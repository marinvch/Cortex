// mcp/test/cortexignore.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCortexignore, makeIgnoreFilter, loadCortexignore } from "../lib/cortexignore.js";

test("parses the three pattern forms", () => {
  const p = parseCortexignore("docs/\n*.example.md\nREADME.md\n");
  assert.equal(p.dirs.length, 1);
  assert.equal(p.files.length, 2);
  assert.ok(p.dirs[0].test("docs/"));
  assert.ok(p.dirs[0].test("a/b/docs/"));
  assert.ok(p.files.some((re) => re.test("home.example.md")));
  assert.ok(p.files.some((re) => re.test("skills/README.md")));
});

test("ignores comments, inline comments and blank lines", () => {
  const p = parseCortexignore("# a comment\n\n  docs/   # trailing note\n\n   \n");
  assert.equal(p.dirs.length, 1);
  assert.equal(p.files.length, 0);
  assert.ok(p.dirs[0].test("docs/"));
});

test("glob matches only the final segment, not across directories", () => {
  const p = parseCortexignore("*.html\n");
  assert.ok(p.files[0].test("cortex.html"));
  assert.ok(p.files[0].test("a/b/cortex.html"));
  assert.ok(!p.files[0].test("cortex.html.md"));
});

test("dots are literal, not regex wildcards", () => {
  const p = parseCortexignore("README.md\n");
  assert.ok(p.files[0].test("README.md"));
  assert.ok(!p.files[0].test("READMExmd"));
});

test("loadCortexignore returns null when the vault has none", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  assert.equal(loadCortexignore(root), null);
});

test("without .cortexignore, falls back to pre-1.1 skip list", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const { skipDir, skipFile } = makeIgnoreFilter(root);
  assert.ok(skipDir("archives"));
  assert.ok(skipDir(".git"));
  assert.ok(skipDir("node_modules"));
  assert.ok(!skipDir("notes"));
  assert.ok(!skipFile("anything.md"));
});

test("with .cortexignore, .git and node_modules are still always pruned", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  // A .cortexignore that mentions neither of them.
  writeFileSync(join(root, ".cortexignore"), "docs/\n");
  const { skipDir } = makeIgnoreFilter(root);
  assert.ok(skipDir(".git"));
  assert.ok(skipDir("node_modules"));
  assert.ok(skipDir("docs"));
  assert.ok(!skipDir("archives"), "archives is only skipped when .cortexignore says so");
});

test("nested directories match the dir form at any depth", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  writeFileSync(join(root, ".cortexignore"), ".backups/\n");
  const { skipDir } = makeIgnoreFilter(root);
  assert.ok(skipDir("context/.backups"));
  assert.ok(!skipDir("context"));
});

test("agrees with the bash knowledge_files() filter on a representative vault", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  writeFileSync(join(root, ".cortexignore"), "# noise\ndocs/\nskills/\n*.example.md\nREADME.md\n");
  for (const d of ["docs", "skills", "notes"]) mkdirSync(join(root, d));
  const { skipDir, skipFile } = makeIgnoreFilter(root);
  assert.ok(skipDir("docs"));
  assert.ok(skipDir("skills"));
  assert.ok(!skipDir("notes"));
  assert.ok(skipFile("home.example.md"));
  assert.ok(skipFile("README.md"));
  assert.ok(skipFile("notes/README.md"));
  assert.ok(!skipFile("notes/idea.md"));
});
