#!/usr/bin/env node
// cortex-loop.mjs — which parts of the AI-native SDLC loop this repo has, and what it is missing.
//
//   node index/cortex-loop.mjs .          # the loop by stage, with ✓ / → / ·
//   node index/cortex-loop.mjs . --line   # one line, for another tool's footer
//   node index/cortex-loop.mjs . --json   # the worklist, for /cortex to walk
//   node index/cortex-loop.mjs . --team tester,reviewer [--as <agent path>=<role|none> ...]
//                                          # after the picks: the team files, values and roster
//
// Read-only in the strongest sense: it writes nothing, not even under `.cortex/`.
//
// This is `/cortex`'s script the way the findings report is `/cortex-install`'s (ADR 0006). The
// ritual walks `missing` top-down, so the rank in `lib/loop.mjs` is control flow — it decides which
// artifact a user is offered first, not merely how a report reads.

import { loopPlan, loopLine, STAGES } from "./lib/loop.mjs";
import { teamValues } from "./lib/team.mjs";
import { normalizeChangedPath } from "./lib/changed.mjs";
import { openTarget } from "./lib/open.mjs";

// `index: "optional"` — the loop is mostly file facts, and the two rows that read the index
// (`brief` cites the stack, `hooks` cites generated paths) degrade to an honest "nothing detected"
// rather than to a wrong answer. Running this before the indexer is the ordinary case on a repo
// where `/cortex` has only just started.
const { root, args, index } = openTarget(process.argv.slice(2), {
  usage: "usage: node index/cortex-loop.mjs [root] [--line] [--json] [--team ROLES|none] [--as PATH=ROLE|none ...]",
  flags: { "--json": "boolean", "--line": "boolean", "--index": "value", "--team": "list", "--as": "multi" },
  root: "positional",
  index: "optional",
  freshness: (a) => !a.json && !a.line && !a.team.length,
});

const fail = (text) => {
  process.stderr.write(text + "\n");
  process.exit(1);
};

// The developer's answer to "is this agent that role": `--as .claude/agents/x.md=reviewer`, or
// `=none`. A mapping is a proposal the developer confirms, so the answer outranks the mapper.
const as = {};
for (const kv of args.as) {
  const eq = kv.lastIndexOf("=");
  if (eq <= 0) fail(`--as must be <agent path>=<role|none>: ${kv}`);
  as[normalizeChangedPath(kv.slice(0, eq))] = kv.slice(eq + 1) === "none" ? null : kv.slice(eq + 1);
}

let plan;
try {
  plan = loopPlan(root, index, Object.keys(as).length ? { agentsAs: as } : {});
} catch (e) {
  fail(e.message);
}
// The agents this repo already has — graded, mapped to a role, with proposed edits (spec T6) — are
// `agents`; the team row's offer built on them is `state.agentTeam`. `null` without an index.
const team = plan.state.agentTeam;
const agents = team?.report ?? null;

// After the picks (plan step 14): which files to write, with which values, and the roster the
// playbook names — so /cortex renders exactly the team that was picked. `none` picks no role, for a
// repo whose existing agents are the whole team. Writes nothing.
if (args.team.length) {
  if (!team) fail("no index, so the agents already here cannot be read — run node index/cortex-index.mjs first");
  const picked = args.team.includes("none") ? [] : args.team;
  try {
    console.log(JSON.stringify(teamValues(team, picked), null, 2));
  } catch (e) {
    fail(e.message);
  }
  process.exit(0);
}

if (args.json) {
  const state = team ? { ...plan.state, agentTeam: { ...team, report: undefined } } : plan.state;
  console.log(JSON.stringify({ ...plan, state, agents }, null, 2));
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
    // Said on the row, because it is the row a headless /cortex leaves missing while reporting
    // success: Claude Code never auto-approves a write under .claude/, and `claude -p` has nobody
    // to ask. Naming the flag here is the difference between a gap and a gap with a way through.
    if (e.mark === "missing" && e.protectedWrites?.length) {
      console.log(`      ${dim("under .claude/, which Claude Code protects — unattended, run with --permission-mode auto")}`);
    }
  }
  console.log("");
}

// Blocked rows are named rather than dropped. An offer that silently vanishes looks like Cortex
// forgot it, and the user has no way to tell that apart from a bug.
if (plan.blocked.length) {
  console.log(dim(`${plan.blocked.length} artifact(s) are waiting on something earlier — they are listed above, not dropped.`));
  console.log("");
}

// Only when the repo has agents, so a repo without any reads exactly as before. Every mapping is a
// proposal the developer confirms; "unmapped — ask" is an answer, not a gap in this report.
if (agents?.agents.length) {
  const REASON = {
    ambiguous: (m) => `unmapped — ask: it reads as ${m.remaining.join(" or ")}`,
    "no-role-words": () => "unmapped — ask: nothing in its name or description names a role",
    dropped: (m) => `unmapped — ask: ${m.dropped[0]?.why ?? "every candidate was ruled out"}`,
    lens: (m) => `unmapped — a specialist: ${m.note}`,
    "outside-roster": (m) => `unmapped — ${m.note}`,
    "not-loaded": () => "not loaded by Claude Code — its frontmatter lacks a name or description",
  };
  console.log(b(`Agents already here — ${agents.agents.length} in .claude/agents/`));
  for (const a of agents.agents) {
    const m = a.mapping;
    const file = a.path.split("/").pop();
    const said = m.role
      ? `${m.role} — ${[...m.evidence.name.map((w) => `name "${w}"`), ...m.evidence.description.slice(0, 2).map((w) => `"${w}"`)].join(", ")}`
      : REASON[m.reason](m);
    console.log(`  ${m.role ? green("✓") : dim("?")} ${file}  ${dim(said)}`);
    if (m.upgrade) console.log(`      ${dim(`offered the upgrade to ${m.upgrade.template} — it keeps working until you accept`)}`);
    for (const f of a.findings) console.log(`      ${dim(`${f.kind}: ${f.evidence[0]}`)}`);
    for (const p of a.proposals) {
      const where = p.action === "append" ? `after line ${p.line}` : `line ${p.line}`;
      console.log(`      ${cyan("→")} ${where}: ${p.text.split("\n").join(" / ")}`);
      console.log(`        ${dim(p.why)}`);
    }
  }
  console.log(`  ${agents.gaps.length ? `Roles no agent covers: ${agents.gaps.join(", ")}` : "Every role in the team is covered by an agent here."}`);
  console.log(dim("  Mappings and edits are proposals. Nothing has been changed; each agent is asked about on its own."));
  console.log("");
}

console.log(loopLine(root, index));
console.log(dim("`/cortex` stamps what is missing, in one pass, after one confirmation."));
