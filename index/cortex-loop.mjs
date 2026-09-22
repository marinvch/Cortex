#!/usr/bin/env node
// cortex-loop.mjs — which parts of the AI-native SDLC loop this repo has, and what it is missing.
//
//   node index/cortex-loop.mjs .          # the loop by stage, with ✓ / → / ·
//   node index/cortex-loop.mjs . --line   # one line, for another tool's footer
//   node index/cortex-loop.mjs . --json   # the worklist, for /cortex to walk
//
// Read-only in the strongest sense: it writes nothing, not even under `.cortex/`.
//
// This is `/cortex`'s script the way the findings report is `/cortex-install`'s (ADR 0006). The
// ritual walks `missing` top-down, so the rank in `lib/loop.mjs` is control flow — it decides which
// artifact a user is offered first, not merely how a report reads.

import { loopPlan, loopLine, STAGES } from "./lib/loop.mjs";
import { openTarget } from "./lib/open.mjs";

// `index: "optional"` — the loop is mostly file facts, and the two rows that read the index
// (`brief` cites the stack, `hooks` cites generated paths) degrade to an honest "nothing detected"
// rather than to a wrong answer. Running this before the indexer is the ordinary case on a repo
// where `/cortex` has only just started.
const { root, args, index } = openTarget(process.argv.slice(2), {
  usage: "usage: node index/cortex-loop.mjs [root] [--line] [--json]",
  flags: { "--json": "boolean", "--line": "boolean", "--index": "value" },
  root: "positional",
  index: "optional",
  freshness: (a) => !a.json && !a.line,
});

const plan = loopPlan(root, index);

if (args.json) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}
if (args.line) {
  console.log(loopLine(root, index));
  process.exit(0);
}

const B = "\x1b[1m", D = "\x1b[2m", C = "\x1b[36m", G = "\x1b[32m", R = "\x1b[0m";
const tty = process.stdout.isTTY;
const b = (s) => (tty ? B + s + R : s);
const dim = (s) => (tty ? D + s + R : s);
const cyan = (s) => (tty ? C + s + R : s);
const green = (s) => (tty ? G + s + R : s);

const STAGE_LABEL = {
  plan: "Plan      an idea becomes intent.md",
  design: "Design    intent.md becomes spec.md",
  build: "Build     spec.md becomes plan.md, then a diff",
  test: "Test      the diff proves itself",
  deploy: "Deploy    the diff is judged, then gated",
  maintain: "Maintain  production writes the next intent.md",
};

console.log("");
console.log(b(`The loop — ${root}`));
console.log(
  dim(
    plan.greenfield
      ? "Greenfield: no code yet, so the loop grows with it instead of being reverse-engineered later."
      : `${plan.served} of ${plan.total} artifacts in place. Every ✓ is a file on disk, not a guess.`,
  ),
);
// Said once, plainly. Two rows cite the stack and the generated paths, and without an index both
// report "nothing detected" — which is indistinguishable from "looked and found none" unless the
// header says which one this is.
if (!plan.state.indexed) {
  console.log(dim("No index yet, so the stack and generated paths read as undetected rather than absent."));
  console.log(dim("Run the indexer first for the full picture: node index/cortex-index.mjs ."));
}
console.log("");

// By stage, in loop order, so the gaps read as a break in a chain rather than as a list of chores.
const all = [
  ...plan.present.map((e) => ({ ...e, mark: "present" })),
  ...plan.missing.map((e) => ({ ...e, mark: "missing" })),
  ...plan.blocked.map((e) => ({ ...e, mark: "blocked" })),
];

for (const stage of STAGES) {
  const rows = all.filter((e) => e.stage === stage);
  if (!rows.length) continue;
  console.log(b(STAGE_LABEL[stage] ?? stage));
  for (const e of rows) {
    const mark = e.mark === "present" ? green("✓") : e.mark === "missing" ? cyan("→") : dim("·");
    const title = e.mark === "present" ? dim(e.title) : e.mark === "missing" ? b(e.title) : e.title;
    console.log(`  ${mark} ${title}`);
    console.log(`      ${dim(e.why)}`);
    // A blocked row names its prerequisite. The first version printed "(waiting on an earlier
    // artifact)" and left the user to guess which — which is the offer-vanishes failure wearing a
    // label, since neither version tells them how to unlock it.
    if (e.mark === "blocked") console.log(`      ${dim("needs: " + (e.needs.join("; ") || "an earlier artifact"))}`);
    if (e.mark !== "present") console.log(`      ${dim(e.paths.join("  "))}`);
  }
  console.log("");
}

// Blocked rows are named rather than dropped. An offer that silently vanishes looks like Cortex
// forgot it, and the user has no way to tell that apart from a bug.
if (plan.blocked.length) {
  console.log(dim(`${plan.blocked.length} artifact(s) are waiting on something earlier — they are listed above, not dropped.`));
  console.log("");
}

console.log(loopLine(root, index));
console.log(dim("`/cortex` stamps what is missing, in one pass, after one confirmation."));
