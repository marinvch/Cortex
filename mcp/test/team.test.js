import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectorObject, writeConnector, cloneTeamBrain, seedTeamBrain, initTeamBrain } from "../lib/team.js";

function bareRemote() {
  const remote = mkdtempSync(join(tmpdir(), "remote-"));
  execFileSync("git", ["init", "--bare", "-q", "-b", "master"], { cwd: remote });
  return remote;
}

test("connectorObject returns slug + teamBrainRepo only", () => {
  assert.deepEqual(connectorObject("unis", "git@x:acme/brain.git"), { slug: "unis", teamBrainRepo: "git@x:acme/brain.git" });
});

test("writeConnector writes generic .cortex/connector.json (no machine paths)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "proj-"));
  const p = writeConnector(cwd, "unis", "git@x:acme/brain.git");
  assert.match(p, /\.cortex[\\/]connector\.json$/);
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  assert.deepEqual(parsed, { slug: "unis", teamBrainRepo: "git@x:acme/brain.git" });
  // must not leak the absolute cwd/machine path into the committed connector
  assert.ok(!readFileSync(p, "utf8").includes(cwd));
});

test("seedTeamBrain writes team.md + gitkeeps for each project", () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-"));
  const written = seedTeamBrain(dir, { name: "acme", projects: ["unis", "acme-web"] });
  assert.ok(existsSync(join(dir, "team.md")));
  assert.ok(existsSync(join(dir, "projects", ".gitkeep")));
  assert.ok(existsSync(join(dir, "projects", "unis", ".gitkeep")));
  assert.ok(existsSync(join(dir, "projects", "acme-web", ".gitkeep")));
  assert.match(readFileSync(join(dir, "team.md"), "utf8"), /Team: acme/);
  assert.ok(written.length >= 4);
});

test("cloneTeamBrain clones a local bare repo, and is a no-op if present", () => {
  const remote = bareRemote();
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const first = cloneTeamBrain(root, "acme", remote);
  assert.equal(first.cloned, true);
  assert.match(first.dir, /team[\\/]acme$/);
  assert.ok(existsSync(join(first.dir, ".git")));
  const second = cloneTeamBrain(root, "acme", remote);
  assert.equal(second.cloned, false);
});

test("initTeamBrain seeds, commits, and pushes to the remote", () => {
  const remote = bareRemote();
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const dir = initTeamBrain(root, { name: "acme", repo: remote, projects: ["unis"] });
  assert.ok(existsSync(join(dir, "team.md")));
  // verify the push landed: clone the remote fresh and check team.md arrived
  const verify = mkdtempSync(join(tmpdir(), "verify-"));
  execFileSync("git", ["clone", "-q", remote, "."], { cwd: verify, stdio: ["ignore", "pipe", "pipe"] });
  assert.ok(existsSync(join(verify, "team.md")));
  assert.ok(existsSync(join(verify, "projects", "unis", ".gitkeep")));
});
