import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commitAndPush, commitPath, pull, pushHead, teamCloneDir } from "../lib/gitsync.js";
import { tempDir } from "./tmp.js";
import { policyFor } from "../../core/profile.js";

const HOME = { policy: policyFor("home") };

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

// Local bare "remote" + a working clone, both pinned to the 'master' branch so
// push.default=simple pushes cleanly (avoids main/master mismatch flakiness).
function setup() {
  const remote = tempDir("remote-");
  git(remote, "init", "--bare", "-q", "-b", "master");
  const clone = tempDir("clone-");
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

test("teamCloneDir slugifies the team name", () => {
  assert.match(teamCloneDir("/vault", "Acme Corp"), /team[\\/]acme-corp$/);
});

test("commitAndPush pushes a note to the bare remote", () => {
  const { clone } = setup();
  writeFileSync(join(clone, "note.md"), "hello");
  const res = commitAndPush(clone, ["note.md"], "add note", HOME);
  assert.equal(res.ok, true);
  assert.equal(res.pushed, true);
});

test("commitAndPush refuses a non-git dir", () => {
  const dir = tempDir("plain-");
  const res = commitAndPush(dir, ["x.md"], "m", HOME);
  assert.equal(res.ok, false);
});

test("pull --ff-only succeeds on a clean clone", () => {
  const { clone } = setup();
  const res = pull(clone, HOME);
  assert.equal(res.ok, true);
});

// --- a lost push race (ADR 0032) -------------------------------------------------------------------

/** A clone and a teammate's clone of the same remote. */
function pair() {
  const { remote, clone } = setup();
  const mate = tempDir("mate-");
  git(mate, "clone", "-q", remote, ".");
  git(mate, "config", "user.email", "m@m");
  git(mate, "config", "user.name", "m");
  return { remote, clone, mate };
}
function commitFile(dir, file, text, message = file) {
  writeFileSync(join(dir, file), text);
  git(dir, "add", file);
  git(dir, "commit", "-qm", message);
}
const counts = (dir) => git(dir, "rev-list", "--left-right", "--count", "HEAD...@{upstream}").trim().split(/\s+/).map(Number);
const midRebase = (dir) => existsSync(join(dir, ".git", "rebase-merge")) || existsSync(join(dir, ".git", "rebase-apply"));

test("a push that lost the race replays and lands, with both commits on the remote", () => {
  const { remote, clone, mate } = pair();
  commitFile(mate, "theirs.md", "t");
  git(mate, "push", "-q");
  writeFileSync(join(clone, "mine.md"), "m");
  const res = commitAndPush(clone, ["mine.md"], "mine", HOME);
  assert.equal(res.pushed, true, res.error);
  const log = git(remote, "log", "--format=%s", "master");
  assert.match(log, /mine/);
  assert.match(log, /theirs/);
});

test("pushHead recovers the same way", () => {
  const { remote, clone, mate } = pair();
  commitFile(mate, "theirs.md", "t");
  git(mate, "push", "-q");
  writeFileSync(join(clone, "mine.md"), "m");
  assert.equal(commitPath(clone, "mine.md", "mine").committed, true);
  const res = pushHead(clone, HOME);
  assert.equal(res.ok, true, res.error);
  assert.match(git(remote, "log", "--format=%s", "master"), /mine/);
});

test("a clone already stuck ahead 2, behind 1 is repaired by a pull, which does not push", () => {
  const { remote, clone, mate } = pair();
  commitFile(mate, "theirs.md", "t");
  git(mate, "push", "-q");
  commitFile(clone, "a.md", "a");
  commitFile(clone, "b.md", "b");
  git(clone, "fetch", "-q");
  assert.deepEqual(counts(clone), [2, 1]);
  const before = git(remote, "rev-parse", "master").trim();
  const res = pull(clone, HOME);
  assert.equal(res.ok, true, res.error);
  assert.equal(res.replayed, 2);
  assert.deepEqual(counts(clone), [2, 0]);
  assert.equal(git(remote, "rev-parse", "master").trim(), before, "a pull publishes nothing");
});

test("a conflict aborts: no rebase in progress, HEAD as it was, the commit intact, the files named", () => {
  const { clone, mate } = pair();
  commitFile(mate, "ask.md", "their answer\n");
  git(mate, "push", "-q");
  commitFile(clone, "ask.md", "my answer\n");
  const head = git(clone, "rev-parse", "HEAD").trim();
  const res = pull(clone, HOME);
  assert.equal(res.ok, false);
  assert.match(res.error, /diverged_conflict/);
  assert.match(res.error, /ask\.md/);
  assert.match(res.error, /resolve-conflicts/);
  assert.equal(midRebase(clone), false);
  assert.equal(git(clone, "rev-parse", "HEAD").trim(), head);
  // Line endings are git's to choose on checkout: with core.autocrlf the abort writes CRLF.
  assert.equal(readFileSync(join(clone, "ask.md"), "utf8").replace(/\r\n/g, "\n"), "my answer\n");
  assert.equal(git(clone, "status", "--porcelain").trim(), "");
});

test("the same conflict on a push reports it and keeps the commit", () => {
  const { clone, mate } = pair();
  commitFile(mate, "ask.md", "their answer\n");
  git(mate, "push", "-q");
  writeFileSync(join(clone, "ask.md"), "my answer\n");
  const res = commitAndPush(clone, ["ask.md"], "mine", HOME);
  assert.equal(res.pushed, false);
  assert.match(res.error, /^push_failed: diverged_conflict/);
  assert.equal(midRebase(clone), false);
  assert.match(git(clone, "log", "-1", "--format=%s"), /mine/);
});

test("changed tracked files stop the recovery and are not touched", () => {
  const { clone, mate } = pair();
  commitFile(mate, "theirs.md", "t");
  git(mate, "push", "-q");
  commitFile(clone, "a.md", "a");
  writeFileSync(join(clone, "seed.md"), "edited, not committed");
  const head = git(clone, "rev-parse", "HEAD").trim();
  const res = pull(clone, HOME);
  assert.equal(res.ok, false);
  assert.match(res.error, /diverged_dirty/);
  assert.equal(git(clone, "rev-parse", "HEAD").trim(), head);
  assert.equal(readFileSync(join(clone, "seed.md"), "utf8"), "edited, not committed");
});

test("an untracked note stays where it is through a replay", () => {
  const { clone, mate } = pair();
  commitFile(mate, "theirs.md", "t");
  git(mate, "push", "-q");
  commitFile(clone, "a.md", "a");
  writeFileSync(join(clone, "note.md"), "not committed");
  assert.equal(pull(clone, HOME).ok, true);
  assert.equal(readFileSync(join(clone, "note.md"), "utf8"), "not committed");
});

test("on lab a pull catches up, keeps the commit's date, and publishes nothing", () => {
  const { remote, clone, mate } = pair();
  commitFile(mate, "theirs.md", "t");
  git(mate, "push", "-q");
  writeFileSync(join(clone, "old.md"), "old");
  git(clone, "add", "old.md");
  execFileSync("git", ["commit", "-qm", "old"], {
    cwd: clone,
    stdio: "ignore",
    env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-02T03:04:05Z", GIT_COMMITTER_DATE: "2026-01-02T03:04:05Z" },
  });
  const before = git(remote, "rev-parse", "master").trim();
  const res = pull(clone, { policy: policyFor("lab") });
  assert.equal(res.ok, true, res.error);
  assert.equal(git(clone, "log", "-1", "--format=%cI").trim().slice(0, 10), "2026-01-02", "an old note does not come back as new");
  assert.equal(git(remote, "rev-parse", "master").trim(), before);
});

test("an unreachable remote is still a failed pull, even on a clone that looks diverged", () => {
  const { clone, mate } = pair();
  commitFile(mate, "theirs.md", "t");
  git(mate, "push", "-q");
  commitFile(clone, "a.md", "a");
  git(clone, "fetch", "-q");
  const head = git(clone, "rev-parse", "HEAD").trim();
  git(clone, "remote", "set-url", "origin", join(tempDir("gone-"), "nope.git"));
  const res = pull(clone, HOME);
  assert.equal(res.ok, false);
  assert.doesNotMatch(res.error, /^diverged/);
  assert.equal(git(clone, "rev-parse", "HEAD").trim(), head);
});

test("a clone with no upstream reports the failure and does not throw", () => {
  const { clone } = setup();
  git(clone, "checkout", "-q", "-b", "local-only");
  assert.equal(pull(clone, HOME).ok, false);
});
