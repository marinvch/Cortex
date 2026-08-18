// The structural rule behind the Vault module: `mcp/lib/vault.js` is the ONLY place that joins a
// path onto a vault root.
//
// This exists because the traversal fix that landed standalone was a lock on one door in a building
// with three. `getProjectContext` was patched to route both candidate paths through `resolveInRoot`,
// which was correct and insufficient — `cortexignore`, `projects` and `recall` each still joined
// onto the root themselves. Path safety was something five modules had to remember, and the way you
// find out one of them forgot is a disclosure bug.
//
// Same instinct as core/test/architecture.test.js: a rule a test enforces is cheaper than a rule
// everyone has to remember. That one exists because the layering was already broken once; this one
// exists because the guard was already bypassed once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

// Files allowed to join onto a root. Each needs a reason, because an allowlist without reasons
// becomes a place to hide a bug.
const ALLOWED = new Map([
  // The door itself.
  ["lib/vault.js", "the Vault module is the one place a vault path is constructed"],
  // Joins onto the CORTEX INSTALL DIRECTORY, not a vault. Different root, and the vault guard has
  // no authority over it — refusing these would be a category error, not extra safety.
  ["lib/version.js", "reads VERSION and package.json from the install dir, not a vault"],
  ["lib/setup-plugins.js", "reads the bundle manifest from the install dir, not a vault"],
  // Verified, not assumed: teamCloneDir joins slugify(team) onto the root, and slugify reduces
  // any run of non-alphanumerics — including `..` — to a single dash or the empty string, so a
  // traversal cannot survive it. The spec keeps gitsync separate as a genuinely different concern
  // (remote sync, not vault access). Do not "fix" this into the vault without re-reading slug.js.
  ["lib/gitsync.js", "joins a slugified team name; slugify cannot emit a traversal segment"],
]);

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "test" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

// A join/resolve whose FIRST argument is a root-ish identifier. Deliberately syntactic rather than
// clever: this must be obvious to a reader, and a false positive is a prompt to use the vault.
const ROOT_JOIN = /\b(?:join|resolve)\s*\(\s*(root|vaultRoot|aiOsRoot|AI_OS_ROOT)\b/;

test("vault.js is the only door onto a vault root", () => {
  const offenders = [];
  for (const file of sourceFiles(MCP_DIR)) {
    const rel = relative(MCP_DIR, file).split(/[\\/]/).join("/");
    if (ALLOWED.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    src.split("\n").forEach((line, i) => {
      // Comments are prose, not calls. Without this the check flags the very comment explaining why
      // the check exists — which it did, in recall.js. A rule that cannot survive being written
      // about is too brittle to keep.
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      if (ROOT_JOIN.test(line)) offenders.push(`${rel}:${i + 1}  ${trimmed}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `these join onto a vault root outside vault.js — route them through the Vault instead:\n${offenders.join("\n")}`,
  );
});

// The root-join scan above is syntactic, and syntax is not the whole rule: `recall.js` seeds a
// recursive walk with `walk(root, "")` and then joins onto a local `dir`, so it bypasses the guard
// without ever writing `join(root, …)`. Rather than teach the regex to chase a variable through a
// closure — which would make the check clever and unreadable — the rule is stated directly for the
// modules the collapse converts: a vault caller does not touch the filesystem at all. It asks the
// Vault.
//
// This is deliberately a named list, not "every file under lib/". Ten modules import node:fs today
// and most are not vault readers (`digest`, `team`, `catchup`, `version`). A blanket ban would need
// a six-entry allowlist, and an allowlist that size stops being a rule.
const VAULT_CALLERS = ["cortexignore.js", "projects.js", "recall.js", "capture.js"];

test("the Vault's callers do not touch the filesystem themselves", () => {
  const offenders = [];
  for (const name of VAULT_CALLERS) {
    const src = readFileSync(join(MCP_DIR, "lib", name), "utf8");
    if (/from "node:fs"/.test(src)) offenders.push(`lib/${name}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `these still read or write the filesystem directly; the Vault is the door:\n${offenders.join("\n")}`,
  );
});

test("the allowlist stays small and every entry still exists", () => {
  // An allowlist is a liability. If it grows, the rule is being negotiated with rather than kept.
  assert.ok(ALLOWED.size <= 4, "adding a fourth exception means re-reading the invariant, not editing this number");
  for (const rel of ALLOWED.keys()) {
    assert.doesNotThrow(
      () => statSync(join(MCP_DIR, rel)),
      `allowlisted '${rel}' no longer exists — delete the entry rather than leaving a stale exemption`,
    );
  }
});
