// core/claude-code.js — what Anthropic's Claude Code docs say, as data Cortex can check against.
// The `model.*` rules come from the platform docs instead: how the model itself behaves, which is
// what a direct Messages API caller or an unattended runner has to assume.
//
// Every rule carries the page it came from, the sentence on that page that states it — copied, not
// paraphrased — and the date someone last confirmed the sentence was still there. Nothing here
// fetches anything: users get these rules with the plugin, the same on every machine and offline.
// Keeping them true is the maintainer's job, and `tools/cortex-claude-docs.mjs --check` is how —
// it fails when a rule's evidence has left its page. ADR 0017 holds the reasoning.
//
// Pure data and two lookups. It lives in core/ because both leaves (index/'s findings, and the
// tools/ that check Cortex's own files) consume it, and core/ is the one place both may import.
//
// Adding a rule: fetch the page (`<source>.md` serves the markdown), copy the sentence that states
// the rule into `evidence` exactly as the page has it — link text without the URL is fine — and run
// the check. If no sentence states it, the rule does not belong here: an unsourced rule is an
// opinion, and the point of this file is that none of it is.

/** The date every rule below was last confirmed against its page. */
export const CHECKED = "2026-09-26";

const SKILLS = "https://code.claude.com/docs/en/skills";
const SUBAGENTS = "https://code.claude.com/docs/en/sub-agents";
const MCP = "https://code.claude.com/docs/en/mcp";
const HOOKS = "https://code.claude.com/docs/en/hooks";
const MEMORY = "https://code.claude.com/docs/en/memory";
const BEST = "https://code.claude.com/docs/en/best-practices";
const OPUS_5_5 =
  "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5";

/**
 * `table: "frontmatter"` marks a rule whose value is a key list read from the page's frontmatter
 * reference table — the check confirms every listed key is still a row there, and reports rows it
 * does not know as new (informational: a new key breaks nothing, it is just unused).
 */
export const RULES = Object.freeze([
  // --- skills ------------------------------------------------------------------------------------
  {
    id: "skill.frontmatter.keys",
    value: [
      "name", "description", "when_to_use", "argument-hint", "arguments",
      "disable-model-invocation", "user-invocable", "allowed-tools", "disallowed-tools", "model",
      "effort", "context", "agent", "background", "hooks", "paths", "shell", "metadata", "license",
      "compatibility",
    ],
    table: "frontmatter",
    source: SKILLS,
    evidence:
      "A field name must match the table exactly, hyphens included: Claude Code ignores a field it doesn't recognize without reporting an error.",
  },
  {
    id: "skill.metadata.custom-keys",
    value: "metadata",
    source: SKILLS,
    evidence:
      "Free-form YAML map for your own key-value data, such as entitlement or catalog fields, read by your own tooling from `SKILL.md`.",
  },
  {
    id: "skill.description.max-chars",
    value: 1536,
    source: SKILLS,
    evidence:
      "Put the key use case first: the combined `description` and `when_to_use` text is truncated at 1,536 characters in the skill listing to reduce context usage.",
  },
  {
    id: "skill.body.max-lines",
    value: 500,
    source: SKILLS,
    evidence: "Keep `SKILL.md` under 500 lines. Move detailed reference material to separate files.",
  },
  {
    id: "skill.disable-model-invocation",
    value: true,
    source: SKILLS,
    evidence:
      "Set to `true` to prevent Claude from automatically loading this skill. Use for workflows you want to trigger manually with `/name`.",
  },

  // --- subagents ---------------------------------------------------------------------------------
  {
    id: "subagent.frontmatter.keys",
    value: [
      "name", "description", "tools", "disallowedTools", "model", "permissionMode", "maxTurns",
      "skills", "mcpServers", "hooks", "memory", "background", "omitClaudeMd", "effort",
      "isolation", "color", "initialPrompt", "experimental",
    ],
    table: "frontmatter",
    source: SUBAGENTS,
    evidence:
      "Multi-word field names use camelCase, such as `maxTurns` and `disallowedTools`, and must match the table exactly: Claude Code ignores a field it doesn't recognize without reporting an error.",
  },
  {
    id: "subagent.frontmatter.required",
    value: ["name", "description"],
    source: SUBAGENTS,
    evidence: "Only `name` and `description` are required.",
  },
  {
    id: "subagent.plugin.ignored-keys",
    value: ["hooks", "mcpServers", "permissionMode"],
    source: SUBAGENTS,
    evidence:
      "For security reasons, plugin subagents don't support the `hooks`, `mcpServers`, or `permissionMode` frontmatter fields. These fields are ignored when loading agents from a plugin.",
  },
  {
    id: "subagent.name.no-colon",
    value: ":",
    source: SUBAGENTS,
    evidence:
      "Names can't contain `:`, which is reserved for plugin-scoped identifiers such as `my-plugin:reviewer`.",
  },
  {
    id: "subagent.descriptions.max-tokens",
    value: 15000,
    source: SUBAGENTS,
    evidence:
      "When the combined descriptions of your subagents, except the built-in ones, exceed 15,000 tokens, Claude Code shows a warning at startup with the total token count.",
  },

  // --- MCP ---------------------------------------------------------------------------------------
  {
    id: "mcp.output.warn-tokens",
    value: 10000,
    source: MCP,
    evidence: "Claude Code displays a warning when any MCP tool output exceeds 10,000 tokens",
  },
  {
    id: "mcp.output.max-tokens",
    value: 25000,
    source: MCP,
    evidence: "the default maximum is 25,000 tokens",
  },
  {
    id: "mcp.output.max-result-chars",
    value: 500000,
    source: MCP,
    evidence:
      "Claude Code raises that tool's threshold to the annotated value, up to a hard ceiling of 500,000 characters.",
  },

  // --- hooks -------------------------------------------------------------------------------------
  {
    id: "hook.exit.blocking-code",
    value: 2,
    source: HOOKS,
    evidence: "For most hook events, exit code 2 is the only exit code that blocks through the code alone.",
  },
  {
    id: "hook.exit.one-does-not-block",
    value: 1,
    source: HOOKS,
    evidence:
      "Without valid JSON on stdout, Claude Code treats exit code 1 as a non-blocking error and proceeds with the action, even though 1 is the conventional Unix failure code.",
  },
  {
    id: "hook.post-tool-use.cannot-block",
    value: "PostToolUse",
    source: HOOKS,
    evidence: "| `PostToolUse`         | No         | Shows stderr to Claude; the tool already ran |",
  },
  {
    id: "hook.timeout.default-seconds",
    value: { command: 600, prompt: 30, agent: 60 },
    source: HOOKS,
    evidence: "Defaults: 600 for `command`, `http`, and `mcp_tool`; 30 for `prompt`; 60 for `agent`.",
  },

  // --- CLAUDE.md ---------------------------------------------------------------------------------
  {
    id: "claude-md.max-lines",
    value: 200,
    source: MEMORY,
    evidence:
      "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence.",
  },
  {
    id: "claude-md.imports",
    value: "@path/to/import",
    source: MEMORY,
    evidence: "CLAUDE.md files can import additional files using `@path/to/import` syntax.",
  },
  {
    id: "claude-md.broad-only",
    value: true,
    source: BEST,
    evidence: "CLAUDE.md is loaded every session, so only include things that apply broadly.",
  },
  {
    id: "claude-md.prune-test",
    value: "Would removing this cause Claude to make mistakes?",
    source: BEST,
    evidence:
      "Keep it concise. For each line, ask: *\"Would removing this cause Claude to make mistakes?\"* If not, cut it.",
  },
  {
    id: "claude-md.emphasis-one-line",
    value: "IMPORTANT",
    source: BEST,
    evidence:
      "If Claude keeps skipping one instruction, add emphasis such as \"IMPORTANT\" to that line alone. If you emphasize many lines, none of them stands out.",
  },

  // --- the model: what a direct Messages API caller and an unattended runner must assume ----------
  {
    id: "model.effort.default-medium",
    value: "medium",
    source: OPUS_5_5,
    evidence:
      "Start at `medium`, the default on Claude Opus 5.5 (Claude Opus 5 defaults to `high`), set it explicitly, and test several levels against your own evals rather than carrying over the setting you used on Claude Opus 5.",
  },
  {
    id: "model.thinking.counts-toward-max-tokens",
    value: true,
    source: OPUS_5_5,
    evidence:
      "Thinking counts toward `max_tokens` even when thinking content isn't returned to you, so a limit sized for Claude Opus 5 with thinking off can cut replies off.",
  },
  {
    id: "model.response.read-by-block-type",
    value: "text",
    source: OPUS_5_5,
    evidence:
      "Check each block's type instead of assuming the first content block is text: a response may or may not begin with a `thinking` block, whose `thinking` field is empty under the default `display: \"omitted\"`.",
  },
  {
    id: "model.response.refusal-stop-reason",
    value: "refusal",
    source: OPUS_5_5,
    evidence:
      "A classifier decline arrives as a normal response with `stop_reason: \"refusal\"` and a `stop_details` object naming the category.",
  },
  {
    id: "model.thinking.cannot-disable",
    value: "thinking: {\"type\": \"disabled\"}",
    source: OPUS_5_5,
    evidence:
      "Claude Opus 5 accepts `thinking: {\"type\": \"disabled\"}` at `high` effort or below; Claude Opus 5.5 doesn't, and the migration guide covers the request change.",
  },
  {
    id: "model.prompt.no-reasoning-in-response",
    value: "reasoning_extraction",
    source: OPUS_5_5,
    evidence:
      "Requests that push the model to reproduce its internal reasoning in the response text can be declined with the `reasoning_extraction` category, which is new if you're coming from Claude Opus 5.",
  },
  {
    id: "model.agentic.end-turn-is-a-report",
    value: "end_turn",
    source: OPUS_5_5,
    evidence: "Treat a text-only end of turn as a report rather than as proof the task is done.",
  },
  {
    id: "model.agentic.continuation-cap",
    value: 3,
    source: OPUS_5_5,
    evidence:
      "Either way, stop after two or three automatic continuations on the same task rather than repeating them indefinitely, so that a run that is genuinely stuck ends and can be reviewed.",
  },
].map((r) => Object.freeze({ ...r, checked: CHECKED })));

/** One rule by id. Throws on an unknown id, so a typo in a consumer fails loudly, not as `undefined`. */
export function rule(id) {
  const found = RULES.find((r) => r.id === id);
  if (!found) throw new Error(`core/claude-code.js has no rule "${id}"`);
  return found;
}

/** A rule's value — the number, key list or string a check compares against. */
export function limit(id) {
  return rule(id).value;
}
