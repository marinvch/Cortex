#!/usr/bin/env node
// The outcome harness's one scorer. A command decides every result; no model judges one.
//
//   node evals/harness/accept.mjs <task> <tree>     # exit 0 pass · 1 fail · 2 could not run
//
// It prints one JSON line, { task, works, rule, pass, reason }. For the given tree it runs three
// things under `node --test`:
//
//   1. the shop's own test files, as the fixture built them. They are written back first, so a
//      session that edited or deleted a test cannot pass by it;
//   2. accept/<task>.works.test.mjs — only what the prompt asks for;
//   3. accept/<task>.rule.test.mjs  — the rule the context layer states, by its property.
//
// `works` is 1 and 2 together. `rule` is 3, and null for the control. `pass` needs both.
//
// The tree is judged on a copy: the session's working copy is left as the session left it, and the
// acceptance files stay in Cortex and are never copied anywhere a session could read them.
//
// Exit 2 is a harness fault (an unknown task, a tree that is not a built fixture, `node` that would
// not start) and is never counted as a failed task. A change that hangs or no longer loads is a
// failed task: that is the session's doing, not the harness's.

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FIXTURE_NAME, OWN_TESTS, fixtureFiles } from "./fixture.mjs";
import { TASKS, taskById } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const EXIT = { pass: 0, fail: 1, fault: 2 };
export const ACCEPT_TIMEOUT_MS = 120_000;

export class HarnessFault extends Error {}

// One `node --test` run. Resolves { ok, timedOut, failed } and never rejects for a failing test;
// it rejects with a HarnessFault only when node itself could not be started.
function nodeTest(files, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const posix = process.platform !== "win32";
    const child = spawn(process.execPath, ["--test", "--test-reporter=tap", ...files], { cwd, env, windowsHide: true, detached: posix });
    let out = "";
    let timedOut = false;
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    // `node --test` runs each file in a process of its own. Killing the parent alone would leave a
    // hung file spinning, so the whole tree goes.
    const killTree = () => {
      if (!posix) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    };
    const timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(new HarnessFault(`node --test could not start: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      // The first failing test, by name. A file that would not load has no test name; say so.
      const failed = /^\s*not ok \d+ - (.+?)\s*$/m.exec(out)?.[1];
      resolve({ ok: code === 0 && !timedOut, timedOut, failed: timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : failed ?? "the tests did not run to the end" });
    });
  });
}

// The decision, as a function. The command below prints exactly this.
export async function accept(taskId, tree, { timeoutMs = ACCEPT_TIMEOUT_MS } = {}) {
  const task = taskById(taskId);
  if (!task) throw new HarnessFault(`unknown task ${JSON.stringify(taskId)}: it is one of ${TASKS.map((t) => t.id).join(", ")}`);
  if (typeof tree !== "string" || !existsSync(tree) || !statSync(tree).isDirectory()) throw new HarnessFault(`no tree at ${tree}`);
  if (!existsSync(join(tree, "package.json")) || !existsSync(join(tree, "src"))) throw new HarnessFault(`${tree} is not a built fixture: it has no package.json and src/`);
  const worksFile = join(HERE, "accept", `${task.id}.works.test.mjs`);
  const ruleFile = join(HERE, "accept", `${task.id}.rule.test.mjs`);
  if (!existsSync(worksFile)) throw new HarnessFault(`no works check for ${task.id}`);
  if (!task.control && !existsSync(ruleFile)) throw new HarnessFault(`no rule check for ${task.id}`);

  const root = mkdtempSync(join(tmpdir(), "cortex-accept-"));
  const copy = join(root, FIXTURE_NAME);
  try {
    cpSync(tree, copy, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules)$/.test(src) });
    const own = fixtureFiles("without");
    for (const rel of OWN_TESTS) {
      const at = join(copy, ...rel.split("/"));
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, Buffer.from(own[rel], "utf8"));
    }
    // A test run started from inside another `node --test` inherits this variable and then reports
    // in a format meant for its parent. The checks are their own runs.
    const env = { ...process.env, HARNESS_TREE: copy };
    delete env.NODE_TEST_CONTEXT;
    const opts = { cwd: copy, env, timeoutMs };
    const ownFiles = OWN_TESTS.filter((rel) => /\.test\.js$/.test(rel));
    const [ownRun, worksRun, ruleRun] = await Promise.all([
      nodeTest(ownFiles, opts),
      nodeTest([worksFile], opts),
      task.control ? null : nodeTest([ruleFile], opts),
    ]);
    const works = ownRun.ok && worksRun.ok;
    const rule = ruleRun ? ruleRun.ok : null;
    const pass = works && rule !== false;
    let reason = "pass";
    if (!worksRun.ok) reason = `works: ${worksRun.failed}`;
    else if (!ownRun.ok) reason = `own tests: ${ownRun.failed}`;
    else if (rule === false) reason = `rule: ${ruleRun.failed}`;
    return { task: task.id, works, rule, pass, reason };
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [taskId, tree, ...rest] = process.argv.slice(2);
  if (!taskId || !tree || rest.length) {
    console.error(`usage: node evals/harness/accept.mjs <task> <tree>     # task: ${TASKS.map((t) => t.id).join(" | ")}`);
    process.exitCode = EXIT.fault;
  } else {
    try {
      const result = await accept(taskId, tree);
      console.log(JSON.stringify(result));
      process.exitCode = result.pass ? EXIT.pass : EXIT.fail;
    } catch (e) {
      console.log(JSON.stringify({ task: taskId, works: null, rule: null, pass: null, reason: `harness fault: ${e.message}` }));
      process.exitCode = EXIT.fault;
    }
  }
}
