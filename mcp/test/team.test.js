import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEAM_JSON, connectorObject, writeConnector, cloneTeamBrain, seedTeamBrain, initTeamBrain, readTeamSource } from "../lib/team.js";
import { tempDir } from "./tmp.js";
import { policyFor } from "../../core/profile.js";

const HOME = policyFor("home");

function bareRemote() {
  const remote = tempDir("remote-");
  execFileSync("git", ["init", "--bare", "-q", "-b", "master"], { cwd: remote });
  return remote;
}

test("connectorObject returns team + project + teamBrainRepo only", () => {
  assert.deepEqual(
    connectorObject({ team: "acme", project: "shop", teamBrainRepo: "git@x:acme/brain.git", extra: 1 }),
    { team: "acme", project: "shop", teamBrainRepo: "git@x:acme/brain.git" },
  );
});

test("connectorObject carries a source only when the team set one (#622)", () => {
  const base = { team: "acme", project: "shop", teamBrainRepo: "git@x:acme/brain.git" };
  assert.deepEqual(connectorObject({ ...base, source: null }), base, "upstream: the connector it always was");
  assert.deepEqual(connectorObject({ ...base, source: "acme/cortex" }), { ...base, source: "acme/cortex" });
  const p = writeConnector(tempDir("proj-"), { ...base, source: "acme/cortex" });
  assert.equal(JSON.parse(readFileSync(p, "utf8")).source, "acme/cortex");
});

test("initTeamBrain --source writes team.json holding the source and nothing else, and pushes it", () => {
  const remote = bareRemote();
  const root = tempDir("vault-");
  const { dir, pushed } = initTeamBrain(root, { name: "acme", repo: remote, projects: [], source: "acme/cortex", policy: HOME });
  assert.equal(pushed, true);
  assert.equal(readFileSync(join(dir, TEAM_JSON), "utf8"), '{\n  "source": "acme/cortex"\n}\n');
  assert.equal(readTeamSource(dir), "acme/cortex");
  const verify = tempDir("verify-");
  execFileSync("git", ["clone", "-q", remote, "."], { cwd: verify, stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(readTeamSource(verify), "acme/cortex", "every member's clone gets it");
});

test("initTeamBrain without a source writes no team.json", () => {
  const { dir } = initTeamBrain(tempDir("vault-"), { name: "acme", repo: bareRemote(), projects: [], policy: HOME });
  assert.equal(existsSync(join(dir, TEAM_JSON)), false);
  assert.equal(readTeamSource(dir), null);
});

test("initTeamBrain refuses an unusable source before anything is cloned", () => {
  const root = tempDir("vault-");
  const remote = bareRemote();
  const token = "gh" + "p_" + "B".repeat(36);
  for (const bad of ["../cortex", `https://${token}@github.com/acme/cortex.git`, "not a source"]) {
    assert.throws(() => initTeamBrain(root, { name: "acme", repo: remote, source: bad, policy: HOME }), (e) => e.code === "source_refused" && !e.message.includes(token));
  }
  assert.equal(existsSync(join(root, "team")), false, "nothing was cloned");
});

test("readTeamSource refuses a team.json it cannot use, and reads a blank source as none", () => {
  const dir = tempDir("clone-");
  writeFileSync(join(dir, TEAM_JSON), "{ bad");
  assert.throws(() => readTeamSource(dir), /team\.json in the team-brain is not valid JSON/);
  writeFileSync(join(dir, TEAM_JSON), JSON.stringify({ source: "  " }));
  assert.equal(readTeamSource(dir), null);
  writeFileSync(join(dir, TEAM_JSON), JSON.stringify({ source: "nope" }));
  assert.throws(() => readTeamSource(dir), (e) => e.code === "source_refused");
});

test("writeConnector writes generic .cortex/connector.json (no machine paths)", () => {
  const cwd = tempDir("proj-");
  const p = writeConnector(cwd, { team: "acme", project: "shop", teamBrainRepo: "git@x:acme/brain.git" });
  assert.match(p, /\.cortex[\\/]connector\.json$/);
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  assert.deepEqual(parsed, { team: "acme", project: "shop", teamBrainRepo: "git@x:acme/brain.git" });
  // must not leak the absolute cwd/machine path into the committed connector
  assert.ok(!readFileSync(p, "utf8").includes(cwd));
});

test("seedTeamBrain writes team.md + gitkeeps for each project", () => {
  const dir = tempDir("clone-");
  const written = seedTeamBrain(dir, { name: "acme", projects: ["shop", "acme-web"] });
  assert.ok(existsSync(join(dir, "team.md")));
  assert.ok(existsSync(join(dir, "projects", ".gitkeep")));
  assert.ok(existsSync(join(dir, "projects", "shop", ".gitkeep")));
  assert.ok(existsSync(join(dir, "projects", "acme-web", ".gitkeep")));
  assert.match(readFileSync(join(dir, "team.md"), "utf8"), /Team: acme/);
  assert.ok(written.length >= 4);
});

test("team.md points at projects/ and lists no project — the files there are the registry", () => {
  // The seed used to write `- shop` and `- acme-web` under Projects. That list was never the
  // registry and went stale with the first repo that joined later (docs/adr/0024).
  const dir = tempDir("clone-");
  seedTeamBrain(dir, { name: "example-team", projects: ["storefront", "billing-api"] });
  const text = readFileSync(join(dir, "team.md"), "utf8");
  assert.match(text, /## Projects\n[^#]*`projects\/`/);
  assert.match(text, /projects\/<slug>\.md/);
  assert.doesNotMatch(text, /storefront|billing-api/);
  assert.doesNotMatch(text, /^- (?!\(add members\))/m, "the only list left is the members placeholder");
  // The seed still writes no project file: a project with no repo is not registered (D4, D14).
  assert.equal(existsSync(join(dir, "projects", "storefront.md")), false);
  assert.ok(existsSync(join(dir, "projects", "storefront", ".gitkeep")));
});

test("cloneTeamBrain clones a local bare repo, and is a no-op if present", () => {
  const remote = bareRemote();
  const root = tempDir("vault-");
  const first = cloneTeamBrain(root, "acme", remote, { policy: HOME });
  assert.equal(first.cloned, true);
  assert.match(first.dir, /team[\\/]acme$/);
  assert.ok(existsSync(join(first.dir, ".git")));
  const second = cloneTeamBrain(root, "acme", remote, { policy: HOME });
  assert.equal(second.cloned, false);
});

test("initTeamBrain seeds, commits, and pushes to the remote", () => {
  const remote = bareRemote();
  const root = tempDir("vault-");
  const { dir } = initTeamBrain(root, { name: "acme", repo: remote, projects: ["shop"], policy: HOME });
  assert.ok(existsSync(join(dir, "team.md")));
  // verify the push landed: clone the remote fresh and check team.md arrived
  const verify = tempDir("verify-");
  execFileSync("git", ["clone", "-q", remote, "."], { cwd: verify, stdio: ["ignore", "pipe", "pipe"] });
  assert.ok(existsSync(join(verify, "team.md")));
  assert.ok(existsSync(join(verify, "projects", "shop", ".gitkeep")));
});

test("initTeamBrain is idempotent (safe to re-run after a prior init)", () => {
  const remote = bareRemote();
  const root = tempDir("vault-");
  const { dir } = initTeamBrain(root, { name: "acme", repo: remote, projects: ["shop"], policy: HOME });
  assert.doesNotThrow(() => initTeamBrain(root, { name: "acme", repo: remote, projects: ["shop"], policy: HOME }));
  assert.ok(existsSync(join(dir, "team.md")));
});

// core/profile.js:48-51 argues that sealing outward sync is the load-bearing half of `lab`:
// "Without this, `lab` would just be a way to switch the firewall off and keep pushing — which is
// the leak with extra steps." The push here was unconditional, so that is exactly what /team-init
// did on a lab install. capture.js already had the shape: write locally, decline the push, and
// tell the caller which, rather than reporting a silent success.
test("initTeamBrain refuses to push when outward sync is sealed", () => {
  const remote = bareRemote();
  const root = tempDir("vault-");

  const res = initTeamBrain(root, { name: "acme", repo: remote, projects: ["shop"], policy: policyFor("lab") });

  assert.equal(res.pushed, false);
  assert.equal(res.error, "outward_sync_disabled");
  assert.ok(existsSync(join(res.dir, "team.md")), "the seed is still written locally");

  const refs = execFileSync("git", ["for-each-ref"], { cwd: remote }).toString().trim();
  assert.equal(refs, "", "nothing may reach the remote on a sealed profile");
});
