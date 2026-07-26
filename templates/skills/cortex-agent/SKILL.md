---
name: cortex-agent
description: Create a subagent for THIS repo. Use when the user wants a specialist that runs in its own context — a reviewer, an explorer, an auditor — or says "make an agent for X".
---

# /cortex-agent — author a repo-scoped subagent

## When an agent is the right answer
Use an agent when the work needs an **isolated context**: a broad read-only sweep, an adversarial
review, or a long search whose intermediate output should not pollute the main conversation.
If the work is a procedure the main agent should follow inline, write a skill instead (`/cortex-skill`).

## Before writing
1. Read `AGENTS.md` for stack and conventions.
2. List `.claude/agents/`. Do not duplicate an existing agent.
3. Ask what the agent should be handed, and what it should return.

## Write it
Create `.claude/agents/<kebab-name>.md`:

```
---
name: <kebab-name>
description: <when the main agent should dispatch this>
tools: Read, Glob, Grep
---

<system prompt: the agent's single responsibility, what it must read first,
what it must NOT do, and the exact shape of the report it returns>
```

Rules:
- Grant the narrowest `tools` list that works. A read-only agent must not get `Write` or `Edit`.
- State the return format explicitly — the caller only sees the final message.
- Give it one job. Agents with two jobs do neither well.

## Register it
Append to `## Project skills` in `AGENTS.md`:

`- \`<kebab-name>\` (agent) — <one-line purpose> (created <YYYY-MM-DD>)`

## Close
Tell the user to commit it so the team shares the agent.
