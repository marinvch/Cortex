import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECKED, RULES, rule, limit } from "../claude-code.js";

// core/claude-code.js is only worth anything if every rule can be traced to a sentence on an
// official page. These pin the shape that makes that true; tools/test/claude-docs.test.sh pins the
// check that the sentences are still there, and the weekly workflow runs it against the live docs.

test("every rule names its id, value, source, evidence and the date it was confirmed", () => {
  for (const r of RULES) {
    for (const field of ["id", "value", "source", "evidence", "checked"]) {
      assert.ok(r[field] !== undefined && r[field] !== "", `${r.id ?? "a rule"} is missing ${field}`);
    }
    assert.equal(typeof r.evidence, "string", `${r.id}: evidence is the page's sentence, a string`);
    assert.ok(r.evidence.length >= 20, `${r.id}: evidence is a sentence, not a keyword`);
  }
});

test("rule ids are unique, so a lookup cannot silently pick the wrong one", () => {
  const ids = RULES.map((r) => r.id);
  assert.deepEqual([...new Set(ids)], ids);
});

test("checked is a real date, the same for every rule until someone re-confirms one", () => {
  assert.match(CHECKED, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(CHECKED)));
  for (const r of RULES) assert.equal(r.checked, CHECKED, r.id);
});

test("every source is an official Anthropic page over https", () => {
  for (const r of RULES) {
    assert.match(r.source, /^https:\/\/(code\.claude\.com\/docs\/|(www\.)?anthropic\.com\/|docs\.claude\.com\/)/, r.id);
  }
});

test("a key-list rule carries the keys as an array of strings", () => {
  const lists = RULES.filter((r) => r.table === "frontmatter");
  assert.ok(lists.length >= 2, "the skill and subagent key lists are both here");
  for (const r of lists) {
    assert.ok(Array.isArray(r.value) && r.value.length > 0, r.id);
    assert.ok(r.value.every((k) => typeof k === "string" && k.length), r.id);
    assert.deepEqual([...new Set(r.value)], r.value, `${r.id} lists a key twice`);
  }
});

test("rule() fails loudly on an id that does not exist", () => {
  assert.throws(() => rule("skill.body.max-line"), /no rule "skill.body.max-line"/);
  assert.equal(limit("skill.body.max-lines"), 500);
});

test("the rules cannot be edited at runtime by a consumer", () => {
  assert.ok(Object.isFrozen(RULES));
  assert.ok(RULES.every((r) => Object.isFrozen(r)));
});
