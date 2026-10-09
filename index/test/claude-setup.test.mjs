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

test("a project skill's link written from the repo root is followed, as Claude follows it (#522)", () => {
  const body = [
    "See [the traps](.claude/skills/x/references/traps.md) and [`a.ts:33`](src/a.ts#L33).",
    "And [gone](src/missing.ts).",
  ].join("\n") + "\n";
  const fs = check({
    ".claude/skills/x/SKILL.md": skill("name: x\ndescription: Does x.", body),
    ".claude/skills/x/references/traps.md": "t\n",
    "src/a.ts": "export {}\n",
  });
  const f = assertFinding(fs, "skill-reference-missing");
  assert.deepEqual(f.evidence, [".claude/skills/x/SKILL.md:6 — src/missing.ts"]);
  // A plugin skill runs in the user's project, not the plugin, so a link only the plugin's root
  // resolves is still reported.
  const plugin = check({
    ".claude-plugin/plugin.json": "{}",
    "skills/x/SKILL.md": skill("name: x\ndescription: Does x.", "See [the tool](tools/a.mjs).\n"),
    "tools/a.mjs": "export {}\n",
  });
  assert.deepEqual(only(plugin, "skill-reference-missing")[0]?.evidence, ["skills/x/SKILL.md:5 — tools/a.mjs"]);
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

// A plugin needs no manifest of its own: the marketplace entry names it. Seven skills in one public
// marketplace repo sat in such a folder, and no skill finding looked at them.
const market = (...sources) => JSON.stringify({ name: "m", plugins: sources.map((source, i) => ({ name: `p${i}`, source })) });
const LONG = `name: x\ndescription: ${"word ".repeat(260)}`;

test("a plugin listed by a marketplace is checked even with no manifest of its own", () => {
  const fs = check({
    ".claude-plugin/marketplace.json": market("./plugins/fmt", "./plugins/lint/"),
    "plugins/fmt/skills/x/SKILL.md": skill(LONG, "Body.\n"),
    "plugins/lint/skills/y/SKILL.md": skill("name: y\ndescription: Does y.\nversion: 1", "Body.\n"),
    "plugins/fmt/agents/r.md": agent("name: r\ndescription: Reviews.\ntools: Read\nhooks: {}"),
  });
  const hit = assertFinding(fs, "skill-description-not-portable");
  assert.match(hit.evidence[0], /^plugins\/fmt\/skills\/x\/SKILL\.md/);
  assertFinding(fs, "subagent-plugin-ignored-key");
  // A trailing slash names the same folder.
  assert.match(assertFinding(fs, "skill-unknown-key").evidence[0], /^plugins\/lint\/skills\/y\/SKILL\.md/);
});

test("a folder no marketplace entry names is still not plugin content", () => {
  const fs = check({
    ".claude-plugin/marketplace.json": market("./plugins/fmt"),
    "plugins/other/skills/x/SKILL.md": skill(LONG, "Body.\n"),
    "docs/skills/x/SKILL.md": skill(LONG, "Body.\n"),
  });
  assert.deepEqual(kinds(fs), []);
});

test("a marketplace source resolves from the directory that holds .claude-plugin/", () => {
  const fs = check({
    "tools/market/.claude-plugin/marketplace.json": market("./plugins/fmt", "./"),
    "tools/market/plugins/fmt/skills/x/SKILL.md": skill(LONG, "Body.\n"),
    "plugins/fmt/skills/x/SKILL.md": skill(LONG, "Body.\n"),
  });
  const hit = only(fs, "skill-description-not-portable");
  assert.equal(hit.length, 1);
  assert.deepEqual(hit[0].evidence.map((e) => e.split(" — ")[0]), ["tools/market/plugins/fmt/skills/x/SKILL.md"]);
});

test("a source that is not a path inside the marketplace names no plugin root", () => {
  for (const source of [{ source: "github", repo: "example-org/fmt" }, "../fmt", "./a/../../fmt", "./plugins/../fmt", "/abs/fmt", "plugins/fmt", "", 7, null]) {
    const fs = check({
      ".claude-plugin/marketplace.json": market(source),
      "plugins/fmt/skills/x/SKILL.md": skill(LONG, "Body.\n"),
      "fmt/skills/x/SKILL.md": skill(LONG, "Body.\n"),
    });
    assert.deepEqual(kinds(fs), [], JSON.stringify(source));
  }
});

test("a marketplace file that does not parse, or lists nothing, changes nothing and does not throw", () => {
  for (const text of ["{ not json", "[]", "{}", '{"plugins": "all"}', '{"plugins": [null, 3, {}]}', null]) {
    const files = { "plugins/fmt/skills/x/SKILL.md": skill(LONG, "Body.\n") };
    const fs = claudeSetupFindings(
      { files: [".claude-plugin/marketplace.json", ...Object.keys(files)].map((path) => ({ path, category: "docs", isTest: false })) },
      null,
      { read: (p) => (p in files ? files[p] : p.endsWith("marketplace.json") ? text : null), exists: () => true, modeOf: () => "100644" },
    );
    assert.deepEqual(kinds(fs), [], String(text));
  }
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

test("a flow list broken over lines is a list — a formatter writes long tool lists that way", () => {
  // Found on a real repo: `tools:` read as a nested map, so the agent looked as if it granted nothing.
  const fm = readFrontmatter("---\nname: q\ndescription: Checks.\ntools:\n  [\n    Read,\n    Bash,\n    mcp__x__y,\n  ]\nmodel: opus\n---\n");
  assert.deepEqual(fm.keys, ["name", "description", "tools", "model"]);
  assert.deepEqual(fm.data.tools, ["Read", "Bash", "mcp__x__y"]);
  assert.deepEqual(readFrontmatter("---\ntools: [Read,\n  Edit]\n---\n").data.tools, ["Read", "Edit"]);
  // …so an agent that claims to change nothing and lists Edit that way is still caught.
  const ro = agent("name: r\ndescription: Read-only reviewer.\ntools:\n  [\n    Read,\n    Edit,\n  ]");
  assertFinding(check({ ".claude/agents/r.md": ro }), "subagent-read-only-can-edit");
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
  // Plugin agents/ is scanned recursively too (docs: sub-agents), so a subfolder agent is graded.
  assertFinding(check({ ".claude-plugin/plugin.json": "{}", "agents/review/r.md": agent(fm) }), "subagent-plugin-ignored-key");
});

test("an agent described as read-only that can still edit", () => {
  const ro = "name: r\ndescription: Read-only reviewer. Changes nothing.";
  assertFinding(check({ ".claude/agents/r.md": agent(ro) }), "subagent-read-only-can-edit"); // tools omitted → inherits
  assertFinding(check({ ".claude/agents/r.md": agent(`${ro}\ntools: Read, Edit`) }), "subagent-read-only-can-edit");
  assert.deepEqual(check({ ".claude/agents/r.md": agent(`${ro}\ntools: Read, Grep, Bash`) }), []);
  // An agent that edits and says a flag is "not read-only" is not claiming to be read-only.
  const writer = agent("name: w\ndescription: Owns docs.\ntools: Read, Edit", "That flag marks destructive, not read-only.\n");
  assert.deepEqual(check({ ".claude/agents/w.md": writer }), []);
  // A conditional "change nothing" guards one failure in an agent built to edit (#523).
  for (const guard of [
    "If the brief cannot be verified, report it as a finding and change nothing.",
    "If the brief cannot be verified, report it as a finding and\nchange nothing. Do not implement against it.",
    "Report it, and if the brief is wrong, change nothing.",
    "Change nothing until the plan is approved.",
    "- When the tests are red before you start, make no changes and say so.",
  ]) {
    const fixer = agent("name: f\ndescription: Implements the plan.\ntools: Read, Edit", `${guard}\n`);
    assert.deepEqual(check({ ".claude/agents/f.md": fixer }), [], guard);
  }
  // Only the description and the role's opening statement make a claim about the agent. Further
  // down, "read-only" describes something else (wshobson/agents: 8 reported, 8 wrong).
  const coder = agent(
    "name: c\ndescription: Writes secure backend code.\ntools: Read, Edit",
    "# Security coder\n\nYou write secure backend code.\n\n## Capabilities\n- CSP: nonces, hashes, report-only mode\n- Read-only workflow state access\n",
  );
  assert.deepEqual(check({ ".claude/agents/c.md": coder }), []);
  const opening = agent("name: o\ndescription: Reviews.\ntools: Read, Edit", "# Reviewer\n\nYou are a read-only reviewer.\n\n## Steps\n- Read.\n");
  assertFinding(check({ ".claude/agents/o.md": opening }), "subagent-read-only-can-edit");
  // An unconditional claim still counts, also beside a conditional sentence.
  for (const claim of [
    "This agent is read-only and changes nothing.",
    "If the input is empty, stop. This agent changes nothing.",
  ]) {
    const ro2 = agent("name: r\ndescription: Reviews.\ntools: Read, Edit", `${claim}\n`);
    assertFinding(check({ ".claude/agents/r.md": ro2 }), "subagent-read-only-can-edit");
  }
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

// --- mods --------------------------------------------------------------------------------------

/** A plugin at `plugins/m/` whose hooks.json is `json`, plus whatever else the case needs. */
const mod = (json, files = {}) =>
  check({ "plugins/m/.claude-plugin/plugin.json": "{}", "plugins/m/hooks/hooks.json": JSON.stringify(json), ...files });

test("a mod whose module exists is reported once, as a statement and not a defect", () => {
  const fs = mod({ modules: ["./register.js"] }, { "plugins/m/hooks/register.js": "export function register() {}\n" });
  const f = assertFinding(fs, "mod-present");
  assert.equal(f.severity, "low");
  assert.match(f.evidence[0], /plugins\/m\/hooks\/hooks\.json → \.\/register\.js/);
  assert.equal(fs.length, 1, kinds(fs).join(", "));
});

test("a hooks module that is not there", () => {
  const fs = mod({ modules: ["./register.js"] });
  const f = assertFinding(fs, "mod-module-missing");
  assert.match(f.evidence[0], /plugins\/m\/hooks\/register\.js not found/);
  assert.deepEqual(only(fs, "mod-present"), []);
});

test("the module path is relative to hooks.json, not to the plugin root", () => {
  const fs = mod({ modules: ["./register.js"] }, { "plugins/m/register.js": "export function register() {}\n" });
  assertFinding(fs, "mod-module-missing");
});

test("modules that is not an array of one path", () => {
  const two = mod(
    { modules: ["./a.js", "./b.js"] },
    { "plugins/m/hooks/a.js": "export function register() {}\n", "plugins/m/hooks/b.js": "export function register() {}\n" },
  );
  assert.match(assertFinding(two, "mod-modules-not-one").evidence[0], /2 entries/);
  assert.deepEqual(only(two, "mod-present"), []);
  assert.match(assertFinding(mod({ modules: "./register.js" }), "mod-modules-not-one").evidence[0], /a string/);
  assert.match(assertFinding(mod({ modules: [] }), "mod-modules-not-one").evidence[0], /0 entries/);
  assertFinding(mod({ modules: [42] }), "mod-modules-not-one");
});

test("a modules key in a settings file is not a mod — only a plugin's hooks.json is", () => {
  const fs = check({ ".claude/settings.json": JSON.stringify({ modules: ["./register.js"] }) });
  assert.deepEqual(fs, []);
});

test("a hooks module with an extension a mod cannot use", () => {
  const fs = mod({ modules: ["./register.py"] }, { "plugins/m/hooks/register.py": "def register(): pass\n" });
  assert.match(assertFinding(fs, "mod-module-extension").evidence[0], /\.py/);
  assert.deepEqual(only(fs, "mod-present"), []);
  for (const ext of [".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]) {
    const ok = mod({ modules: [`./register${ext}`] }, { [`plugins/m/hooks/register${ext}`]: "export function register() {}\n" });
    assert.deepEqual(kinds(ok), ["claude-setup/mod-present"], ext);
  }
});

test("settings hooks in a plugin's hooks.json, with no modules key, are not a mod", () => {
  const fs = mod(
    { hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/guard.sh" }] }] } },
    { "plugins/m/hooks/guard.sh": "exit 0\n" },
  );
  assert.deepEqual(fs, []);
});

test("a hooks.json with modules and no plugin manifest beside it is not a mod", () => {
  const fs = check({ "hooks/hooks.json": JSON.stringify({ modules: ["./register.js"] }) });
  assert.deepEqual(fs, []);
});

test("a mod that also carries settings hooks gets both read", () => {
  const fs = mod(
    {
      modules: ["./register.js"],
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/guard.sh" }] }] },
    },
    { "plugins/m/hooks/register.js": "export function register() {}\n" },
  );
  assertFinding(fs, "mod-present");
  assertFinding(fs, "hook-script-missing");
});

// --- the skill authoring page (plan step 0a) --------------------------------------------------------
//
// These three are limits of the Agent Skills format, stated on the platform's authoring page. Claude
// Code loads a skill that breaks them; the API and a claude.ai upload refuse it, or read it worse.
// So each is low severity and says which of the two it is about.

test("a skill name the Agent Skills format refuses: its characters, its length, a reserved word", () => {
  const fs = check({
    ".claude/skills/a/SKILL.md": skill("name: Writing Hookify Rules\ndescription: Writes rules."),
    ".claude/skills/b/SKILL.md": skill("name: claude-handoff\ndescription: Hands off."),
    ".claude/skills/c/SKILL.md": skill(`name: ${"x".repeat(65)}\ndescription: Long name.`),
    ".claude/skills/d/SKILL.md": skill("name: my_skill\ndescription: Underscore."),
    ".claude/skills/ok-1/SKILL.md": skill("name: processing-pdfs-2\ndescription: Fine."),
    // "Cannot contain" is about the letters, so a longer word that holds one is refused too.
    ".claude/skills/ok-2/SKILL.md": skill("name: declaude\ndescription: Holds a reserved word."),
  });
  const f = assertFinding(fs, "skill-name-not-portable");
  assert.equal(f.severity, "low");
  assert.deepEqual(f.evidence, [
    ".claude/skills/a/SKILL.md — \"Writing Hookify Rules\": characters other than lowercase letters, numbers and hyphens",
    ".claude/skills/b/SKILL.md — \"claude-handoff\": contains the reserved word \"claude\"",
    `.claude/skills/c/SKILL.md — "${"x".repeat(65)}": 65 characters`,
    ".claude/skills/d/SKILL.md — \"my_skill\": characters other than lowercase letters, numbers and hyphens",
    ".claude/skills/ok-2/SKILL.md — \"declaude\": contains the reserved word \"claude\"",
  ]);
  assert.match(f.detail ?? f.what ?? "", /Claude Code still loads/);
});

test("a skill with no name is checked by its directory, which is the name Claude Code gives it", () => {
  const f = assertFinding(check({ ".claude/skills/Anthropic_Helper/SKILL.md": skill("description: No name key.") }), "skill-name-not-portable");
  assert.match(f.evidence[0], /"Anthropic_Helper": characters other than/);
  assert.deepEqual(only(check({ ".claude/skills/pdf-forms/SKILL.md": skill("description: No name key.") }), "skill-name-not-portable"), []);
});

test("a description over 1,024 characters is over the format's limit while under Claude Code's", () => {
  const fs = check({
    ".claude/skills/x/SKILL.md": skill(`name: x\ndescription: ${"d".repeat(1025)}`),
    ".claude/skills/y/SKILL.md": skill(`name: y\ndescription: ${"d".repeat(1024)}`),
    // when_to_use is Claude Code's own key and is not part of the format's description.
    ".claude/skills/z/SKILL.md": skill(`name: z\ndescription: ${"d".repeat(900)}\nwhen_to_use: ${"w".repeat(400)}`),
  });
  const f = assertFinding(fs, "skill-description-not-portable");
  assert.equal(f.severity, "low");
  assert.deepEqual(f.evidence, [".claude/skills/x/SKILL.md — 1025 characters"]);
  assert.deepEqual(only(fs, "skill-description-too-long"), [], "1,025 is under Claude Code's own 1,536");
});

test("a reference file over 100 lines with no table of contents at the top", () => {
  const long = (head) => head + Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n") + "\n";
  const fs = check({
    ".claude/skills/x/SKILL.md": skill("name: x\ndescription: Does x.", "See [a](A.md), [b](B.md), [c](C.md), [short](SHORT.md) and [deep](refs/D.md).\n"),
    ".claude/skills/x/A.md": long("# A\n\n"),
    ".claude/skills/x/B.md": long("# B\n\n## Contents\n\n- One\n- Two\n\n"),
    ".claude/skills/x/C.md": long("# C\n\n- [One](#one)\n- [Two](#two)\n- [Three](#three)\n\n"),
    ".claude/skills/x/SHORT.md": "# Short\n\nTen lines.\n",
    ".claude/skills/x/refs/D.md": long("# D\n\nIntro.\n\n### Table of Contents\n\n"),
    // Long, with no contents, and no skill points at it: not a reference file.
    ".claude/skills/x/NOTES.md": long("# Notes\n\n"),
  });
  const f = assertFinding(fs, "skill-reference-no-contents");
  assert.equal(f.severity, "low");
  assert.deepEqual(f.evidence, [".claude/skills/x/A.md — 122 lines"]);
});

test("a long file outside the skill's directory is not its reference file, and one linked twice is one row", () => {
  const long = "# Guide\n\n" + Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n") + "\n";
  const fs = check({
    ".claude/skills/x/SKILL.md": skill("name: x\ndescription: Does x.", "See [the guide](../../../docs/guide.md), [a](A.md) and again [a](A.md#part).\n"),
    ".claude/skills/x/A.md": long,
    "docs/guide.md": long,
  });
  assert.deepEqual(assertFinding(fs, "skill-reference-no-contents").evidence, [".claude/skills/x/A.md — 122 lines"]);
});

test("exactly 100 lines needs no contents, and three in-page links are the fewest that count", () => {
  const lines = (n, head = "") => head + Array.from({ length: n }, (_, i) => `line ${i}`).join("\n") + "\n";
  const fs = check({
    ".claude/skills/x/SKILL.md": skill("name: x\ndescription: Does x.", "See [a](A.md), [b](B.md) and [c](C.md).\n"),
    ".claude/skills/x/A.md": lines(100),
    ".claude/skills/x/B.md": lines(120, "# B\n\n- [One](#one)\n- [Two](#two)\n\n"),
    ".claude/skills/x/C.md": lines(120, "# C\n\n- [One](#one)\n- [Two](#two)\n- [Three](#three)\n\n"),
  });
  assert.deepEqual(assertFinding(fs, "skill-reference-no-contents").evidence, [".claude/skills/x/B.md — 125 lines"]);
});

test("a contents list far down the file is not at the top", () => {
  const body = "# A\n\n" + Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n") + "\n\n## Contents\n\n" + Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n") + "\n";
  const fs = check({ ".claude/skills/x/SKILL.md": skill("name: x\ndescription: Does x.", "See [a](A.md).\n"), ".claude/skills/x/A.md": body });
  assertFinding(fs, "skill-reference-no-contents");
});
