import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { listFiles } from "../lib/walk.mjs";

function git(root, ...args) {
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd: root,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

/** A git repo whose bin/ and obj/ hold hand-written source, the way an ops repo does. */
function gitFixture() {
  const root = tempDir("cortex-walk-");
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "obj"));
  mkdirSync(join(root, "node_modules", "junk"), { recursive: true });
  writeFileSync(join(root, "bin", "tool.sh"), "#!/bin/sh\necho hi\n");
  writeFileSync(join(root, "obj", "model.cs"), "class Model {}\n");
  writeFileSync(join(root, "node_modules", "junk", "x.js"), "module.exports = 1;\n");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}

const paths = (root) => listFiles(root).files.map((f) => f.path);

test("git-tracked source under bin/ and obj/ is indexed, not silently dropped", () => {
  const root = gitFixture();
  const found = paths(root);

  assert.ok(found.includes("bin/tool.sh"), "a tracked bin/ script is source, not build output");
  assert.ok(found.includes("obj/model.cs"), "a tracked obj/ file is source too");
  assert.ok(found.includes("README.md"));
});

test("an untracked file under bin/ is still skipped — only git may override the name", () => {
  const root = gitFixture();
  writeFileSync(join(root, "bin", "compiled"), "binary-ish output\n");
  const found = paths(root);

  assert.ok(!found.includes("bin/compiled"), "bin/ still means build output until git says otherwise");
  assert.ok(found.includes("bin/tool.sh"), "and the tracked sibling survives");
});

test("tracking does not rescue node_modules — that name is never ambiguous", () => {
  const root = gitFixture();

  assert.ok(!paths(root).some((p) => p.startsWith("node_modules/")), "vendored deps stay out even when committed");
});

test("outside a git repo, bin/ and obj/ are skipped as before", () => {
  const root = tempDir("cortex-walk-nogit-");
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "tool.sh"), "#!/bin/sh\necho hi\n");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  const found = paths(root);

  assert.ok(!found.includes("bin/tool.sh"), "with no git to ask, the name is all we have");
  assert.ok(found.includes("README.md"));
});

// A guess the reader never sees is the half of #360 that cost the most: the count looked complete.

test("a file dropped by an ambiguous directory name is reported, not passed over in silence", () => {
  const root = gitFixture();
  writeFileSync(join(root, "bin", "generated.sh"), "#!/bin/sh\necho generated\n");
  writeFileSync(join(root, "bin", "also-generated.sh"), "#!/bin/sh\necho too\n");

  assert.deepEqual(listFiles(root).skipped, [{ dir: "bin", files: 2 }]);
});

test("the report covers the non-git case too, where every ambiguous name is a guess", () => {
  const root = tempDir("cortex-walk-nogit-");
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "obj"));
  writeFileSync(join(root, "bin", "tool.sh"), "#!/bin/sh\necho hi\n");
  writeFileSync(join(root, "obj", "model.cs"), "class Model {}\n");
  writeFileSync(join(root, "README.md"), "# fixture\n");

  assert.deepEqual(listFiles(root).skipped, [
    { dir: "bin", files: 1 },
    { dir: "obj", files: 1 },
  ]);
});

test("names Cortex is certain about are not reported — only the guesses are", () => {
  const root = gitFixture();

  assert.deepEqual(listFiles(root).skipped, [], "node_modules/ is not a guess, so it is not a gap");
});

test("a compiled artefact under bin/ is not reported as hidden source", () => {
  const root = gitFixture();
  writeFileSync(join(root, "bin", "tool.exe"), "MZ\n");
  writeFileSync(join(root, "bin", "lib.so"), "ELF\n");

  assert.deepEqual(listFiles(root).skipped, [], "the count must mean readable source, or it is noise");
});

// #529: `vendor/` is somebody else's code by Linguist's default. It is left out and counted, and the
// repo — not git tracking, which a committed Go tree also has — says when it is the team's own.

/** A git repo with a committed Go-style vendor/ tree and the team's own code beside it. */
function vendorFixture(attributes = null) {
  const root = tempDir("cortex-walk-vendor-");
  mkdirSync(join(root, "vendor", "github.com", "x", "y"), { recursive: true });
  mkdirSync(join(root, "cmd"));
  writeFileSync(join(root, "vendor", "github.com", "x", "y", "y.go"), "package y\n");
  writeFileSync(join(root, "vendor", "github.com", "x", "y", "z.go"), "package y\n");
  writeFileSync(join(root, "vendor", "modules.txt"), "# github.com/x/y\n");
  writeFileSync(join(root, "cmd", "main.go"), "package main\n");
  if (attributes !== null) writeFileSync(join(root, ".gitattributes"), attributes);
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}

test("a tracked vendor/ is left out by default, and counted rather than dropped in silence", () => {
  const root = vendorFixture();
  const { files, skipped } = listFiles(root);

  assert.ok(!files.some((f) => f.path.startsWith("vendor/")), "a committed Go tree is still not the team's code");
  assert.ok(files.some((f) => f.path === "cmd/main.go"));
  assert.deepEqual(skipped, [{ dir: "vendor", files: 3 }]);
});

test("`-linguist-vendored` in .gitattributes indexes vendor/ as the team's own, a subtree at a time", () => {
  const all = vendorFixture("vendor/** -linguist-vendored\n");
  assert.ok(paths(all).includes("vendor/github.com/x/y/y.go"));
  assert.deepEqual(listFiles(all).skipped, []);

  const part = vendorFixture("vendor/github.com/** linguist-vendored=false\n");
  assert.ok(paths(part).includes("vendor/github.com/x/y/z.go"), "linguist-vendored=false says the same");
  assert.ok(!paths(part).includes("vendor/modules.txt"), "what the attribute does not cover stays out");
  assert.deepEqual(listFiles(part).skipped, [{ dir: "vendor", files: 1 }]);
});

test("a nested vendor/ is the same directory, and outside git it is pruned with no count", () => {
  const root = vendorFixture();
  mkdirSync(join(root, "app", "vendor"), { recursive: true });
  writeFileSync(join(root, "app", "vendor", "lib.js"), "module.exports = 1;\n");
  assert.ok(!paths(root).includes("app/vendor/lib.js"));

  const nogit = tempDir("cortex-walk-nogit-");
  mkdirSync(join(nogit, "vendor"));
  writeFileSync(join(nogit, "vendor", "a.go"), "package a\n");
  writeFileSync(join(nogit, "README.md"), "# fixture\n");
  assert.deepEqual(listFiles(nogit), { files: [{ path: "README.md", lines: 2, bytes: 10 }], skipped: [] });
});
