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

import { nextSteps, nextLine } from "./lib/next.mjs";
import { openTarget } from "./lib/open.mjs";

// `index: "optional"` — this command's whole job is answering on a repo where nothing has been run
// yet, so a missing index is the ordinary case and not an error. One that exists and cannot be read
// still gets said out loud on stderr: a file the user can see, silently ignored, is how a ✓ ends up
// next to a step nobody ran.
const { root, args, index } = openTarget(process.argv.slice(2), {
  usage: "usage: node index/cortex-next.mjs [root] [--line] [--json]",
  flags: { "--json": "boolean", "--line": "boolean", "--index": "value" },
  root: "positional",
  index: "optional",
  // --line is another tool's footer and --json is a ritual's input. Neither has room for an advisory.
  freshness: (a) => !a.json && !a.line,
});

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
