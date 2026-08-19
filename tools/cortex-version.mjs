#!/usr/bin/env node
// cortex-version.mjs — the version fact has one home, and this module propagates it.
//
// A Cortex release used to be a memory exercise. The version was authored by hand in eight places
// and verified in five, so the way you found out you had missed one was a test failing *after* the
// mistake — or, for the sites no test covered, not at all. core/package.json sat at 2.2.0 for six
// releases because nothing compared it to anything.
//
// So: VERSION is the interface, and the other sites are implementation. Adding a site means adding
// one entry to SITES below — the list is the single source of truth for both writing and checking,
// which is what stops the checker and the writer from drifting apart the way the sites themselves
// did.
//
//   node tools/cortex-version.mjs             # check — exit 1 on drift, writes nothing
//   node tools/cortex-version.mjs --set 2.9.1 # propagate to every site
//   node tools/cortex-version.mjs --list      # what is a site, and what does it hold now
//
// Deliberately in tools/, not core/: this runs at release time, never at runtime, and ADR 0004 says
// a plugin install runs no build step. core/test/architecture.test.js does not walk tools/, so the
// layering is untouched.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The repo this stamps. Overridable so the tests can run --set against a scratch copy instead of
// against the live tree — a writer that has only ever been checked, never exercised, is the shape
// of bug this module exists to remove.
export const REPO_ROOT =
  process.env.CORTEX_VERSION_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");

/** The `"version": "x.y.z"` of a JSON manifest, matched on the first occurrence only — a nested
 *  dependency version must never be mistaken for the package's own. */
const jsonSite = (path, label) => ({
  path,
  label,
  get: (src) => (src.match(/"version"\s*:\s*"([^"]+)"/) || [])[1] ?? null,
  set: (src, v) => src.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${v}"`),
});

// Scanning lines beats building a RegExp out of a version string: the dots would need escaping,
// and an unescaped `.` quietly matches any character — so `2.9.1` would also accept `2X9Y1`.
const lineStartsWith = (src, prefix) => src.split("\n").some((l) => l.startsWith(prefix));

// Every place the current version appears. Order is reporting order, most authoritative first.
export const SITES = [
  {
    path: "VERSION",
    label: "the source of truth",
    get: (src) => src.trim() || null,
    set: (_src, v) => `${v}\n`,
  },
  jsonSite(".claude-plugin/plugin.json", "what Claude Code installs"),
  jsonSite(".claude-plugin/marketplace.json", "what the marketplace offers"),
  jsonSite("mcp/package.json", "the MCP server package"),
  // The site that rotted. It has no publish step and no test compared it to anything, so it sat six
  // releases behind in silence. It is in the list now, which is the whole point of there being one.
  jsonSite("core/package.json", "the kernel package"),
  {
    path: "README.md",
    label: "the badge line",
    get: (src) => (src.match(/\*\*v(\d+\.\d+\.\d+)\*\*/) || [])[1] ?? null,
    set: (src, v) => src.replace(/\*\*v\d+\.\d+\.\d+\*\*/, `**v${v}**`),
  },
  {
    // The one that gets missed. A missing link reference does not break the build or fail a test —
    // it renders `[2.9.0]` as literal text in the changelog and nobody notices for months. It is
    // fully derivable from the version, so it is generated rather than remembered.
    path: "CHANGELOG.md",
    label: "the release link reference",
    get: (src) => (src.match(/^\[(\d+\.\d+\.\d+)\]:\s*https/m) || [])[1] ?? null,
    set: (src, v) => {
      if (lineStartsWith(src, `[${v}]:`)) return src;
      const first = src.match(/^\[\d+\.\d+\.\d+\]:\s*https.*$/m);
      const line = `[${v}]: https://github.com/marinvch/Cortex/releases/tag/v${v}`;
      if (!first) return `${src.replace(/\s*$/, "")}\n\n${line}\n`;
      return src.replace(first[0], `${line}\n${first[0]}`);
    },
  },
];

// The eighth site, kept separate on purpose: its content is prose, and prose is the one thing a
// generator must not invent. A release entry says what changed and why, which no amount of string
// substitution knows. So this is CHECKED and never written — the tool refuses to stamp a version
// whose changelog entry a human has not written.
export const CHANGELOG_SECTION = {
  path: "CHANGELOG.md",
  label: "the release entry (written by hand, never generated)",
  has: (src, v) => lineStartsWith(src, `## [${v}]`),
};

/** The version every site should agree on. */
export function current() {
  return read("VERSION").trim();
}

/** Sites whose value differs from `version`, plus whether the changelog entry exists. */
export function check(version = current()) {
  const drift = [];
  for (const site of SITES) {
    if (!existsSync(join(REPO_ROOT, site.path))) {
      drift.push({ site, found: "(file missing)" });
      continue;
    }
    const found = site.get(read(site.path));
    if (found !== version) drift.push({ site, found: found ?? "(no version found)" });
  }
  const changelog = CHANGELOG_SECTION.has(read(CHANGELOG_SECTION.path), version);
  return { version, drift, changelog };
}

/** Write `version` into every generated site. Returns the paths actually changed. */
export function set(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`not a version: ${version}`);
  const changed = [];
  for (const site of SITES) {
    const p = join(REPO_ROOT, site.path);
    if (!existsSync(p)) throw new Error(`site is missing: ${site.path}`);
    const src = readFileSync(p, "utf8");
    const next = site.set(src, version);
    if (next !== src) {
      writeFileSync(p, next);
      changed.push(site.path);
    }
  }
  return changed;
}

// --- CLI -------------------------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const setIdx = args.indexOf("--set");

  if (args.includes("--list")) {
    const v = current();
    console.log(`VERSION says ${v}\n`);
    for (const s of SITES) {
      const found = existsSync(join(REPO_ROOT, s.path)) ? s.get(read(s.path)) : "(file missing)";
      console.log(`  ${found === v ? "ok  " : "DRIFT"}  ${s.path.padEnd(32)} ${found}   — ${s.label}`);
    }
    console.log(`\n  ${CHANGELOG_SECTION.has(read("CHANGELOG.md"), v) ? "ok  " : "MISSING"}  ${CHANGELOG_SECTION.label}`);
    process.exit(0);
  }

  if (setIdx !== -1) {
    const v = args[setIdx + 1];
    if (!v) { console.error("usage: cortex-version.mjs --set <x.y.z>"); process.exit(2); }
    const changed = set(v);
    console.log(changed.length ? `stamped ${v}:\n${changed.map((p) => `  ${p}`).join("\n")}` : `already ${v} everywhere`);
    if (!CHANGELOG_SECTION.has(read("CHANGELOG.md"), v)) {
      console.error(`\nCHANGELOG.md has no "## [${v}]" entry. Write it by hand — a release entry says\nwhat changed and why, which this tool has no way to know.`);
      process.exit(1);
    }
    process.exit(0);
  }

  const { version, drift, changelog } = check();
  if (!drift.length && changelog) {
    console.log(`every version site agrees on ${version}`);
    process.exit(0);
  }
  for (const d of drift) console.error(`DRIFT  ${d.site.path} says ${d.found}, VERSION says ${version}`);
  if (!changelog) console.error(`MISSING  CHANGELOG.md has no "## [${version}]" entry`);
  console.error(`\nFix: node tools/cortex-version.mjs --set ${version}`);
  process.exit(1);
}
