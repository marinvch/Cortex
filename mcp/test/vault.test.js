// The Vault module: the one door onto a vault root.
//
// The refusal cases here are not edge cases — they are the reason this module exists. Every
// operation that takes a caller-supplied path must refuse one that escapes the root, because
// "the caller will pass something sensible" is exactly the assumption that produced the
// getProjectContext disclosure bug.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { openVault } from "../lib/vault.js";
import { OutsideRootError } from "../../core/paths.js";

function seed() {
  const root = mkdtempSync(join(tmpdir(), "vault-mod-"));
  mkdirSync(join(root, "projects", "client"), { recursive: true });
  writeFileSync(join(root, "notes.md"), "top level note\n");
  writeFileSync(join(root, "projects", "alpha.md"), "# Alpha\n");
  writeFileSync(join(root, "projects", "client", "beta.md"), "# Beta\n");
  writeFileSync(join(root, "notes.txt"), "not markdown\n");
  return root;
}

test("read returns file contents", () => {
  const v = openVault(seed());
  assert.match(v.read("notes.md"), /top level note/);
});

test("exists answers without throwing for a missing file", () => {
  const v = openVault(seed());
  assert.equal(v.exists("notes.md"), true);
  assert.equal(v.exists("ghost.md"), false);
});

test("abs returns an absolute path under the root", () => {
  const root = seed();
  const v = openVault(root);
  const p = v.abs("notes.md");
  assert.ok(isAbsolute(p));
  assert.ok(p.startsWith(root));
});

test("write creates parent directories and overwrites", () => {
  const root = seed();
  const v = openVault(root);
  v.write("daily/2026-08-18.md", "first\n");
  assert.equal(readFileSync(join(root, "daily", "2026-08-18.md"), "utf8"), "first\n");
  v.write("daily/2026-08-18.md", "second\n");
  assert.equal(readFileSync(join(root, "daily", "2026-08-18.md"), "utf8"), "second\n");
});

test("append creates parent directories and appends", () => {
  const root = seed();
  const v = openVault(root);
  v.append("inbox/notes.md", "one\n");
  v.append("inbox/notes.md", "two\n");
  assert.equal(readFileSync(join(root, "inbox", "notes.md"), "utf8"), "one\ntwo\n");
});

test("list walks recursively and returns root-relative POSIX paths", () => {
  const v = openVault(seed());
  const found = v.list("", { ext: ".md" }).sort();
  assert.deepEqual(found, ["notes.md", "projects/alpha.md", "projects/client/beta.md"]);
  for (const p of found) assert.ok(!isAbsolute(p), `list must return root-relative paths, got '${p}'`);
});

test("list scopes to a subdirectory", () => {
  const v = openVault(seed());
  const found = v.list("projects", { ext: ".md" }).sort();
  assert.deepEqual(found, ["projects/alpha.md", "projects/client/beta.md"]);
});

test("list filters by extension, and returns everything when ext is omitted", () => {
  const v = openVault(seed());
  assert.ok(!v.list("", { ext: ".md" }).includes("notes.txt"));
  assert.ok(v.list("").includes("notes.txt"));
});

test("list returns [] for a missing scope rather than throwing", () => {
  const v = openVault(seed());
  assert.deepEqual(v.list("nope"), []);
});

test("list applies .cortexignore to directories and files", () => {
  const root = seed();
  mkdirSync(join(root, "vendor"), { recursive: true });
  writeFileSync(join(root, "vendor", "dep.md"), "vendored\n");
  writeFileSync(join(root, "scratch.tmp.md"), "scratch\n");
  writeFileSync(join(root, ".cortexignore"), "vendor/\n*.tmp.md\n");

  const found = openVault(root).list("", { ext: ".md" });
  assert.ok(!found.some((p) => p.startsWith("vendor/")), "an ignored directory is pruned");
  assert.ok(!found.includes("scratch.tmp.md"), "an ignored file glob is skipped");
  assert.ok(found.includes("notes.md"));
});

test("list always skips node_modules and .git, even with a .cortexignore present", () => {
  const root = seed();
  writeFileSync(join(root, ".cortexignore"), "nothing-real/\n");
  for (const d of ["node_modules", ".git"]) {
    mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, d, "junk.md"), "junk\n");
  }
  const found = openVault(root).list("", { ext: ".md" });
  assert.ok(!found.some((p) => p.startsWith("node_modules/") || p.startsWith(".git/")));
});

test("without a .cortexignore, list falls back to skipping archives and README", () => {
  const root = seed();
  mkdirSync(join(root, "archives"), { recursive: true });
  writeFileSync(join(root, "archives", "old.md"), "old\n");
  writeFileSync(join(root, "README.md"), "readme\n");
  const found = openVault(root).list("", { ext: ".md" });
  assert.ok(!found.some((p) => p.startsWith("archives/")), "pre-1.1 recall behaviour is preserved");
  assert.ok(!found.includes("README.md"));
});

// --- The refusals. This is what the module is for. ---

for (const escape of ["../escape.md", "../../etc/passwd", "projects/../../escape.md"]) {
  test(`every operation refuses an escaping path: ${escape}`, () => {
    const v = openVault(seed());
    assert.throws(() => v.abs(escape), OutsideRootError);
    assert.throws(() => v.read(escape), OutsideRootError);
    assert.throws(() => v.write(escape, "x"), OutsideRootError);
    assert.throws(() => v.append(escape, "x"), OutsideRootError);
    assert.throws(() => v.exists(escape), OutsideRootError);
  });
}

test("exists refuses rather than answering false for an escaping path", () => {
  // Answering "false" would be a disclosure channel: it confirms the path is outside the root, and
  // it teaches callers that exists() is safe to call on untrusted input. Refusing is the answer.
  const v = openVault(seed());
  assert.throws(() => v.exists("../escape.md"), (e) => e.code === "outside_root");
});

test("list never escapes the root via a scope argument", () => {
  const v = openVault(seed());
  assert.throws(() => v.list(".."), OutsideRootError);
});
