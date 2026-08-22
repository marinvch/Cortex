import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
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
  const root = mkdtempSync(join(tmpdir(), "cortex-walk-"));
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

test("git-tracked source under bin/ and obj/ is indexed, not silently dropped", () => {
  const root = gitFixture();
  const paths = listFiles(root).map((f) => f.path);

  assert.ok(paths.includes("bin/tool.sh"), "a tracked bin/ script is source, not build output");
  assert.ok(paths.includes("obj/model.cs"), "a tracked obj/ file is source too");
  assert.ok(paths.includes("README.md"));
});

test("an untracked file under bin/ is still skipped — only git may override the name", () => {
  const root = gitFixture();
  writeFileSync(join(root, "bin", "compiled"), "binary-ish output\n");
  const paths = listFiles(root).map((f) => f.path);

  assert.ok(!paths.includes("bin/compiled"), "bin/ still means build output until git says otherwise");
  assert.ok(paths.includes("bin/tool.sh"), "and the tracked sibling survives");
});

test("tracking does not rescue node_modules — that name is never ambiguous", () => {
  const root = gitFixture();
  const paths = listFiles(root).map((f) => f.path);

  assert.ok(!paths.some((p) => p.startsWith("node_modules/")), "vendored deps stay out even when committed");
});

test("outside a git repo, bin/ and obj/ are skipped as before", () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-walk-nogit-"));
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "tool.sh"), "#!/bin/sh\necho hi\n");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  const paths = listFiles(root).map((f) => f.path);

  assert.ok(!paths.includes("bin/tool.sh"), "with no git to ask, the name is all we have");
  assert.ok(paths.includes("README.md"));
});
