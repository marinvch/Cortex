# Claude Code — the official rules Cortex checks against

Cortex writes and ships Claude Code configuration: skills, subagents, hooks, `CLAUDE.md`, an MCP
server. What counts as correct there is decided by Anthropic's documentation, not by Cortex.

**The rules live in [`core/claude-code.js`](../core/claude-code.js)** — one entry per rule, each with
the official page it came from, the sentence on that page that states it, and the date it was last
confirmed. That file is the source of truth; this page does not repeat its values, so it cannot
disagree with them. Checkers import it and never hard-code a limit.

What it covers today: skill and subagent frontmatter keys, the skill description cap and body
length, which subagent fields a plugin cannot use, MCP output limits, hook exit codes and timeouts,
and `CLAUDE.md` size and content guidance.

## Keeping it current

```bash
node tools/cortex-claude-docs.mjs --check   # exit 1: a rule's sentence left its page · 2: a page could not be read
node tools/cortex-claude-docs.mjs --json
```

A weekly workflow runs the same check and opens a `docs-drift` issue when it fails. Users never
fetch the docs — they get updated rules with a plugin update. Why it works this way, and what was
rejected: [ADR 0017](../docs/adr/0017-anthropic-docs-are-the-authoring-source.md).

## Adding a rule

1. Find the sentence on an official page that states it. The docs serve markdown at `<url>.md`.
2. Add an entry to `core/claude-code.js`: `id`, `value`, `source`, and `evidence` — the sentence as
   the page has it (link text without its URL is fine).
3. Run the check. It must pass before the rule is used.

If no sentence states the rule, it is an opinion, and it does not belong in that file.

## Sources

- Skills — https://code.claude.com/docs/en/skills
- Subagents — https://code.claude.com/docs/en/sub-agents
- Hooks — https://code.claude.com/docs/en/hooks
- MCP — https://code.claude.com/docs/en/mcp
- Memory and `CLAUDE.md` — https://code.claude.com/docs/en/memory
- Best practices — https://code.claude.com/docs/en/best-practices
- Prompting Claude Opus 5.5 (the `model.*` rules: effort, thinking and `max_tokens`, reading a
  response by block type, unattended runs) —
  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5
- The full index — https://code.claude.com/docs/llms.txt
