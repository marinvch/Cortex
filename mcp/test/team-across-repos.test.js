// Team memory across repos — the acceptance scenario S2, on real git repositories.
//
// One team-brain (a bare remote), two product repos, two developers each with a vault of their own.
// The BE dev captures in repo A; the FE dev's catch-up in repo B must return that note's CONTENT.
// Both halves failed together before: `team add` wrote the PROJECT slug into the connector's `slug`
// field and the resolver read that field as the TEAM, so capture looked for a clone at
// `team/<project>` and found none; and catch-up never pulled and never read a team note, only the
// clone's commit subjects.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBrain } from "../lib/resolve.js";
import { capture } from "../lib/capture.js";
import { catchMeUp } from "../lib/catchup.js";
import { tempDir } from "./tmp.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "ai-os.js");
const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

function git(cwd, ...a) {
  return execFileSync("git", a, { cwd, env: { ...process.env, ...IDENTITY }, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

/** A team-brain as /team-init leaves it: team.md, projects/, pushed to a bare remote on master. */
function teamBrainRemote(name = "harbor") {
  const remote = tempDir("brain-remote-");
  git(remote, "init", "--bare", "-q", "-b", "master");
  const seed = tempDir("brain-seed-");
  git(seed, "clone", "-q", remote, ".");
  mkdirSync(join(seed, "projects"), { recursive: true });
  writeFileSync(join(seed, "projects", ".gitkeep"), "");
  writeFileSync(join(seed, "team.md"), `# Team: ${name}\n`);
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "seed");
  git(seed, "branch", "-M", "master");
  git(seed, "push", "-q", "-u", "origin", "master");
  return remote;
}

function productRepo(prefix) {
  const repo = tempDir(prefix);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "x");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  return repo;
}

function cli(cwd, vault, ...args) {
  const env = { ...process.env, ...IDENTITY, AI_OS_ROOT: vault };
  delete env.CORTEX_PROFILE;
  delete env.CORTEX_AUDIENCE;
  return spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: "utf8" });
}

/** Two devs, two repos, one team — everyone joins BEFORE anyone writes, as a real team does. */
function team() {
  const remote = teamBrainRemote();
  const repoA = productRepo("svc-a-");
  const repoB = productRepo("web-b-");
  const be1 = tempDir("vault-be1-");
  const fe1 = tempDir("vault-fe1-");
  for (const [repo, vault, project] of [[repoA, be1, "svc-a"], [repoB, fe1, "web-b"]]) {
    const add = cli(repo, vault, "team", "add", "--name", "harbor", "--repo", remote, "--project", project);
    assert.equal(add.status, 0, add.stderr);
  }
  return { remote, repoA, repoB, be1, fe1 };
}

function captureAs(vault, repo, content, noteId, today = "2026-09-25") {
  const brain = resolveBrain({ cwd: repo, env: { AI_OS_ROOT: vault } });
  return capture(vault, { content, project: brain.project, team: brain.team, today, noteId });
}

test("team add writes a connector that names the team and the project separately", () => {
  const { repoA, remote } = team();
  const conn = JSON.parse(readFileSync(join(repoA, ".cortex", "connector.json"), "utf8"));
  assert.deepEqual(conn, { team: "harbor", project: "svc-a", teamBrainRepo: remote });
  const b = resolveBrain({ cwd: repoA, env: { AI_OS_ROOT: tempDir("v-") } });
  assert.equal(b.team, "harbor");
  assert.equal(b.project, "svc-a");
  assert.match(b.teamClone, /team[\\/]harbor$/);
});

test("a note captured in repo A by one dev is in the other dev's catch-up in repo B, content and all", () => {
  const { repoA, repoB, be1, fe1 } = team();
  const res = captureAs(be1, repoA, "orders now publish OrderShipped; token-s2-7f3", "n1");
  assert.equal(res.pushed, true, res.error);
  assert.match(res.path, /team[\\/]harbor[\\/]projects[\\/]svc-a[\\/]2026-09-25-n1\.md$/);

  const run = cli(repoB, fe1, "catch-up", "--since", "2026-09-24");
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.deepEqual(out.pull, { ok: true });
  const note = out.teamNotes.find((n) => n.project === "svc-a");
  assert.ok(note, `fe1 sees no svc-a note: ${run.stdout.slice(0, 400)}`);
  assert.match(note.content, /token-s2-7f3/);
  assert.equal(note.created, "2026-09-25");
});

test("catch-up reads every project of the team, newest first, and honours since", () => {
  const { repoA, repoB, be1, fe1 } = team();
  captureAs(be1, repoA, "an old decision", "old", "2026-01-01");
  captureAs(be1, repoA, "backend change", "a1", "2026-09-20");
  captureAs(fe1, repoB, "frontend change", "b1", "2026-09-22");
  const brain = resolveBrain({ cwd: repoB, env: { AI_OS_ROOT: fe1 } });
  const res = catchMeUp(fe1, { project: brain.project, since: "2026-09-01", team: brain.team });
  assert.deepEqual(res.teamNotes.map((n) => [n.project, n.created]), [["web-b", "2026-09-22"], ["svc-a", "2026-09-20"]]);
  assert.equal(res.truncated, false);
});

test("a failed pull is reported, never hidden, and local work is not rewritten", () => {
  const { repoA, repoB, be1, fe1 } = team();
  // fe1 commits locally and cannot push (the remote moves on first) — the clone has diverged.
  const clone = join(fe1, "team", "harbor");
  captureAs(be1, repoA, "remote side", "r1");
  mkdirSync(join(clone, "projects", "web-b"), { recursive: true });
  writeFileSync(join(clone, "projects", "web-b", "2026-09-25-local.md"), "---\ncreated: 2026-09-25\n---\n\nlocal only\n");
  git(clone, "add", ".");
  git(clone, "commit", "-qm", "local");
  const head = git(clone, "rev-parse", "HEAD").trim();

  const res = catchMeUp(fe1, { project: "web-b", since: "2026-09-24", team: "harbor" });
  assert.equal(res.pull.ok, false);
  assert.ok(res.pull.error.length > 0, "the failure must say why");
  assert.equal(git(clone, "rev-parse", "HEAD").trim(), head, "ff-only: a diverged clone is left as it was");
  assert.ok(res.teamNotes.some((n) => /local only/.test(n.content)), "what IS local is still returned");
});

test("an unreachable remote is a reported pull failure, not an empty week", () => {
  const { repoB, fe1 } = team();
  git(join(fe1, "team", "harbor"), "remote", "set-url", "origin", join(tempDir("gone-"), "nope.git"));
  const run = cli(repoB, fe1, "catch-up", "--since", "2026-09-24");
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.equal(out.pull.ok, false);
});

test("a team with no local clone says so instead of returning nothing", () => {
  const res = catchMeUp(tempDir("v-"), { project: "web-b", since: "2026-09-24", team: "harbor" });
  assert.deepEqual(res.pull, { ok: false, error: "not_a_git_repo" });
  assert.deepEqual(res.teamNotes, []);
});

test("team notes are bounded so the result stays under the transport cap", () => {
  const { repoA, be1 } = team();
  const brain = resolveBrain({ cwd: repoA, env: { AI_OS_ROOT: be1 } });
  const clone = brain.teamClone;
  mkdirSync(join(clone, "projects", "svc-a"), { recursive: true });
  for (let i = 0; i < 80; i++) {
    const id = String(i).padStart(2, "0");
    writeFileSync(join(clone, "projects", "svc-a", `2026-09-25-${id}.md`), `---\ncreated: 2026-09-25\n---\n\n${"x".repeat(5000)}\n`);
  }
  const res = catchMeUp(be1, { project: "svc-a", since: "2026-09-01", team: "harbor" });
  assert.equal(res.truncated, true);
  const chars = res.teamNotes.reduce((s, n) => s + n.content.length, 0);
  assert.ok(chars <= 12_000, `team note content is ${chars} chars`);
  assert.ok(JSON.stringify(res).length < 40_000, "the whole result fits one MCP call");
});

// --- the connector a team already committed ---------------------------------------------------------

test("a legacy {slug, teamBrainRepo} connector finds the clone whose origin is that repo", () => {
  const { remote, be1 } = team();
  const legacy = productRepo("legacy-");
  mkdirSync(join(legacy, ".cortex"), { recursive: true });
  writeFileSync(join(legacy, ".cortex", "connector.json"), JSON.stringify({ slug: "svc-a", teamBrainRepo: `${remote}/` }));
  const b = resolveBrain({ cwd: legacy, env: { AI_OS_ROOT: be1 } });
  assert.equal(b.audience, "team");
  assert.equal(b.team, "harbor", "the clone at team/harbor has this origin, so that is the team");
  assert.equal(b.project, "svc-a", "the old slug was the project");
  assert.match(b.source, /legacy/, "source says the connector is the old shape and how to fix it");
});

test("a legacy connector whose slug IS a cloned team keeps meaning the team", () => {
  const vault = tempDir("v-");
  const remote = teamBrainRemote("acme");
  git(vault, "clone", "-q", remote, join("team", "acme"));
  const repo = productRepo("legacy-");
  mkdirSync(join(repo, ".cortex"), { recursive: true });
  writeFileSync(join(repo, ".cortex", "connector.json"), JSON.stringify({ slug: "acme", teamBrainRepo: "https://elsewhere.invalid/acme.git" }));
  const b = resolveBrain({ cwd: repo, env: { AI_OS_ROOT: vault } });
  assert.equal(b.team, "acme");
  assert.equal(b.project, null);
  assert.ok(existsSync(join(b.teamClone, ".git")));
});
