import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECKED, RULES, rule, limit, protectedClaudePath } from "../claude-code.js";

// core/claude-code.js is only worth anything if every rule can be traced to a sentence on an
// official page. These pin the shape that makes that true; tools/test/claude-docs.test.sh pins the
// check that the sentences are still there, and the daily workflow runs it against the live docs.

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
    assert.match(
      r.source,
      /^https:\/\/(code\.claude\.com\/docs\/|platform\.claude\.com\/docs\/|(www\.)?anthropic\.com\/|docs\.claude\.com\/)/,
      r.id,
    );
  }
});

// The model rules are the ones a direct Messages API caller trips over — tools/server/cortex-cron.sh
// read `.content[0].text` with `max_tokens: 800` until these existed. Pinned so a consumer can look
// them up by id and a later edit cannot quietly drop one.
test("the Opus 5.5 prompting rules are present and sourced from the platform docs", () => {
  const ids = [
    "model.effort.default-medium",
    "model.thinking.counts-toward-max-tokens",
    "model.response.read-by-block-type",
    "model.response.refusal-stop-reason",
    "model.thinking.cannot-disable",
    "model.prompt.no-reasoning-in-response",
    "model.agentic.end-turn-is-a-report",
    "model.agentic.continuation-cap",
  ];
  for (const id of ids) {
    assert.match(rule(id).source, /^https:\/\/platform\.claude\.com\/docs\/en\/build-with-claude\//, id);
  }
  assert.equal(limit("model.effort.default-medium"), "medium");
  assert.equal(limit("model.agentic.continuation-cap"), 3);
});

// What Cortex says about the shim it writes and about mods rests on these. Pinned by id and page so
// a finding or a template note can cite them, and a later edit cannot quietly drop one.
test("the AGENTS.md and mods rules are present and sourced from their pages", () => {
  for (const id of [
    "agents-md.default-needs-no-claude-md",
    "agents-md.setting-loads-both",
    "agents-md.import-not-read-twice",
    "agents-md.min-version",
  ]) {
    assert.equal(rule(id).source, "https://code.claude.com/docs/en/memory", id);
  }
  for (const id of [
    "mod.min-version",
    "mod.not-sandboxed",
    "mod.hooks-json.modules",
    "mod.module.extensions",
    "mod.approves-past-pretooluse",
  ]) {
    assert.match(rule(id).source, /^https:\/\/code\.claude\.com\/docs\/en\/plugins\/mods\/(overview|reference|admin)$/, id);
  }
  assert.equal(limit("agents-md.setting-loads-both"), "claude-md-and-agents-md");
  assert.equal(limit("mod.hooks-json.modules"), "modules");
  assert.ok(limit("mod.module.extensions").includes(".tsx"));
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

// An unattended /cortex writes .claude/agents/, .claude/hooks/ and .claude/settings.json, and Claude
// Code refuses every one of them in a `claude -p` run unless the mode lets them through. The chain
// of documented sentences that says so is pinned here, so a consumer that explains the refusal can
// cite them by id — and the path test is pinned against the one documented exception.
test("the protected-path rules an unattended install depends on are present and sourced", () => {
  for (const id of [
    "permission.protected-path.claude-dir",
    "permission.protected-path.never-auto-approved",
    "permission.protected-path.allow-rules-do-not-apply",
    "permission.protected-path.auto-mode-classifier",
    "headless.permission.no-host-denied",
  ]) {
    assert.match(rule(id).source, /^https:\/\/code\.claude\.com\/docs\/en\/(permission-modes|headless)$/, id);
  }
  assert.equal(limit("permission.protected-path.claude-dir"), ".claude");
});

test("protectedClaudePath answers for .claude/ and nothing that merely looks like it", () => {
  const yes = [".claude", ".claude/settings.json", ".claude/agents/verifier.md", "./.claude/hooks/x.sh", ".claude\\skills\\a\\SKILL.md"];
  for (const p of yes) assert.equal(protectedClaudePath(p), true, p);
  const no = [".claude/worktrees", ".claude/worktrees/agent-1/AGENTS.md", "CLAUDE.md", ".claudeignore", "docs/.claude/x", "CLAUDE.md#Verifying your work"];
  for (const p of no) assert.equal(protectedClaudePath(p), false, p);
});
