import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CatchUpRefused, catchMeUp, catchUp, catchUpRepo, catchUpTeam } from "../lib/catchup.js";
import { tempDir } from "./tmp.js";
import { policyFor } from "../../core/profile.js";
import { bothLayouts, newLayoutOnly, ENTRIES, ENTRIES_OF_THE_15TH, NEW_ONLY_ENTRY } from "../../core/test/memory-fixture.js";

function repoWithHistory() {
  const repo = tempDir("repo-");
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
  assert.ok(res.commits.some((c) => /merge-work the thing/.test(c)));
  assert.equal(res.truncated, false);
});

// Both memory layouts (plan step 4.1): `<date>.md` and `<date>/<author>.md`, with one date held by
// both. `since` filters by day, so every file of a day inside the window comes back.
test("catchUpRepo returns every file of a day that holds both layouts, and says whose each is", () => {
  const repo = repoWithHistory();
  bothLayouts(join(repo, ".cortex"));
  const res = catchUpRepo(repo, { since: "2026-08-15" });
  assert.deepEqual(res.memory.map((m) => [m.day, m.author]), [
    ["2026-08-15", null],
    ["2026-08-15", "dev-a"],
    ["2026-08-15", "dev-b"],
  ]);
  const text = res.memory.map((m) => m.content).join("\n");
  for (const entry of ENTRIES_OF_THE_15TH) assert.ok(text.includes(entry), `missing: ${entry}`);
  assert.ok(!text.includes(ENTRIES.dayBefore), "nothing from the 14th when since is the 15th");
  assert.ok(!text.includes("strayreadme"), "a stray README is not memory");
  assert.ok(res.memory.every((m) => Object.keys(m).join() === "day,author,path,content"));

  const earlier = catchUpRepo(repo, { since: "2026-08-14" });
  assert.equal(earlier.memory.length, 4, "the 14th is in the window now");
  assert.ok(earlier.memory.at(-1).content.includes(ENTRIES.dayBefore));
  assert.deepEqual(catchUpRepo(repo, { since: "2026-08-16" }).memory, []);
});

test("catchUpRepo reads a repo that only ever wrote the new layout", () => {
  const repo = repoWithHistory();
  newLayoutOnly(join(repo, ".cortex"));
  const res = catchUpRepo(repo, { since: "2026-08-01" });
  assert.deepEqual(res.memory.map((m) => [m.day, m.author]), [["2026-08-16", "dev-a"]]);
  assert.ok(res.memory[0].content.includes(NEW_ONLY_ENTRY));
});

test("catchUpRepo on a repo nobody has dreamed in is empty memory, not an error", () => {
  const repo = repoWithHistory();
  const res = catchUpRepo(repo, { since: "2000-01-01" });
  assert.deepEqual(res.memory, []);
  assert.equal(res.commits.length, 1);
});

test("returns notes for the project (no team)", () => {
  const root = tempDir("vault-");
  mkdirSync(join(root, "projects", "shop"), { recursive: true });
  writeFileSync(join(root, "projects", "shop", "n1.md"), "SSO change landed for shop");
  const res = catchMeUp(root, { project: "shop", since: "2026-06-01" });
  assert.ok(res.notes.some((n) => /SSO change/.test(n.snippet)));
  assert.ok(Array.isArray(res.commits));
  assert.equal(res.commits.length, 0);
});

test("includes team-brain git commits since <since>", () => {
  const root = tempDir("vault-");
  const clone = join(root, "team", "acme");
  mkdirSync(clone, { recursive: true });
  const git = (...a) => execFileSync("git", a, { cwd: clone, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "master");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(clone, "note.md"), "x");
  git("add", ".");
  git("commit", "-qm", "capture: shop session cookies");
  const res = catchMeUp(root, { project: "shop", since: "2000-01-01", team: "acme", policy: policyFor("home") });
  assert.ok(res.commits.some((c) => /session cookies/.test(c)));
});

// --- catchUp: which sources, which repo, which project ------------------------------------------------
// These decisions lived in mcp/ai-os.js, where only a subprocess could reach them.

/** A vault with one note per named project. */
function vaultWith(...projects) {
  const root = tempDir("vault-");
  for (const p of projects) {
    mkdirSync(join(root, "projects", p), { recursive: true });
    writeFileSync(join(root, "projects", p, "n1.md"), `a note about ${p}`);
  }
  return root;
}
const vaultBrain = (root, extra = {}) => ({ root, isRepo: false, project: null, team: null, policy: policyFor("home"), ...extra });
const nowhere = () => null;

test("catchUp with no root reads the repo alone and says which half is missing", () => {
  const repo = repoWithHistory();
  const res = catchUp({ brain: null, since: "2000-01-01", cwd: repo, top: () => repo });
  assert.ok(res.repo.commits.some((c) => /merge-work the thing/.test(c)));
  assert.deepEqual(res.notes, []);
  assert.deepEqual(res.commits, []);
  assert.match(res.skipped, /CORTEX_ROOT is not set, so only this repo was read/);
});

test("catchUp with neither a repo nor a root is refused, never an empty success", () => {
  assert.throws(
    () => catchUp({ brain: null, since: "2000-01-01", cwd: tempDir("nowhere-"), top: nowhere }),
    (e) => e instanceof CatchUpRefused && e.code === "nothing_to_read" && /not inside a git repository and CORTEX_ROOT is not set/.test(e.message),
  );
});

test("catchUp in repo mode reads the repo above the root, whatever the cwd", () => {
  const repo = repoWithHistory();
  mkdirSync(join(repo, ".cortex", "memory"), { recursive: true });
  writeFileSync(join(repo, ".cortex", "memory", "2026-06-02.md"), "a day");
  const brain = { root: join(repo, ".cortex"), isRepo: true, project: null, team: null };
  const res = catchUp({ brain, since: "2026-06-01", cwd: tempDir("elsewhere-"), top: () => { throw new Error("the cwd must not be asked"); } });
  assert.deepEqual(res.repo.memory.map((m) => m.day), ["2026-06-02"]);
  assert.ok(res.repo.commits.some((c) => /merge-work the thing/.test(c)));
});

test("catchUp inside the vault's own checkout reads no repo half: its log is the notes arriving", () => {
  const root = vaultWith("shop");
  const res = catchUp({ brain: vaultBrain(root), since: "2000-01-01", project: "shop", cwd: root, top: () => root });
  assert.equal("repo" in res, false);
  assert.ok(res.notes.some((n) => /a note about shop/.test(n.snippet)));
  // The same directory spelt with a trailing separator is still the vault.
  const again = catchUp({ brain: vaultBrain(root), since: "2000-01-01", project: "shop", cwd: root, top: () => root + "/" });
  assert.equal("repo" in again, false);
});

test("catchUp in a product repo with a vault returns both halves", () => {
  const root = vaultWith("shop");
  const repo = repoWithHistory();
  const res = catchUp({ brain: vaultBrain(root, { project: "shop" }), since: "2000-01-01", cwd: repo, top: () => repo });
  assert.ok(res.repo.commits.some((c) => /merge-work the thing/.test(c)));
  assert.ok(res.notes.some((n) => /a note about shop/.test(n.snippet)));
  assert.deepEqual(Object.keys(res)[0], "repo", "the repo half is printed first");
});

test("catchUp picks the project asked for, then the connector's, then the repo's folder name", () => {
  const repo = repoWithHistory();
  const folder = repo.split(/[\\/]/).pop();
  const root = vaultWith("asked", "connected", folder);
  const notesOf = (brain, project) => catchUp({ brain, since: "2000-01-01", project, cwd: repo, top: () => repo }).notes.map((n) => /projects[\\/]([^\\/]+)/.exec(n.path)[1]);
  assert.deepEqual([...new Set(notesOf(vaultBrain(root, { project: "connected" }), "asked"))], ["asked"]);
  assert.deepEqual([...new Set(notesOf(vaultBrain(root, { project: "connected" }), undefined))], ["connected"]);
  assert.deepEqual([...new Set(notesOf(vaultBrain(root), undefined))], [folder]);
});

test("catchUp with a vault, no repo and no project is refused for want of a project", () => {
  const root = vaultWith("shop");
  assert.throws(
    () => catchUp({ brain: vaultBrain(root), since: "2000-01-01", cwd: tempDir("nowhere-"), top: nowhere }),
    (e) => e instanceof CatchUpRefused && e.code === "no_project",
  );
});

test("catchUpTeam takes the team asked for, else the connector's, and is what both adapters call", () => {
  assert.equal(catchUpTeam("asked", { team: "connected" }), "asked");
  assert.equal(catchUpTeam(undefined, { team: "connected" }), "connected");
  assert.equal(catchUpTeam(undefined, { team: null }), undefined);
  const here = new URL("..", import.meta.url);
  for (const file of ["server.js", "lib/catchup.js"]) {
    assert.match(readFileSync(new URL(file, here), "utf8"), /catchUpTeam\(/, `${file} resolves the team its own way`);
  }
  assert.doesNotMatch(readFileSync(new URL("ai-os.js", here), "utf8"), /brain\.team \?\? undefined/);
});

test("catchUp reaches the team clone through the connector's team, with no --team", () => {
  const root = vaultWith("shop");
  const clone = join(root, "team", "acme");
  mkdirSync(clone, { recursive: true });
  const git = (...a) => execFileSync("git", a, { cwd: clone, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "master");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(clone, "note.md"), "x");
  git("add", ".");
  git("commit", "-qm", "capture: shop session cookies");
  const res = catchUp({ brain: vaultBrain(root, { project: "shop", team: "acme" }), since: "2000-01-01", cwd: tempDir("nowhere-"), top: nowhere });
  assert.ok(res.commits.some((c) => /session cookies/.test(c)));
  const solo = catchUp({ brain: vaultBrain(root, { project: "shop" }), since: "2000-01-01", cwd: tempDir("nowhere-"), top: nowhere });
  assert.deepEqual(solo.commits, []);
});

test("the CLI holds no catch-up decision: it parses, calls catchUp once and prints", () => {
  const cli = readFileSync(new URL("../ai-os.js", import.meta.url), "utf8");
  assert.doesNotMatch(cli, /catchUpRepo|catchMeUp|repoTop|samePath/);
  assert.equal((cli.match(/\bcatchUp\(/g) ?? []).length, 1);
  assert.ok(readdirSync(new URL("../lib/", import.meta.url)).includes("catchup.js"));
});
