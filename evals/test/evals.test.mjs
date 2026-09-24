// The scorer is what the optimizer climbs, so it is tested before anything trusts it: every task's
// correct answer must score 1, and each way of being wrong must score below 1. A scorer that passed a
// wrong answer would train a skill toward the wrong behaviour and report it as an improvement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SKILLS } from "../skills.mjs";
import { build } from "../generate.mjs";
import { listOf } from "../lib.mjs";

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
};

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
  assert.match(s.reason, /still true/);
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
