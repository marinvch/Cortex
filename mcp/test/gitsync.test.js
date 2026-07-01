import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAndPush, pull, teamCloneDir } from "../lib/gitsync.js";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

// Local bare "remote" + a working clone, both pinned to the 'master' branch so
// push.default=simple pushes cleanly (avoids main/master mismatch flakiness).
function setup() {
  const remote = mkdtempSync(join(tmpdir(), "remote-"));
  git(remote, "init", "--bare", "-q", "-b", "master");
  const clone = mkdtempSync(join(tmpdir(), "clone-"));
  git(clone, "clone", "-q", remote, ".");
  git(clone, "config", "user.email", "t@t");
  git(clone, "config", "user.name", "t");
  writeFileSync(join(clone, "seed.md"), "seed");
  git(clone, "add", ".");
  git(clone, "commit", "-qm", "seed");
  git(clone, "branch", "-M", "master");            // force local branch name to master
  git(clone, "push", "-q", "-u", "origin", "master"); // push + set upstream (names match)
  return { remote, clone };
}

test("teamCloneDir builds path under root/team", () => {
  assert.match(teamCloneDir("/vault", "acme"), /team[\\/]acme$/);
});

test("commitAndPush pushes a note to the bare remote", () => {
  const { clone } = setup();
  writeFileSync(join(clone, "note.md"), "hello");
  const res = commitAndPush(clone, ["note.md"], "add note");
  assert.equal(res.ok, true);
  assert.equal(res.pushed, true);
});

test("commitAndPush refuses a non-git dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "plain-"));
  const res = commitAndPush(dir, ["x.md"], "m");
  assert.equal(res.ok, false);
});

test("pull --ff-only succeeds on a clean clone", () => {
  const { clone } = setup();
  const res = pull(clone);
  assert.equal(res.ok, true);
});
