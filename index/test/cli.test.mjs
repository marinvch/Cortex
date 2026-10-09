import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, basename, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { bothLayouts, newLayoutOnly, ENTRIES, ENTRIES_OF_THE_15TH, NEW_ONLY_ENTRY } from "../../core/test/memory-fixture.js";

const INDEX_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = (name) => join(INDEX_DIR, name);

// The four CLIs were the one true positive Cortex reported about itself: lib/ was well covered,
// the top-level argument parsing and file writing were not. These are smoke tests — they run each
// command for real against a fixture repo and check the artifact it promised to write.

function fixture() {
  const root = tempDir("cortex-cli-");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.js"), 'import { a } from "./a.js";\na();\n');
  writeFileSync(join(root, "src", "a.js"), "export function a() { return 1; }\n");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  return root;
}

function run(script, args, cwd) {
  return execFileSync(process.execPath, [cli(script), ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("cortex-index writes the index and reports what it found", () => {
  const root = fixture();
  const out = run("cortex-index.mjs", ["."], root);
  assert.match(out, /Indexed \d+ files/);
  const p = join(root, ".cortex", "index", "index.json");
  assert.ok(existsSync(p), "the index must land at .cortex/index/index.json");
  const idx = JSON.parse(readFileSync(p, "utf8"));
  assert.ok(idx.files.some((f) => f.path === "src/a.js"));
  assert.equal(idx.version, "1");
});

test("cortex-index honours --out", () => {
  const root = fixture();
  run("cortex-index.mjs", [".", "--out", "custom.json"], root);
  assert.ok(existsSync(join(root, "custom.json")));
});

test("cortex-findings writes exactly one dated report", () => {
  const root = fixture();
  run("cortex-index.mjs", ["."], root);
  const out = run("cortex-findings.mjs", ["."], root);
  assert.match(out, /\d+ findings/);
  const dir = join(root, ".cortex", "findings");
  assert.ok(existsSync(dir));
  const written = readdirSync(dir);
  assert.equal(written.length, 1, "exactly one report per run");
  assert.match(written[0], /^\d{4}-\d{2}-\d{2}\.md$/);
  const report = readFileSync(join(dir, written[0]), "utf8");
  assert.match(report, /Nothing in this repository has been changed/);
});

test("cortex-findings --stdout writes no file", () => {
  const root = fixture();
  const out = run("cortex-findings.mjs", [".", "--stdout"], root);
  assert.match(out, /# Cortex findings/);
  assert.ok(!existsSync(join(root, ".cortex", "findings")), "--stdout must not write a report");
});

test("cortex-findings --offers prints the wizard's script as JSON and writes nothing", () => {
  // The report is prose for a human; --offers is the machine surface /cortex-install walks. It is
  // read-only on purpose: a wizard that has already written something is not asking a question.
  const root = fixture();
  const out = run("cortex-findings.mjs", [".", "--offers"], root);
  const worklist = JSON.parse(out);
  assert.ok(Array.isArray(worklist), "--offers must emit a JSON array, parseable without a shim");
  for (const entry of worklist) {
    assert.ok(entry.action, "every entry names an action the wizard can dispatch on");
    assert.ok(Array.isArray(entry.targets));
    assert.ok(entry.findings?.length, "an entry carries the titles that produced it, so it can say why");
  }
  assert.ok(!existsSync(join(root, ".cortex", "findings")), "--offers must not write a report");
});

test("cortex-enrich plans, reports status, and merges", () => {
  const root = fixture();
  run("cortex-index.mjs", ["."], root);

  const planned = run("cortex-enrich.mjs", ["plan", "."], root);
  assert.match(planned, /Planned \d+ batches/);

  const status = run("cortex-enrich.mjs", ["status", "."], root);
  assert.match(status, /0\/\d+ batches complete/);

  const merged = run("cortex-enrich.mjs", ["merge", "."], root);
  assert.match(merged, /Enriched 0\/\d+ indexed files/, "merging with no results is honest, not a crash");
  assert.ok(existsSync(join(root, ".cortex", "index", "enriched.json")));
});

// --- cortex-memory append (plan step 4.2) ---------------------------------------------------------
//
// The writer writes one file per author per day. Every run below says who is writing, or builds a
// git that knows nobody: a run that did neither would read the name of whoever owns the machine.

/** An environment in which git can find no identity but the one a fixture repo sets for itself. */
function isolatedGit(root, extra = {}) {
  const empty = join(root, "..", `${basename(root)}.gitconfig`);
  writeFileSync(empty, "");
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^GIT_/i.test(k) || k === "CORTEX_AUTHOR") delete env[k];
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: empty,
    GIT_CONFIG_SYSTEM: empty,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CEILING_DIRECTORIES: dirname(root), // a temp dir that sits inside some repo is not that repo
    ...extra,
  };
}

/** Run cortex-memory.mjs and return `{ code, stdout, stderr }`, whatever the exit. */
function memory(args, cwd, env) {
  const r = spawnSync(process.execPath, [cli("cortex-memory.mjs"), ...args], { cwd, env, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Every file and directory under `dir`, as sorted relative paths with `/`. */
function tree(dir, prefix = "") {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}${e.name}`;
    if (e.isDirectory()) out.push(`${rel}/`, ...tree(join(dir, e.name), `${rel}/`));
    else out.push(rel);
  }
  return out.sort();
}

function memoryFixture() {
  const root = fixture();
  mkdirSync(join(root, ".cortex"), { recursive: true });
  return root;
}

test("cortex-memory append writes <day>/<author>.md for CORTEX_AUTHOR, and reads it back", () => {
  const root = memoryFixture();
  const env = isolatedGit(root, { CORTEX_AUTHOR: "dev-a" });

  const wrote = memory(["append", "Split a.js out of index.js.", "--kind", "decision"], root, env);
  assert.equal(wrote.code, 0, wrote.stderr);
  assert.match(wrote.stdout, /^wrote .*[\\/]memory[\\/]\d{4}-\d{2}-\d{2}[\\/]dev-a\.md\n$/);
  assert.equal(wrote.stderr, "", "a write that names its author has nothing to warn about");

  const files = tree(join(root, ".cortex", "memory"));
  assert.equal(files.length, 2, "one day directory holding one file");
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}\/$/);
  assert.equal(files[1], `${files[0]}dev-a.md`);
  const text = readFileSync(join(root, ".cortex", "memory", files[1]), "utf8");
  assert.match(text, /^# \d{4}-\d{2}-\d{2} · dev-a\n\n## \d{2}:\d{2} · decision\n\nSplit a\.js out of index\.js\.\n\n$/);

  const back = memory(["recent", "--days", "1"], root, env);
  assert.match(back.stdout, /Split a\.js out of index\.js\./);
  assert.match(back.stdout, /^# \d{4}-\d{2}-\d{2} · dev-a$/m, "the header says whose file it is");
});

test("two authors on one day get two files, through the CLI", () => {
  const root = memoryFixture();
  assert.equal(memory(["append", "from the first"], root, isolatedGit(root, { CORTEX_AUTHOR: "dev-a" })).code, 0);
  assert.equal(memory(["append", "from the second"], root, isolatedGit(root, { CORTEX_AUTHOR: "dev-b" })).code, 0);
  const files = tree(join(root, ".cortex", "memory")).map((f) => f.replace(/^\d{4}-\d{2}-\d{2}/, "<day>"));
  assert.deepEqual(files, ["<day>/", "<day>/dev-a.md", "<day>/dev-b.md"]);
});

test("cortex-memory REFUSES a secret with exit 2, and creates no day directory", () => {
  const secret = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");
  // With an author set, with a git identity, and with no name at all: the gate is before all three.
  const cases = [
    (root) => isolatedGit(root, { CORTEX_AUTHOR: "dev-a" }),
    (root) => {
      gitRepo(root, isolatedGit(root), "Dev B");
      return isolatedGit(root);
    },
    (root) => isolatedGit(root),
  ];
  for (const envFor of cases) {
    const root = memoryFixture();
    const env = envFor(root);
    const r = memory(["append", `key ${secret} rotated`], root, env);
    assert.equal(r.code, 2, "a refused write must exit 2 so a caller can branch on it");
    assert.match(r.stderr, /REFUSED/);
    assert.ok(!r.stderr.includes(secret), "the refusal must not echo the secret");
    assert.equal(r.stdout, "");
    // The property, not one symptom of it: .cortex/ is as empty as it was. No memory/, no day
    // directory, no file.
    assert.deepEqual(tree(join(root, ".cortex")), [], "a refused write leaves nothing behind");
  }
});

test("a refused write on a day that has entries adds nothing to it", () => {
  const root = memoryFixture();
  const secret = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");
  assert.equal(memory(["append", "a note"], root, isolatedGit(root, { CORTEX_AUTHOR: "dev-a" })).code, 0);
  const before = tree(join(root, ".cortex"));
  const r = memory(["append", `key ${secret} rotated`], root, isolatedGit(root, { CORTEX_AUTHOR: "dev-b" }));
  assert.equal(r.code, 2);
  assert.deepEqual(tree(join(root, ".cortex")), before, "no file for the author whose write was refused");
});

/** Make `root` a git repo whose own config names `name`. Nothing is read from the machine. */
function gitRepo(root, env, name) {
  const git = (...args) => execFileSync("git", args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  if (name !== null) git("config", "user.name", name);
}

test("with no CORTEX_AUTHOR the author is the repo's git user.name, read by the real git", () => {
  const root = memoryFixture();
  const env = isolatedGit(root);
  gitRepo(root, env, "Dev  B.");
  const wrote = memory(["append", "from git"], root, env);
  assert.equal(wrote.code, 0, wrote.stderr);
  assert.match(wrote.stdout, /[\\/]memory[\\/]\d{4}-\d{2}-\d{2}[\\/]dev-b\.md\n$/);
  assert.equal(wrote.stderr, "");
});

test("CORTEX_AUTHOR beats the repo's git user.name, through the CLI", () => {
  const root = memoryFixture();
  gitRepo(root, isolatedGit(root), "Dev B");
  const wrote = memory(["append", "chosen"], root, isolatedGit(root, { CORTEX_AUTHOR: "dev-a" }));
  assert.match(wrote.stdout, /[\\/]dev-a\.md\n$/);
});

test("the author is read in the repo that holds --root, not in the directory the CLI ran from", () => {
  const root = memoryFixture();
  const env = isolatedGit(root);
  gitRepo(root, env, "Dev B");
  const elsewhere = tempDir("cortex-cli-elsewhere-");
  const wrote = memory(["append", "from elsewhere", "--root", join(root, ".cortex")], elsewhere, {
    ...env,
    GIT_CEILING_DIRECTORIES: [dirname(root), dirname(elsewhere)].join(delimiter),
  });
  assert.equal(wrote.code, 0, wrote.stderr);
  assert.match(wrote.stdout, /[\\/]dev-b\.md\n$/);
});

test("with no usable author the entry goes to <day>.md, exit 0, and stderr says so on every write", () => {
  // No git identity at all, and a repo whose git name has no ASCII letter. Both fall back.
  const cases = [
    (root) => isolatedGit(root),
    (root) => {
      gitRepo(root, isolatedGit(root), "Разработчик А"); // "developer A" in Cyrillic: nobody's name
      return isolatedGit(root);
    },
    (root) => isolatedGit(root, { CORTEX_AUTHOR: "" }), // an empty setting is an unset one
  ];
  for (const envFor of cases) {
    const root = memoryFixture();
    const env = envFor(root);
    for (const text of ["first", "second"]) {
      const r = memory(["append", text], root, env);
      assert.equal(r.code, 0, "a /dream at the end of a day does not fail over a setting");
      assert.match(r.stdout, /^wrote .*[\\/]memory[\\/]\d{4}-\d{2}-\d{2}\.md\n$/, "stdout is still the one line");
      assert.match(r.stderr, /shared day file \d{4}-\d{2}-\d{2}\.md/, `said on the ${text} write`);
      assert.match(r.stderr, /Set CORTEX_AUTHOR to /, "the line names the fix, as something to do");
      assert.equal(r.stderr.trim().split("\n").length, 1, "one line");
      assert.ok(!r.stderr.includes("Разработчик"), "no name is repeated");
    }
    const files = tree(join(root, ".cortex", "memory"));
    assert.equal(files.length, 1, "one day file and no day directory");
    assert.match(files[0], /^\d{4}-\d{2}-\d{2}\.md$/);
    const text = readFileSync(join(root, ".cortex", "memory", files[0]), "utf8");
    assert.match(text, /^# \d{4}-\d{2}-\d{2}\n\n## /, "the day file's header names no author");
    assert.match(text, /first\n\n## \d{2}:\d{2} · note\n\nsecond\n\n$/);
  }
});

test("a CORTEX_AUTHOR that is set and unusable writes nothing, and is not swapped for git", () => {
  for (const bad of ["..", "CON", "***"]) {
    const root = memoryFixture();
    gitRepo(root, isolatedGit(root), "Dev B");
    const r = memory(["append", "a note"], root, isolatedGit(root, { CORTEX_AUTHOR: bad }));
    assert.equal(r.code, 1, bad);
    assert.match(r.stderr, /CORTEX_AUTHOR/);
    assert.equal(r.stdout, "");
    assert.deepEqual(tree(join(root, ".cortex")), [], "nothing is written, to either layout");
  }
});

test("cortex-memory append never creates .cortex", () => {
  const root = fixture();
  const r = memory(["append", "a note"], root, isolatedGit(root, { CORTEX_AUTHOR: "dev-a" }));
  assert.notEqual(r.code, 0);
  assert.equal(existsSync(join(root, ".cortex")), false, "the consent gate: the writer never makes .cortex/");
});

// Both memory layouts (plan step 4.1). `recent` prints every file of each day it was asked for, so a
// date held by an old day file and by two authors' files prints all four of its entries.
test("cortex-memory recent prints every entry of a date held by both layouts", () => {
  const root = fixture();
  bothLayouts(join(root, ".cortex"));

  const day = run("cortex-memory.mjs", ["recent", "--days", "1"], root);
  for (const entry of ENTRIES_OF_THE_15TH) assert.ok(day.includes(entry), `missing: ${entry}`);
  assert.ok(!day.includes(ENTRIES.dayBefore), "--days 1 is one day");
  assert.ok(!day.includes("strayreadme"), "a stray README is not memory");
  // Each author's file opens with a header that names them, which is how the output says whose it is.
  assert.ok(day.indexOf("# 2026-08-15\n") < day.indexOf("# 2026-08-15 · dev-a"), "the old day file first");
  assert.ok(day.indexOf("# 2026-08-15 · dev-a") < day.indexOf("# 2026-08-15 · dev-b"), "then authors by slug");

  const all = run("cortex-memory.mjs", ["recent"], root);
  for (const entry of Object.values(ENTRIES)) assert.ok(all.includes(entry), `missing: ${entry}`);
});

test("cortex-memory recent reads a repo that only ever wrote one file per author", () => {
  const root = fixture();
  newLayoutOnly(join(root, ".cortex"));
  const out = run("cortex-memory.mjs", ["recent", "--days", "1"], root);
  assert.ok(out.includes(NEW_ONLY_ENTRY));
  assert.doesNotMatch(out, /no memory yet/);
});

test("an unknown subcommand fails loudly", () => {
  const root = fixture();
  let code = 0;
  try {
    run("cortex-enrich.mjs", ["frobnicate", "."], root);
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 1);
});

test("cortex-index says out loud what it skipped on a guess", () => {
  const root = fixture();
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "deploy.sh"), "#!/bin/sh\necho deploy\n");

  const out = run("cortex-index.mjs", ["."], root);

  assert.match(out, /Skipped by name/, "a silent gap is the part that costs the most");
  assert.match(out, /1 file under bin\//, "and the reader is told how much, and where");
});

function gitFixtureWithMovedFile() {
  const root = tempDir("cortex-cit-");
  const g = (...a) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "mcp", "lib"), { recursive: true });
  writeFileSync(join(root, "mcp", "lib", "scrub.js"), "export const scrub = 1;\n");
  writeFileSync(join(root, "AGENTS.md"), "# Brief\n\nThe secret gate is `mcp/lib/scrub.js`.\n");
  g("init", "-q");
  g("add", "-A");
  g("commit", "-qm", "init");
  mkdirSync(join(root, "core"), { recursive: true });
  g("mv", "mcp/lib/scrub.js", "core/scrub.js");
  g("commit", "-qm", "move scrub to core");
  return root;
}

test("cortex-review --citations proves a moved file left a document wrong", () => {
  const root = gitFixtureWithMovedFile();
  run("cortex-index.mjs", ["."], root);

  let out = "";
  let code = 0;
  try {
    out = run("cortex-review.mjs", ["--citations"], root);
  } catch (e) {
    out = String(e.stdout ?? "");
    code = e.status;
  }

  assert.equal(code, 1, "a provable finding must fail the gate");
  assert.match(out, /mcp\/lib\/scrub\.js/);
  assert.match(out, /core\/scrub\.js/, "and it must name where the file went");
});

test("cortex-review --citations --json reports counts by class", () => {
  const root = gitFixtureWithMovedFile();
  run("cortex-index.mjs", ["."], root);
  let out = "";
  try {
    out = run("cortex-review.mjs", ["--citations", "--json"], root);
  } catch (e) {
    out = String(e.stdout ?? "");
  }
  const r = JSON.parse(out);
  assert.equal(r.counts.provable, 1);
  assert.equal(r.findings[0].suggestion, "core/scrub.js");
});

test("cortex-review --citations exits zero on a repo whose citations all resolve", () => {
  const root = fixture();
  writeFileSync(join(root, "AGENTS.md"), "# Brief\n\nEntry point is `src/index.js`.\n");
  run("cortex-index.mjs", ["."], root);
  const out = run("cortex-review.mjs", ["--citations"], root);
  assert.match(out, /No unresolved citations/);
});

test("--citations --fix emits an appliable patch and changes nothing on disk", () => {
  const root = gitFixtureWithMovedFile();
  run("cortex-index.mjs", ["."], root);
  const before = readFileSync(join(root, "AGENTS.md"), "utf8");

  const patch = run("cortex-review.mjs", ["--citations", "--fix"], root);

  assert.match(patch, /^--- a\/AGENTS\.md$/m);
  assert.match(patch, /^-.*mcp\/lib\/scrub\.js/m);
  assert.match(patch, /^\+.*core\/scrub\.js/m);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), before, "index/ never writes to a target repo");

  writeFileSync(join(root, "p.diff"), patch);
  execFileSync("git", ["apply", "p.diff"], { cwd: root, stdio: "ignore" });
  assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /core\/scrub\.js/, "the patch must actually apply");
});

test("--fix declines to touch anything it cannot prove", () => {
  const root = fixture();
  writeFileSync(join(root, "AGENTS.md"), "# Brief\n\nSee `never/existed.js`.\n");
  run("cortex-index.mjs", ["."], root);
  const out = run("cortex-review.mjs", ["--citations", "--fix"], root);
  assert.match(out, /nothing to fix/i);
});

// --- cortex-review cites a change that lowers the bar (lib/lowered-bar.mjs) -------------------------
//
// On a real repository, because the reader takes git's own diff: line numbers, a rename and the
// staged-then-worktree fallback are git's behaviour, and a stub agrees with whoever wrote it.

function gitFixtureWithATestSuite({ contextLayer = true } = {}) {
  const root = tempDir("cortex-bar-");
  const g = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "core.autocrlf=false", ...a], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "pay.js"), "export function refund(n) {\n  return n;\n}\n");
  writeFileSync(join(root, "src", "pay.test.js"), "import { refund } from './pay.js';\n\nit('refunds once', () => {\n  expect(refund(1)).toBe(1);\n});\n\nit('refunds twice', () => {\n  expect(refund(2)).toBe(2);\n  expect(refund(2)).not.toBe(3);\n});\n");
  writeFileSync(join(root, "src", "old.test.js"), "it('old', () => {\n  expect(1).toBe(1);\n});\n");
  writeFileSync(join(root, "package.json"), '{\n  "name": "fixture",\n  "scripts": {\n    "lint": "eslint . --max-warnings 0"\n  }\n}\n');
  writeFileSync(join(root, "jest.config.js"), "export default {\n  coverageThreshold: {\n    global: {\n      branches: 80,\n    },\n  },\n};\n");
  if (contextLayer) writeFileSync(join(root, "AGENTS.md"), "# Brief\n\nRefunds live in `src/pay.js`.\n");
  g("init", "-q");
  g("add", "-A");
  g("commit", "-qm", "init");
  // The change: every way of lowering the bar, in one commit's worth of edits.
  writeFileSync(join(root, "src", "pay.js"), "export function refund(n) {\n  // eslint-disable-next-line no-undef\n  return n + fudge;\n}\n");
  writeFileSync(join(root, "src", "pay.test.js"), "import { refund } from './pay.js';\n\nit('refunds once', () => {\n  expect(refund(1)).toBe(1);\n});\n\nit.skip('refunds twice', () => {\n  expect(refund(2)).toBe(2);\n});\n");
  g("rm", "-q", "src/old.test.js");
  writeFileSync(join(root, "package.json"), '{\n  "name": "fixture",\n  "scripts": {\n    "lint": "eslint . --max-warnings 20"\n  }\n}\n');
  writeFileSync(join(root, "jest.config.js"), "export default {\n  coverageThreshold: {\n    global: {\n      branches: 50,\n    },\n  },\n};\n");
  return { root, g };
}

test("cortex-review --staged --json cites each line that lowers the bar, by git's own line numbers", () => {
  const { root, g } = gitFixtureWithATestSuite();
  run("cortex-index.mjs", ["."], root);
  g("add", "-A");
  const r = JSON.parse(run("cortex-review.mjs", ["--staged", "--json"], root));
  assert.equal(r.loweredBar.read, true);
  assert.deepEqual(
    r.loweredBar.citations.map((c) => `${c.kind} ${c.path}:${c.line} ${c.side}`),
    [
      "threshold jest.config.js:4 added",
      "threshold package.json:4 added",
      "deleted-test src/old.test.js:null removed",
      "suppression src/pay.js:2 added",
      "skipped-test src/pay.test.js:7 added",
      "stripped-assertion src/pay.test.js:9 removed",
    ],
  );
  assert.equal(r.loweredBar.citations.find((c) => c.kind === "threshold" && c.path === "jest.config.js").note, "was 80");
});

test("unstaged, the same change is read from the worktree, and the report says a citation is not a verdict", () => {
  const { root, g } = gitFixtureWithATestSuite();
  // `git rm` staged the deletion. With anything staged, --staged reads the index alone, so unstage
  // it: this case is the fallback to the worktree.
  g("reset", "-q");
  run("cortex-index.mjs", ["."], root);
  const out = run("cortex-review.mjs", ["--staged"], root);
  assert.match(out, /may have lowered the bar it is judged against \(6\)/);
  assert.match(out, /src\/pay\.js:2 {2}\/\/ eslint-disable-next-line no-undef/);
  assert.match(out, /src\/pay\.test\.js:9 \(removed\) {2}expect\(refund\(2\)\)\.not\.toBe\(3\);/);
  assert.match(out, /A citation is not a defect/);
  assert.match(out, /src\/old\.test\.js {2}\n {10}this test file is deleted/);
});

test("a named file is compared with the last commit, and a repo with no context layer is still read", () => {
  const { root } = gitFixtureWithATestSuite({ contextLayer: false });
  run("cortex-index.mjs", ["."], root);
  const out = run("cortex-review.mjs", ["src/pay.test.js"], root);
  assert.match(out, /no context layer/);
  assert.match(out, /a test skipped \(1\)/);
  assert.doesNotMatch(out, /eslint-disable/, "only the named file's lines");
});

test("a change that lowers nothing says so, and says what it cannot see", () => {
  const { root, g } = gitFixtureWithATestSuite();
  g("add", "-A");
  g("commit", "-qm", "lowered");
  writeFileSync(join(root, "src", "pay.js"), "export function refund(n) {\n  return n;\n}\n");
  run("cortex-index.mjs", ["."], root);
  const out = run("cortex-review.mjs", ["--staged"], root);
  assert.match(out, /No line of this change switches a check off/);
  assert.match(out, /not proof the bar held/);
});

test("a ref git cannot resolve is reported as unread, not as nothing lowered", () => {
  const { root } = gitFixtureWithATestSuite();
  run("cortex-index.mjs", ["."], root);
  let r;
  try {
    r = JSON.parse(run("cortex-review.mjs", ["src/pay.js", "--since", "no-such-ref", "--json"], root));
  } catch (e) {
    r = JSON.parse(String(e.stdout));
  }
  assert.equal(r.loweredBar.read, false);
  assert.deepEqual(r.loweredBar.citations, []);
});
