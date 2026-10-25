// Approved destinations at every outward point in mcp/ (core/destinations.js, docs/adr/0030).
//
// The team-brain's origin is pointed at `https://github.com/someone/brain.git`, a host nobody
// approved. git in this process may use the file transport and nothing else (GIT_ALLOW_PROTOCOL), so
// a push or a pull that slipped past the check would not reach the network: it would fail with
// git's own "transport 'https' not allowed". A refusal that says `unapproved_destination` is
// therefore proof the check ran and git did not. Every test hands the module its own HOME, so no
// run reads the machine's real list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pull, pushHead, commitAndPush, commitPath } from "../lib/gitsync.js";
import { capture } from "../lib/capture.js";
import { cloneTeamBrain, initTeamBrain, ensureTeamClone } from "../lib/team.js";
import { askFrom } from "../lib/asks.js";
import { openBrain } from "../lib/brain.js";
import { request } from "../lib/trackers/http.js";
import { githubAdapter } from "../lib/trackers/github.js";
import { policyFor } from "../../core/profile.js";
import { DestinationRefusedError } from "../../core/destinations.js";
import { tempDir } from "./tmp.js";

process.env.GIT_ALLOW_PROTOCOL = "file";

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const UNAPPROVED = "https://github.com/someone/brain.git";
const HOME = policyFor("home");
const WORK = policyFor("work");
const LAB = policyFor("lab");

function git(cwd, ...a) {
  return execFileSync("git", a, { cwd, env: { ...process.env, ...IDENTITY }, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

/** A HOME of the test's own, with an approved-destinations list when `text` is given. */
function homeEnv(text) {
  const home = tempDir("cortex-dest-home-");
  if (text !== undefined) {
    mkdirSync(join(home, ".cortex"), { recursive: true });
    writeFileSync(join(home, ".cortex", "allowed-destinations"), text);
  }
  return { HOME: home, USERPROFILE: home };
}

/** A clone of a seeded bare remote, with its origin then re-pointed at `origin`. */
function cloneAt(dir, origin) {
  const remote = tempDir("dest-remote-");
  git(remote, "init", "--bare", "-q", "-b", "master");
  mkdirSync(dir, { recursive: true });
  git(dir, "clone", "-q", remote, ".");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "seed.md"), "seed\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "seed");
  git(dir, "branch", "-M", "master");
  git(dir, "push", "-q", "-u", "origin", "master");
  if (origin) git(dir, "remote", "set-url", "origin", origin);
  return { remote, dir };
}

const commits = (dir) => Number(git(dir, "rev-list", "--count", "HEAD").trim());
const refused = (r) => typeof r.error === "string" && r.error.startsWith("unapproved_destination: ");

// --- gitsync ---------------------------------------------------------------------------------------

test("on work with no list, pull and push refuse without running git, and name the host and path", () => {
  const { dir } = cloneAt(tempDir("dest-clone-"), UNAPPROVED);
  const gate = { policy: WORK, env: homeEnv() };
  const p = pull(dir, gate);
  assert.equal(p.ok, false);
  assert.ok(refused(p), p.error);
  assert.match(p.error, /github\.com\/someone\/brain/);
  assert.match(p.error, /allowed-destinations/, "the refusal says how to set the file up");
  assert.doesNotMatch(p.error, /transport/, "git never ran");

  const h = pushHead(dir, gate);
  assert.equal(h.ok, false);
  assert.ok(refused(h), h.error);
});

test("on work, commitAndPush keeps the commit and reports the refused push", () => {
  const { dir } = cloneAt(tempDir("dest-clone-"), UNAPPROVED);
  writeFileSync(join(dir, "note.md"), "a note\n");
  const before = commits(dir);
  const r = commitAndPush(dir, ["note.md"], "add note", { policy: WORK, env: homeEnv() });
  assert.equal(r.ok, true);
  assert.equal(r.pushed, false);
  assert.ok(refused(r), r.error);
  assert.equal(commits(dir), before + 1, "the commit is made locally");
});

test("on work with the remote approved, the check passes and git runs", () => {
  const { dir } = cloneAt(tempDir("dest-clone-"), UNAPPROVED);
  const gate = { policy: WORK, env: homeEnv("git: github.com/someone\n") };
  const p = pull(dir, gate);
  assert.equal(p.ok, false);
  assert.ok(!refused(p), "allowed by the list");
  assert.match(p.error, /transport 'https' not allowed/, "git ran, and this test's GIT_ALLOW_PROTOCOL stopped it");
  const h = pushHead(dir, gate);
  assert.ok(!refused(h));
  assert.match(h.error, /^push_failed: /);
});

test("an approved owner does not approve a lookalike owner", () => {
  const { dir } = cloneAt(tempDir("dest-clone-"), "https://github.com/someone-else/brain.git");
  assert.ok(refused(pushHead(dir, { policy: WORK, env: homeEnv("git: github.com/someone\n") })));
});

test("a pushurl is where a push goes, so the push is checked there and the pull is not", () => {
  const { dir } = cloneAt(tempDir("dest-clone-"));
  git(dir, "remote", "set-url", "--push", "origin", UNAPPROVED);
  const gate = { policy: WORK, env: homeEnv() };
  assert.equal(pull(dir, gate).ok, true, "the fetch URL is a path on this machine");
  assert.ok(refused(pushHead(dir, gate)), "the push URL is not");
});

test("a bare repo on disk is a remote on this machine, on every profile and with no list", () => {
  for (const policy of [HOME, WORK]) {
    const { dir } = cloneAt(tempDir("dest-clone-"));
    writeFileSync(join(dir, "n.md"), "x\n");
    const r = commitAndPush(dir, ["n.md"], "n", { policy, env: homeEnv() });
    assert.equal(r.pushed, true, `${policy.label}: ${r.error}`);
    assert.equal(pull(dir, { policy, env: homeEnv() }).ok, true);
  }
});

test("home is unchanged: no list is read and git runs as it always did", () => {
  const { dir } = cloneAt(tempDir("dest-clone-"), UNAPPROVED);
  const p = pull(dir, { policy: HOME, env: homeEnv() });
  assert.ok(!refused(p));
  assert.match(p.error, /transport 'https' not allowed/);
});

test("lab may pull (inbound) and may not push", () => {
  const { dir } = cloneAt(tempDir("dest-clone-"), UNAPPROVED);
  const gate = { policy: LAB, env: homeEnv() };
  assert.ok(!refused(pull(dir, gate)), "lab is sealed outward, not cut off");
  const h = pushHead(dir, gate);
  assert.ok(refused(h));
  assert.match(h.error, /lab profile sends nothing/);
});

test("the policy is a required option, so a caller that forgets it fails rather than pushing", () => {
  const { dir } = cloneAt(tempDir("dest-clone-"));
  assert.throws(() => pull(dir), TypeError);
  assert.throws(() => pushHead(dir, {}), TypeError);
  assert.throws(() => commitAndPush(dir, ["seed.md"], "m"), TypeError);
  assert.throws(() => pull(dir, { policy: { outwardSync: true } }), TypeError, "a policy with no destinations is not any");
  assert.throws(() => cloneTeamBrain(tempDir("v-"), "acme", UNAPPROVED), TypeError);
  assert.throws(() => initTeamBrain(tempDir("v-"), { name: "acme", repo: UNAPPROVED }), TypeError);
  assert.throws(() => capture(tempDir("v-"), { content: "x", team: "acme", today: "2026-10-25", noteId: "n1" }), TypeError);
});

// --- clone and init --------------------------------------------------------------------------------

test("on work, cloneTeamBrain refuses an unapproved URL before anything is created", () => {
  const root = tempDir("dest-vault-");
  assert.throws(
    () => cloneTeamBrain(root, "acme", UNAPPROVED, { policy: WORK, env: homeEnv() }),
    (e) => e instanceof DestinationRefusedError && e.code === "unapproved_destination" && e.host === "github.com",
  );
  assert.ok(!existsSync(join(root, "team")), "nothing was created");
  assert.throws(() => initTeamBrain(root, { name: "acme", repo: UNAPPROVED, policy: WORK, env: homeEnv() }), DestinationRefusedError);
});

test("lab may clone: cloning is inbound", () => {
  const { remote } = cloneAt(tempDir("dest-clone-"));
  const { cloned } = cloneTeamBrain(tempDir("dest-vault-"), "acme", remote, { policy: LAB, env: homeEnv() });
  assert.equal(cloned, true);
});

test("initTeamBrain on a clone already there checks the push, and keeps the seed commit", () => {
  const root = tempDir("dest-vault-");
  cloneAt(join(root, "team", "acme"), UNAPPROVED);
  const res = initTeamBrain(root, { name: "acme", repo: UNAPPROVED, policy: WORK, env: homeEnv() });
  assert.equal(res.pushed, false);
  assert.ok(refused(res), res.error);
  assert.match(git(res.dir, "log", "-1", "--format=%s"), /seed team-brain acme/);
});

// --- capture and ask -------------------------------------------------------------------------------

test("a team capture on work commits locally and reports the refused push", () => {
  const root = tempDir("dest-vault-");
  const { dir } = cloneAt(join(root, "team", "acme"), UNAPPROVED);
  const before = commits(dir);
  const res = capture(root, { content: "the cut-over is on Friday", project: "web-a", team: "acme", today: "2026-10-25", noteId: "n1", policy: WORK, env: homeEnv() });
  assert.ok(existsSync(res.path), "the note is written");
  assert.equal(res.pushed, false);
  assert.ok(refused(res), res.error);
  assert.equal(commits(dir), before + 1, "and committed");
});

test("the same capture with the remote approved passes the check", () => {
  const root = tempDir("dest-vault-");
  cloneAt(join(root, "team", "acme"), UNAPPROVED);
  const res = capture(root, { content: "x", project: "web-a", team: "acme", today: "2026-10-25", noteId: "n2", policy: WORK, env: homeEnv("git: github.com/someone/brain\n") });
  assert.ok(!refused(res));
  assert.match(res.error, /^push_failed: .*transport 'https' not allowed/s);
});

/** A product repo on work joined to a team-brain whose clone's origin is the unapproved URL. */
function workRepo(listText, { integrations } = {}) {
  const seed = cloneAt(tempDir("dest-seed-"));
  mkdirSync(join(seed.dir, "projects", "web-a"), { recursive: true });
  writeFileSync(join(seed.dir, "projects", "web-a", ".gitkeep"), "");
  writeFileSync(join(seed.dir, "team.json"), JSON.stringify({ ...(integrations ? { integrations } : {}), members: [{ handle: "dev-fe", roles: ["frontend"], projects: ["web-a"] }, { handle: "dev-be", roles: ["backend"], projects: [] }] }, null, 2) + "\n");
  git(seed.dir, "add", ".");
  git(seed.dir, "commit", "-qm", "roster");
  git(seed.dir, "push", "-q", "origin", "master");
  const repo = tempDir("dest-repo-");
  git(repo, "init", "-q", "-b", "main");
  mkdirSync(join(repo, ".cortex"), { recursive: true });
  writeFileSync(join(repo, ".cortex", "connector.json"), JSON.stringify({ team: "harbor", project: "web-a", teamBrainRepo: seed.remote }) + "\n");
  const env = { CORTEX_ROOT: join(repo, ".cortex"), CORTEX_PROFILE: "work", CORTEX_AUTHOR: "dev-fe", ...homeEnv(listText) };
  const brain = openBrain({ cwd: repo, env });
  // The clone is made from the bare repo on disk — a remote on this machine — and then pointed away.
  const { dir } = ensureTeamClone(brain, "test");
  git(dir, "remote", "set-url", "origin", UNAPPROVED);
  return { brain, repo, dir };
}

test("an ask on work commits locally and reports the refusal; with the remote approved it passes", async () => {
  const off = workRepo();
  assert.equal(off.brain.env.CORTEX_PROFILE, "work", "the brain carries the env it was opened with");
  const before = commits(off.dir);
  const res = await askFrom(off.brain, { to: "backend", content: "Is there an endpoint for order history?" }, { env: off.brain.env, cwd: off.repo, id: "dest-a1", today: "2026-10-25" });
  assert.equal(res.committed, true);
  assert.equal(res.pushed, false);
  assert.ok(refused(res), res.error);
  assert.equal(commits(off.dir), before + 1);

  const on = workRepo("git: github.com/someone\n");
  const ok = await askFrom(on.brain, { to: "backend", content: "Same question" }, { env: on.brain.env, cwd: on.repo, id: "dest-a2", today: "2026-10-25" });
  assert.equal(ok.committed, true);
  assert.ok(!refused(ok), "the approved remote passes the check");
  assert.match(ok.error, /push_failed/);
});

// --- trackers --------------------------------------------------------------------------------------

const neverFetch = () => { throw new Error("fetch was called: the destination check did not run first"); };

test("on work, a tracker request to an unapproved host never calls fetch", async () => {
  await assert.rejects(
    () => request("github", { policy: WORK, env: homeEnv(), fetch: neverFetch }, "GET", "https://api.github.com/repos/acme/svc/issues"),
    (e) => e instanceof DestinationRefusedError && /api\.github\.com\/repos\/acme\/svc\/issues/.test(e.message),
  );
  await assert.rejects(
    () => request("github", { policy: WORK, env: homeEnv("https: acme.service-now.com\n"), fetch: neverFetch }, "GET", "https://api.github.com/x"),
    DestinationRefusedError,
  );
  const api = githubAdapter({ kind: "github" }, { env: { ...homeEnv(), GH_TOKEN: "not-a-real-token" }, policy: WORK, fetch: neverFetch });
  await assert.rejects(() => api.find({ id: "a1", target: { repo: "acme/svc" } }), DestinationRefusedError);
});

test("on work, an ask's tracker sync never calls an unapproved tracker, and leaves the link pending with the reason", async () => {
  const w = workRepo("git: github.com/someone\n", { integrations: [{ kind: "github", repo: "acme/svc" }] });
  let calls = 0;
  const fetch = async () => { calls++; return new Response("{}", { status: 200 }); };
  const res = await askFrom(w.brain, { to: "backend", content: "Which endpoint?" }, { env: { ...w.brain.env, GH_TOKEN: "not-a-real-token" }, cwd: w.repo, id: "dest-s1", today: "2026-10-25", fetch });
  assert.equal(calls, 0, "fetch was never called");
  assert.ok(res.sync, "the sync ran");
  const ask = readFileSync(join(w.dir, "asks", "dest-s1.md"), "utf8");
  assert.match(ask, /pending/);
  assert.match(ask, /refusing to reach api\.github\.com/, "the pending link carries the refusal");
});

test("a tracker request needs the policy", async () => {
  await assert.rejects(() => request("github", { fetch: neverFetch }, "GET", "https://api.github.com/x"), TypeError);
});

test("on work, an approved tracker host is called; on home any host is", async () => {
  let calls = 0;
  const fetch = async () => { calls++; return new Response("{}", { status: 200 }); };
  assert.deepEqual(await request("github", { policy: WORK, env: homeEnv("https: api.github.com\n"), fetch }, "GET", "https://api.github.com/x"), {});
  assert.deepEqual(await request("github", { policy: HOME, env: homeEnv(), fetch }, "GET", "https://tracker.example/x"), {});
  assert.equal(calls, 2);
  await assert.rejects(() => request("github", { policy: LAB, env: homeEnv(), fetch: neverFetch }, "GET", "https://tracker.example/x"), DestinationRefusedError);
});

// commitPath is local-only and needs no policy: committing is not leaving the machine.
test("commitPath stays local and needs no policy", () => {
  const { dir } = cloneAt(tempDir("dest-clone-"), UNAPPROVED);
  writeFileSync(join(dir, "x.md"), "x\n");
  assert.equal(commitPath(dir, "x.md", "x").committed, true);
});
