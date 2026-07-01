import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCommits, collectMergedPRs, buildDigest, digest } from "../lib/digest.js";

function repoWithCommit() {
  const repo = mkdtempSync(join(tmpdir(), "prod-"));
  const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(repo, "a.txt"), "1");
  git("add", ".");
  git("commit", "-qm", "feat: add login");
  return repo;
}

test("collectCommits lists commits since a date", () => {
  const repo = repoWithCommit();
  const lines = collectCommits(repo, "2000-01-01");
  assert.ok(lines.some((l) => /feat: add login/.test(l)));
});

test("buildDigest renders heading + commits, and PRs when given", () => {
  const repo = repoWithCommit();
  const noPr = buildDigest(repo, "2000-01-01");
  assert.match(noPr, /## Digest since 2000-01-01/);
  assert.match(noPr, /### Commits/);
  assert.match(noPr, /feat: add login/);
  const withPr = buildDigest(repo, "2000-01-01", ["- #12 wire auth"]);
  assert.match(withPr, /### Merged PRs/);
  assert.match(withPr, /#12 wire auth/);
});

test("collectMergedPRs returns [] gracefully on a non-GitHub/plain repo", () => {
  const repo = repoWithCommit();
  const prs = collectMergedPRs(repo, "2000-01-01");
  assert.deepEqual(prs, []); // gh missing OR no github remote -> [] (never throws)
});

test("digest appends a digest to the out file", () => {
  const repo = repoWithCommit();
  const out = join(mkdtempSync(join(tmpdir(), "brain-")), "notes", "digest.md");
  const written = digest(repo, "2000-01-01", out);
  assert.equal(written, out);
  assert.match(readFileSync(out, "utf8"), /feat: add login/);
});
