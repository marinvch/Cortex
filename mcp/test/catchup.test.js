import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { catchMeUp, catchUpRepo } from "../lib/catchup.js";
import { tempDir } from "./tmp.js";
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
  assert.ok(res.commits.some((c) => /ship the thing/.test(c)));
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
  mkdirSync(join(root, "projects", "unis"), { recursive: true });
  writeFileSync(join(root, "projects", "unis", "n1.md"), "PingID change landed for unis");
  const res = catchMeUp(root, { project: "unis", since: "2026-06-01" });
  assert.ok(res.notes.some((n) => /PingID change/.test(n.snippet)));
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
  git("commit", "-qm", "capture: unis session cookies");
  const res = catchMeUp(root, { project: "unis", since: "2000-01-01", team: "acme" });
  assert.ok(res.commits.some((c) => /session cookies/.test(c)));
});
