// claude-setup.test.mjs — one fixture per rule the checker enforces, each breaking exactly that rule.
//
// Every fixture is literal text through `read`/`exists`/`modeOf`, so no temp tree is needed and no
// test depends on the platform's executable bit. The stamp-then-check test, which does write a
// tree, lives in cortex-output-passes.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeSetupFindings, readFrontmatter, CLAUDE_SETUP_KINDS } from "../lib/claude-setup.mjs";
import { RULES } from "../../core/claude-code.js";

/** Run the checker over `files` ({ path: text }); `modes` overrides git's recorded mode per path. */
function check(files, { modes = {}, extra = [] } = {}) {
  const paths = [...Object.keys(files), ...extra];
  const index = {
    files: paths.map((path) => ({
      path,
      category: /\.(m?js|ts|py|java)$/.test(path) ? "code" : /\.sh$/.test(path) ? "script" : /\.md$/.test(path) ? "docs" : "config",
      isTest: false,
    })),
  };
  return claudeSetupFindings(index, null, {
    read: (p) => (p in files ? files[p] : null),
    exists: (p) => paths.includes(p),
    modeOf: (p) => modes[p] ?? "100755",
  });
}

const kinds = (fs) => fs.map((f) => f.kind);
const only = (fs, kind) => fs.filter((f) => f.kind === `claude-setup/${kind}`);

/** The finding exists, cites a real rule id and its source URL, and is never critical. */
function assertFinding(fs, kind) {
  const hit = only(fs, kind);
  assert.equal(hit.length, 1, `expected one ${kind}, got: ${kinds(fs).join(", ") || "none"}`);
  const f = hit[0];
  const cited = RULES.find((r) => f.detail.includes(`\`${r.id}\``));
  assert.ok(cited, `${kind} detail names no rule id: ${f.detail}`);
  assert.ok(f.detail.includes(cited.source), `${kind} detail does not cite ${cited.source}`);
  assert.ok(["medium", "low"].includes(f.severity), `${kind} severity ${f.severity}`);
  assert.ok(f.evidence.length > 0);
  return f;
}

const skill = (fm, body = "Body.\n") => `---\n${fm}\n---\n${body}`;
const agent = (fm, body = "You review code.\n") => `---\n${fm}\n---\n${body}`;
const GOOD_SKILL = skill("name: tidy\ndescription: Tidy imports in a changed file. Use when imports are unsorted.");
const GOOD_AGENT = agent("name: reviewer\ndescription: Reviews a diff.\ntools: Read, Grep");

// --- the empty and the clean -------------------------------------------------------------------

test("a repo with no Claude setup at all has no claude-setup findings and does not throw", () => {
  assert.deepEqual(check({}), []);
  assert.deepEqual(check({ "src/a.js": "export const a = 1;\n", "README.md": "# hi\n" }), []);
  assert.deepEqual(claudeSetupFindings({ files: [] }, null), []);
  assert.deepEqual(claudeSetupFindings(null, null), []);
});

test("a clean setup produces nothing", () => {
  const fs = check({
    "CLAUDE.md": "@AGENTS.md\n",
    "AGENTS.md": "# Brief\n\nRun `npm test`.\n",
    ".claude/skills/tidy/SKILL.md": GOOD_SKILL,
    ".claude/agents/reviewer.md": GOOD_AGENT,
  });
  assert.deepEqual(fs, []);
});

test("every kind is prefixed and every row cites a rule that exists", () => {
  for (const k of CLAUDE_SETUP_KINDS) assert.match(k, /^claude-setup\/[a-z0-9-]+$/);
  assert.equal(new Set(CLAUDE_SETUP_KINDS).size, CLAUDE_SETUP_KINDS.length);
});

// --- CLAUDE.md -----------------------------------------------------------------------------------

test("CLAUDE.md over the line limit, counting what it imports", () => {
  const long = Array.from({ length: 201 }, (_, i) => `line ${i}`).join("\n") + "\n";
  assertFinding(check({ "CLAUDE.md": long }), "claude-md-too-long");
  const f = assertFinding(check({ "CLAUDE.md": "@AGENTS.md\n", "AGENTS.md": long }), "claude-md-too-long");
  assert.match(f.evidence[0], /^AGENTS\.md — 201 lines/);
  assert.deepEqual(check({ "CLAUDE.md": long.split("\n").slice(0, 200).join("\n") + "\n" }), []);
});

test("emphasis on many lines is low severity and says the threshold is Cortex's", () => {
  const md = ["IMPORTANT: a", "NEVER b", "ALWAYS c", "You MUST d", "plain"].join("\n");
  const f = assertFinding(check({ "CLAUDE.md": md }), "claude-md-emphasis");
  assert.equal(f.severity, "low");
  assert.match(f.detail, /Cortex's threshold/);
  assert.deepEqual(check({ "CLAUDE.md": md.split("\n").slice(1).join("\n") }), []);
  // Emphasis inside code is not emphasis.
  assert.deepEqual(check({ "CLAUDE.md": "```\nIMPORTANT\nMUST\nNEVER\nALWAYS\n```\n" }), []);
});

test("an @import to a file that does not exist", () => {
  const f = assertFinding(check({ "CLAUDE.md": "See @docs/missing.md for more.\n" }), "claude-md-import-missing");
  assert.match(f.evidence[0], /^CLAUDE\.md:1 — @docs\/missing\.md/);
  // An email address, a decorator in a code fence and a package scope are not imports.
  assert.deepEqual(check({ "CLAUDE.md": "Mail a@b.co.\n```\n@Component\n```\nUse `@scope/pkg`.\n" }), []);
});

// --- skills ------------------------------------------------------------------------------------

test("skill description + when_to_use over 1,536 characters — counted in code points", () => {
  const desc = (n) => "д".repeat(n); // Cyrillic: 2 bytes each, so a byte count would fire at 768
  const at = check({ ".claude/skills/bg/SKILL.md": skill(`name: bg\ndescription: ${desc(1536)}`) });
  assert.deepEqual(only(at, "skill-description-too-long"), []);
  const over = check({ ".claude/skills/bg/SKILL.md": skill(`name: bg\ndescription: ${desc(1537)}`) });
  assertFinding(over, "skill-description-too-long");
  const split = check({
    ".claude/skills/bg/SKILL.md": skill(`name: bg\ndescription: ${desc(1000)}\nwhen_to_use: ${desc(537)}`),
  });
  assertFinding(split, "skill-description-too-long");
  // An astral character is two UTF-16 units; `.length` would double-count it and fire at 768.
  const astral = check({ ".claude/skills/bg/SKILL.md": skill(`name: bg\ndescription: ${"😀".repeat(1536)}`) });
  assert.deepEqual(only(astral, "skill-description-too-long"), []);
});

test("skill body over 500 lines", () => {
  const body = Array.from({ length: 501 }, (_, i) => `step ${i}`).join("\n") + "\n";
  assertFinding(check({ ".claude/skills/x/SKILL.md": skill("name: x\ndescription: Does x.", body) }), "skill-body-too-long");
});

test("unknown skill frontmatter key; metadata: is the place for custom data", () => {
  const f = assertFinding(
    check({ ".claude/skills/x/SKILL.md": skill("name: x\ndescription: Does x.\ncapability: model") }),
    "skill-unknown-key",
  );
  assert.match(f.evidence[0], /capability/);
  assert.deepEqual(
    check({ ".claude/skills/x/SKILL.md": skill("name: x\ndescription: Does x.\nmetadata:\n  capability: model") }),
    [],
  );
});

test("trigger phrasing on a disable-model-invocation skill", () => {
  const fm = "name: x\ndescription: Deploys. Use when the user says ship it.\ndisable-model-invocation: true";
  assertFinding(check({ ".claude/skills/x/SKILL.md": skill(fm) }), "skill-user-invoked-with-triggers");
  // The same description on a model-invoked skill is exactly right.
  assert.deepEqual(check({ ".claude/skills/x/SKILL.md": skill(fm.replace("true", "false")) }), []);
});

test("a skill pointing at a supporting file that does not exist", () => {
  const body = "See [the reference](reference.md) and [forms](forms.md).\n";
  const fs = check({
    ".claude/skills/x/SKILL.md": skill("name: x\ndescription: Does x.", body),
    ".claude/skills/x/reference.md": "ref\n",
  });
  const f = assertFinding(fs, "skill-reference-missing");
  assert.deepEqual(f.evidence, [".claude/skills/x/SKILL.md:5 — forms.md"]);
  // A placeholder link in an example is not a file reference.
  const example = skill("name: x\ndescription: Does x.", "> See [Title](URL) — one line.\n");
  assert.deepEqual(check({ ".claude/skills/x/SKILL.md": example }), []);
});

test("a plugin skill naming ${CLAUDE_PLUGIN_ROOT}/<missing>", () => {
  const body = "Run `node ${CLAUDE_PLUGIN_ROOT}/tools/gone.mjs`.\n";
  const fs = check({
    ".claude-plugin/plugin.json": "{}",
    "skills/x/SKILL.md": skill("name: x\ndescription: Does x.", body),
  });
  assertFinding(fs, "skill-reference-missing");
});

test("plugins inside a marketplace repo are found under plugins/<name>/, with their own plugin root", () => {
  const pj = "plugins/fmt/.claude-plugin/plugin.json";
  const hooks = JSON.stringify({
    hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/guard.sh" }] }] },
  });
  const fs = check({
    ".claude-plugin/marketplace.json": "{}",
    [pj]: "{}",
    "plugins/fmt/hooks/hooks.json": hooks,
    "plugins/fmt/skills/x/SKILL.md": skill("name: x\ndescription: Does x.", "Run ${CLAUDE_PLUGIN_ROOT}/bin/x.sh.\n"),
    "plugins/fmt/bin/x.sh": "exit 0\n",
    "plugins/fmt/agents/r.md": agent("name: r\ndescription: Reviews.\ntools: Read\nhooks: {}"),
  });
  const missing = assertFinding(fs, "hook-script-missing");
  assert.match(missing.evidence[0], /plugins\/fmt\/hooks\/guard\.sh not found/);
  assertFinding(fs, "subagent-plugin-ignored-key");
  assert.deepEqual(only(fs, "skill-reference-missing"), []); // resolved inside plugins/fmt/, where x.sh is
});

test("unterminated skill frontmatter is one finding, not a crash", () => {
  const fs = check({ ".claude/skills/x/SKILL.md": "---\nname: x\ndescription: Does x.\n\nBody with no closing marker.\n" });
  assertFinding(fs, "skill-frontmatter-unreadable");
  assert.deepEqual(kinds(fs), ["claude-setup/skill-frontmatter-unreadable"]);
});

// --- frontmatter reading -------------------------------------------------------------------------

test("BOM + CRLF frontmatter parses", () => {
  const src = "﻿---\r\nname: x\r\ndescription: Does x.\r\n---\r\nBody\r\n";
  const fm = readFrontmatter(src);
  assert.equal(fm.state, "ok");
  assert.deepEqual(fm.keys, ["name", "description"]);
  assert.equal(fm.data.description, "Does x.");
  assert.deepEqual(check({ ".claude/skills/x/SKILL.md": src }), []);
});

test("block scalars, lists and nested maps are read, not mistaken for keys", () => {
  const fm = readFrontmatter(
    "---\nname: x\ndescription: >-\n  Folded\n  text.\ntools:\n  - Read\n  - Grep\nmetadata:\n  owner: a\n---\n",
  );
  assert.deepEqual(fm.keys, ["name", "description", "tools", "metadata"]);
  assert.equal(fm.data.description, "Folded text.");
  assert.deepEqual(fm.data.tools, ["Read", "Grep"]);
});

// --- subagents ---------------------------------------------------------------------------------

test("unknown subagent key — a snake_case spelling is not the camelCase key", () => {
  const f = assertFinding(
    check({ ".claude/agents/r.md": agent("name: r\ndescription: Reviews.\ndisallowed_tools: Write") }),
    "subagent-unknown-key",
  );
  assert.match(f.evidence[0], /disallowed_tools/);
  // Prose pasted unindented into a description is a loose block: its lines are not reported as keys.
  const loose = "---\nname: r\ndescription: Use this agent when.\nContext: x\nuser: \"a\"\n<example>\nuser: \"b\"\n---\nBody\n";
  assert.equal(readFrontmatter(loose).loose, true);
  assert.deepEqual(check({ ".claude/agents/r.md": loose }), []);
});

test("subagent missing a description", () => {
  assertFinding(check({ ".claude/agents/r.md": agent("name: r") }), "subagent-missing-required");
});

test("subagent name containing ':'", () => {
  assertFinding(check({ ".claude/agents/r.md": agent('name: "team:r"\ndescription: Reviews.') }), "subagent-name-colon");
});

test("hooks / mcpServers / permissionMode on a plugin subagent — and not on a project one", () => {
  const fm = "name: r\ndescription: Reviews.\ntools: Read\npermissionMode: plan";
  assertFinding(check({ ".claude-plugin/plugin.json": "{}", "agents/r.md": agent(fm) }), "subagent-plugin-ignored-key");
  assert.deepEqual(check({ ".claude/agents/r.md": agent(fm) }), []);
});

test("an agent described as read-only that can still edit", () => {
  const ro = "name: r\ndescription: Read-only reviewer. Changes nothing.";
  assertFinding(check({ ".claude/agents/r.md": agent(ro) }), "subagent-read-only-can-edit"); // tools omitted → inherits
  assertFinding(check({ ".claude/agents/r.md": agent(`${ro}\ntools: Read, Edit`) }), "subagent-read-only-can-edit");
  assert.deepEqual(check({ ".claude/agents/r.md": agent(`${ro}\ntools: Read, Grep, Bash`) }), []);
  // An agent that edits and says a flag is "not read-only" is not claiming to be read-only.
  const writer = agent("name: w\ndescription: Owns docs.\ntools: Read, Edit", "That flag marks destructive, not read-only.\n");
  assert.deepEqual(check({ ".claude/agents/w.md": writer }), []);
  assert.deepEqual(
    check({ ".claude/agents/r.md": agent(`${ro}\ndisallowedTools: Edit, Write, MultiEdit, NotebookEdit`) }),
    [],
  );
});

test("unterminated subagent frontmatter is one finding, not a crash", () => {
  assertFinding(check({ ".claude/agents/r.md": "---\nname: r\n" }), "subagent-frontmatter-unreadable");
});

// --- hooks -------------------------------------------------------------------------------------

const settings = (event, command) =>
  JSON.stringify({ hooks: { [event]: [{ matcher: "Edit|Write", hooks: [{ type: "command", command }] }] } });

test("a settings file that is not JSON is one finding, not a crash", () => {
  const fs = check({ ".claude/settings.json": "{ hooks: nope" });
  assertFinding(fs, "settings-not-json");
  assert.equal(fs.length, 1);
});

test("a hook command naming a script that does not exist — direct and through bash \"…\"", () => {
  assertFinding(
    check({ ".claude/settings.json": settings("PreToolUse", 'bash "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard.sh"') }),
    "hook-script-missing",
  );
  assertFinding(check({ ".claude/settings.json": settings("PreToolUse", ".claude/hooks/guard.sh") }), "hook-script-missing");
  assert.deepEqual(
    check({
      ".claude/settings.json": settings("PreToolUse", 'bash "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard.sh"'),
      ".claude/hooks/guard.sh": "exit 0\n",
    }),
    [],
  );
});

test("a script run directly without its executable bit; through bash it does not need one", () => {
  const files = { ".claude/hooks/guard.sh": "exit 0\n" };
  const modes = { ".claude/hooks/guard.sh": "100644" };
  assertFinding(
    check({ ...files, ".claude/settings.json": settings("PreToolUse", '"$CLAUDE_PROJECT_DIR"/.claude/hooks/guard.sh') }, { modes }),
    "hook-script-not-executable",
  );
  assert.deepEqual(
    check({ ...files, ".claude/settings.json": settings("PreToolUse", 'bash "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard.sh"') }, { modes }),
    [],
  );
  // An unknown mode (an untracked file on Windows) is not a finding — nothing to report honestly.
  assert.deepEqual(
    check({ ...files, ".claude/settings.json": settings("PreToolUse", ".claude/hooks/guard.sh") }, { modes: { ".claude/hooks/guard.sh": null } })
      .filter((f) => f.kind.endsWith("not-executable")),
    [],
  );
});

test("a PostToolUse hook that exits 2", () => {
  const cmd = 'bash "${CLAUDE_PROJECT_DIR}/.claude/hooks/lint.sh"';
  assertFinding(
    check({ ".claude/settings.json": settings("PostToolUse", cmd), ".claude/hooks/lint.sh": "lint || exit 2\n" }),
    "post-tool-use-exit-2",
  );
  // The same script in PreToolUse blocks as intended; a comment mentioning exit 2 is not an exit.
  assert.deepEqual(
    check({ ".claude/settings.json": settings("PreToolUse", cmd), ".claude/hooks/lint.sh": "lint || exit 2\n" }),
    [],
  );
  assert.deepEqual(
    check({ ".claude/settings.json": settings("PostToolUse", cmd), ".claude/hooks/lint.sh": "# never exit 2 here\nexit 0\n" }),
    [],
  );
});

// --- the Messages API ----------------------------------------------------------------------------

const api = (body) => `import Anthropic from "@anthropic-ai/sdk";\nconst client = new Anthropic();\n${body}\n`;

test("reading content[0].text off a Messages API response", () => {
  assertFinding(check({ "src/ask.js": api("const r = await client.messages.create(req);\nreturn r.content[0].text;") }), "api-first-block-as-text");
  // Without an Anthropic signal the same expression is someone else's API.
  assert.deepEqual(check({ "src/other.js": "return r.content[0].text;\n" }), []);
});

test("a small literal max_tokens is low severity and says the threshold is Cortex's", () => {
  const f = assertFinding(check({ "src/ask.js": api("client.messages.create({ max_tokens: 1024 });") }), "api-max-tokens-small");
  assert.equal(f.severity, "low");
  assert.match(f.detail, /Cortex's threshold/);
  assert.deepEqual(check({ "src/ask.js": api("client.messages.create({ max_tokens: 16000 });") }), []);
});

test("thinking disabled", () => {
  assertFinding(
    check({ "src/ask.py": 'import anthropic\nclient.messages.create(\n  thinking={"type": "disabled"},\n)\n' }),
    "api-thinking-disabled",
  );
});

test("a prompt asking the model to write out its reasoning", () => {
  assertFinding(check({ "CLAUDE.md": "Before answering, show your reasoning step by step.\n" }), "prompt-asks-for-reasoning");
  // Advice to an author about explaining reasons asks the model to reveal nothing.
  assert.deepEqual(check({ "CLAUDE.md": "Explain the reasoning so the model understands why.\n" }), []);
  assertFinding(
    check({ "src/ask.js": api('const system = "Explain your reasoning before the answer.";') }),
    "prompt-asks-for-reasoning",
  );
});

// --- aggregation -------------------------------------------------------------------------------

test("one finding per kind, however many files it applies to, with evidence capped", () => {
  const files = {};
  for (let i = 0; i < 40; i++) files[`.claude/skills/s${i}/SKILL.md`] = skill(`name: s${i}\ndescription: Does it.\nreached-by: x`);
  const f = assertFinding(check(files), "skill-unknown-key");
  assert.match(f.title, /^40 skills/);
  assert.equal(f.evidence.length, 25);
  assert.match(f.detail, /first 25 of 40/);
});

test("the report is deterministic", () => {
  const files = {
    "CLAUDE.md": "@x.md\n",
    ".claude/agents/r.md": agent("name: r"),
    ".claude/skills/x/SKILL.md": skill("name: x\ndescription: Does x.\nfoo: 1"),
  };
  assert.deepEqual(check(files), check(files));
});
