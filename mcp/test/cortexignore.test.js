// mcp/test/cortexignore.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
// No filesystem imports: this module is pure now. It decides what the patterns MEAN, and the Vault
// fetches the text. A test that needed a temp directory to check a regex was telling us something.
import { parseCortexignore, makeIgnoreFilter } from "../lib/cortexignore.js";

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

// `loadCortexignore(root)` used to live here and read the file itself. It is gone: reading a vault
// path is the Vault's job now (docs/adr/0007). What it actually verified — that a vault with no
// .cortexignore falls back rather than failing — is covered from both sides: `makeIgnoreFilter(null)`
// below is the null contract, and vault.test.js's "without a .cortexignore, list falls back to
// skipping archives and README" is the end-to-end behaviour.
test("a null text means 'this vault has no .cortexignore', not 'ignore nothing'", () => {
  const { skipDir } = makeIgnoreFilter(null);
  assert.ok(skipDir("archives"), "the fallback list applies; null is not an empty ruleset");
});

test("without .cortexignore, falls back to pre-1.1 skip list", () => {
  const { skipDir, skipFile } = makeIgnoreFilter(null);
  assert.ok(skipDir("archives"));
  assert.ok(skipDir(".git"));
  assert.ok(skipDir("node_modules"));
  assert.ok(!skipDir("notes"));
  assert.ok(!skipFile("anything.md"));
});

test("without .cortexignore, README.md is scaffolding, not knowledge", () => {
  // A fresh vault ships no .cortexignore, and nothing seeds one. Without this fallback every
  // consumer has to hand-code its own README exclusion — projects.js did exactly that.
  const { skipFile } = makeIgnoreFilter(null);
  assert.ok(skipFile("README.md"));
  assert.ok(skipFile("projects/README.md"));
  assert.ok(!skipFile("readme-notes.md"));
});

test("a .cortexignore that omits README.md is respected — the file stays the source of truth", () => {
  const { skipFile } = makeIgnoreFilter("docs/\n");
  assert.ok(!skipFile("README.md"));
});

test("with .cortexignore, .git and node_modules are still always pruned", () => {
  // A .cortexignore that mentions neither of them.
  const { skipDir } = makeIgnoreFilter("docs/\n");
  assert.ok(skipDir(".git"));
  assert.ok(skipDir("node_modules"));
  assert.ok(skipDir("docs"));
  assert.ok(!skipDir("archives"), "archives is only skipped when .cortexignore says so");
});

test("nested directories match the dir form at any depth", () => {
  const { skipDir } = makeIgnoreFilter(".backups/\n");
  assert.ok(skipDir("context/.backups"));
  assert.ok(!skipDir("context"));
});

test("agrees with the bash knowledge_files() filter on a representative vault", () => {
  const { skipDir, skipFile } = makeIgnoreFilter("# noise\ndocs/\nskills/\n*.example.md\nREADME.md\n");
  assert.ok(skipDir("docs"));
  assert.ok(skipDir("skills"));
  assert.ok(!skipDir("notes"));
  assert.ok(skipFile("home.example.md"));
  assert.ok(skipFile("README.md"));
  assert.ok(skipFile("notes/README.md"));
  assert.ok(!skipFile("notes/idea.md"));
});
