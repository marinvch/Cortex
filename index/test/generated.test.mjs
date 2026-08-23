import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureGitignored, ensureGeneratedDir, GENERATED_DIRS } from "../lib/generated.mjs";

function repo(gitignore = null) {
  const root = mkdtempSync(join(tmpdir(), "cortex-gen-"));
  if (gitignore !== null) writeFileSync(join(root, ".gitignore"), gitignore);
  return root;
}
const read = (root) => readFileSync(join(root, ".gitignore"), "utf8");

test("the generated dirs are ignored, and memory/ deliberately is not", () => {
  // The asymmetry is the product's: .cortex/memory/ is committed, because that is how several
  // developers share one context. Ignoring the parent would silently reverse that decision.
  const root = repo("node_modules/\n");
  const added = ensureGitignored(root);
  assert.deepEqual(added, GENERATED_DIRS);
  const txt = read(root);
  assert.ok(txt.includes(".cortex/index/"));
  assert.ok(txt.includes(".cortex/view/"));
  // On entries, not substrings: the marker comment names memory/ precisely to explain why it is
  // absent, so a substring check passes only by accident and fails for the wrong reason.
  const entries = txt.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  assert.ok(!entries.includes(".cortex/memory/"), "memory is committed, never ignored");
  assert.ok(!entries.includes(".cortex/"), "and the parent is not ignored either — that would hide it");
  assert.ok(txt.startsWith("node_modules/"), "existing content is untouched");
});

test("running twice adds nothing the second time", () => {
  // Every CLI calls this on every run. Appending each time would grow a user's .gitignore forever.
  const root = repo("");
  ensureGitignored(root);
  const once = read(root);
  assert.deepEqual(ensureGitignored(root), []);
  assert.equal(read(root), once);
});

test("a broader .cortex/ the user wrote themselves is honoured, not duplicated", () => {
  // Narrower entries under it would be noise — and worse, they would imply memory/ is tracked when
  // that line already ignores it. Their file, their decision; we do not argue with it in-place.
  const root = repo(".cortex/\n");
  assert.deepEqual(ensureGitignored(root), []);
  assert.equal(read(root), ".cortex/\n");
});

test("an entry already present individually is not repeated", () => {
  const root = repo(".cortex/index/\n");
  const added = ensureGitignored(root);
  assert.deepEqual(added, [".cortex/findings/", ".cortex/view/"]);
  assert.equal(read(root).match(/\.cortex\/index\//g).length, 1);
});

test("a repo with no .gitignore gets one", () => {
  const root = repo(null);
  assert.deepEqual(ensureGitignored(root), GENERATED_DIRS);
  assert.ok(existsSync(join(root, ".gitignore")));
});

test("a missing trailing newline does not glue our block onto the last entry", () => {
  const root = repo("dist");
  ensureGitignored(root);
  const lines = read(root).split("\n");
  assert.equal(lines[0], "dist", "the last existing entry survives intact");
  assert.ok(lines.includes(".cortex/index/"));
});

test("creating the directory reports whether it was the first write", () => {
  // "Generated and gitignored is not the same as invisible" — the CLIs print this, so a directory
  // appearing on a run the user did not ask for is at least visible to them.
  const root = repo("");
  const first = ensureGeneratedDir(root, join(root, ".cortex", "index"));
  assert.equal(first.created, true);
  assert.deepEqual(first.ignored, GENERATED_DIRS);

  const second = ensureGeneratedDir(root, join(root, ".cortex", "findings"));
  assert.equal(second.created, false, "only the first call created .cortex/");
  assert.deepEqual(second.ignored, []);
});

test("an unwritable .gitignore costs the entry, never the run", () => {
  // The directory still has to be created; losing an ignore line must not fail an index.
  const root = repo("");
  mkdirSync(join(root, ".gitignore.d"), { recursive: true });
  // A directory where the file should be: reading and writing both fail, and neither may throw.
  const dirAsFile = mkdtempSync(join(tmpdir(), "cortex-gen-ro-"));
  mkdirSync(join(dirAsFile, ".gitignore"), { recursive: true });
  const res = ensureGeneratedDir(dirAsFile, join(dirAsFile, ".cortex", "index"));
  assert.equal(res.created, true);
  assert.deepEqual(res.ignored, []);
  assert.ok(existsSync(join(dirAsFile, ".cortex", "index")), "the directory is still created");
});
