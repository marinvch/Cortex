// The /resume scenario on a state written by hand. evals.test.mjs runs the generated tasks and their
// traps; this file pins what each branch kind means for HIDDEN, and what each wrong field costs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generate, render, score, truth } from "../scenarios/resume.mjs";

const t = { uncommitted: "feat/cart-sync", hidden: ["fix/audit-queue", "feat/theme-cache"], route: "/ship" };
const answer = (over = {}) => {
  const a = { ...t, ...over };
  return `UNCOMMITTED: ${a.uncommitted}\nHIDDEN: ${a.hidden.join(", ") || "none"}\nROUTE: ${a.route}`;
};

test("only three kinds of branch hold hidden work: ahead, no upstream, and a dirty extra worktree", () => {
  const kinds = ["ahead", "ahead-merged", "wt-dirty", "wt-clean", "no-upstream", "in-sync-pr", "gone-merged", "merged-local"];
  const s = { current: "feat/x", dirty: false, route: "/dream", branches: kinds.map((kind) => ({ name: `b/${kind}`, kind })) };
  assert.deepEqual(truth(s), { uncommitted: "none", hidden: ["b/ahead", "b/wt-dirty", "b/no-upstream"], route: "/dream" });
  assert.equal(truth({ ...s, dirty: true }).uncommitted, "feat/x", "a dirty tree is reported with its branch");
});

test("all three fields right scores 1", () => {
  assert.deepEqual(score(answer(), t), { hard: 1, soft: 1, reason: "correct" });
});

test("each field is a third of the credit, and the reason quotes what was given", () => {
  const unc = score(answer({ uncommitted: "master" }), t);
  assert.ok(Math.abs(unc.soft - 2 / 3) < 1e-9, String(unc.soft));
  assert.equal(unc.reason, 'UNCOMMITTED should be feat/cart-sync, got "master"');

  const route = score(answer({ route: "/dream" }), t);
  assert.ok(Math.abs(route.soft - 2 / 3) < 1e-9, String(route.soft));
  assert.equal(route.reason, 'ROUTE should be /ship, got "/dream"');
});

test("half the hidden branches keeps F1 credit for that field", () => {
  const s = score(answer({ hidden: ["fix/audit-queue"] }), t);
  assert.equal(s.hard, 0);
  // Precision 1, recall 1/2, F1 2/3.
  assert.ok(Math.abs(s.soft - (1 + 2 / 3 + 1) / 3) < 1e-9, String(s.soft));
});

test("a missing HIDDEN line is not the same as HIDDEN: none", () => {
  const missing = score("UNCOMMITTED: feat/cart-sync\nROUTE: /ship", t);
  assert.match(missing.reason, /HIDDEN should be fix\/audit-queue, feat\/theme-cache, got "\(missing\)"/);
  const empty = { ...t, hidden: [] };
  assert.equal(score("UNCOMMITTED: feat/cart-sync\nROUTE: /ship", empty).hard, 0);
  assert.equal(score(answer({ hidden: [] }), empty).hard, 1);
});

test("the branch is compared without case, and the route is the first /command on its line", () => {
  assert.equal(score(answer({ uncommitted: "Feat/Cart-Sync" }), t).hard, 1);
  assert.equal(score(answer({ route: "run /ship next" }), t).hard, 1);
  assert.equal(score(answer({ route: "ship" }), t).reason, 'ROUTE should be /ship, got "ship"');
});

test("a seed always builds the same state, and the prompt names the current branch and the three keys", () => {
  assert.deepEqual(generate(7), generate(7));
  const s = generate(7);
  const text = render(s);
  assert.ok(text.includes(s.current), "the current branch is in the prompt");
  for (const key of ["UNCOMMITTED:", "HIDDEN:", "ROUTE:"]) assert.ok(text.includes(key), key);
});
