#!/usr/bin/env node
// Did my edit make this ritual worse? Run a skill's eval tasks against a real model and compare the
// score to the one recorded for the previous version of its text.
//
//   node evals/run.mjs <skill> [--split test] [--record] [--accept-drop "<reason>"]
//        [--model claude-sonnet-5] [--effort medium] [--concurrency 4] [--timeout 300]
//   node evals/run.mjs --check          # deterministic, no model: is every baseline current?
//
// Each task runs through `claude -p` on your own login: the SKILL.md BODY is the system prompt, the
// task's `prompt` is the user message, and the reply is scored by score.mjs — the one scorer. This
// is what SkillOpt's adapter does, without Python. A model run never happens in CI; `--check` is the
// half CI runs, and it only compares hashes.
//
// `--record` writes evals/baselines/<skill>.json. It refuses when the mean soft score fell more than
// DROP_LIMIT below the previous baseline, unless --accept-drop says why — the reason is kept as
// `note`. It also refuses when any call failed: a timeout scores 0, and a baseline full of outages
// is a low bar that would hide the next real regression.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SKILLS } from "./skills.mjs";
import { scoreTask } from "./score.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DROP_LIMIT = 0.1;
// The target model and effort SkillOpt trains against (skillopt/config.yaml), so a baseline recorded
// here and a score SkillOpt reports are measuring the same thing.
export const DEFAULT_MODEL = "claude-sonnet-5";
export const DEFAULT_EFFORT = "medium";

// ── the body and its hash ─────────────────────────────────────────────────────────────────────────

// The trainable document: frontmatter stripped exactly as skillopt/run.py's seed_skill() strips it.
// Frontmatter is routing metadata, never trained, so editing it must not demand a re-measure; line
// endings are normalised first so a CRLF checkout hashes the same as the LF one that recorded it.
export function skillBody(text) {
  return String(text).replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "").trimStart();
}

export const bodySha256 = (text) => createHash("sha256").update(skillBody(text), "utf8").digest("hex");

const paths = (root, skill, split = "test") => ({
  skill: join(root, "skills", skill, "SKILL.md"),
  tasks: join(root, "evals", "data", skill, split, "tasks.json"),
  baseline: join(root, "evals", "baselines", `${skill}.json`),
  predictions: join(root, ".cortex", "evals", skill, split),
});
const recordCmd = (skill, split = "test") => `node evals/run.mjs ${skill} --split ${split} --record`;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ── --check ───────────────────────────────────────────────────────────────────────────────────────

export function check({ root = REPO, skills = Object.keys(SKILLS) } = {}) {
  const problems = [];
  for (const skill of skills) {
    const p = paths(root, skill);
    if (!existsSync(p.baseline)) {
      problems.push({ skill, message: `${skill}: no baseline — measure it with \`${recordCmd(skill)}\`` });
      continue;
    }
    if (!existsSync(p.skill)) { problems.push({ skill, message: `${skill}: baseline exists but skills/${skill}/SKILL.md does not` }); continue; }
    const b = readJson(p.baseline);
    const now = bodySha256(readFileSync(p.skill, "utf8"));
    if (b.bodySha256 !== now) {
      problems.push({
        skill,
        message: `${skill}: skills/${skill}/SKILL.md changed since its baseline (recorded ${b.recordedAt}, soft ${b.soft}) — ` +
          `re-measure with \`${recordCmd(skill, b.split)}\``,
      });
    }
  }
  return { ok: problems.length === 0, problems };
}

// ── running the tasks ─────────────────────────────────────────────────────────────────────────────

// `call({system, user, signal})` returns the reply as a string or `{text, model}`. It is injected so
// the tests never spawn `claude`; the default is claudeCall().
export async function runTasks({ tasks, system, call, concurrency = 4, timeoutMs = 300_000, onResult = () => {} }) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      const task = tasks[i];
      const ac = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { ac.abort(); reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
      });
      let r;
      try {
        const reply = await Promise.race([Promise.resolve().then(() => call({ system, user: task.prompt, signal: ac.signal })), timeout]);
        const text = typeof reply === "string" ? reply : reply?.text ?? "";
        r = { ...scoreTask(task, text), prediction: text, model: reply?.model };
      } catch (e) {
        // A failed call is a failed task, not a crashed run — the other tasks still get measured.
        r = { id: task.id, hard: 0, soft: 0, reason: `model call failed: ${e.message}`, failed: true, prediction: "" };
      } finally {
        clearTimeout(timer);
      }
      results[i] = r;
      onResult(r, i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker));
  return results;
}

const round = (x) => Math.round(x * 10000) / 10000;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ── --record ──────────────────────────────────────────────────────────────────────────────────────

// Compared on the stored (rounded) means, with a hair of tolerance so a drop of exactly DROP_LIMIT
// is not refused by floating-point noise.
export function judgeRecord(prev, next, acceptDrop) {
  if (!prev) return { ok: true, message: "no previous baseline" };
  if (prev.split !== next.split) return { ok: true, message: `previous baseline was on ${prev.split}; not comparable` };
  const drop = prev.soft - next.soft;
  if (drop <= DROP_LIMIT + 1e-9) return { ok: true, message: `soft ${prev.soft} → ${next.soft}` };
  if (acceptDrop) return { ok: true, message: `soft ${prev.soft} → ${next.soft}, drop accepted: ${acceptDrop}` };
  return {
    ok: false,
    message: `soft fell ${round(drop)} (${prev.soft} → ${next.soft}), more than ${DROP_LIMIT} — this edit made the skill worse ` +
      `on its evals. Fix the edit, or record it on purpose with --accept-drop "<why the drop is worth it>".`,
  };
}

// ── the real model call ───────────────────────────────────────────────────────────────────────────

// Isolated on purpose: an empty temp cwd (no CLAUDE.md, no git status), local settings only, no tools,
// no MCP servers, no skills, no session saved. The system prompt goes by file because a skill body is
// longer than cmd.exe's 8,191-character command line, which is what `claude.cmd` runs through on
// Windows. `--system-prompt-file` replaces Claude Code's default prompt, as `--system-prompt` does.
export function claudeCall({ model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, bin = process.env.CLAUDE_CLI_BIN || (process.platform === "win32" ? "claude.cmd" : "claude") } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cortex-evals-"));
  const files = new Map();
  const shell = /\.(cmd|bat)$/i.test(bin);
  return ({ system, user, signal }) => new Promise((resolve, reject) => {
    const key = createHash("sha256").update(system).digest("hex").slice(0, 12);
    if (!files.has(key)) { files.set(key, join(dir, `system-${key}.md`)); writeFileSync(files.get(key), system); }
    const args = ["-p", "--system-prompt-file", files.get(key), "--setting-sources", "local", "--tools", "",
      "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence",
      "--model", model, "--effort", effort, "--output-format", "json"];
    // A .cmd shim cannot be spawned without a shell (Node refuses it since the 2024 batch-file fix),
    // and the shell joins argv unquoted, so quote each argument — including the empty --tools value.
    const child = shell
      ? spawn([bin, ...args].map((a) => `"${a}"`).join(" "), { cwd: dir, shell: true, env: { ...process.env, CLAUDE_SETTING_SOURCES: "local" }, windowsHide: true })
      : spawn(bin, args, { cwd: dir, env: { ...process.env, CLAUDE_SETTING_SOURCES: "local" } });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    signal?.addEventListener("abort", () => {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGKILL");
    });
    child.on("close", (code) => {
      let j;
      try { j = JSON.parse(out); } catch { return reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(-300)}`)); }
      if (j.is_error || j.subtype !== "success") return reject(new Error(`claude: ${j.subtype} ${String(j.result ?? "").slice(0, 300)}`));
      resolve({ text: j.result ?? "", model: Object.keys(j.modelUsage || {})[0] || model });
    });
    child.stdin.end(user);
  });
}

// ── the CLI ───────────────────────────────────────────────────────────────────────────────────────

function parse(argv) {
  const o = { split: "test", record: false, check: false, positional: [] };
  const value = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--") || !v.trim()) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") o.check = true;
    else if (a === "--record") o.record = true;
    else if (a === "--split") o.split = value(i++, a);
    else if (a === "--accept-drop") o.acceptDrop = value(i++, a);
    else if (a === "--model") o.model = value(i++, a);
    else if (a === "--effort") o.effort = value(i++, a);
    else if (a === "--concurrency") o.concurrency = Number(value(i++, a));
    else if (a === "--timeout") o.timeoutMs = Number(value(i++, a)) * 1000;
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else o.positional.push(a);
  }
  return o;
}

export async function main(argv, deps = {}) {
  const { root = REPO, skills = Object.keys(SKILLS), log = console.log, error = console.error } = deps;
  let o;
  try { o = parse(argv); } catch (e) { error(e.message); return 2; }

  if (o.check) {
    const { ok, problems } = check({ root, skills });
    for (const p of problems) error(p.message);
    log(ok ? `every evaled skill matches its baseline (${skills.join(", ")})` : `${problems.length} skill(s) need re-measuring`);
    return ok ? 0 : 1;
  }

  const [skill] = o.positional;
  if (!skill || !skills.includes(skill)) { error(`usage: node evals/run.mjs <${skills.join("|")}> [--split test] [--record] [--accept-drop "<reason>"] | --check`); return 2; }
  if (!deps.call && process.env.CI) { error("a model run never happens in CI — run it on your own machine; CI runs --check"); return 2; }

  const p = paths(root, skill, o.split);
  if (!existsSync(p.tasks)) { error(`no tasks at ${p.tasks}`); return 2; }
  const tasks = readJson(p.tasks);
  const text = readFileSync(p.skill, "utf8");
  const model = o.model || DEFAULT_MODEL;
  const call = deps.call || claudeCall({ model, effort: o.effort || DEFAULT_EFFORT });

  const started = Date.now();
  log(`${skill} · ${o.split} · ${tasks.length} tasks · ${deps.call ? "injected model" : `${model} via claude -p`}`);
  const results = await runTasks({
    tasks, system: skillBody(text), call, concurrency: o.concurrency || 4, timeoutMs: o.timeoutMs || 300_000,
    onResult: (r) => log(`  ${r.id.padEnd(24)} hard ${r.hard}  soft ${r.soft.toFixed(3)}${r.hard ? "" : `  ${r.reason}`}`),
  });
  const seconds = Math.round((Date.now() - started) / 1000);

  mkdirSync(p.predictions, { recursive: true });
  for (const r of results) writeFileSync(join(p.predictions, `${r.id}.txt`), `${r.prediction}\n\n--- hard ${r.hard} soft ${r.soft} ${r.reason || ""}\n`);

  const failed = results.filter((r) => r.failed).length;
  const next = {
    skill, bodySha256: bodySha256(text), split: o.split, n: results.length,
    hard: round(mean(results.map((r) => r.hard))), soft: round(mean(results.map((r) => r.soft))),
    model: results.find((r) => r.model)?.model || model, effort: o.effort || DEFAULT_EFFORT, recordedAt: new Date().toISOString(),
  };
  log(`  mean  hard ${next.hard.toFixed(3)}  soft ${next.soft.toFixed(3)}  (${seconds}s${failed ? `, ${failed} call(s) failed` : ""})`);

  const prev = existsSync(p.baseline) ? readJson(p.baseline) : null;
  if (prev) log(`  baseline  hard ${prev.hard}  soft ${prev.soft}  (${prev.model}${prev.effort ? ` · ${prev.effort}` : ""}, ${prev.recordedAt})${prev.bodySha256 === next.bodySha256 ? "" : "  — body has changed since"}`);
  if (!o.record) return 0;

  if (failed) { error(`not recorded: ${failed} model call(s) failed, and a failed call is not a measurement — re-run`); return 1; }
  const verdict = judgeRecord(prev, next, o.acceptDrop);
  if (!verdict.ok) { error(`not recorded: ${verdict.message}`); return 1; }
  if (o.acceptDrop) next.note = o.acceptDrop;
  mkdirSync(dirname(p.baseline), { recursive: true });
  writeFileSync(p.baseline, JSON.stringify(next, null, 2) + "\n");
  log(`recorded evals/baselines/${skill}.json — ${verdict.message}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
