#!/usr/bin/env node
// The outcome harness: does a repo's context layer make an agent do a task right more often?
//
//   node evals/harness/run.mjs --dry             # no model: print the schedule and a table from a stubbed run
//   node evals/harness/run.mjs                   # the measurement: 2 probes, then 30 sessions; prints the table
//   node evals/harness/run.mjs --record          # the same, and append the result to evals/harness/RESULTS.md
//   node evals/harness/run.mjs --resume <run>    # continue an interrupted run from its records (add --record to record it)
//   node evals/harness/run.mjs --probe           # the preflight and the two probes only
//   node evals/harness/run.mjs --tasks <id,id> --once     # a partial run: some tasks, one repeat. Never read.
//
// It builds one small repo twice, with its context layer and without (fixture.mjs), runs five tasks
// three times in each through `claude -p` on your own login, decides every result with a command
// (accept.mjs), and prints raw counts. The two arms of a task and repeat run at the same time; the
// fifteen pairs run one after another. Each attempt's result, verdict and diff go to
// .cortex/evals/harness/<run>/, which is gitignored, and the working copy is deleted.
//
// A failed call is not a failed task: it is retried up to twice, counted, and never scored. A
// session that reaches the turn limit is scored on the tree it left. No flag takes a number, and
// RESULTS.md is only ever appended to by --record. A model run never happens in CI.
//
// Design: docs/specs/2026-10-09-outcome-harness-design.md. How to run it: evals/README.md.

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { claudeBin, parseResult, spawnClaude } from "../claude.mjs";
import { ARMS, CODENAME, FIXTURE_NAME, FIXTURE_VERSION, buildFixture, sessionDiff, treeHash } from "./fixture.mjs";
import { PROBE_PROMPT, TASKS, promptFor, taskById } from "./tasks.mjs";
import { HarnessFault, accept as realAccept } from "./accept.mjs";
import { stubSession } from "./stub.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The skill evals' target, so the two kinds of measurement are about one model (the spec's M4).
export const MODEL = "claude-sonnet-5";
export const EFFORT = "medium";
export const MAX_TURNS = 40;
export const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
export const REPEATS = 3;
export const MAX_RETRIES = 2;
// `--permission-prompts none` needs this version or later.
export const MIN_CLI = "2.1.259";
// What a full measurement is: five tasks, two arms, three repeats.
const FULL = TASKS.length * ARMS.length * REPEATS;

// ── one session ───────────────────────────────────────────────────────────────────────────────────

// The arguments of one session. Both arms get these, the same prompt and the same environment;
// only the working directory differs. The spec's table gives the sentence in the docs behind each.
export function sessionArgs() {
  return [
    "-p", "--model", MODEL, "--effort", EFFORT,
    "--permission-mode", "acceptEdits", "--permission-prompts", "none",
    "--allowedTools", "Bash(node *)", "Bash(npm test)", "Bash(npm test *)", "Bash(npm run *)",
    "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)",
    "--setting-sources", "project,local", "--strict-mcp-config", "--disable-slash-commands",
    "--no-session-persistence", "--max-turns", String(MAX_TURNS), "--output-format", "json",
  ];
}

// Added to the session's environment. Without it one session could leave a note the next one reads.
export const SESSION_ENV = Object.freeze({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });

// The real session: one `claude -p` process in the working copy, the prompt on stdin. It answers
// the result object the CLI printed, and throws when there is none.
export function claudeSession({ bin = claudeBin() } = {}) {
  return async ({ cwd, prompt, args, env, signal }) =>
    parseResult(await spawnClaude({ bin, args, cwd, env: { ...process.env, ...env }, input: prompt, signal }));
}

// Is this result a session to score, or a call that failed? A session that ended by itself is
// scored. One that reached --max-turns is scored on the tree it left and marked `budget`. Anything
// else is a failed call: an error subtype, an API or login error, no result at all, or a result in
// which the pinned model never ran.
export function classify(result, { model = MODEL } = {}) {
  const failed = (reason) => ({ kind: "failed", reason });
  if (!result || typeof result !== "object" || Array.isArray(result)) return failed("the session printed no result object");
  const budget = result.subtype === "error_max_turns";
  if (!budget && (result.is_error || result.subtype !== "success")) {
    const said = String(result.result ?? (Array.isArray(result.errors) ? result.errors.join("; ") : "")).slice(0, 300);
    return failed(`the session reported ${result.subtype ?? "no subtype"}${result.is_error ? ", an error" : ""}${said ? `: ${said}` : ""}`);
  }
  const usage = result.modelUsage && typeof result.modelUsage === "object" ? result.modelUsage : {};
  const ran = Object.entries(usage).flatMap(([name, u]) => [name, u?.canonicalModel]).filter(Boolean);
  if (!ran.includes(model)) return failed(`the pinned model ${model} is absent from the session's modelUsage (${Object.keys(usage).join(", ") || "empty"})`);
  return { kind: "scored", budget };
}

const number = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

// Turns, tokens and cost, as the result reports them. Tokens are every kind added up over every
// model the session used; nothing is read from them but their size.
function usageOf(result) {
  let tokens = 0;
  for (const u of Object.values(result?.modelUsage ?? {})) {
    tokens += (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0) + (u?.cacheReadInputTokens ?? 0) + (u?.cacheCreationInputTokens ?? 0);
  }
  return {
    turns: number(result?.num_turns),
    cost: number(result?.total_cost_usd),
    tokens: tokens || null,
    denials: Array.isArray(result?.permission_denials) ? result.permission_denials.length : null,
  };
}

// ── the schedule ──────────────────────────────────────────────────────────────────────────────────

// Fixed, and printed by --dry: for each repeat, the tasks in an order rotated by one from the
// repeat before. Each entry is a pair: its two arms are started together, so whatever drifts
// during a run (load, rate limits, a model update) reaches both arms of a pair alike.
export function schedule({ tasks = TASKS, repeats = REPEATS } = {}) {
  const pairs = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const shift = (repeat - 1) % tasks.length;
    for (const task of [...tasks.slice(shift), ...tasks.slice(0, shift)]) pairs.push({ repeat, task });
  }
  return pairs;
}

// ── before any session ────────────────────────────────────────────────────────────────────────────

const INSTRUCTION_FILES = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"];

// Claude Code loads these from the working directory "and every directory above it". One above the
// working copies would load in both arms, so the run stops with its path.
export function instructionFilesAbove(dir) {
  const found = [];
  for (let at = resolve(dir); ; at = dirname(at)) {
    for (const name of INSTRUCTION_FILES) if (existsSync(join(at, name))) found.push(join(at, name));
    if (dirname(at) === at) break;
  }
  return found;
}

export function versionAtLeast(text, min) {
  const parts = (s) => /(\d+)\.(\d+)\.(\d+)/.exec(String(s))?.slice(1).map(Number);
  const have = parts(text), need = parts(min);
  if (!have || !need) return false;
  for (let i = 0; i < 3; i++) if (have[i] !== need[i]) return have[i] > need[i];
  return true;
}

// The run cannot go on, and nothing about it is a result.
export class StopRun extends Error {}

// ── the run ───────────────────────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const duration = (ms) => {
  const s = Math.round(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};
const money = (x) => `$${x.toFixed(2)}`;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const recordName = (r) => `r${r.repeat}-${r.task}-${r.arm}-a${r.attempt}.json`;

// A cell is one task in one arm on one repeat. It is finished once a session was scored, or every
// attempt failed.
const attemptsOf = (records, task, arm, repeat) => records.filter((r) => r.task === task && r.arm === arm && r.repeat === repeat);
const isFinal = (attempts) => attempts.some((r) => r.kind === "scored") || attempts.length > MAX_RETRIES;

// One call with a time limit. The session is told to stop when it runs past it.
function timed(session, call, timeoutMs) {
  const ac = new AbortController();
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => { ac.abort(); reject(new Error(`ran past the time limit of ${duration(timeoutMs)}`)); }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(() => session({ ...call, signal: ac.signal })), limit]).finally(() => clearTimeout(timer));
}

function removeDir(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* a killed session may still hold a file; the temp dir is the OS's to clear */ }
}

// Runs the measurement, or continues one, and answers { meta, records }. Throws StopRun when the
// preflight or a probe says the arms are not what they should be, and HarnessFault when the scorer
// could not run. Everything that touches the world is in `d`, so the tests pass a stub.
export async function measure(d = {}) {
  const o = {
    accept: realAccept, tmp: tmpdir(), recordsRoot: join(REPO, ".cortex", "evals", "harness"), home: homedir(),
    now: () => new Date(), log: () => {}, timeoutMs: SESSION_TIMEOUT_MS, retryDelayMs: 20_000, tasks: TASKS, repeats: REPEATS,
    cliVersion: realCliVersion, ...d,
  };
  if (typeof o.session !== "function") throw new Error("measure needs a session");
  const invoked = Date.now();

  // Preflight: no model.
  const above = instructionFilesAbove(o.tmp);
  if (above.length) throw new StopRun(`an instruction file sits above the working copies and would load in both arms: ${above.join(", ")}. Move it, or point the run at another temp directory.`);
  const versionText = String(await o.cliVersion()).trim();
  if (!versionAtLeast(versionText, MIN_CLI)) throw new StopRun(`Claude Code ${versionText || "(no version)"} is older than ${MIN_CLI}, which --permission-prompts needs. Update it and run again.`);
  const cliVersion = /\d+\.\d+\.\d+/.exec(versionText)[0];
  const fixture = { name: FIXTURE_NAME, version: FIXTURE_VERSION, with: treeHash("with"), without: treeHash("without") };

  // The run: a new one, or the records of one that was interrupted.
  let meta, records = [];
  if (o.resume) {
    const dir = join(o.recordsRoot, o.resume);
    if (!existsSync(join(dir, "run.json"))) throw new StopRun(`no run ${o.resume} under ${o.recordsRoot}`);
    meta = readJson(join(dir, "run.json"));
    if (JSON.stringify(meta.fixture) !== JSON.stringify(fixture)) throw new StopRun(`run ${o.resume} was made with another version of the fixture; results from two versions are never added together`);
    if (meta.model !== MODEL || meta.effort !== EFFORT) throw new StopRun(`run ${o.resume} was made with ${meta.model} at ${meta.effort}`);
    records = readdirSync(dir).filter((f) => /^r\d+-.+-a\d+\.json$/.test(f)).map((f) => readJson(join(dir, f)));
  } else {
    const startedAt = o.now().toISOString();
    meta = {
      runId: `${startedAt.replace(/[-:]|\.\d+/g, "")}-${randomBytes(2).toString("hex")}`,
      startedAt, model: MODEL, effort: EFFORT, maxTurns: MAX_TURNS, cliVersion, fixture,
      userClaudeMd: existsSync(join(o.home, ".claude", "CLAUDE.md")),
      tasks: o.tasks.map((t) => t.id), repeats: o.repeats, probes: [], wallMs: 0, finished: false,
    };
  }
  const tasks = meta.tasks.map(taskById);
  const dir = join(o.recordsRoot, meta.runId);
  mkdirSync(dir, { recursive: true });
  mkdirSync(o.tmp, { recursive: true });
  const saveMeta = () => writeFileSync(join(dir, "run.json"), JSON.stringify({ ...meta, wallMs: meta.wallMs + (Date.now() - invoked) }, null, 2) + "\n");
  saveMeta();
  o.log(`run ${meta.runId} · ${FIXTURE_NAME} v${FIXTURE_VERSION} · ${MODEL} · ${EFFORT} · Claude Code ${cliVersion}`);

  // A fresh copy of one arm. The directory is <tmp>/cortex-harness-<random>/shop in both arms.
  const prepare = (arm) => {
    const root = mkdtempSync(join(o.tmp, "cortex-harness-"));
    const cwd = join(root, FIXTURE_NAME);
    buildFixture(cwd, { arm });
    return { root, cwd };
  };
  const launch = (cwd, prompt) => timed(o.session, { cwd, prompt, args: sessionArgs(), env: { ...SESSION_ENV } }, o.timeoutMs);

  try {
    // Two probe calls, one per arm, which are not sessions of the measurement. The root brief
    // names a codename; the with-arm must know it and the without-arm must not. If either fails the
    // arms are not what the spec says they are, and the run stops before the sessions are spent.
    const copies = ARMS.map((arm) => ({ arm, ...prepare(arm) }));
    const probes = await Promise.all(copies.map(async ({ arm, root, cwd }) => {
      try {
        const result = await launch(cwd, PROBE_PROMPT);
        const c = classify(result);
        if (c.kind === "failed") return { arm, ok: false, why: `the probe could not run in the ${arm}-arm: ${c.reason}` };
        const reply = String(result.result ?? "").trim();
        const knows = reply.toLowerCase().includes(CODENAME);
        const short = JSON.stringify(reply.slice(0, 120));
        if (arm === "with" && !knows) return { arm, ok: false, reply, why: `the with-arm did not answer the codename (it said ${short}): the root brief is not loading at launch` };
        if (arm === "without" && knows) return { arm, ok: false, reply, why: `the without-arm answered the codename (it said ${short}): something other than the layer is reaching it` };
        return { arm, ok: true, reply: reply.slice(0, 200), cost: number(result.total_cost_usd) };
      } catch (e) {
        if (e instanceof HarnessFault) throw e;
        return { arm, ok: false, why: `the probe could not run in the ${arm}-arm: ${e.message}` };
      } finally {
        removeDir(root);
      }
    }));
    meta.probes = probes;
    saveMeta();
    const bad = probes.filter((p) => !p.ok);
    if (bad.length) throw new StopRun(`${bad.map((p) => p.why).join("; ")}. No session was run.`);
    o.log("probes: the with-arm answered the codename and the without-arm did not");
    if (o.probeOnly) return { meta, records };

    // One attempt of one cell, in a copy that is deleted afterwards.
    const attemptOnce = async (task, arm, repeat, attempt, work) => {
      const base = { repeat, task: task.id, arm, attempt };
      const started = Date.now();
      try {
        let result;
        try {
          result = await launch(work.cwd, promptFor(task));
        } catch (e) {
          if (e instanceof HarnessFault) throw e;
          return { ...base, kind: "failed", reason: e.message, ms: Date.now() - started };
        }
        const c = classify(result);
        if (c.kind === "failed") return { ...base, kind: "failed", reason: c.reason, ...usageOf(result), result, ms: Date.now() - started };
        let diff = null;
        try { diff = sessionDiff(work.cwd); } catch { /* a session that removed its .git leaves no diff; the verdict does not need one */ }
        const verdict = await o.accept(task.id, work.cwd);
        return { ...base, kind: "scored", budget: c.budget, accept: verdict, ...usageOf(result), result, diff, ms: Date.now() - started };
      } finally {
        removeDir(work.root);
      }
    };

    // A cell: its first attempt in the copy built for the pair, then up to two retries.
    const runCell = async (task, arm, repeat, first) => {
      let work = first;
      for (let attempt = attemptsOf(records, task.id, arm, repeat).length + 1; attempt <= MAX_RETRIES + 1; attempt++) {
        work ??= prepare(arm);
        const record = await attemptOnce(task, arm, repeat, attempt, work);
        work = null;
        records.push(record);
        writeFileSync(join(dir, recordName(record)), JSON.stringify(record, null, 2) + "\n");
        const what = record.kind === "scored"
          ? `${record.accept.pass ? "pass" : "fail"}${record.budget ? " (budget)" : ""}  ${record.turns ?? "?"} turns  ${record.cost === null ? "" : money(record.cost)}  ${duration(record.ms)}${record.accept.pass ? "" : `  ${record.accept.reason}`}`
          : `failed call, attempt ${attempt} of ${MAX_RETRIES + 1}: ${record.reason}`;
        o.log(`  r${repeat} ${task.label} ${task.id.padEnd(13)} ${arm.padEnd(8)} ${what}`);
        if (record.kind === "scored") return;
        if (attempt <= MAX_RETRIES && o.retryDelayMs) await sleep(o.retryDelayMs);
      }
    };

    for (const { repeat, task } of schedule({ tasks, repeats: meta.repeats })) {
      const pending = ARMS.filter((arm) => !isFinal(attemptsOf(records, task.id, arm, repeat)));
      // Both copies are built before either session starts, so the two arms start together.
      const cells = pending.map((arm) => ({ arm, work: prepare(arm) }));
      const settled = await Promise.allSettled(cells.map(({ arm, work }) => runCell(task, arm, repeat, work)));
      const fault = settled.find((s) => s.status === "rejected");
      if (fault) throw fault.reason;
    }
    meta.finished = true;
    return { meta, records };
  } catch (e) {
    if (e && typeof e === "object") e.runId = meta.runId;
    throw e;
  } finally {
    meta.wallMs += Date.now() - invoked;
    writeFileSync(join(dir, "run.json"), JSON.stringify(meta, null, 2) + "\n");
  }
}

// ── scoring ───────────────────────────────────────────────────────────────────────────────────────

const order = (list, id) => { const i = list.indexOf(id); return i < 0 ? list.length : i; };
const byCell = (ids) => (a, b) =>
  order(ids, a.task) - order(ids, b.task) || order(ARMS, a.arm) - order(ARMS, b.arm) || a.repeat - b.repeat || a.attempt - b.attempt;

// Raw counts per task and arm, from a run's records. A cell's count is over the sessions that were
// scored: three repeats with one call lost read 2/2, never 2/3.
export function summarise(run) {
  const { meta, records } = run;
  const tasks = meta.tasks.map(taskById);
  const ids = tasks.map((t) => t.id);
  const count = (list, f) => list.filter(f).length;
  const cells = [];
  for (const task of tasks) {
    for (const arm of ARMS) {
      const mine = records.filter((r) => r.task === task.id && r.arm === arm);
      const scored = mine.filter((r) => r.kind === "scored");
      cells.push({
        task: task.id, label: task.label, control: task.control, arm,
        scored: scored.length,
        pass: count(scored, (r) => r.accept.pass === true),
        works: count(scored, (r) => r.accept.works === true),
        rule: task.control ? null : count(scored, (r) => r.accept.rule === true),
        budget: count(scored, (r) => r.budget),
        failedCalls: mine.length - scored.length,
        turns: scored.map((r) => r.turns).filter((x) => x !== null && x !== undefined),
        tokens: scored.map((r) => r.tokens).filter((x) => x !== null && x !== undefined),
        cost: mine.reduce((sum, r) => sum + (r.cost ?? 0), 0),
      });
    }
  }
  const armTotal = (arm) => {
    const mine = cells.filter((c) => c.arm === arm && !c.control);
    const sum = (k) => mine.reduce((n, c) => n + c[k], 0);
    return { pass: sum("pass"), works: sum("works"), rule: sum("rule"), scored: sum("scored") };
  };
  const cellOf = (task, arm) => cells.find((c) => c.task === task && c.arm === arm);
  const control = tasks.find((t) => t.control);
  const full = meta.repeats === REPEATS && ids.join() === TASKS.map((t) => t.id).join();
  const everyCellFinal = tasks.every((t) => ARMS.every((arm) =>
    Array.from({ length: meta.repeats }, (_, i) => i + 1).every((repeat) => isFinal(attemptsOf(records, t.id, arm, repeat)))));
  const scoredRecords = records.filter((r) => r.kind === "scored");
  const failedCallList = records.filter((r) => r.kind === "failed").sort(byCell(ids))
    .map((r) => ({ task: r.task, label: taskById(r.task).label, arm: r.arm, repeat: r.repeat, attempt: r.attempt, reason: r.reason }));
  return {
    cells,
    rule: { with: armTotal("with"), without: armTotal("without") },
    perTask: tasks.filter((t) => !t.control).map((t) => ({ task: t.id, with: cellOf(t.id, "with").pass, without: cellOf(t.id, "without").pass })),
    control: control ? { with: cellOf(control.id, "with").pass, without: cellOf(control.id, "without").pass } : null,
    scored: scoredRecords.length,
    scheduled: tasks.length * ARMS.length * meta.repeats,
    failedCalls: failedCallList.length,
    failedCallList,
    // Every session that was scored and did not pass, with the scorer's reason.
    failed: scoredRecords.filter((r) => !r.accept.pass).sort(byCell(ids))
      .map((r) => ({ task: r.task, label: taskById(r.task).label, arm: r.arm, repeat: r.repeat, budget: r.budget, reason: r.accept.reason })),
    budget: scoredRecords.filter((r) => r.budget).length,
    cost: records.reduce((sum, r) => sum + (r.cost ?? 0), 0) + (meta.probes ?? []).reduce((sum, p) => sum + (p.cost ?? 0), 0),
    complete: full && everyCellFinal,
  };
}

// ── the reading ───────────────────────────────────────────────────────────────────────────────────

export const READINGS = Object.freeze({
  suspect: "suspect",
  ceiling: "tasks do not discriminate",
  supported: "supported, at this size",
  notShown: "not shown",
  inconclusive: "inconclusive",
  notRead: "not read",
});

// What the counts mean, by a rule fixed before any session ran (the spec, "What the first
// measurement must show"). The primary number is passes on the rule tasks, out of twelve per arm.
// The rows are tried from the top and the first that fits is the reading. Nobody chooses it.
export function reading(s) {
  if (!s.complete) return { reading: READINGS.notRead, why: "this is not the full schedule of five tasks and three repeats, so the reading rule does not apply to it" };
  const w = s.rule.with.pass, wo = s.rule.without.pass, lead = w - wo;
  const counts = `the with-arm passed ${w} of ${s.rule.with.scored ?? 12} rule-task sessions and the without-arm ${wo} of ${s.rule.without.scored ?? 12}`;
  const gap = Math.abs(s.control.with - s.control.without);
  if (gap >= 2) return { reading: READINGS.suspect, why: `the control, which the layer should not help, differs by ${gap} of 3 between the arms (${s.control.with} with, ${s.control.without} without). Nothing is read from this run until the cause is found` };
  if (s.failedCalls > 6) return { reading: READINGS.suspect, why: `${s.failedCalls} calls failed, which is more than 6. Nothing is read from this run; repeat it` };
  if (wo >= 11) return { reading: READINGS.ceiling, why: `${counts}. The tasks are too easy to show anything: the fixture needs a new version` };
  if (w <= 1) return { reading: READINGS.ceiling, why: `${counts}. The tasks are too hard to show anything: the fixture needs a new version` };
  const leading = s.perTask.filter((t) => t.with > t.without).length;
  if (lead >= 4 && leading >= 2) return { reading: READINGS.supported, why: `${counts}, a lead of ${lead} on ${leading} tasks. This is worth the next thirty sessions and claims no significance` };
  if (lead <= 1) return { reading: READINGS.notShown, why: `${counts}. ${lead < 0 ? `The without-arm leads by ${-lead}` : `A lead of ${lead} is inside what one arm does against itself`}. The claim is not supported by this measurement` };
  return { reading: READINGS.inconclusive, why: `${counts}, a lead of ${lead}${lead >= 4 ? " carried by one task" : ""}. Run more repeats of the same five tasks before building on it` };
}

// ── the table ─────────────────────────────────────────────────────────────────────────────────────

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
const spread = (xs, show) => (xs.length ? `${show(median(xs))} (${show(Math.min(...xs))}–${show(Math.max(...xs))})` : "—");
const thousands = (n) => `${Math.round(n / 1000)}k`;
const WIDTHS = [18, 10, 7, 7, 7, 14, 20, 9];
const row = (cols) => cols.map((c, i) => String(c).padEnd(WIDTHS[i] ?? 0)).join("").trimEnd();
const calls = (n) => `${n} failed call${n === 1 ? "" : "s"}`;

// Raw counts. No percentage and no mean of passes is printed, because twelve sessions do not
// carry one. Turns and tokens are the median with the range over scored sessions; cost is the sum.
export function renderTable(run) {
  const s = summarise(run);
  const m = run.meta;
  const lines = [
    `outcome harness · ${m.fixture.name} v${m.fixture.version} · ${m.model} · ${m.effort} · ${m.startedAt.slice(0, 10)}  ·  ${s.scored} scored, ${calls(s.failedCalls)}`,
    row(["task", "arm", "pass", "works", "rule", "turns", "tokens", "cost", "failed calls"]),
  ];
  const of = (n, c) => `${n}/${c.scored}`;
  for (const c of s.cells) {
    const name = c.arm === ARMS[0] ? `${c.label} ${c.task}` : c.control ? "  (control)" : "";
    lines.push(row([name, c.arm, of(c.pass, c), of(c.works, c), c.rule === null ? "—" : of(c.rule, c),
      spread(c.turns, String), spread(c.tokens, thousands), money(c.cost), c.failedCalls]));
  }
  const ruleLabels = s.cells.filter((c) => !c.control && c.arm === ARMS[0]).map((c) => c.label);
  if (ruleLabels.length) {
    const name = `rule tasks ${ruleLabels.length > 1 ? `${ruleLabels[0]}–${ruleLabels.at(-1)}` : ruleLabels[0]}`;
    for (const arm of ARMS) {
      const t = s.rule[arm];
      lines.push(row([arm === ARMS[0] ? name : "", arm, of(t.pass, t), of(t.works, t), of(t.rule, t)]));
    }
  }
  if (s.budget) lines.push(`budget: ${s.budget} session${s.budget === 1 ? "" : "s"} reached the limit of ${m.maxTurns} turns and ${s.budget === 1 ? "was" : "were"} scored on the tree left behind`);
  const r = reading(s);
  lines.push(`reading: ${r.reading} — ${r.why}`);
  return lines.join("\n");
}

// ── the record ────────────────────────────────────────────────────────────────────────────────────

const RESULTS_HEADER = `# Outcome harness: results

Every section below was written by \`node evals/harness/run.mjs --record\` from the records of one
run. Nothing here is typed by hand, and a section is never edited afterwards: a later measurement is
a new section. This file is a log. It gates nothing, and two sections with a different model,
Claude Code version or fixture version are two measurements, not a trend.

What the table means, and the rule its reading follows, are in
[\`evals/README.md\`](../README.md#the-outcome-harness). The rule was fixed before the first session
ran.
`;

// One dated section, as a pure function of a run's records.
export function renderSection(run) {
  const s = summarise(run);
  const m = run.meta;
  const r = reading(s);
  const reported = [...new Set(run.records.filter((x) => x.kind === "scored").flatMap((x) => Object.keys(x.result?.modelUsage ?? {})))]
    .sort((a, b) => (a === m.model ? -1 : b === m.model ? 1 : a < b ? -1 : 1));
  const partial = s.scheduled === FULL ? [] : [`- schedule: partial. Tasks ${m.tasks.join(", ")}, ${m.repeats} repeat${m.repeats === 1 ? "" : "s"}: ${s.scheduled} sessions of the ${FULL} a measurement has`];
  const where = (x) => `${x.label} ${x.task} · ${x.arm} · repeat ${x.repeat}`;
  const lines = [
    `## ${m.startedAt.slice(0, 10)} · ${s.scored} of ${FULL} sessions scored · run ${m.runId}`,
    "",
    `- model: ${reported.length ? `${reported.join(", ")}, as the sessions reported it` : `${m.model}, pinned; no session was scored`} · effort ${m.effort} · Claude Code ${m.cliVersion}`,
    `- fixture: ${m.fixture.name} v${m.fixture.version} · with \`${m.fixture.with}\` · without \`${m.fixture.without}\``,
    `- \`~/.claude/CLAUDE.md\` existed during the run: ${m.userClaudeMd ? "yes" : "no"}`,
    ...partial,
    `- failed calls: ${s.failedCalls}`,
    `- total cost: ${money(s.cost)} · wall-clock: ${duration(m.wallMs)}`,
    "",
    "```text",
    renderTable(run),
    "```",
    "",
    `**Reading: ${r.reading}.** ${r.why[0].toUpperCase()}${r.why.slice(1)}.`,
    "",
    "### Failed sessions",
    "",
    ...(s.failed.length ? s.failed.map((x) => `- ${where(x)}: ${x.reason}${x.budget ? " (reached the turn limit)" : ""}`) : ["None."]),
    "",
    "### Failed calls",
    "",
    ...(s.failedCallList.length ? s.failedCallList.map((x) => `- ${where(x)} · attempt ${x.attempt}: ${String(x.reason).replace(/\s+/g, " ")}`) : ["None."]),
    "",
  ];
  return lines.join("\n");
}

const recordedIn = (file, runId) => existsSync(file) && readFileSync(file, "utf8").includes(`· run ${runId}\n`);

// Appends one section. Earlier bytes are never rewritten: the file is created with its header once,
// and after that it is only appended to.
export function appendRecord(file, run) {
  if (recordedIn(file, run.meta.runId)) throw new StopRun(`run ${run.meta.runId} is already recorded in ${file}; a section is never written twice`);
  if (!existsSync(file)) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, RESULTS_HEADER); }
  appendFileSync(file, `\n${renderSection(run)}`);
}

// ── the CLI ───────────────────────────────────────────────────────────────────────────────────────

const USAGE = "usage: node evals/harness/run.mjs [--dry] [--record] [--resume <run>] [--probe] [--tasks <id,id>] [--once]";

function parse(argv) {
  const o = { dry: false, record: false, probe: false, once: false };
  const value = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--") || !v.trim()) throw new Error(`${flag} needs a value. ${USAGE}`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry") o.dry = true;
    else if (a === "--record") o.record = true;
    else if (a === "--probe") o.probe = true;
    else if (a === "--once") o.once = true;
    else if (a === "--resume") o.resume = value(i++, a);
    else if (a === "--tasks") o.tasks = value(i++, a).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}. ${USAGE}`);
    // No flag takes a number, and no result is typed: a stray argument is refused, not ignored.
    else throw new Error(`unexpected argument ${JSON.stringify(a)}. ${USAGE}`);
  }
  if (o.tasks) for (const id of o.tasks) if (!taskById(id)) throw new Error(`unknown task ${JSON.stringify(id)}: it is one of ${TASKS.map((t) => t.id).join(", ")}. ${USAGE}`);
  return o;
}

const realCliVersion = async () => {
  const run = await spawnClaude({ args: ["--version"], input: "" });
  if (run.code !== 0) throw new StopRun(`\`claude --version\` exited ${run.code}: ${(run.stderr || run.stdout).trim().slice(-200)}`);
  return run.stdout;
};

export async function main(argv, deps = {}) {
  const { log = console.log, error = console.error } = deps;
  const resultsFile = deps.resultsFile ?? join(REPO, "evals", "harness", "RESULTS.md");
  let o;
  try { o = parse(argv); } catch (e) { error(e.message); return 2; }
  if (o.dry && (o.record || o.resume || o.probe)) { error("a dry run is never recorded, resumed or probed: it has no model in it"); return 2; }
  if (o.probe && (o.record || o.resume)) { error(`--probe runs the two probes and nothing else. ${USAGE}`); return 2; }
  if (!o.dry && !deps.session && process.env.CI) { error("a model run never happens in CI — run it on your own machine; CI runs --check"); return 2; }
  if (o.record && o.resume && recordedIn(resultsFile, o.resume)) { error(`run ${o.resume} is already recorded in ${resultsFile}; a section is never written twice`); return 1; }

  const tasks = o.tasks ? TASKS.filter((t) => o.tasks.includes(t.id)) : deps.tasks ?? TASKS;
  const repeats = o.once ? 1 : deps.repeats ?? REPEATS;
  const dryRoot = o.dry ? mkdtempSync(join(tmpdir(), "cortex-harness-dry-")) : null;
  const d = {
    ...deps, log, tasks, repeats, resume: o.resume, probeOnly: o.probe,
    session: o.dry ? stubSession() : deps.session ?? claudeSession(),
    cliVersion: deps.cliVersion ?? (o.dry ? async () => `${MIN_CLI} (not checked: dry run)` : realCliVersion),
    ...(o.dry ? { recordsRoot: join(dryRoot, "records"), retryDelayMs: 0 } : {}),
  };

  try {
    if (o.dry) {
      log("dry run: a stubbed session, no model. The stub applies a reference patch in both arms, so every task passes in both.");
      log("the schedule: each task's two arms start together, and the pairs run one after another");
      for (let repeat = 1; repeat <= repeats; repeat++) {
        log(`  repeat ${repeat}:  ${schedule({ tasks, repeats }).filter((p) => p.repeat === repeat).map((p) => p.task.id).join(", ")}`);
      }
    } else if (!deps.session) {
      log(o.probe ? "two probe calls on your login" : `${o.resume ? "continuing" : "starting"} a real run on your login: 2 probe calls, then up to ${tasks.length * ARMS.length * repeats} sessions`);
    }
    const run = await measure(d);
    if (o.probe) { for (const p of run.meta.probes) log(`  ${p.arm.padEnd(8)} answered ${JSON.stringify(p.reply)}`); return 0; }
    log("");
    log(renderTable(run));
    if (!o.dry) log(`\nrecords: ${join(d.recordsRoot ?? join(REPO, ".cortex", "evals", "harness"), run.meta.runId)}`);
    if (o.record) {
      appendRecord(resultsFile, run);
      log(`recorded in ${resultsFile}`);
    }
    return 0;
  } catch (e) {
    if (!(e instanceof StopRun) && !(e instanceof HarnessFault)) throw e;
    error(e instanceof HarnessFault ? `harness fault: ${e.message}` : e.message);
    if (e.runId && !o.dry && !o.probe) error(`the records so far are kept. Continue with: node evals/harness/run.mjs --resume ${e.runId}${o.record ? " --record" : ""}`);
    return e instanceof StopRun && /already recorded/.test(e.message) ? 1 : 2;
  } finally {
    if (dryRoot) removeDir(dryRoot);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
