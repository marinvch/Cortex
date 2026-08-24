import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { unimported, namedElsewhere, findOrphans } from "../lib/orphans.mjs";

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "cortex-orph-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

const file = (path, over = {}) => ({
  path,
  lang: "javascript",
  category: "code",
  lines: 10,
  bytes: 200,
  isTest: false,
  isEntry: false,
  inbound: 0,
  imports: [],
  ...over,
});

test("a file nothing imports and nothing names is an orphan", () => {
  const root = repo({ "src/dead.js": "export const x = 1;\n", "src/live.js": "export const y = 1;\n" });
  const index = { files: [file("src/dead.js"), file("src/live.js", { inbound: 1 })] };
  assert.deepEqual(
    findOrphans(index, root).map((f) => f.path),
    ["src/dead.js"],
  );
});

test("a CLI invoked from a shell test is not unreferenced", () => {
  // The false positive that prompted this: tools/cortex-version.mjs is what releases this repo and
  // tools/cortex-capability.mjs is what proves its capability table, and both were listed because
  // nothing `import`s them. Cortex reported it about itself.
  const root = repo({
    "tools/release.mjs": "// a CLI\n",
    "tools/test/release.test.sh": 'VER="$REPO_ROOT/tools/release.mjs"\n',
  });
  const index = {
    files: [file("tools/release.mjs"), file("tools/test/release.test.sh", { category: "script", isTest: true })],
  };
  assert.deepEqual(unimported(index).map((f) => f.path), ["tools/release.mjs"], "the import graph alone still flags it");
  assert.deepEqual(findOrphans(index, root), [], "naming it settles the question");
});

test("a doc or an ADR naming the path counts", () => {
  // How repo tooling is normally wired. Excluding docs would have left the original false positives
  // in place, since these two are named by an ADR and by the contributor invariants.
  const root = repo({
    "tools/stamp.mjs": "// a CLI\n",
    "docs/adr/0001-x.md": "Run `node tools/stamp.mjs --set 1.0.0` to propagate.\n",
  });
  const index = { files: [file("tools/stamp.mjs"), file("docs/adr/0001-x.md", { category: "docs" })] };
  assert.deepEqual(findOrphans(index, root), []);
});

test("a file naming itself does not rescue itself", () => {
  // Otherwise every file with a header comment quoting its own path becomes unreportable.
  const root = repo({ "src/dead.js": "// src/dead.js — does nothing\nexport const x = 1;\n" });
  const index = { files: [file("src/dead.js")] };
  assert.deepEqual(
    findOrphans(index, root).map((f) => f.path),
    ["src/dead.js"],
  );
});

test("without a root, only the import graph is consulted", () => {
  // The old, noisier behaviour. A caller that has the root should pass it; one that cannot must get
  // a defined answer rather than a crash.
  const index = { files: [file("tools/release.mjs")] };
  assert.deepEqual(
    findOrphans(index).map((f) => f.path),
    ["tools/release.mjs"],
  );
});

test("entry points and tests are never orphans", () => {
  const root = repo({ "src/main.js": "x", "src/a.test.js": "x" });
  const index = { files: [file("src/main.js", { isEntry: true }), file("src/a.test.js", { isTest: true })] };
  assert.deepEqual(findOrphans(index, root), []);
});

test("an unreadable file costs its mentions, never the finding", () => {
  // The searched file does not exist on disk here; the walk must skip it and still return an answer.
  const root = repo({ "src/dead.js": "export const x = 1;\n" });
  const index = { files: [file("src/dead.js"), file("ghost/missing.js")] };
  assert.equal(findOrphans(index, root).length, 2);
});

test("namedElsewhere reports only what it was asked about", () => {
  const root = repo({
    "a.js": "// mentions tools/b.mjs\n",
    "tools/b.mjs": "// b\n",
    "tools/c.mjs": "// c\n",
  });
  const index = { files: [file("a.js"), file("tools/b.mjs"), file("tools/c.mjs")] };
  const named = namedElsewhere(index, root, ["tools/b.mjs", "tools/c.mjs"]);
  assert.deepEqual([...named], ["tools/b.mjs"]);
});
