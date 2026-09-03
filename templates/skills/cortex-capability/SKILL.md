---
name: cortex-capability
description: Author a capability for THIS repo — a skill, a subagent, a hook, or an MCP server. Use when the user says "make a skill for X", "turn this into a command", "add a ritual", "make an agent for X", "every time X do Y", "before/after Y", "stop me from Z", "give the agent access to our API", or when a task keeps repeating and deserves a repeatable procedure.
---

# /cortex-capability — author a capability scoped to this repo

## Step 1 — pick the shape

Four shapes. Ask which one the user wants unless the request already makes it obvious, and say why
you picked it if you inferred it — the wrong shape is the most expensive mistake here.

| Shape | Choose it when |
|---|---|
| **Skill** | The work is a procedure the main agent should follow inline. Most requests are this. |
| **Subagent** | The work needs an *isolated context*: a broad read-only sweep, an adversarial review, a long search whose intermediate output should not pollute the main conversation. |
| **Hook** | Something must happen *automatically* on an event — "every time X", "before/after Y", "stop me from Z". |
| **MCP server** | The agent needs a *live* capability: querying a database, calling an internal service, reading state that is not in the repo. |

If the answer is "read these files and follow these steps," it is a skill. Not an agent, and
definitely not an MCP server.

## Step 2 — before writing anything

1. Read `AGENTS.md` for this project's stack, conventions and dev cycle.
2. Read the `## Project skills` section of `AGENTS.md` and list `.claude/skills/` and
   `.claude/agents/`. **If something already covers this, say so and stop** — improve the existing
   one instead of adding a near-duplicate.
3. Ask the user what triggers it and what a good result looks like. One question at a time.

Then follow the matching section below.

---

## A — Skill

Create `.claude/skills/<kebab-name>/SKILL.md`:

```
---
name: <kebab-name>
description: <when to use this, in trigger language the model will match on>
---

# /<kebab-name>

<numbered steps, each one concrete action, grounded in THIS repo's real paths and commands>
```

Rules:
- The `name` must match the directory name exactly.
- The `description` is the only thing a model sees when deciding to invoke it — write triggers, not a summary.
- Reference real files and real commands from this repo. Never invent paths.
- Keep it short. A skill that is not read is not a skill.

Registry line: `` - `/<kebab-name>` — <one-line purpose> (created <YYYY-MM-DD>) ``

---

## B — Subagent

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

Before writing, ask what the agent should be handed and what it should return.

Rules:
- Grant the narrowest `tools` list that works. A read-only agent must not get `Write` or `Edit`.
- State the return format explicitly — the caller only sees the final message.
- Give it one job. Agents with two jobs do neither well.

Registry line: `` - `<kebab-name>` (agent) — <one-line purpose> (created <YYYY-MM-DD>) ``

---

## C — Hook

First read `.claude/settings.json` if it exists. **Never overwrite it — merge.**

Confirm which event is wanted, and whether failure should block:
- `PreToolUse` — inspect or block a tool call before it runs
- `PostToolUse` — react after a tool call succeeds
- `UserPromptSubmit` — inspect or rewrite an incoming prompt
- `SessionEnd` — harvest at the end of a session (Cortex already registers one here)

Create `.claude/hooks/<kebab-name>.mjs`:

```
#!/usr/bin/env node
import { readFileSync } from 'node:fs';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { payload = {}; }

// <the check>

// exit 0 to allow; exit 2 with a message on stderr to block
process.exit(0);
```

Rules:
- Read the payload from stdin as JSON. Never assume it parses — wrap it.
- Exit 0 on success. A hook that throws on unexpected input breaks every session.
- Keep it fast. It runs on every matching event.
- No network calls.

Then merge into `.claude/settings.json` — read the file, add one entry, write it back:

```
{ "hooks": { "<Event>": [ { "hooks": [ { "type": "command",
    "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/<kebab-name>.mjs\"" } ] } ] } }
```

Registry line: `` - `<kebab-name>` (hook, <Event>) — <one-line purpose> (created <YYYY-MM-DD>) ``

Warn the user that hooks run automatically for everyone who clones the repo, and to commit deliberately.

---

## D — MCP server

**Decide first.** An MCP server is a running process with dependencies. Before scaffolding one,
check whether a skill would do — if the answer is "read these files and follow these steps," it
would. Reach for MCP only when the agent needs a live capability.

Tell the user this trade-off explicitly and get agreement before writing anything.

Then ask which tools the server exposes, what each takes, and what each returns.

Create `.cortex/mcp/<name>/server.mjs` using the stdio JSON-RPC pattern, one handler per tool, and a
`package.json` beside it if it needs dependencies. Keep tool descriptions written for a model:
say when to use the tool, not just what it does.

Register in the repo's `.mcp.json` (create if absent, **merge** if present):

```
{ "mcpServers": { "<name>": { "command": "node", "args": [".cortex/mcp/<name>/server.mjs"] } } }
```

Rules:
- Validate every input. A tool that throws on bad input surfaces as an unusable tool.
- Never read outside the repo, and never return secrets or `.env` values.
- If the server needs credentials, read them from the environment and document which vars are required.

Registry line: `` - `<name>` (mcp) — <one-line purpose> (created <YYYY-MM-DD>) ``

Tell the user which env vars they must set and that teammates need them too.

---

## Step 3 — register it

Whatever you created, append its registry line to the `## Project skills` section of `AGENTS.md`.

That section sits **outside** the `cortex:generated` markers, so `npx cortex-init --refresh` will
never remove it.

## Step 4 — close

Tell the user what exists now and to commit it, so the whole team gets it.
