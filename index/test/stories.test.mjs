// Story links on a fixture repo built with real git: keys in messages and branch names, a merge
// commit, a squash subject, an unmerged branch. The CLI is run as a person runs it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./tmp.mjs";
import { buildStoryLinks, parseLog } from "../lib/stories.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEXER = join(HERE, "..", "cortex-index.mjs");
const STORIES = join(HERE, "..", "cortex-stories.mjs");
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", CLAUDE_CLI_BIN: "/no/such/claude" };

const git = (cwd, ...a) => execFileSync("git", a, { cwd, env: ENV, stdio: ["ignore", "pipe", "pipe"] }).toString();
const write = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const run = (args, cwd) => spawnSync(process.execPath, args, { cwd, env: ENV, encoding: "utf8" });

/** The fixture: a small JS repo whose history names ABC-1, ABC-2, ABC-3, #5 and PR 6. */
function fixture() {
  const root = tempDir("cortex-stories-");
  git(root, "init", "-q", "-b", "main");
  git(root, "remote", "add", "origin", "https://github.com/acme/app.git");
  write(root, "src/a.js", 'import { b } from "./b.js";\nexport const a = () => b();\n');
  write(root, "src/b.js", 'import { c } from "./c.js";\nexport const b = () => c();\n');
  write(root, "src/c.js", "export const c = () => 1;\n");
  write(root, "test/a.test.js", 'import { a } from "../src/a.js";\na();\n');
  git(root, "add", ".");
  git(root, "commit", "-qm", "init");

  write(root, "src/a.js", 'import { b } from "./b.js";\nexport const a = () => b() + 1;\n');
  git(root, "commit", "-qam", "ABC-1 make a add one");

  git(root, "checkout", "-q", "-b", "feature/ABC-2-tune-b");
  write(root, "src/b.js", 'import { c } from "./c.js";\nexport const b = () => c() * 2;\n');
  git(root, "commit", "-qam", "tune b");
  git(root, "checkout", "-q", "main");
  git(root, "merge", "-q", "--no-ff", "feature/ABC-2-tune-b", "-m", "Merge branch 'feature/ABC-2-tune-b'");
  git(root, "branch", "-q", "-D", "feature/ABC-2-tune-b");

  write(root, "src/c.js", "export const c = () => 2;\n");
  git(root, "commit", "-qam", "Fix #5 (#6)");

  write(root, "src/b.js", 'import { c } from "./c.js";\nexport const b = () => c() * 3;\n');
  git(root, "commit", "-qam", "Follow up on ABC-2");

  git(root, "checkout", "-q", "-b", "ABC-3-wip");
  write(root, "src/c.js", "export const c = () => 3;\n");
  git(root, "commit", "-qam", "work in progress");
  git(root, "checkout", "-q", "main");
  return root;
}

function indexed() {
  const root = fixture();
  const r = run([INDEXER, root], root);
  assert.equal(r.status, 0, r.stderr);
  return root;
}

const byKey = (links) => Object.fromEntries(links.stories.map((s) => [s.key, s]));

test("keys link to commits and files with the right confidence: message extracted, branch name inferred", () => {
  const root = indexed();
  const r = run([STORIES, root], root);
  assert.equal(r.status, 0, r.stderr);
  const links = JSON.parse(r.stdout);
  const s = byKey(links);
  assert.deepEqual(Object.keys(s).sort(), ["ABC-1", "ABC-2", "ABC-3", "acme/app#5"]);
  assert.equal(links.repo, "acme/app");

  assert.equal(s["ABC-1"].confidence, "extracted");
  assert.deepEqual(s["ABC-1"].files.map((f) => [f.path, f.confidence, f.tested]), [["src/a.js", "extracted", true]]);

  // ABC-2: one commit through the merged branch's name, one naming it in its message.
  assert.equal(s["ABC-2"].confidence, "extracted");
  assert.deepEqual(s["ABC-2"].commits.map((c) => c.confidence).sort(), ["extracted", "inferred"]);
  assert.deepEqual(s["ABC-2"].files.map((f) => [f.path, f.confidence]), [["src/b.js", "extracted"]]);

  // ABC-3: only an unmerged branch's name carries it.
  assert.equal(s["ABC-3"].confidence, "inferred");
  assert.deepEqual(s["ABC-3"].files.map((f) => [f.path, f.confidence]), [["src/c.js", "inferred"]]);

  // #5 is the issue, qualified by origin; 6 is the PR of a squash subject and never a key.
  assert.equal(s["acme/app#5"].confidence, "extracted");
  assert.deepEqual(s["acme/app#5"].commits[0].prs, [6]);
  assert.ok(!s["acme/app#6"]);

  // Every file carries its cluster, hub flag and test state; no commit text or author leaves.
  for (const st of links.stories) for (const f of st.files) assert.ok("cluster" in f && "hub" in f && "tested" in f);
  assert.ok(!r.stdout.includes("make a add one") && !r.stdout.includes('"t@t"'));
  assert.match(links.note, /A floor/);
});

test("the same history and index give the same bytes", () => {
  const root = indexed();
  const a = run([STORIES, root], root);
  const b = run([STORIES, root], root);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout);
});

test("--keys narrows the Jira shape to the named projects", () => {
  const root = indexed();
  const r = run([STORIES, root, "--keys", "XYZ"], root);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).stories.map((s) => s.key), ["acme/app#5"]);
});

test("a stale index is refused with the rebuild command, and so is a directory outside git", () => {
  const root = indexed();
  const future = new Date(Date.now() + 120_000);
  utimesSync(join(root, "src", "c.js"), future, future);
  const r = run([STORIES, root], root);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /older|newer/);
  assert.match(r.stderr, /cortex-index\.mjs/);
  assert.equal(r.stdout, "");

  const plain = tempDir("cortex-stories-nogit-");
  write(plain, "a.js", "export const a = 1;\n");
  assert.equal(run([INDEXER, plain], plain).status, 0);
  const n = run([STORIES, plain], plain);
  assert.equal(n.status, 2);
  assert.match(n.stderr, /not inside a git repository/);
});

test("--out writes under .cortex/index/ only, and keeps it ignored", () => {
  const root = indexed();
  const r = run([STORIES, root, "--out", join(root, ".cortex", "index", "stories.json")], root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /4 stories/);
  assert.equal(JSON.parse(readFileSync(join(root, ".cortex", "index", "stories.json"), "utf8")).format, 1);
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /\.cortex\/index\//);
});

test("the pure half: a file the index does not hold is counted in gone, and a story keeps its surest confidence", () => {
  const commits = new Map([
    ["a".repeat(40), { sha: "a".repeat(40), keys: ["ABC-1"], prs: [], files: ["src/x.js", "src/old.js"] }],
    ["b".repeat(40), { sha: "b".repeat(40), keys: [], prs: [], files: ["src/x.js", "src/y.js"] }],
  ]);
  const index = { files: [{ path: "src/x.js", cluster: "c1" }, { path: "src/y.js", cluster: null }], clusters: { items: [{ id: "c1", hub: "src/x.js", size: 1 }] } };
  const links = buildStoryLinks({
    commits, branches: [{ branch: "ABC-1-x", keys: ["ABC-1"], shas: ["b".repeat(40)] }], index,
    untested: new Set(["src/y.js"]), testable: new Set(["src/x.js", "src/y.js"]), hubs: new Set(["src/x.js"]),
    project: "app", repo: null, head: "a".repeat(40), asOf: "2026-10-01", window: { maxCommits: 10 },
  });
  const [s] = links.stories;
  assert.equal(s.gone, 1);
  assert.deepEqual(s.files, [
    { path: "src/x.js", confidence: "extracted", cluster: "c1", hub: true, tested: true },
    { path: "src/y.js", confidence: "inferred", cluster: null, hub: false, tested: false },
  ]);
  assert.deepEqual(links.clusters, [{ id: "c1", hub: "src/x.js", size: 1 }]);
});

test("parseLog reads git's records, and a merge lists no files", () => {
  const text = "\x1eaaa\x1fp1\x1fsubject\n\nbody\n\x1f\n\nsrc/a.js\nsrc/b.js\n\x1ebbb\x1fp1 p2\x1fMerge branch 'x'\n\x1f\n";
  assert.deepEqual(parseLog(text), [
    { sha: "aaa", parents: ["p1"], message: "subject\n\nbody\n", files: ["src/a.js", "src/b.js"] },
    { sha: "bbb", parents: ["p1", "p2"], message: "Merge branch 'x'\n", files: [] },
  ]);
});
