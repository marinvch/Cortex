// agent-answers.mjs — what the developer said about an agent already here, kept for the next run.
//
// Every mapping of an existing agent to a role is a proposal the developer confirms (`agents.mjs`),
// and an agent the mapper will not guess about is asked about. Until this file the answer lived in
// one command's `--as` arguments: a repo with five area-owner agents, each answered "not a role",
// was asked the same five questions on every /cortex run (#548). The answer is a decision about the
// repo, so it is kept in the repo.
//
// The file is `.cortex/agents.json`, committed like `.cortex/stamps.json`, so a teammate is not
// asked what a colleague already answered:
//
//   { "format": 1,
//     "answers": { "<repo-relative posix path of the agent>": "<role>" | "none" } }
//
// It is its own file rather than a key in the stamp record. That record refuses a key it does not
// know, so a teammate one release behind would read a record carrying answers as damaged, and a
// damaged record blocks every re-run. An older plugin that never reads this file only asks again.
//
// The direction of error is chosen: reading can only ever lose an answer, never invent one. A file
// that is missing, unparseable or the wrong shape reads as no answers. One bad entry (a path out of
// the repo, a role the roster does not have) is dropped and the rest are kept. Whether an answered
// path still names an agent is `agentReport`'s to decide, since it holds the list.
//
// Writing is the opposite: `rememberAgentAnswers` refuses a file it cannot read rather than
// replacing it, because that file may hold a teammate's answers. It is the one write here and it
// touches only `.cortex/agents.json`. Deterministic: sorted paths, LF, no clock.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROLES } from "./agents.mjs";
import { stampPathProblem } from "./stamps.mjs";

export const ANSWERS_REL = ".cortex/agents.json";
export const ANSWERS_FORMAT = 1;

const NONE = "none";
const fileOf = (repoRoot) => join(repoRoot, ...ANSWERS_REL.split("/"));
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The document on disk: `null` when there is none, `undefined` when it is not an answers file. */
function load(file) {
  if (!existsSync(file)) return null;
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const answers = doc?.answers;
    if (doc?.format !== ANSWERS_FORMAT || !answers || typeof answers !== "object" || Array.isArray(answers)) return undefined;
    return doc;
  } catch {
    return undefined;
  }
}

/**
 * The answers recorded for this repo, as `{ path: role | null }` — `null` is "not a role". `{}` when
 * nothing was recorded or the file cannot be read; see the header for why that never throws.
 */
export function readAgentAnswers(repoRoot) {
  const out = {};
  const doc = load(fileOf(repoRoot));
  if (!doc) return out;
  for (const path of Object.keys(doc.answers).sort(byCodeUnit)) {
    const said = doc.answers[path];
    if (stampPathProblem(path)) continue;
    if (said === NONE) out[path] = null;
    else if (ROLES.includes(said)) out[path] = said;
  }
  return out;
}

/**
 * Record `answers` (`{ path: role | null | undefined }`) over the ones already there and return the
 * file written. `null` records "not a role"; `undefined` forgets the answer, so the agent is asked
 * about again. Refused before any write: a path that is not repo-relative, a role the roster does
 * not have, and a file already there that cannot be read.
 */
export function rememberAgentAnswers(repoRoot, answers) {
  const file = fileOf(repoRoot);
  for (const [path, role] of Object.entries(answers)) {
    const problem = stampPathProblem(path);
    if (problem) throw new Error(`${path}: an agent path ${problem}`);
    if (role !== null && role !== undefined && !ROLES.includes(role)) throw new Error(`${role} is not a role — one of ${ROLES.join(", ")}, or none`);
  }
  const doc = load(file);
  if (doc === undefined) throw new Error(`${file}: not an answers file this Cortex can read, so it is not replaced — fix or remove it first`);

  const merged = { ...(doc ? readAgentAnswers(repoRoot) : {}) };
  for (const [path, role] of Object.entries(answers)) {
    if (role === undefined) delete merged[path];
    else merged[path] = role;
  }
  const sorted = {};
  for (const path of Object.keys(merged).sort(byCodeUnit)) sorted[path] = merged[path] ?? NONE;

  mkdirSync(join(repoRoot, ".cortex"), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ format: ANSWERS_FORMAT, answers: sorted }, null, 2) + "\n");
  renameSync(tmp, file);
  return file;
}
