// /ship — merge a queue in an order that strands nothing, and delete only what is really merged.
//
// Two judgments the skill's text governs, both checkable:
//   ORDER  — a PR another PR is based on goes first; then PRs that share files with another PR;
//            then the rest. Scored as constraints, so every order the rules allow passes.
//   DELETE — a local branch is safe only when its work is on the main branch: `git branch --merged`
//            says so, or its PR was merged and nothing was committed to it afterwards (a squash merge
//            is invisible to --merged). An old branch with no PR, a PR closed without merging, and a
//            merged PR that kept receiving commits are all traps — each still holds work.

import { rng, pick, int, shuffle, sample, words, branchName, readAnswer, listOf, setF1, sameSet } from "../lib.mjs";

const FILES = [
  "src/api/client.ts", "src/api/routes.ts", "src/auth/session.ts", "src/billing/invoice.ts",
  "src/billing/ledger.ts", "src/ui/Button.tsx", "src/ui/Modal.tsx", "src/search/index.ts",
  "src/cart/cart.ts", "src/checkout/pay.ts", "src/notify/email.ts", "src/lib/format.ts",
  "README.md", "CHANGELOG.md", "package.json", "src/export/csv.ts", "src/i18n/en.json",
];

export function generate(seed) {
  const r = rng(seed);
  const used = new Set(["master"]);
  const n = int(r, 3, 6);
  const prs = [];
  let num = int(r, 120, 480);
  for (let i = 0; i < n; i++) {
    num += int(r, 1, 7);
    prs.push({ number: num, head: branchName(r, used), base: "master", files: sample(r, FILES, int(r, 1, 3)) });
  }
  // Maybe stack one PR on another (the accidental stack the skill warns about).
  if (r() < 0.7) {
    const [a, b] = sample(r, prs, 2);
    b.base = a.head;
  }
  // Make the file overlaps deliberate rather than whatever sample() produced: clear them, then add.
  const pool = shuffle(r, FILES);
  let k = 0;
  for (const p of prs) p.files = [pool[k++ % pool.length], ...(r() < 0.4 ? [pool[k++ % pool.length]] : [])];
  if (r() < 0.8) {
    const [a, b] = sample(r, prs, 2);
    const shared = pick(r, FILES.filter((f) => !a.files.includes(f)));
    a.files.push(shared);
    b.files.push(shared);
  }

  // Local branches to clean up: the PR heads (all still open, so not deletable) plus older ones.
  const locals = [];
  const kinds = shuffle(r, ["git-merged", "squash-clean", "squash-dirty", "closed", "no-pr-old", "squash-clean", "no-pr-new"]);
  for (const kind of kinds.slice(0, int(r, 3, 6))) {
    const b = branchName(r, used);
    const pr = num + int(r, 8, 60) * (r() < 0.5 ? -1 : 1);
    const row = { branch: b, gitMerged: "no", pr: "none", after: "-", age: `${int(r, 1, 20)} days ago` };
    if (kind === "git-merged") Object.assign(row, { gitMerged: "yes", pr: `#${pr} merged`, after: "0" });
    if (kind === "squash-clean") Object.assign(row, { pr: `#${pr} merged (squash)`, after: "0" });
    if (kind === "squash-dirty") Object.assign(row, { pr: `#${pr} merged (squash)`, after: String(int(r, 1, 4)) });
    if (kind === "closed") Object.assign(row, { pr: `#${pr} closed, not merged` });
    if (kind === "no-pr-old") Object.assign(row, { age: `${int(r, 4, 9)} months ago` });
    row.deletable = kind === "git-merged" || kind === "squash-clean";
    locals.push(row);
  }
  for (const p of prs) locals.push({ branch: p.head, gitMerged: "no", pr: `#${p.number} open`, after: "-", age: `${int(r, 0, 6)} days ago`, deletable: false });

  return { prs, locals: shuffle(r, locals) };
}

export function tiers(prs) {
  const heads = new Map(prs.map((p) => [p.head, p]));
  const isBase = new Set(prs.filter((p) => heads.has(p.base)).map((p) => heads.get(p.base).number));
  const shares = new Set();
  for (const a of prs) for (const b of prs) if (a !== b && a.files.some((f) => b.files.includes(f))) shares.add(a.number);
  const tier = new Map(prs.map((p) => [p.number, isBase.has(p.number) ? 1 : shares.has(p.number) ? 2 : 3]));
  const stacked = prs.filter((p) => heads.has(p.base)).map((p) => [heads.get(p.base).number, p.number]);
  return { tier, stacked };
}

export function render(s) {
  const prRows = s.prs.map((p) => `#${p.number}  ${p.head.padEnd(26)} → ${p.base.padEnd(26)} checks: pass  mergeable: MERGEABLE`);
  const fileRows = s.prs.map((p) => `#${p.number}: ${p.files.join(", ")}`);
  const localRows = s.locals.map((b) => `${b.branch.padEnd(28)} ${b.gitMerged.padEnd(8)} ${b.pr.padEnd(28)} ${b.after.padEnd(6)} ${b.age}`);
  return [
    "The user says: \"everything's green — merge what's open and clean up the old branches.\"",
    "",
    "You cannot run commands. Everything you need is below.",
    "",
    "$ gh pr list --state open --json number,headRefName,baseRefName,mergeable,checks",
    ...prRows,
    "",
    "Files each PR changes:",
    ...fileRows,
    "",
    "Local branches (main branch is `master`):",
    `${"branch".padEnd(28)} ${"--merged".padEnd(8)} ${"PR".padEnd(28)} ${"commits after PR merged".padEnd(6)} / last commit`,
    ...localRows,
    "",
    "Decide the merge order for the open PRs, and which LOCAL branches are safe to delete right now.",
    "The open PRs are not merged yet, so judge each branch as it stands at this moment.",
    "End your reply with exactly these two lines:",
    "ORDER: #<n>, #<n>, ...",
    "DELETE: <branch>, <branch>   (or: DELETE: none)",
  ].join("\n");
}

export function truth(s) {
  const { tier, stacked } = tiers(s.prs);
  return {
    tier: Object.fromEntries(tier),
    stacked,
    prs: s.prs.map((p) => p.number),
    delete: s.locals.filter((b) => b.deletable).map((b) => b.branch),
  };
}

export function score(prediction, t) {
  const a = readAnswer(prediction, ["ORDER", "DELETE"]);
  const order = (listOf(a.ORDER) || []).map(Number);
  const del = listOf(a.DELETE);
  const reasons = [];

  // ORDER: a permutation of the open PRs that satisfies every rule.
  const checks = [];
  checks.push(sameSet(order.map(String), t.prs.map(String)) && order.length === t.prs.length);
  if (!checks[0]) reasons.push(`ORDER must list each open PR exactly once (${t.prs.map((n) => "#" + n).join(", ")})`);
  const pos = new Map(order.map((n, i) => [n, i]));
  for (const [base, dep] of t.stacked) {
    const ok = pos.has(base) && pos.has(dep) && pos.get(base) < pos.get(dep);
    checks.push(ok);
    if (!ok) reasons.push(`#${dep} is based on #${base}'s branch, so #${base} must merge first`);
  }
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
    const ti = t.tier[order[i]], tj = t.tier[order[j]];
    if (ti === undefined || tj === undefined) continue;
    const ok = ti <= tj;
    checks.push(ok);
    if (!ok) reasons.push(`#${order[j]} (${["", "a base of another PR", "shares files with another PR", "independent"][tj]}) should come before #${order[i]} (${["", "a base of another PR", "shares files with another PR", "independent"][ti]})`);
  }
  const orderFrac = checks.filter(Boolean).length / checks.length;
  const orderOk = checks.every(Boolean);

  // DELETE: exactly the branches whose work is already on master.
  const delF1 = del === null ? 0 : setF1(del, t.delete);
  const delOk = del !== null && sameSet(del, t.delete);
  if (del === null) reasons.push("no DELETE line");
  else if (!delOk) {
    const extra = del.filter((b) => !t.delete.includes(b));
    const missed = t.delete.filter((b) => !del.includes(b));
    if (extra.length) reasons.push(`would delete branches that still hold work: ${extra.join(", ")}`);
    if (missed.length) reasons.push(`missed branches whose work is already on master: ${missed.join(", ")}`);
  }
  return { hard: orderOk && delOk ? 1 : 0, soft: 0.5 * orderFrac + 0.5 * delF1, reason: reasons.join("; ") || "correct" };
}
