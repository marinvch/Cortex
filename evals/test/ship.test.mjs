// The /ship scenario on a queue written by hand, so every expected number below can be checked by
// reading it. evals.test.mjs runs the generated tasks; this file pins the rules those tasks rest on:
// how a PR gets its tier, what partial credit each mistake keeps, and what the reason says.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generate, render, score, tiers, truth } from "../scenarios/ship.mjs";

// #10 is the base of #11. #12 and #13 change the same file. #14 touches nothing anyone else does.
const prs = [
  { number: 10, head: "feat/a", base: "master", files: ["src/a.ts"] },
  { number: 11, head: "feat/b", base: "feat/a", files: ["src/b.ts"] },
  { number: 12, head: "feat/c", base: "master", files: ["src/c.ts", "src/shared.ts"] },
  { number: 13, head: "feat/d", base: "master", files: ["src/d.ts", "src/shared.ts"] },
  { number: 14, head: "feat/e", base: "master", files: ["src/e.ts"] },
];
const locals = [
  { branch: "chore/old-report", gitMerged: "yes", pr: "#3 merged", after: "0", age: "9 days ago", deletable: true },
  { branch: "feat/a", gitMerged: "no", pr: "#10 open", after: "-", age: "1 days ago", deletable: false },
];
const t = truth({ prs, locals });
const GOOD = "ORDER: #10, #12, #13, #11, #14\nDELETE: chore/old-report";

test("a base is tier 1, a PR sharing a file is tier 2, anything else is tier 3", () => {
  const { tier, stacked } = tiers(prs);
  assert.deepEqual(Object.fromEntries(tier), { 10: 1, 11: 3, 12: 2, 13: 2, 14: 3 });
  assert.deepEqual(stacked, [[10, 11]]);
});

test("a base that also shares a file is still tier 1: it has to land first either way", () => {
  const both = prs.map((p) => (p.number === 10 ? { ...p, files: ["src/a.ts", "src/shared.ts"] } : p));
  assert.equal(tiers(both).tier.get(10), 1);
});

test("the truth is the tiers, the stacked pairs, the open PRs and the branches already on master", () => {
  assert.deepEqual(t, {
    tier: { 10: 1, 11: 3, 12: 2, 13: 2, 14: 3 },
    stacked: [[10, 11]],
    prs: [10, 11, 12, 13, 14],
    delete: ["chore/old-report"],
  });
});

test("the right order and the right branches score 1", () => {
  assert.deepEqual(score(GOOD, t), { hard: 1, soft: 1, reason: "correct" });
});

test("ORDER and DELETE are half the credit each", () => {
  const noDelete = score("ORDER: #10, #12, #13, #11, #14", t);
  assert.deepEqual([noDelete.hard, noDelete.soft, noDelete.reason], [0, 0.5, "no DELETE line"]);

  const none = score("ORDER: #10, #12, #13, #11, #14\nDELETE: none", t);
  assert.equal(none.soft, 0.5);
  assert.equal(none.reason, "missed branches whose work is already on master: chore/old-report");
});

test("deleting a branch that still holds work keeps F1 credit and names the branch", () => {
  const s = score("ORDER: #10, #12, #13, #11, #14\nDELETE: chore/old-report, feat/a", t);
  assert.equal(s.hard, 0);
  // One right of two named, one wanted: precision 1/2, recall 1, F1 2/3. Half of that, plus the order.
  assert.ok(Math.abs(s.soft - (0.5 + 0.5 * (2 / 3))) < 1e-9, String(s.soft));
  assert.equal(s.reason, "would delete branches that still hold work: feat/a");
});

test("a dependent ahead of its base fails and the reason names both", () => {
  const s = score("ORDER: #11, #10, #12, #13, #14\nDELETE: chore/old-report", t);
  assert.equal(s.hard, 0);
  assert.ok(s.soft > 0.5 && s.soft < 1, String(s.soft));
  assert.match(s.reason, /#11 is based on #10's branch, so #10 must merge first/);
});

test("an order that drops a PR, or names one that is not open, fails without throwing", () => {
  const dropped = score("ORDER: #10, #12, #13, #11\nDELETE: chore/old-report", t);
  assert.equal(dropped.hard, 0);
  assert.match(dropped.reason, /ORDER must list each open PR exactly once \(#10, #11, #12, #13, #14\)/);
  // A number that is not in the queue has no tier, so it costs the "each PR once" check and nothing
  // else: seven of eight order checks hold, and the reason does not rank it against the others.
  const stranger = score("ORDER: #10, #12, #13, #11, #99\nDELETE: chore/old-report", t);
  assert.deepEqual([stranger.hard, stranger.soft], [0, 0.5 * (7 / 8) + 0.5]);
  assert.doesNotMatch(stranger.reason, /#99 \(/);
});

test("the prompt shows each PR's base and files, every local branch, and the two answer lines", () => {
  const text = render({ prs, locals });
  assert.match(text, /^#11 {2}feat\/b +→ feat\/a +checks: pass/m);
  assert.ok(text.includes("#12: src/c.ts, src/shared.ts"));
  assert.match(text, /^chore\/old-report +yes +#3 merged/m);
  assert.ok(text.endsWith("ORDER: #<n>, #<n>, ...\nDELETE: <branch>, <branch>   (or: DELETE: none)"));
});

test("a seed always builds the same queue, and an open PR's branch is never deletable", () => {
  assert.deepEqual(generate(42), generate(42));
  for (let seed = 1; seed <= 60; seed++) {
    const s = generate(seed);
    assert.ok(s.prs.length >= 3 && s.prs.length <= 6, `seed ${seed}: ${s.prs.length} PRs`);
    for (const p of s.prs) {
      const row = s.locals.find((b) => b.branch === p.head);
      assert.ok(row && row.deletable === false, `seed ${seed}: ${p.head}`);
    }
  }
});
