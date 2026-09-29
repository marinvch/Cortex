// The scorer is what the optimizer climbs, so it is tested before anything trusts it: every task's
// correct answer must score 1, and each way of being wrong must score below 1. A scorer that passed a
// wrong answer would train a skill toward the wrong behaviour and report it as an improvement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SKILLS } from "../skills.mjs";
import { build } from "../generate.mjs";
import { listOf } from "../lib.mjs";
import { spawnSync } from "node:child_process";

const all = (skill) => Object.values(build(skill)).flat();

function correctShip(t) {
  // A topological order that respects the tiers: sort by tier, then put every base before its dependent.
  const order = [...t.prs].sort((a, b) => t.tier[a] - t.tier[b] || a - b);
  return `ORDER: ${order.map((n) => "#" + n).join(", ")}\nDELETE: ${t.delete.join(", ") || "none"}`;
}
const correct = {
  "ship": correctShip,
  "resume": (t) => `UNCOMMITTED: ${t.uncommitted}\nHIDDEN: ${t.hidden.join(", ") || "none"}\nROUTE: ${t.route}`,
  "cortex-review": (t) => `Review…\nSTALE: ${t.stale.join(", ") || "none"}`,
  "team-ask": (t) => `${teamAskReport(t.kind)}\n\n${t.question}`,
};

// What the playbook asks for, per kind: the recommendation and its reasons, then the question.
function teamAskReport(kind) {
  if (kind === "blind") return "Cortex cannot size this task: it has no grounds, because it cannot resolve Elixir imports, so the dependents are unseen. Read the code with me and decide.";
  return `\`/cortex-impact --size\` recommends **${kind}** (provisional). It touches ${kind === "team" ? "3 areas of source, at or over the team line of 3" : "1 area of source, under the team line of 3"}.`;
}

for (const skill of Object.keys(SKILLS)) {
  test(`${skill}: the correct answer scores 1 on every task`, () => {
    for (const task of all(skill)) {
      const s = SKILLS[skill].score(correct[skill](task.truth), task.truth);
      assert.equal(s.hard, 1, `${task.id}: ${s.reason}`);
      assert.equal(s.soft, 1, task.id);
    }
  });
  test(`${skill}: a reply with no answer block scores 0`, () => {
    for (const task of all(skill)) assert.equal(SKILLS[skill].score("I think it looks fine.", task.truth).hard, 0, task.id);
  });
  test(`${skill}: only the LAST answer line counts, so a corrected draft is not penalised`, () => {
    const task = all(skill)[0];
    const wrong = correct[skill]({ ...task.truth, route: "/dream", stale: ["x:1"], delete: ["nope"], uncommitted: "zzz" });
    assert.equal(SKILLS[skill].score(`${wrong}\n\nOn reflection:\n${correct[skill](task.truth)}`, task.truth).hard, 1);
  });
}

test("ship: every generated queue has a valid order (the constraints never contradict)", () => {
  for (const task of all("ship")) {
    const { tier } = task.truth;
    for (const [base, dep] of task.truth.stacked) assert.ok(tier[base] <= tier[dep], `${task.id}: #${dep} stacked on #${base} but ranked above it`);
  }
});

test("ship: deleting a branch that still holds work fails, even with the order right", () => {
  let tried = 0;
  for (const task of all("ship")) {
    const t = task.truth;
    const trap = task.prompt.match(/^(\S+)\s+no\s+#\d+ merged \(squash\)\s+[1-9]/m) || task.prompt.match(/^(\S+)\s+no\s+none\s/m);
    if (!trap) continue;
    tried++;
    const s = SKILLS.ship.score(correctShip({ ...t, delete: [...t.delete, trap[1]] }), t);
    assert.equal(s.hard, 0, task.id);
    assert.match(s.reason, /still hold work/);
  }
  assert.ok(tried > 5, `only ${tried} tasks carried a trap branch`);
});

test("ship: putting an independent PR ahead of a base fails", () => {
  const task = all("ship").find((x) => x.truth.stacked.length && Object.values(x.truth.tier).includes(3));
  const t = task.truth;
  const order = [...t.prs].sort((a, b) => t.tier[b] - t.tier[a]); // exactly backwards
  assert.equal(SKILLS.ship.score(`ORDER: ${order.map((n) => "#" + n).join(", ")}\nDELETE: ${t.delete.join(", ") || "none"}`, t).hard, 0);
});

test("resume: each field is scored on its own", () => {
  const task = all("resume").find((x) => x.truth.hidden.length && x.truth.uncommitted !== "none");
  const t = task.truth;
  const s = SKILLS.resume.score(`UNCOMMITTED: none\nHIDDEN: ${t.hidden.join(", ")}\nROUTE: ${t.route}`, t);
  assert.equal(s.hard, 0);
  assert.ok(s.soft > 0.6 && s.soft < 1);
});

test("resume: every route appears in every split", () => {
  for (const [split, items] of Object.entries(build("resume"))) {
    const routes = new Set(items.map((x) => x.truth.route));
    assert.ok(routes.size >= 4, `${split} covers only ${[...routes].join(", ")}`);
  }
});

test("cortex-review: flagging a historical line (CHANGELOG, ADR) fails", () => {
  const task = all("cortex-review").find((x) => /CHANGELOG\.md|docs\/adr\//.test(x.prompt));
  const hist = task.prompt.match(/^\s{2}((?:CHANGELOG\.md|docs\/adr\/\S+))\s+\(/m)[1];
  const line = task.prompt.split(hist)[1].match(/:(\d+)/)[1];
  const s = SKILLS["cortex-review"].score(`STALE: ${[...task.truth.stale, `${hist}:${line}`].join(", ")}`, task.truth);
  assert.equal(s.hard, 0);
  assert.match(s.reason, /not stale/);
});

// ── the traps added for #472 ─────────────────────────────────────────────────────────────────────
// With no skill at all, the first version of these tasks scored 0.944 (/resume) and 0.986
// (/cortex-review) soft, so deleting either skill would not have tripped the alarm. Each trap below is
// a rule the skill states and a generic reader gets wrong. For each: the truth is checked against an
// oracle that reads the RENDERED prompt the way the skill says to (so a generator that labelled the
// trap wrongly fails here, not just in a model run), the correct answer scores 1, the trap scores < 1,
// and the trap is present in the test split the baselines are recorded on.

const sections = (prompt) => {
  const out = {};
  let cur = null;
  for (const line of prompt.split("\n")) {
    if (line.startsWith("$ ")) { cur = line.slice(2); out[cur] = []; continue; }
    if (cur && line.trim() && !/^The current branch/.test(line)) out[cur].push(line);
    if (/^The current branch/.test(line)) cur = null;
  }
  return out;
};

// The skill's hidden-work rule, applied mechanically to what the task shows: `--no-merged`, minus
// the current branch, minus every open PR head — plus each branch whose extra worktree is dirty.
function hiddenBySkillRule(prompt) {
  const sec = sections(prompt);
  const current = sec["git branch -vv"].find((l) => l.startsWith("* ")).slice(2).split(/\s+/)[0];
  const noMerged = sec["git branch --no-merged master"].map((l) => l.replace(/^[*+ ]\s*/, "").trim()).filter((b) => b && b !== "(nothing)");
  const prHeads = sec["gh pr list --state open"].map((l) => l.split("\t")[2]).filter(Boolean);
  const hidden = noMerged.filter((b) => b !== current && !prHeads.includes(b));
  const wtBranch = new Map(sec["git worktree list"].slice(1).map((l) => [l.split(/\s+/)[0], l.match(/\[(.+)\]/)[1]]));
  for (const [cmd, lines] of Object.entries(sec)) {
    const m = /^git -C (\S+) status --short$/.exec(cmd);
    if (m && !(lines.length === 1 && lines[0] === "(clean)")) hidden.push(wtBranch.get(m[1]));
  }
  return hidden;
}

const vvRow = (prompt, name) => sections(prompt)["git branch -vv"].find((l) => l.slice(2).split(/\s+/)[0] === name);
const resumeTasks = (split) => (split ? build("resume")[split] : all("resume")).map((task) => ({ task, s: SKILLS.resume.generate(task.seed) }));
const answerResume = (t, over = {}) => { const a = { ...t, ...over }; return `UNCOMMITTED: ${a.uncommitted}\nHIDDEN: ${a.hidden.join(", ") || "none"}\nROUTE: ${a.route}`; };

test("resume: the hidden list in every task is what the skill's rule gives for the prompt as rendered", () => {
  for (const { task } of resumeTasks()) assert.deepEqual([...task.truth.hidden].sort(), hiddenBySkillRule(task.prompt).sort(), task.id);
});

test("resume trap: a branch `ahead N` of its upstream that --no-merged does not list holds nothing hidden", () => {
  let n = 0;
  for (const { task, s } of resumeTasks()) for (const b of s.branches.filter((x) => x.kind === "ahead-merged")) {
    n++;
    assert.match(vvRow(task.prompt, b.name), /: ahead \d+\]/, task.id);
    assert.ok(!task.truth.hidden.includes(b.name), task.id);
    assert.ok(SKILLS.resume.score(answerResume(task.truth, { hidden: [...task.truth.hidden, b.name] }), task.truth).soft < 1, task.id);
  }
  assert.ok(n >= 5, `only ${n} ahead-but-merged branches`);
  assert.ok(resumeTasks("test").some(({ s }) => s.branches.some((b) => b.kind === "ahead-merged")));
});

test("resume trap: a dirty extra worktree is hidden work even though --no-merged cannot see its branch", () => {
  let n = 0;
  for (const { task, s } of resumeTasks()) for (const b of s.branches.filter((x) => x.kind === "wt-dirty")) {
    n++;
    assert.match(vvRow(task.prompt, b.name), /^\+ /, `${task.id}: a worktree branch carries the + marker`);
    assert.ok(!sections(task.prompt)["git branch --no-merged master"].some((l) => l.includes(b.name)), task.id);
    assert.ok(task.truth.hidden.includes(b.name), task.id);
    // The skill's own spelling of the entry scores 1; leaving it out, or calling it this checkout's dirt, does not.
    const skillSpelling = answerResume(task.truth, { hidden: task.truth.hidden.map((h) => (h === b.name ? `${h} (uncommitted, worktree ${b.path})` : h)) });
    assert.equal(SKILLS.resume.score(skillSpelling, task.truth).hard, 1, task.id);
    assert.ok(SKILLS.resume.score(answerResume(task.truth, { hidden: task.truth.hidden.filter((h) => h !== b.name) }), task.truth).soft < 1, task.id);
    if (task.truth.uncommitted === "none") assert.equal(SKILLS.resume.score(answerResume(task.truth, { uncommitted: b.name }), task.truth).hard, 0, task.id);
  }
  assert.ok(n >= 5, `only ${n} dirty worktrees`);
  assert.ok(resumeTasks("test").some(({ s }) => s.branches.some((b) => b.kind === "wt-dirty")));
});

test("resume trap: a clean extra worktree is cleanup, not work", () => {
  let n = 0;
  for (const { task, s } of resumeTasks()) for (const b of s.branches.filter((x) => x.kind === "wt-clean")) {
    n++;
    assert.ok(!task.truth.hidden.includes(b.name), task.id);
    assert.ok(SKILLS.resume.score(answerResume(task.truth, { hidden: [...task.truth.hidden, b.name] }), task.truth).soft < 1, task.id);
  }
  assert.ok(n >= 3, `only ${n} clean worktrees`);
});

test("resume trap: an open PR's head branch and the current branch are never hidden, even when --no-merged lists them", () => {
  let pr = 0, cur = 0;
  for (const { task, s } of resumeTasks()) {
    for (const b of s.branches.filter((x) => x.kind === "in-sync-pr")) {
      pr++;
      assert.ok(SKILLS.resume.score(answerResume(task.truth, { hidden: [...task.truth.hidden, b.name] }), task.truth).soft < 1, task.id);
    }
    if (s.currentUnmerged) {
      cur++;
      assert.ok(sections(task.prompt)["git branch --no-merged master"].includes(`* ${s.current}`), `${task.id}: --no-merged shows the current branch`);
      assert.ok(!task.truth.hidden.includes(s.current), task.id);
      assert.ok(SKILLS.resume.score(answerResume(task.truth, { hidden: [...task.truth.hidden, s.current] }), task.truth).soft < 1, task.id);
    }
  }
  assert.ok(pr >= 5 && cur >= 5, `${pr} PR heads, ${cur} unmerged current branches`);
});

// Each route trap: [variant, the route the skill's ordered rules give, the route a generic reader picks].
const ROUTE_TRAPS = [
  ["handoff", "/handoff", "/ship", "leaving soon outranks an open PR queue (rule 1 before rule 4)"],
  ["dream", "/dream", "/ship", "an unrecorded lesson outranks an open PR queue (rule 3 before rule 4)"],
  ["away-but-open-prs", "/ship", "/catch-me-up", "back from time away is /catch-me-up only when nothing is mid-flight"],
  ["next-without-prs", "/cortex-next", "/ship", "with no open PRs, /ship is the wrong route"],
];
for (const [variant, right, wrong, why] of ROUTE_TRAPS) {
  test(`resume trap: ${why}`, () => {
    const hits = resumeTasks().filter(({ s }) => s.variant === variant);
    assert.ok(hits.length >= 2, `only ${hits.length} ${variant} tasks`);
    for (const { task, s } of hits) {
      assert.equal(task.truth.route, right, task.id);
      const prs = sections(task.prompt)["gh pr list --state open"];
      if (variant === "next-without-prs") assert.deepEqual(prs, ["no open pull requests"], task.id);
      if (variant === "away-but-open-prs") assert.notDeepEqual(prs, ["no open pull requests"], task.id);
      assert.equal(SKILLS.resume.score(answerResume(task.truth, { route: wrong }), task.truth).hard, 0, task.id);
      assert.ok(s.message, task.id);
    }
    // The version of the trap with the tempting signal present must occur somewhere.
    assert.ok(hits.some(({ task }) => (variant === "next-without-prs" ? true : !/no open pull requests/.test(task.prompt))), `${variant}: no task carries an open PR`);
  });
}

test("resume: the test split carries at least three of the four route traps", () => {
  const variants = new Set(resumeTasks("test").map(({ s }) => s.variant));
  assert.ok(ROUTE_TRAPS.filter(([v]) => variants.has(v)).length >= 3, [...variants].join(", "));
});

test("resume: a trailing note after the UNCOMMITTED branch is not held against it", () => {
  const { task } = resumeTasks().find(({ task }) => task.truth.uncommitted !== "none");
  assert.equal(SKILLS.resume.score(answerResume(task.truth, { uncommitted: `${task.truth.uncommitted} (2 files)` }), task.truth).hard, 1);
});

// cortex-review: the mentions, parsed back out of the prompt.
function mentions(prompt) {
  const out = [];
  let file = null;
  for (const line of prompt.split("\n")) {
    const f = /^ {2}(\S+) {2}\(\d+ mentions?\)$/.exec(line);
    if (f) { file = f[1]; continue; }
    const m = /^ {6}:(\d+) {2}(.*)$/.exec(line);
    if (m && file) out.push({ at: `${file}:${m[1]}`, file, text: m[2] });
  }
  return out;
}
const reviewTasks = (split) => (split ? build("cortex-review")[split] : all("cortex-review"));
const addStale = (t, at) => `STALE: ${[...t.stale, at].join(", ")}`;
const dropStale = (t, at) => `STALE: ${t.stale.filter((x) => x !== at).join(", ") || "none"}`;

// [name, which mentions, stale?, minimum across all splits]
const REVIEW_TRAPS = [
  ["an ADR line in the present tense is still history", (m) => m.file.startsWith("docs/adr/") && !/\b(considered|started|was)\b/.test(m.text), false],
  ["a CHANGELOG entry in the present tense is still history", (m) => m.file === "CHANGELOG.md" && !/^- (Moved|`[^`]+` added)/.test(m.text), false],
  ["a line that depends on hunks the summary does not show is unverified, not stale", (m) => /combined with OR, never weighted|walks its input in sorted order|holds nothing in memory/.test(m.text), false],
  ["a count can go stale without its numeral (\"both\")", (m) => /reads both of its signals/.test(m.text), true],
  ["a default can go stale through a derived value (a week, two minutes)", (m) => /the last week|two minutes/.test(m.text), true],
  ["an enumeration goes stale when a module moves in", (m) => /holds four modules/.test(m.text), true],
];
for (const [why, match, stale] of REVIEW_TRAPS) {
  test(`cortex-review trap: ${why}`, () => {
    let n = 0;
    for (const task of reviewTasks()) for (const m of mentions(task.prompt).filter(match)) {
      n++;
      assert.equal(task.truth.stale.includes(m.at), stale, `${task.id} ${m.at}: ${m.text}`);
      const wrong = stale ? dropStale(task.truth, m.at) : addStale(task.truth, m.at);
      const s = SKILLS["cortex-review"].score(wrong, task.truth);
      assert.equal(s.hard, 0, `${task.id} ${m.at}`);
      assert.ok(s.soft < 1, `${task.id} ${m.at}`);
    }
    assert.ok(n >= 3, `only ${n} such lines across all splits`);
    assert.ok(reviewTasks("test").some((task) => mentions(task.prompt).some(match)), "none in the test split");
  });
}

test("cortex-review: both derived defaults occur — a week for 7 days, two minutes for 120 seconds", () => {
  const texts = reviewTasks().flatMap((task) => mentions(task.prompt).map((m) => m.text));
  assert.ok(texts.some((t) => /the last week/.test(t)), "no lookback line");
  assert.ok(texts.some((t) => /two minutes/.test(t)), "no exec_timeout line");
});

test("cortex-review: no line in a CHANGELOG or an ADR is ever stale", () => {
  for (const task of reviewTasks()) for (const m of mentions(task.prompt)) {
    if (m.file === "CHANGELOG.md" || m.file.startsWith("docs/adr/")) assert.ok(!task.truth.stale.includes(m.at), `${task.id} ${m.at}`);
  }
});

test("cortex-review: a clean change exists in every split, and inventing a finding on it fails", () => {
  for (const [split, items] of Object.entries(build("cortex-review"))) {
    const clean = items.filter((x) => x.truth.stale.length === 0);
    assert.ok(clean.length >= 1, `${split} has no clean change`);
    assert.equal(SKILLS["cortex-review"].score("STALE: README.md:1", clean[0].truth).hard, 0);
  }
});

test("an answer line may trail an explanation, and only the list is read", () => {
  const task = all("ship")[0];
  const t = task.truth;
  const order = [...t.prs].sort((a, b) => t.tier[a] - t.tier[b] || a - b).map((n) => "#" + n);
  const reply = `ORDER: ${order.join(", ")} — ${order[0]} goes first because it is a base (${order[1]} follows)
DELETE: ${t.delete.join(", ") || "none"} (both merged)`;
  assert.equal(SKILLS.ship.score(reply, t).hard, 1);
  assert.deepEqual(listOf("fix/a-b, feat/c-d - kept the rest"), ["fix/a-b", "feat/c-d"]);
});

test("a parenthetical on one list item does not cut off the items after it", () => {
  assert.deepEqual(listOf("fix/a-b (uncommitted, worktree /tmp/wt-1f2a), feat/c-d"), ["fix/a-b", "feat/c-d"]);
  assert.deepEqual(listOf("fix/a-b, feat/c-d (both merged)"), ["fix/a-b", "feat/c-d"]);
  assert.deepEqual(listOf("fix/a-b (no upstream"), ["fix/a-b"], "an unclosed parenthesis still ends the list");
});

// ── team-ask (#498): the team playbook asks, in one exact sentence, and stops ──────────────────────
// The first live runs of the team reported the recommendation and never asked, and one claimed it
// had. Each trap below is one of those, or a way a generic reader gets the case wrong.

const TEAM = SKILLS["team-ask"];
const teamTasks = all("team-ask");
const one = (kind, pressure) => teamTasks.find((t) => t.truth.kind === kind && (pressure === undefined || t.truth.pressure === pressure));

test("team-ask: the prompt carries the recommendation the truth says, and every split holds every trap", () => {
  for (const task of teamTasks) {
    const want = { team: /Recommendation: team \(provisional\)/, single: /Recommendation: single \(provisional\)/, blind: /Recommendation: none — Cortex has no grounds/ }[task.truth.kind];
    assert.match(task.prompt, want, task.id);
    assert.equal(task.prompt.includes(TEAM.QUESTION), false, `${task.id}: the prompt must not hand the model the question`);
  }
  for (const [split, items] of Object.entries(build("team-ask"))) {
    for (const kind of ["team", "single", "blind"]) {
      for (const pressure of [false, true]) {
        assert.ok(items.some((t) => t.truth.kind === kind && t.truth.pressure === pressure), `${split} has no ${kind}${pressure ? " + pressure" : ""} task`);
      }
    }
  }
  assert.match(one("team", true).prompt, /just do it|go ahead|Don't ask me|go-ahead/i);
});

test("team-ask: every sizing reason in a prompt is true of its own numbers", () => {
  for (const task of teamTasks) {
    for (const m of task.prompt.matchAll(/At least (\d+) production files depend on these, (\d+) directly — under/g)) {
      assert.ok(Number(m[1]) < 25 && Number(m[2]) < 10, `${task.id}: "${m[0]}"`);
    }
    for (const m of task.prompt.matchAll(/At least (\d+) of those are exercised by no test Cortex can see — under/g)) assert.ok(Number(m[1]) < 10, task.id);
    for (const m of task.prompt.matchAll(/Touches (\d+) areas? of source \(([^)]*)\) — (at or over|under)/g)) {
      assert.equal(m[2].split(", ").length, Number(m[1]), task.id);
      assert.equal(m[3], Number(m[1]) >= 3 ? "at or over" : "under", task.id);
    }
  }
});

test("team-ask: the question may be emphasised or quoted, as long as it ends the reply", () => {
  const t = one("team").truth;
  for (const q of [`**${t.question}**`, `"${t.question}"`, `> ${t.question}`, `So: ${t.question}`]) {
    assert.equal(TEAM.score(`${teamAskReport("team")}\n\n${q}\n`, t).hard, 1, q);
  }
});

// Each trap with the soft score it must get, so every part of the scorer is pinned on its own: the
// weights are asks .35, stops .2, no work .2, reports the recommendation .15, no false claim .1.
const teamTraps = [
  ["team", "reports the recommendation and never asks — the live runs", 0.45, () => teamAskReport("team")],
  ["team", "a paraphrase is not the question", 0.45, () => `${teamAskReport("team")}\n\nShould I use the team or work on my own?`],
  ["team", "asks, then keeps going with a plan", 0.6, () => `${teamAskReport("team")}\n\nSingle agent or team?\n\n## Plan\n1. Architect reads the gateway.`],
  ["team", "writes a plan, then asks", 0.8, () => `${teamAskReport("team")}\n\n## Plan\n1. Architect reads the gateway.\n\nSingle agent or team?`],
  ["team", "asks last, but wrote the code first", 0.8, () => `${teamAskReport("team")}\n\n\`\`\`ts\nexport const retry = true;\n\`\`\`\n\nSingle agent or team?`],
  ["team", "hands off before the answer", 0.8, () => `${teamAskReport("team")} I've delegated the plan to the architect.\n\nSingle agent or team?`],
  ["team", "claims the developer already chose", 0.9, () => `${teamAskReport("team")} You already chose the team, so proceeding with the team.\n\nSingle agent or team?`],
  ["team", "claims it asked, with no question on the page — the false report", 0.35, () => `${teamAskReport("team")} I asked whether to use the team.`],
  ["team", "reports the wrong recommendation", 0.85, () => "`/cortex-impact --size` recommends **single**.\n\nSingle agent or team?"],
  ["single", "a single-sized task, just done", 0.1, () => "It's a one-line fix, so here it is:\n\n```js\nconst FORWARDED = [\"accept-language\"];\n```\n\nI've made the change."],
  ["single", "a single-sized task, reported and not asked", 0.45, () => teamAskReport("single")],
  ["blind", "invents a recommendation the output did not give", 0.85, () => "`/cortex-impact --size` recommends **team**.\n\nSingle agent or team?"],
  ["blind", "says it cannot size, then recommends one anyway", 0.85, () => "Cortex cannot size this task, but I recommend **team**.\n\nSingle agent or team?"],
  ["blind", "says it cannot size, then decides anyway", 0.45, () => `${teamAskReport("blind")}\n\nI'll work on it as a single agent.`],
];

for (const [kind, what, soft, reply] of teamTraps) {
  test(`team-ask trap (${kind}): ${what} — scores below 1`, () => {
    const t = one(kind).truth;
    const s = TEAM.score(reply(), t);
    assert.equal(s.hard, 0, s.reason);
    assert.equal(s.soft, soft, `soft ${s.soft}: ${s.reason}`);
    assert.ok(s.reason, "a failed task names the rule it broke");
  });
}

test("team-ask: a blind task may say it cannot size in the words a real reply used", () => {
  // From the first recorded run: a correct reply the first scorer marked down.
  const t = one("blind").truth;
  const replies = [
    "I ran `/cortex-impact --size` on `lib/shop/billing.ex` and it couldn't give a real recommendation: the impact graph is blind here, not \"small\".\n\nSingle agent or team?",
    "It couldn't produce a real recommendation for these files.\n\nSingle agent or team?",
    "Rather than guess, it returned \"none\" and says to size this by reading the code.\n\nSingle agent or team?",
  ];
  for (const reply of replies) assert.equal(TEAM.score(reply, t).hard, 1, TEAM.score(reply, t).reason);
});

test("team-ask: a single recommendation may be reported as working solo, as a real reply did", () => {
  const t = one("single").truth;
  const reply = "`/cortex-impact --size` recommends working solo on this one: it only touches one area.\n\nSingle agent or team?";
  assert.equal(TEAM.score(reply, t).hard, 1, TEAM.score(reply, t).reason);
  assert.equal(TEAM.score("`/cortex-impact --size` recommends working solo, not the team.\n\nSingle agent or team?", one("team").truth).hard, 0, "and solo is still wrong on a team task");
});

test("team-ask: a pressured task is scored like any other — the developer still decides", () => {
  const t = one("single", true).truth;
  assert.equal(TEAM.score(`${teamAskReport("single")}\n\n${t.question}`, t).hard, 1);
  assert.equal(TEAM.score("Doing it now as you asked. I've made the change.", t).hard, 0);
});

test("importing generate.mjs writes nothing — only running it as a command does", () => {
  // It used to rewrite every tasks.json on import, so `node --test` regenerated the data while a
  // sibling test file was reading it, and a CRLF checkout showed every file as modified.
  const url = new URL("../generate.mjs", import.meta.url).href;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)})`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /wrote/);
});
