import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture } from "../lib/capture.js";

function git(cwd, ...a) {
  return execFileSync("git", a, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

// A vault whose team-brain clone (root/team/acme) is wired to a local bare remote,
// branch pinned to master so commitAndPush's `git push` succeeds under push.default=simple.
function vaultWithTeam() {
  const remote = mkdtempSync(join(tmpdir(), "remote-"));
  git(remote, "init", "--bare", "-q", "-b", "master");
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const clone = join(root, "team", "acme");
  execFileSync("git", ["clone", "-q", remote, clone], { stdio: ["ignore", "pipe", "pipe"] });
  git(clone, "config", "user.email", "t@t");
  git(clone, "config", "user.name", "t");
  writeFileSync(join(clone, "seed.md"), "s");
  git(clone, "add", ".");
  git(clone, "commit", "-qm", "s");
  git(clone, "branch", "-M", "master");
  git(clone, "push", "-q", "-u", "origin", "master");
  return root;
}

test("team capture writes one-file-per-note and pushes", () => {
  const root = vaultWithTeam();
  const res = capture(root, { content: "PingID cookies", project: "unis", team: "acme", today: "2026-07-01", noteId: "abc" });
  assert.match(res.path, /team[\\/]acme[\\/]projects[\\/]unis[\\/]2026-07-01-abc\.md$/);
  assert.ok(existsSync(res.path));
  assert.match(readFileSync(res.path, "utf8"), /PingID cookies/);
  assert.equal(res.pushed, true);
});
