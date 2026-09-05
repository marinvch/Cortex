#!/usr/bin/env node
// cortex-next.mjs — where this repo is in the Cortex sequence, and the one command to run now.
//
//   node index/cortex-next.mjs .          # the ordered runbook, with ✓ / → / ·
//   node index/cortex-next.mjs . --line   # one line, for another tool's footer
//   node index/cortex-next.mjs . --json   # for a ritual to walk
//
// Read-only in the strongest sense: it writes nothing, not even under .cortex/.
//
// This exists because the product had an ordering problem, not a capability one. Every skill knew
// its own job and none of them knew what came after, so the answer to "I installed the plugin,
// now what" was a table of eleven commands sorted by nothing. Deterministic on purpose — the
// sequence is a fact about the filesystem, and asking a model to re-derive it every session is how
// a user gets a different answer each time.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { nextSteps, nextLine } from "./lib/next.mjs";
import { rootProblem } from "./lib/root.mjs";

function parseArgs(argv) {
  const args = { root: null, json: false, line: false, index: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--line") args.line = true;
    else if (a === "--index") args.index = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else if (!a.startsWith("--")) args.root = a;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log("usage: node index/cortex-next.mjs [root] [--line] [--json]");
  process.exit(0);
}

const root = resolve(args.root || process.cwd());

// A root that is not a directory produces a confident empty answer, not an error: buildIndex
// returns zero files rather than throwing. Refuse instead — the route in (a mangled flag, a typo,
// a stale path in a script) does not matter, the output does.
const rootIssue = rootProblem(root);
if (rootIssue) {
  process.stderr.write(rootIssue);
  process.exit(1);
}
const indexPath = args.index
  ? (isAbsolute(args.index) ? args.index : resolve(args.index))
  : join(root, ".cortex", "index", "index.json");

let index = null;
if (existsSync(indexPath)) {
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    index = null;
  }
}

const plan = nextSteps(root, index);

if (args.json) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}
if (args.line) {
  console.log(nextLine(root, index));
  process.exit(0);
}

const B = "\x1b[1m", D = "\x1b[2m", C = "\x1b[36m", G = "\x1b[32m", R = "\x1b[0m";
const tty = process.stdout.isTTY;
const b = (s) => (tty ? B + s + R : s);
const dim = (s) => (tty ? D + s + R : s);
const cyan = (s) => (tty ? C + s + R : s);
const green = (s) => (tty ? G + s + R : s);

console.log("");
console.log(b(`Cortex — ${root}`));
console.log(dim(`${plan.done} of ${plan.total} steps done. Every ✓ is a file on disk, not a guess.`));
console.log("");

for (const s of plan.steps) {
  const mark = s.done ? green("✓") : s.next ? cyan("→") : dim("·");
  const title = s.done ? dim(s.title) : s.next ? b(s.title) : s.title;
  const tags = [s.optional ? dim("(optional)") : "", s.blocking ? cyan("(do this first)") : ""].filter(Boolean).join(" ");
  console.log(`  ${mark} ${title} ${tags}`.trimEnd());
  console.log(`      ${dim(s.why)}`);
  if (!s.done) console.log(`      ${cyan(s.cmd)}`);
  console.log("");
}

console.log(b("Per change — not a sequence, a lookup"));
for (const p of plan.perChange) console.log(`  ${p.when.padEnd(34)} ${cyan(p.cmd)}`);
console.log("");
console.log(nextLine(root, index));
