// A session with no model in it. The tests inject it as `deps.session`, and `run.mjs --dry` uses it
// to show the whole path (build, launch, score, table) without spending a call.
//
// It is given exactly what a real session is given: a working directory, the prompt, the arguments
// and the environment. It learns its arm the way an agent would, by looking at the directory it
// was started in, and its task from the prompt. Then it applies a reference patch and answers with
// a result the real CLI printed once (templates/, ids zeroed and the reply text replaced).
//
//   stubSession({ plan, probe })
//     plan(task, arm, n)   what to do on the n-th call for that task in that arm:
//                            { patch: "good" | "naive" | null,   the reference patch to apply
//                              result: "success" | "max-turns",  the template to answer with
//                              model: "<name>",                  report this model instead
//                              throws: "<message>" }             fail the call
//     probe(arm)           the reply to the probe; by default the codename read off the files the
//                          working copy holds, or NONE
//
// The returned function carries `calls`: everything it was given, in order.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROBE_PROMPT, TASKS, promptFor } from "./tasks.mjs";
import { SOLUTIONS, applyPatch } from "./solutions/index.mjs";

const TEMPLATES = { success: "result-success.json", "max-turns": "result-max-turns.json" };

// A fresh copy of a captured result.
export function template(name) {
  if (!TEMPLATES[name]) throw new Error(`no result template ${JSON.stringify(name)}`);
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./templates/${TEMPLATES[name]}`, import.meta.url)), "utf8"));
}

// The codename, as a session that loads CLAUDE.md and its import at launch would know it.
function codenameIn(cwd) {
  const shim = join(cwd, "CLAUDE.md");
  if (!existsSync(shim)) return "NONE";
  const imported = /^@(\S+)/m.exec(readFileSync(shim, "utf8"))?.[1];
  const text = imported && existsSync(join(cwd, imported)) ? readFileSync(join(cwd, imported), "utf8") : "";
  return /^Project codename: (\S+)/m.exec(text)?.[1] ?? "NONE";
}

export function stubSession({ plan = () => ({ patch: "good" }), probe } = {}) {
  const calls = [];
  const counts = new Map();
  const session = async ({ cwd, prompt, args, env, signal }) => {
    const call = { cwd, prompt, args: [...args], env: { ...env }, signal, startedAt: performance.now(), endedAt: null, seen: null };
    calls.push(call);
    try {
      // A real session takes time, and its two arms overlap. Give the other arm a turn.
      await new Promise((resolve) => setTimeout(resolve, 2));
      const arm = existsSync(join(cwd, "CLAUDE.md")) ? "with" : "without";
      if (prompt === PROBE_PROMPT) {
        call.seen = { probe: true, arm };
        return { ...template("success"), result: probe ? probe(arm) : codenameIn(cwd) };
      }
      const task = TASKS.find((t) => promptFor(t) === prompt);
      if (!task) throw new Error("the stub was given a prompt that is no task's");
      const key = `${task.id} ${arm}`;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      call.seen = { task: task.id, arm, n };
      const step = plan(task.id, arm, n) ?? {};
      if (step.throws) throw new Error(step.throws);
      if (step.patch) {
        const patch = SOLUTIONS[task.id]?.[step.patch];
        if (!patch) throw new Error(`no ${step.patch} patch for ${task.id}`);
        applyPatch(cwd, patch);
      }
      const result = template(step.result ?? "success");
      result.num_turns = step.result === "max-turns" ? 41 : 6 + TASKS.indexOf(task) + n;
      if (step.model) result.modelUsage = Object.fromEntries(Object.values(result.modelUsage).map((usage) => [step.model, { ...usage, canonicalModel: step.model }]));
      return result;
    } finally {
      call.endedAt = performance.now();
    }
  };
  session.calls = calls;
  return session;
}
