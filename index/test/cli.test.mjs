import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

test("cortex-memory appends, reads back, and REFUSES a secret with exit 2", () => {
  const root = fixture();
  mkdirSync(join(root, ".cortex"), { recursive: true });

  const wrote = run("cortex-memory.mjs", ["append", "Split a.js out of index.js.", "--kind", "decision"], root);
  assert.match(wrote, /^wrote /);

  const back = run("cortex-memory.mjs", ["recent", "--days", "1"], root);
  assert.match(back, /Split a\.js out of index\.js\./);

  const secret = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");
  let code = 0;
  let stderr = "";
  try {
    run("cortex-memory.mjs", ["append", `key ${secret} rotated`], root);
  } catch (e) {
    code = e.status;
    stderr = String(e.stderr);
  }
  assert.equal(code, 2, "a refused write must exit 2 so a caller can branch on it");
  assert.match(stderr, /REFUSED/);
  assert.ok(!stderr.includes(secret), "the refusal must not echo the secret");
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
