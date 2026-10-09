// The dry run of the outcome harness: every property the measurement rests on, shown with a
// stubbed session and no model. Nothing here starts `claude`. The session is injected as
// `deps.session`, the way the skill runner injects `deps.call`; the stub applies a reference patch
// to the working copy it is given and answers with a result the real CLI printed once
// (harness/templates/).
//
// The scorer is the real accept(). It is three test runs per call, so these tests remember its
// answer for a tree they have already had judged: thirty stubbed sessions leave at most ten
// different trees.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CODENAME, CONTEXT_LAYER, FIXTURE_VERSION, hashDir, treeHash } from "../harness/fixture.mjs";
import { CLOSING, PROBE_PROMPT, TASKS, promptFor } from "../harness/tasks.mjs";
import { HarnessFault, accept } from "../harness/accept.mjs";
import { stubSession, template } from "../harness/stub.mjs";
import {
  EFFORT, MAX_RETRIES, MAX_TURNS, MIN_CLI, MODEL, READINGS, REPEATS, SESSION_ENV, SESSION_TIMEOUT_MS,
  classify, instructionFilesAbove, main, measure, reading, renderSection, renderTable, schedule, sessionArgs,
  summarise, versionAtLeast,
} from "../harness/run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const roots = [];
const temp = (prefix = "cortex-harness-test-") => { const d = mkdtempSync(join(tmpdir(), prefix)); roots.push(d); return d; };
test.after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const judged = new Map();
const memoAccept = (task, dir) => {
  const key = `${task} ${hashDir(dir)}`;
  if (!judged.has(key)) judged.set(key, accept(task, dir));
  return judged.get(key);
};

const NOW = () => new Date("2026-10-09T10:00:00.000Z");
// What a test passes to measure() or main(): its own temp dirs, the stub, and no output.
function deps(session, extra = {}) {
  const base = temp();
  return {
    session, accept: memoAccept, tmp: join(base, "work"), recordsRoot: join(base, "records"), resultsFile: join(base, "RESULTS.md"),
    home: join(base, "home"), cliVersion: async () => "2.1.295 (Claude Code)", now: NOW, retryDelayMs: 0, log() {}, error() {}, ...extra,
  };
}
const cell = (summary, task, arm) => summary.cells.find((c) => c.task === task && c.arm === arm);
const counts = (c) => [c.pass, c.works, c.rule, c.scored];

// ── where the harness sits ────────────────────────────────────────────────────────────────────────

// Every relative import and re-export of a module, resolved to a file.
function importsOf(file) {
  const text = readFileSync(file, "utf8");
  const found = [...text.matchAll(/\b(?:import|export)\b[^;'"`]*?\bfrom\s*["'](\.[^"']+)["']/g), ...text.matchAll(/\bimport\s*\(?\s*["'](\.[^"']+)["']/g)];
  return found.map((m) => resolve(dirname(file), m[1]));
}
function modulesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? modulesUnder(join(dir, e.name)) : /\.mjs$/.test(e.name) ? [join(dir, e.name)] : []);
}

test("the harness imports nothing from outside evals/, and nothing in the product imports from it", () => {
  const evals = resolve(HERE, "..");
  const repo = resolve(evals, "..");
  const mine = [...modulesUnder(join(evals, "harness")), join(evals, "claude.mjs")];
  assert.ok(mine.length >= 20, "the harness's modules were found");
  for (const file of mine) {
    for (const to of importsOf(file)) assert.ok(to.startsWith(evals + sep), `${relative(repo, file)} imports ${relative(repo, to)}`);
  }
  // The other direction: the kernel, the leaves and the shipped tools never reach into evals/.
  for (const pkg of ["core", "index", "mcp", "tools"]) {
    const sources = readdirSync(join(repo, pkg), { recursive: true }).map(String)
      .filter((f) => /\.(m?js)$/.test(f) && !/(^|[\\/])node_modules[\\/]/.test(f));
    assert.ok(sources.length > 0, pkg);
    for (const f of sources) {
      assert.doesNotMatch(readFileSync(join(repo, pkg, f), "utf8"), /from\s*["'][^"']*evals\/|import\s*\(\s*["'][^"']*evals\//, `${pkg}/${f} imports from evals/`);
    }
  }
});

// ── the launch ────────────────────────────────────────────────────────────────────────────────────

test("one session is the command the spec gives, flag for flag", () => {
  assert.equal(MODEL, "claude-sonnet-5");
  assert.equal(EFFORT, "medium");
  assert.equal(MAX_TURNS, 40);
  assert.equal(SESSION_TIMEOUT_MS, 15 * 60 * 1000);
  assert.equal(REPEATS, 3);
  assert.equal(MAX_RETRIES, 2);
  assert.deepEqual(sessionArgs(), [
    "-p", "--model", "claude-sonnet-5", "--effort", "medium",
    "--permission-mode", "acceptEdits", "--permission-prompts", "none",
    "--allowedTools", "Bash(node *)", "Bash(npm test)", "Bash(npm test *)", "Bash(npm run *)",
    "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)",
    "--setting-sources", "project,local", "--strict-mcp-config", "--disable-slash-commands",
    "--no-session-persistence", "--max-turns", "40", "--output-format", "json",
  ]);
  assert.ok(!sessionArgs().includes("--bare"), "the session must load the repo's instructions");
  assert.deepEqual(SESSION_ENV, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
});

test("no prompt names a document or states a rule, and every prompt ends with the same closing line", () => {
  for (const t of TASKS) {
    const prompt = promptFor(t);
    assert.ok(prompt.endsWith(`\n\n${CLOSING}\n`), t.id);
    for (const rel of [...CONTEXT_LAYER, "AGENTS", "CLAUDE.md", "CONTEXT", "ADR", "docs/"]) assert.ok(!prompt.includes(rel), `${t.id} names ${rel}`);
    // The task's own words only: the spec's closing line says "repository", meaning the checkout.
    const task = prompt.slice(0, -`\n\n${CLOSING}\n`.length);
    assert.doesNotMatch(task, /minor unit|half to even|round|audit|migration|repository|service|never|must not|rule/i, t.id);
  }
  assert.ok(PROBE_PROMPT.includes("codename") && !PROBE_PROMPT.includes(CODENAME));
});

test("the schedule is the spec's: five tasks, rotated by one each repeat, the same on every call", () => {
  const ids = (s) => s.map((p) => `${p.repeat}:${p.task.id}`);
  assert.deepEqual(ids(schedule()), [
    "1:discount", "1:cancel", "1:note", "1:by-status", "1:search-empty",
    "2:cancel", "2:note", "2:by-status", "2:search-empty", "2:discount",
    "3:note", "3:by-status", "3:search-empty", "3:discount", "3:cancel",
  ]);
  assert.deepEqual(ids(schedule()), ids(schedule()));
  assert.deepEqual(ids(schedule({ tasks: [TASKS[4]], repeats: 1 })), ["1:search-empty"]);
});

// ── one full stubbed run: the launch is identical, and the same behaviour gives the same rows ─────

let sameRun;
async function runSame() {
  if (!sameRun) {
    const session = stubSession({ plan: () => ({ patch: "good" }) });
    const d = deps(session);
    sameRun = { session, d, run: await measure(d) };
  }
  return sameRun;
}

test("the launch is identical across arms: only the working directory differs", async () => {
  const { session, run } = await runSame();
  const sessions = session.calls.filter((c) => c.prompt !== PROBE_PROMPT);
  assert.equal(sessions.length, 30, "five tasks, two arms, three repeats");
  assert.equal(session.calls.length, 32, "and one probe per arm");
  const byPair = new Map();
  // Nothing failed in this run, so a task's n-th call in an arm is its n-th repeat.
  for (const c of sessions) {
    const key = `${c.seen.n}:${c.seen.task}`;
    byPair.set(key, [...(byPair.get(key) ?? []), c]);
  }
  assert.equal(byPair.size, 15);
  for (const [key, pair] of byPair) {
    assert.deepEqual(pair.map((c) => c.seen.arm).sort(), ["with", "without"], key);
    const [a, b] = pair;
    assert.equal(a.prompt, b.prompt, `${key}: the same bytes of prompt`);
    assert.deepEqual(a.args, b.args, `${key}: the same arguments`);
    assert.deepEqual(a.env, b.env, `${key}: the same environment`);
    assert.notEqual(a.cwd, b.cwd, key);
    for (const c of pair) {
      assert.equal(basename(c.cwd), "shop", `${key}: the directory is named for the fixture`);
      assert.match(basename(dirname(c.cwd)), /^cortex-harness-[A-Za-z0-9_-]{6}$/, `${key}: a random directory, so the arm's name is not in the path`);
      assert.deepEqual(c.args, sessionArgs(), key);
      assert.deepEqual(c.env, SESSION_ENV, key);
      assert.ok(c.signal instanceof AbortSignal, key);
    }
  }
  for (const c of sessions) for (const rel of CONTEXT_LAYER) assert.ok(!c.prompt.includes(rel), `a prompt names ${rel}`);
  assert.equal(run.meta.fixture.with, treeHash("with"));
  assert.equal(run.meta.fixture.without, treeHash("without"));
  assert.equal(run.meta.fixture.version, FIXTURE_VERSION);
});

test("the two arms of a pair are started together, and the pairs run one after another", async () => {
  const { session } = await runSame();
  const sessions = session.calls.filter((c) => c.prompt !== PROBE_PROMPT);
  for (let i = 0; i < sessions.length; i += 2) {
    const [a, b] = [sessions[i], sessions[i + 1]];
    assert.equal(`${a.seen.n}:${a.seen.task}`, `${b.seen.n}:${b.seen.task}`, "calls come in pairs");
    assert.notEqual(a.seen.arm, b.seen.arm);
    assert.ok(a.startedAt <= b.endedAt && b.startedAt <= a.endedAt, "both arms were running at once");
    if (i > 0) assert.ok(sessions[i - 1].endedAt <= a.startedAt && sessions[i - 2].endedAt <= a.startedAt, "the pair before had finished");
  }
});

test("the harness favours neither arm: the same behaviour in both gives two identical rows per task", async () => {
  const { run } = await runSame();
  const s = summarise(run);
  for (const t of TASKS) {
    assert.deepEqual(counts(cell(s, t.id, "with")), counts(cell(s, t.id, "without")), t.id);
    assert.deepEqual(counts(cell(s, t.id, "with")), [3, 3, t.control ? null : 3, 3], t.id);
  }
  assert.deepEqual([s.rule.with.pass, s.rule.without.pass, s.rule.with.scored, s.rule.without.scored], [12, 12, 12, 12]);
  assert.equal(s.scored, 30);
  assert.equal(s.failedCalls, 0);
  assert.equal(reading(s).reading, READINGS.ceiling, "everything passing without the layer shows nothing");
});

test("every working copy is deleted, and each attempt leaves its result, verdict and diff", async () => {
  const { d, run } = await runSame();
  assert.deepEqual(existsSync(d.tmp) ? readdirSync(d.tmp) : [], [], "no working copy is left behind");
  const dir = join(d.recordsRoot, run.meta.runId);
  const files = readdirSync(dir).sort();
  assert.equal(files.length, 31, "thirty attempts and run.json");
  const one = JSON.parse(readFileSync(join(dir, "r1-discount-with-a1.json"), "utf8"));
  assert.equal(one.kind, "scored");
  assert.deepEqual(one.accept, { task: "discount", works: true, rule: true, pass: true, reason: "pass" });
  assert.equal(one.result.subtype, "success");
  assert.match(one.diff, /^diff --git a\/src\/cart\/pricing\.js b\/src\/cart\/pricing\.js/m);
  assert.match(one.diff, /^\+.*percent\(subtotal/m);
  // The fixture's version and the hash of the arm's tree go into every record, not only run.json:
  // a record read by itself still says which tree it was earned on.
  for (const name of files.filter((f) => f !== "run.json")) {
    const record = JSON.parse(readFileSync(join(dir, name), "utf8"));
    assert.deepEqual(record.fixture, { version: FIXTURE_VERSION, tree: treeHash(record.arm) }, name);
  }
  const meta = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  assert.equal(meta.model, MODEL);
  assert.equal(meta.cliVersion, "2.1.295");
  assert.equal(meta.userClaudeMd, false);
  assert.deepEqual(meta.probes.map((p) => [p.arm, p.ok]), [["with", true], ["without", true]]);
});

test("a stub that is good in one arm and naive in the other gives 12 against 0, and swapping the arms swaps the table", async () => {
  const tables = {};
  for (const [name, goodArm] of [["layer", "with"], ["swapped", "without"]]) {
    const session = stubSession({ plan: (task, arm) => ({ patch: arm === goodArm || task === "search-empty" ? "good" : "naive" }) });
    const run = await measure(deps(session));
    tables[name] = summarise(run);
  }
  const { layer, swapped } = tables;
  assert.deepEqual([layer.rule.with.pass, layer.rule.without.pass], [12, 0]);
  assert.deepEqual([swapped.rule.with.pass, swapped.rule.without.pass], [0, 12]);
  for (const t of TASKS) {
    assert.deepEqual(counts(cell(layer, t.id, "with")), counts(cell(swapped, t.id, "without")), t.id);
    assert.deepEqual(counts(cell(layer, t.id, "without")), counts(cell(swapped, t.id, "with")), t.id);
  }
  // The naive arm did what was asked every time; only the rule separates them.
  assert.deepEqual([layer.rule.without.works, layer.rule.without.rule], [12, 0]);
  assert.equal(reading(layer).reading, READINGS.supported);
  assert.equal(reading(swapped).reading, READINGS.ceiling, "with the arms swapped the with-arm passes nothing, so the tasks show nothing for it");
  assert.equal(layer.failed.length, 12);
  assert.match(layer.failed[0].reason, /^rule: /);
});

// ── a failed call is not a zero ───────────────────────────────────────────────────────────────────

const ONE = { tasks: [TASKS[0]], repeats: 1 };
const TWO = { tasks: [TASKS[0]], repeats: 3 };

test("a call that throws once is retried, listed, and leaves the cell's count at the sessions scored", async () => {
  // `n` counts a task's calls in one arm: the second call is repeat 2's first attempt.
  const session = stubSession({
    plan: (task, arm, n) => (arm === "with" && n === 2 ? { throws: "claude exited 1: API Error: 529 overloaded" } : { patch: "good" }),
  });
  const run = await measure(deps(session, TWO));
  const s = summarise(run);
  assert.deepEqual(counts(cell(s, "discount", "with")), [3, 3, 3, 3], "the retry was scored");
  assert.equal(cell(s, "discount", "with").failedCalls, 1);
  assert.equal(s.failedCalls, 1);
  assert.deepEqual(s.failedCallList.map((f) => [f.task, f.arm, f.repeat, f.attempt]), [["discount", "with", 2, 1]]);
  assert.match(s.failedCallList[0].reason, /529 overloaded/);
  const attempts = run.records.filter((r) => r.arm === "with" && r.repeat === 2).map((r) => [r.attempt, r.kind]);
  assert.deepEqual(attempts, [[1, "failed"], [2, "scored"]]);
  const lost = run.records.find((r) => r.kind === "failed");
  assert.deepEqual(lost.fixture, { version: FIXTURE_VERSION, tree: treeHash("with") }, "a failed call's record names its tree too");
  assert.match(renderTable(run), /6 scored, 1 failed call\b/);
});

test("a call that fails on every attempt is never a zero: the cell reads 2/2, not 2/3", async () => {
  // Calls 3, 4 and 5 in the without-arm are repeat 3 and its two retries.
  const session = stubSession({ plan: (task, arm, n) => (arm === "without" && n >= 3 ? { throws: "timed out" } : { patch: "good" }) });
  const run = await measure(deps(session, TWO));
  const s = summarise(run);
  assert.deepEqual(counts(cell(s, "discount", "without")), [2, 2, 2, 2]);
  assert.equal(cell(s, "discount", "without").failedCalls, MAX_RETRIES + 1, "tried, then retried twice");
  assert.match(renderTable(run), /without\s+2\/2\s+2\/2\s+2\/2/);
  assert.doesNotMatch(renderTable(run), /2\/3/);
  assert.equal(s.scored, 5);
});

test("a session that reaches the turn limit is scored on the tree it left, and marked budget", async () => {
  // In one arm the limit is reached after the work was done, in the other before any was.
  const session = stubSession({ plan: (task, arm) => ({ patch: arm === "with" ? "good" : null, result: "max-turns" }) });
  const run = await measure(deps(session, ONE));
  const s = summarise(run);
  assert.equal(s.failedCalls, 0, "reaching the limit is not a failed call");
  assert.deepEqual(counts(cell(s, "discount", "with")), [1, 1, 1, 1]);
  assert.deepEqual(counts(cell(s, "discount", "without")), [0, 0, 0, 1]);
  assert.deepEqual(run.records.map((r) => r.budget), [true, true]);
  assert.equal(cell(s, "discount", "with").budget, 1);
  assert.match(renderTable(run), /budget/);
});

test("a result that reports another model is a failed call, and so is one that reports an error", async () => {
  const wrong = stubSession({ plan: (task, arm) => (arm === "with" ? { patch: "good", model: "claude-haiku-4-5" } : { patch: "good" }) });
  const s = summarise(await measure(deps(wrong, ONE)));
  assert.deepEqual(counts(cell(s, "discount", "with")), [0, 0, 0, 0]);
  assert.equal(cell(s, "discount", "with").failedCalls, 3);
  assert.match(s.failedCallList[0].reason, /claude-sonnet-5.*claude-haiku-4-5/);
  assert.deepEqual(counts(cell(s, "discount", "without")), [1, 1, 1, 1]);

  const good = template("success");
  assert.deepEqual(classify(good), { kind: "scored", budget: false });
  assert.deepEqual(classify(template("max-turns")), { kind: "scored", budget: true });
  assert.equal(classify({ ...good, is_error: true, subtype: "error_during_execution" }).kind, "failed");
  assert.equal(classify({ ...good, is_error: true, result: "API Error: 401 Please run /login" }).kind, "failed");
  assert.match(classify({ ...good, is_error: true, result: "API Error: 401 Please run /login" }).reason, /401/);
  assert.equal(classify({ ...good, modelUsage: {} }).kind, "failed");
  assert.equal(classify(null).kind, "failed");
  assert.equal(classify("text").kind, "failed");
});

test("the templates are what the CLI printed: a success and a run that ended at --max-turns 1", () => {
  const ok = template("success"), limit = template("max-turns");
  assert.equal(ok.type, "result");
  assert.equal(ok.subtype, "success");
  assert.equal(ok.is_error, false);
  assert.equal(limit.subtype, "error_max_turns");
  assert.equal(limit.is_error, true);
  assert.equal(limit.result, undefined, "a run that reached the limit prints no result text");
  for (const r of [ok, limit]) {
    assert.ok(MODEL in r.modelUsage);
    assert.equal(typeof r.total_cost_usd, "number");
    assert.equal(typeof r.num_turns, "number");
    assert.ok(Array.isArray(r.permission_denials));
    assert.doesNotMatch(JSON.stringify(r), /Users|home\/|[A-Z]:\\\\/, "no path from the machine that captured it");
  }
  assert.notEqual(template("success"), template("success"), "a fresh object each time");
});

test("a session that runs past the time limit is told to stop and counted as a failed call", async () => {
  let aborted = 0;
  const session = ({ prompt, signal }) => new Promise((resolve) => {
    if (prompt === PROBE_PROMPT) return resolve({ ...template("success"), result: "NONE" });
    signal.addEventListener("abort", () => { aborted++; });
  });
  const probes = stubSession({ plan: () => ({ patch: "good" }) });
  const both = (call) => (call.prompt === PROBE_PROMPT ? probes(call) : session(call));
  const run = await measure(deps(both, { ...ONE, timeoutMs: 40 }));
  const s = summarise(run);
  assert.equal(s.scored, 0);
  assert.equal(s.failedCalls, 6);
  assert.equal(aborted, 6, "each timed-out session was told to stop");
  assert.match(s.failedCallList[0].reason, /ran past/);
});

// ── before any session ────────────────────────────────────────────────────────────────────────────

test("an instruction file above the working copies stops the run with its path", async () => {
  const base = temp();
  mkdirSync(join(base, "nested", "work"), { recursive: true });
  assert.deepEqual(instructionFilesAbove(join(base, "nested", "work")).filter((p) => p.startsWith(base)), []);
  writeFileSync(join(base, "AGENTS.md"), "# stray\n");
  writeFileSync(join(base, "nested", "CLAUDE.local.md"), "stray\n");
  const found = instructionFilesAbove(join(base, "nested", "work")).filter((p) => p.startsWith(base));
  assert.deepEqual(found.sort(), [join(base, "AGENTS.md"), join(base, "nested", "CLAUDE.local.md")].sort());

  const session = stubSession({ plan: () => ({ patch: "good" }) });
  const errors = [];
  const code = await main([], deps(session, { tmp: join(base, "nested", "work"), error: (m) => errors.push(m) }));
  assert.equal(code, 2);
  assert.equal(session.calls.length, 0, "nothing was spent");
  assert.ok(errors.join("\n").includes(join(base, "AGENTS.md")));
});

test("a CLI too old for the flags stops the run before any call", async () => {
  assert.equal(MIN_CLI, "2.1.259");
  assert.equal(versionAtLeast("2.1.259", MIN_CLI), true);
  assert.equal(versionAtLeast("2.1.295 (Claude Code)", MIN_CLI), true);
  assert.equal(versionAtLeast("2.2.0", MIN_CLI), true);
  assert.equal(versionAtLeast("3.0.1", MIN_CLI), true);
  assert.equal(versionAtLeast("2.1.258", MIN_CLI), false);
  assert.equal(versionAtLeast("2.0.300", MIN_CLI), false);
  assert.equal(versionAtLeast("1.9.999", MIN_CLI), false);
  assert.equal(versionAtLeast("not a version", MIN_CLI), false);
  const session = stubSession({ plan: () => ({ patch: "good" }) });
  const errors = [];
  const code = await main([], deps(session, { cliVersion: async () => "2.1.200 (Claude Code)", error: (m) => errors.push(m) }));
  assert.equal(code, 2);
  assert.equal(session.calls.length, 0);
  assert.match(errors.join("\n"), /2\.1\.200.*2\.1\.259/);
});

test("the probes stop the run when an arm is not what it claims to be", async () => {
  // The codename reaches both arms: something other than the layer is loading it.
  const leaky = stubSession({ plan: () => ({ patch: "good" }), probe: () => CODENAME });
  const errors = [];
  assert.equal(await main([], deps(leaky, { error: (m) => errors.push(m) })), 2);
  assert.equal(leaky.calls.length, 2, "the thirty sessions were not started");
  assert.match(errors.join("\n"), /without.*codename/i);
  // The codename reaches neither: the root brief is not loading.
  const blind = stubSession({ plan: () => ({ patch: "good" }), probe: () => "NONE" });
  const errors2 = [];
  assert.equal(await main([], deps(blind, { error: (m) => errors2.push(m) })), 2);
  assert.equal(blind.calls.length, 2);
  assert.match(errors2.join("\n"), /with.*did not/i);
  // A probe that cannot run is not a pass.
  const broken = stubSession({ plan: () => ({ patch: "good" }), probe: () => { throw new Error("claude exited 1: not logged in"); } });
  assert.equal(await main([], deps(broken)), 2);
  assert.equal(broken.calls.length, 2);
});

test("a harness fault stops the run and is never scored", async () => {
  const session = stubSession({ plan: () => ({ patch: "good" }) });
  const errors = [];
  const faulty = async () => { throw new HarnessFault("node --test could not start"); };
  const code = await main(["--tasks", "discount", "--once"], deps(session, { accept: faulty, error: (m) => errors.push(m) }));
  assert.equal(code, 2);
  assert.match(errors.join("\n"), /harness fault: node --test could not start/);
});

test("a model run never happens in CI", async () => {
  const before = process.env.CI, bin = process.env.CLAUDE_CLI_BIN;
  process.env.CI = "true";
  // This test runs main() with no injected session. If the refusal ever goes, the real session
  // must not start on the contributor's login: point it at a binary that does not exist.
  process.env.CLAUDE_CLI_BIN = join(temp(), "no-such-claude");
  try {
    const errors = [];
    const d = deps(undefined, { error: (m) => errors.push(m) });
    delete d.session;
    assert.equal(await main([], d), 2);
    assert.equal(errors.join("\n"), "a model run never happens in CI — run it on your own machine; CI runs --check");
    assert.equal(await main(["--record"], d), 2);
    // A stubbed run is not a model run.
    assert.equal(await main(["--dry", "--tasks", "search-empty", "--once"], d), 0);
  } finally {
    if (before === undefined) delete process.env.CI; else process.env.CI = before;
    if (bin === undefined) delete process.env.CLAUDE_CLI_BIN; else process.env.CLAUDE_CLI_BIN = bin;
  }
});

// ── the reading ───────────────────────────────────────────────────────────────────────────────────

// perTask is [with, without] passes for T1..T4; the control and the failed calls default to clean.
function counted(perTask, { control = [3, 3], failedCalls = 0, complete = true } = {}) {
  const sum = (i) => perTask.reduce((n, p) => n + p[i], 0);
  return {
    complete, failedCalls,
    rule: { with: { pass: sum(0) }, without: { pass: sum(1) } },
    perTask: perTask.map(([w, wo], i) => ({ task: TASKS[i].id, with: w, without: wo })),
    control: { with: control[0], without: control[1] },
  };
}

test("the reading rule returns each of its five readings, on both sides of every threshold", () => {
  const read = (...a) => reading(counted(...a)).reading;
  // suspect: the control differs by 2 or more of 3, or more than 6 calls failed. It is tried first.
  assert.equal(read([[3, 0], [3, 0], [2, 1], [2, 1]], { control: [3, 1] }), READINGS.suspect);
  assert.equal(read([[3, 0], [3, 0], [2, 1], [2, 1]], { control: [0, 2] }), READINGS.suspect);
  assert.equal(read([[3, 0], [3, 0], [2, 1], [2, 1]], { control: [3, 2] }), READINGS.supported, "a control difference of 1 is not suspect");
  assert.equal(read([[3, 0], [3, 0], [2, 1], [2, 1]], { failedCalls: 7 }), READINGS.suspect);
  assert.equal(read([[3, 0], [3, 0], [2, 1], [2, 1]], { failedCalls: 6 }), READINGS.supported, "six failed calls are not more than six");
  // tasks do not discriminate: without passes 11 or 12, or with passes 0 or 1.
  assert.equal(read([[3, 3], [3, 3], [3, 3], [3, 3]]), READINGS.ceiling);
  assert.equal(read([[3, 3], [3, 3], [3, 3], [3, 2]]), READINGS.ceiling, "11 of 12 without");
  assert.equal(read([[3, 3], [3, 3], [3, 2], [3, 2]]), READINGS.inconclusive, "10 of 12 without is read");
  assert.equal(read([[1, 0], [0, 0], [0, 0], [0, 0]]), READINGS.ceiling, "1 of 12 with");
  assert.equal(read([[0, 0], [0, 0], [0, 0], [0, 0]]), READINGS.ceiling);
  assert.equal(read([[1, 0], [1, 0], [0, 0], [0, 0]]), READINGS.inconclusive, "2 of 12 with is read");
  // supported: a lead of 4 or more, on at least two tasks.
  assert.equal(read([[3, 1], [3, 1], [2, 2], [2, 2]]), READINGS.supported, "a lead of exactly 4 on two tasks");
  assert.equal(read([[3, 0], [3, 1], [3, 2], [3, 2]]), READINGS.supported);
  assert.equal(read([[3, 0], [2, 1], [1, 2], [2, 2]]), READINGS.inconclusive, "a lead of 3");
  // not shown: a lead of 1 or less, or the without-arm leading by any amount.
  assert.equal(read([[2, 1], [2, 2], [1, 1], [2, 2]]), READINGS.notShown, "a lead of 1");
  assert.equal(read([[2, 2], [2, 2], [1, 1], [2, 2]]), READINGS.notShown, "no lead");
  assert.equal(read([[2, 3], [2, 2], [1, 1], [2, 2]]), READINGS.notShown, "the without-arm leads by 1");
  assert.equal(read([[0, 3], [1, 3], [1, 2], [2, 2]]), READINGS.notShown, "the without-arm leads by 6");
  // inconclusive: a lead of 2 or 3, or 4 and more carried by one task.
  assert.equal(read([[2, 1], [2, 1], [1, 1], [2, 2]]), READINGS.inconclusive, "a lead of 2");
  assert.equal(read([[6, 1], [2, 2], [1, 1], [2, 2]]), READINGS.inconclusive, "a lead of 5 carried by one task, as more repeats could give");
  assert.equal(read([[6, 1], [3, 2], [1, 1], [2, 2]]), READINGS.supported, "the same lead on two tasks");
  // a run that is not the full schedule is not read at all.
  assert.equal(read([[3, 0], [3, 0], [3, 0], [3, 0]], { complete: false }), READINGS.notRead);
  for (const r of Object.values(READINGS)) assert.equal(typeof r, "string");
  assert.equal(new Set(Object.values(READINGS)).size, 6);
  assert.match(reading(counted([[3, 1], [3, 1], [2, 2], [2, 2]])).why, /10 of 12.*6 of 12/);
});

// ── the table and the record ──────────────────────────────────────────────────────────────────────

test("the table prints raw counts, a row per task and arm, the rule-task totals and the reading", async () => {
  const { run } = await runSame();
  const table = renderTable(run);
  const lines = table.split("\n");
  assert.match(lines[0], /^outcome harness · shop v1 · claude-sonnet-5 · medium · 2026-10-09 +· +30 scored, 0 failed calls$/);
  assert.match(lines[1], /^task +arm +pass +works +rule +turns +tokens +cost +failed calls$/);
  assert.match(table, /^T1 discount +with +3\/3 +3\/3 +3\/3 +\d+ \(\d+–\d+\) +\S+ \(\S+–\S+\) +\$\d+\.\d\d +0$/m);
  assert.match(table, /^T5 search-empty +with +3\/3 +3\/3 +— /m);
  assert.match(table, /^ +\(control\) +without +3\/3 +3\/3 +— /m);
  assert.match(table, /^rule tasks T1–T4 +with +12\/12 +12\/12 +12\/12$/m);
  assert.match(table, /^ +without +12\/12 +12\/12 +12\/12$/m);
  assert.match(lines.at(-1), /^reading: tasks do not discriminate — /);
  assert.doesNotMatch(table, /%|mean|average/i, "no percentage and no mean: twelve sessions do not carry one");
  assert.equal(lines.filter((l) => /^(T\d| +\(control\)| {17})/.test(l)).length >= 10, true);
});

test("--dry prints the schedule and a table from a stubbed run, and writes nothing to the repo", async () => {
  const lines = [];
  const d = deps(undefined, { log: (m) => lines.push(m) });
  delete d.session;
  assert.equal(await main(["--dry"], d), 0);
  const out = lines.join("\n");
  assert.match(out, /dry run: a stubbed session, no model/);
  assert.match(out, /repeat 1: +discount, cancel, note, by-status, search-empty/);
  assert.match(out, /repeat 2: +cancel, note, by-status, search-empty, discount/);
  assert.match(out, /repeat 3: +note, by-status, search-empty, discount, cancel/);
  assert.match(out, /^rule tasks T1–T4 +with +12\/12/m);
  assert.match(out, /^reading: /m);
  assert.equal(existsSync(d.resultsFile), false, "a dry run records nothing");
  const lines2 = [];
  assert.equal(await main(["--dry", "--record"], { ...d, error: (m) => lines2.push(m) }), 2);
  assert.match(lines2.join("\n"), /a dry run is never recorded/);
});

test("--record writes the section from a run's records and leaves every earlier section byte-identical", async () => {
  const session = stubSession({ plan: (task, arm) => ({ patch: arm === "with" || task === "search-empty" ? "good" : "naive" }) });
  const d = deps(session);
  const lines = [];
  assert.equal(await main(["--record"], { ...d, log: (m) => lines.push(m) }), 0);
  const first = readFileSync(d.resultsFile, "utf8");
  assert.match(first, /^# Outcome harness: results\n/);
  assert.match(first, /written by `node evals\/harness\/run\.mjs --record`/);
  const section = first.slice(first.indexOf("\n## "));
  assert.match(section, /^\n## 2026-10-09 · 30 of 30 sessions scored · run \S+\n/);
  assert.match(section, /- model: claude-sonnet-5, as the sessions reported it · effort medium · Claude Code 2\.1\.295/);
  assert.ok(section.includes(`- fixture: shop v${FIXTURE_VERSION} · with \`${treeHash("with")}\` · without \`${treeHash("without")}\``));
  assert.match(section, /- `~\/\.claude\/CLAUDE\.md` existed during the run: no/);
  assert.match(section, /- failed calls: 0/);
  assert.match(section, /- total cost: \$\d+\.\d\d · wall-clock: /);
  assert.match(section, /rule tasks T1–T4 +with +12\/12 +12\/12 +12\/12/);
  assert.match(section, /\*\*Reading: supported, at this size\.\*\*/);
  assert.match(section, /### Failed sessions\n\n- T1 discount · without · repeat 1: rule: /);
  assert.equal((section.match(/^- T\d \S+ · without · repeat \d: rule: /gm) ?? []).length, 12, "every failed session is listed with its reason");

  // A second measurement is a new section; the first is untouched, byte for byte.
  const later = { ...d, now: () => new Date("2026-10-20T08:00:00.000Z"), session: stubSession({ plan: () => ({ patch: "good" }) }) };
  assert.equal(await main(["--record"], later), 0);
  const second = readFileSync(d.resultsFile, "utf8");
  assert.ok(second.startsWith(first), "the earlier section is byte-identical and still first");
  assert.match(second.slice(first.length), /^\n## 2026-10-20 · 30 of 30 sessions scored · run /);
  assert.equal((second.match(/^## /gm) ?? []).length, 2);

  // Recording the same run again is refused: a section is never written twice or edited.
  const runId = /run (\S+)\n/.exec(second.slice(first.length))[1];
  const errors = [];
  assert.equal(await main(["--resume", runId, "--record"], { ...later, error: (m) => errors.push(m) }), 1);
  assert.match(errors.join("\n"), /already recorded/);
  assert.equal(readFileSync(d.resultsFile, "utf8"), second);
});

test("no flag takes a number, and nothing but the harness's own records reaches the file", async () => {
  const session = stubSession({ plan: () => ({ patch: "good" }) });
  for (const argv of [["--record", "12"], ["--pass", "12"], ["--record", "--with", "12/12"], ["--repeats", "1"], ["--model", "claude-opus-5"], ["12"]]) {
    const d = deps(session);
    const errors = [];
    assert.equal(await main(argv, { ...d, error: (m) => errors.push(m) }), 2, argv.join(" "));
    assert.match(errors.join("\n"), /unknown|usage/, argv.join(" "));
    assert.equal(existsSync(d.resultsFile), false, argv.join(" "));
  }
  assert.equal(session.calls.length, 0);
  const d = deps(session);
  assert.equal(await main(["--tasks", "nothing"], d), 2);
  assert.equal(await main(["--resume"], d), 2);
});

test("an incomplete run can be recorded, and its heading says how many of thirty were scored", async () => {
  // The first three calls of `note` in each arm are repeat 1 and its two retries.
  const session = stubSession({ plan: (task, arm, n) => (task === "note" && n <= 3 ? { throws: "claude exited 1: API Error: 529" } : { patch: "good" }) });
  const d = deps(session);
  assert.equal(await main(["--record"], d), 0);
  const text = readFileSync(d.resultsFile, "utf8");
  assert.match(text, /^## 2026-10-09 · 28 of 30 sessions scored · run /m);
  assert.match(text, /- failed calls: 6/);
  assert.match(text, /### Failed calls\n\n- T3 note · with · repeat 1 · attempt 1: claude exited 1: API Error: 529/);
  assert.match(text, /^T3 note +with +2\/2 +2\/2 +2\/2 /m);

  const partial = deps(stubSession({ plan: () => ({ patch: "good" }) }));
  assert.equal(await main(["--tasks", "search-empty,discount", "--once", "--record"], partial), 0);
  const short = readFileSync(partial.resultsFile, "utf8");
  assert.match(short, /^## 2026-10-09 · 4 of 30 sessions scored · run /m);
  assert.match(short, /\*\*Reading: not read\.\*\*/);
});

test("an interrupted run continues from its records and does not repeat a finished session", async () => {
  let stop = true;
  const session = stubSession({ plan: (task) => { if (stop && task === "note") throw new HarnessFault("interrupted here"); return { patch: "good" }; } });
  const d = deps(session, { tasks: TASKS.slice(0, 3), repeats: 1 });
  const errors = [];
  assert.equal(await main([], { ...d, error: (m) => errors.push(m) }), 2);
  const [runId] = readdirSync(d.recordsRoot);
  const before = readdirSync(join(d.recordsRoot, runId)).sort();
  assert.deepEqual(before, ["r1-cancel-with-a1.json", "r1-cancel-without-a1.json", "r1-discount-with-a1.json", "r1-discount-without-a1.json", "run.json"]);
  assert.match(errors.join("\n"), new RegExp(`--resume ${runId}`), "the run says how to continue it");

  stop = false;
  const made = session.calls.length;
  const lines = [];
  assert.equal(await main(["--resume", runId], { ...d, log: (m) => lines.push(m) }), 0);
  const again = session.calls.slice(made).filter((c) => c.prompt !== PROBE_PROMPT);
  assert.deepEqual(again.map((c) => c.seen.task).sort(), ["note", "note"], "only the unfinished pair ran");
  assert.equal(readdirSync(join(d.recordsRoot, runId)).length, 7);
  assert.match(lines.join("\n"), /6 scored, 0 failed calls/);
  assert.equal(await main(["--resume", "no-such-run"], d), 2);
});

test("a cell interrupted after two failed calls still gets its third attempt when the run continues", async () => {
  let failing = true;
  const session = stubSession({ plan: (task, arm) => (failing && arm === "with" ? { throws: "claude exited 1: API Error: 529" } : { patch: "good" }) });
  const d = deps(session, ONE);
  const run = await measure(d);
  const dir = join(d.recordsRoot, run.meta.runId);
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes("-with-")).sort(), ["r1-discount-with-a1.json", "r1-discount-with-a2.json", "r1-discount-with-a3.json"]);
  // As if the run had stopped before the last retry: two attempts are on record, and one is owed.
  rmSync(join(dir, "r1-discount-with-a3.json"));
  failing = false;
  const made = session.calls.filter((c) => c.prompt !== PROBE_PROMPT).length;
  const resumed = await measure({ ...d, resume: run.meta.runId });
  const again = session.calls.filter((c) => c.prompt !== PROBE_PROMPT).slice(made);
  assert.deepEqual(again.map((c) => [c.seen.task, c.seen.arm]), [["discount", "with"]], "only the owed attempt ran");
  const mine = resumed.records.filter((r) => r.arm === "with").map((r) => [r.attempt, r.kind]).sort();
  assert.deepEqual(mine, [[1, "failed"], [2, "failed"], [3, "scored"]]);
  assert.deepEqual(counts(cell(summarise(resumed), "discount", "with")), [1, 1, 1, 1]);
});

test("a run is never continued on another version of the fixture, or with another model", async () => {
  const session = stubSession({ plan: () => ({ patch: "good" }) });
  const d = deps(session, ONE);
  const run = await measure(d);
  const file = join(d.recordsRoot, run.meta.runId, "run.json");
  const meta = JSON.parse(readFileSync(file, "utf8"));
  const made = session.calls.length;
  for (const [change, says] of [
    [{ fixture: { ...meta.fixture, version: meta.fixture.version + 1 } }, /another version of the fixture/],
    [{ fixture: { ...meta.fixture, with: "0".repeat(64) } }, /another version of the fixture/],
    [{ model: "claude-haiku-4-5" }, /claude-haiku-4-5/],
    [{ effort: "high" }, /at high/],
  ]) {
    writeFileSync(file, JSON.stringify({ ...meta, ...change }));
    const errors = [];
    assert.equal(await main(["--resume", run.meta.runId], { ...d, error: (m) => errors.push(m) }), 2, JSON.stringify(change));
    assert.match(errors.join("\n"), says);
  }
  assert.equal(session.calls.length, made, "results from two versions are never added together: no call was made");
});

test("a section is a pure function of a run's records", async () => {
  const { run } = await runSame();
  assert.equal(renderSection(run), renderSection(JSON.parse(JSON.stringify(run))));
  assert.ok(renderSection(run).includes(renderTable(run)));
});
