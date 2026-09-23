import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catchMeUp, catchUpRepo } from "../lib/catchup.js";

function repoWithHistory() {
  const repo = mkdtempSync(join(tmpdir(), "repo-"));
  const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(repo, "a.txt"), "x");
  git("add", ".");
  git("commit", "-qm", "ship the thing");
  return repo;
}

test("catchUpRepo reads memory days on or after since, and the repo's own log", () => {
  const repo = repoWithHistory();
  mkdirSync(join(repo, ".cortex", "memory"), { recursive: true });
  writeFileSync(join(repo, ".cortex", "memory", "2026-03-01.md"), "old day");
  writeFileSync(join(repo, ".cortex", "memory", "2026-06-02.md"), "new day");
  writeFileSync(join(repo, ".cortex", "memory", "notes.md"), "not a day file");
  const res = catchUpRepo(repo, { since: "2026-06-01" });
  assert.deepEqual(res.memory.map((m) => m.day), ["2026-06-02"]);
  assert.equal(res.memory[0].content, "new day");
  assert.ok(res.commits.some((c) => /ship the thing/.test(c)));
  assert.equal(res.truncated, false);
});

test("catchUpRepo on a repo nobody has dreamed in is empty memory, not an error", () => {
  const repo = repoWithHistory();
  const res = catchUpRepo(repo, { since: "2000-01-01" });
  assert.deepEqual(res.memory, []);
  assert.equal(res.commits.length, 1);
});

test("returns notes for the project (no team)", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  mkdirSync(join(root, "projects", "unis"), { recursive: true });
  writeFileSync(join(root, "projects", "unis", "n1.md"), "PingID change landed for unis");
  const res = catchMeUp(root, { project: "unis", since: "2026-06-01" });
  assert.ok(res.notes.some((n) => /PingID change/.test(n.snippet)));
  assert.ok(Array.isArray(res.commits));
  assert.equal(res.commits.length, 0);
});

test("includes team-brain git commits since <since>", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const clone = join(root, "team", "acme");
  mkdirSync(clone, { recursive: true });
  const git = (...a) => execFileSync("git", a, { cwd: clone, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "master");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(clone, "note.md"), "x");
  git("add", ".");
  git("commit", "-qm", "capture: unis session cookies");
  const res = catchMeUp(root, { project: "unis", since: "2000-01-01", team: "acme" });
  assert.ok(res.commits.some((c) => /session cookies/.test(c)));
});
