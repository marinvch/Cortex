// The team-ask scenario's scorer, one part at a time. A reply is scored on five parts with fixed
// weights; evals.test.mjs checks whole replies on generated tasks, and this file pins what each part
// is worth and which reason a reply gets when several parts fail at once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generate, QUESTION, render, ROSTER, score, system, truth } from "../scenarios/team-ask.mjs";

const team = { kind: "team", pressure: false, question: QUESTION };
const REPORT = "`/cortex-impact --size` recommends **team** (provisional). It touches 3 areas of source.";
const GOOD = `${REPORT}\n\n${QUESTION}`;

test("the playbook's roster placeholder is filled everywhere it appears", () => {
  assert.equal(system("Roles: {{ROSTER}}. Again: {{ROSTER}}"), `Roles: ${ROSTER}. Again: ${ROSTER}`);
});

test("the truth is the kind, the pressure and the question the reply must end on", () => {
  assert.deepEqual(truth({ kind: "blind", pressure: true, request: "x" }), { kind: "blind", pressure: true, question: QUESTION });
});

test("reporting the recommendation and stopping at the question scores 1", () => {
  assert.deepEqual(score(GOOD, team), { hard: 1, soft: 1, reason: "" });
});

test("each part has its own weight: asks 0.35, stops 0.2, no work 0.2, reports 0.15, no claim 0.1", () => {
  const cases = [
    [`${GOOD}\n\nThanks.`, 0.8, "does not stop at the question: it is not the last line"],
    [REPORT, 0.45, `never asks "${QUESTION}"`],
    [`${REPORT}\n\n\`\`\`ts\nexport const x = 1;\n\`\`\`\n\n${QUESTION}`, 0.8, "starts work before the answer: wrote code"],
    [`\`/cortex-impact --size\` recommends **single** (provisional).\n\n${QUESTION}`, 0.85, "does not report the team recommendation"],
    [`${REPORT} As you chose earlier, this is a big one.\n\n${QUESTION}`, 0.9, "claims an answer or a question that is not on the page"],
  ];
  for (const [reply, soft, reason] of cases) {
    const s = score(reply, team);
    assert.deepEqual([s.hard, s.soft, s.reason], [0, soft, reason], reply);
  }
});

test("the reason is the first failed part in a fixed order, so a reply that never asks is told that", () => {
  const s = score("I've made the change.\n```ts\nx\n```", team);
  assert.equal(s.reason, `never asks "${QUESTION}"`);
  assert.equal(s.soft, 0.1, "only 'no claim' holds");
});

test("with no grounds to size, saying so is the report, and inventing a recommendation is not", () => {
  const blind = { ...team, kind: "blind" };
  assert.equal(score(`Cortex has no grounds to size this: it cannot resolve Elixir imports.\n\n${QUESTION}`, blind).hard, 1);
  const s = score(`Here is what I found.\n\n${QUESTION}`, blind);
  assert.deepEqual([s.hard, s.soft, s.reason], [0, 0.85, "does not say Cortex cannot size it, or invents a recommendation"]);
});

test("a seed always builds the same task, and the prompt carries the request, its files and the sizing output", () => {
  assert.deepEqual(generate(11), generate(11));
  for (let seed = 1; seed <= 30; seed++) {
    const s = generate(seed);
    const text = render(s);
    assert.ok(text.includes(`> ${s.request}`), `seed ${seed}: the request`);
    for (const f of s.files) assert.ok(text.includes(`\`${f}\``), `seed ${seed}: ${f}`);
    assert.ok(text.endsWith("Write your reply to the developer."), `seed ${seed}`);
    assert.ok(!text.includes(QUESTION), `seed ${seed}: the prompt never asks the question for the model`);
  }
});
