---
name: cortex-mcp
description: Scaffold an MCP server for THIS repo. Use when the user wants to expose project data or actions as agent tools — "give the agent access to our API", "make an MCP server for X".
---

# /cortex-mcp — scaffold a repo-scoped MCP server

## Decide first
An MCP server is a running process with dependencies. Before scaffolding one, check whether a
**skill** would do — if the answer is "read these files and follow these steps," it would.
Reach for MCP only when the agent needs a live capability: querying a database, calling an internal
service, or reading state that is not in the repo.

Tell the user this trade-off explicitly and get agreement before writing anything.

## Before writing
1. Read `AGENTS.md` for the stack.
2. Ask which tools the server exposes, what each takes, and what each returns.

## Write it
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

## Register it
Append to `## Project skills` in `AGENTS.md`:

`- \`<name>\` (mcp) — <one-line purpose> (created <YYYY-MM-DD>)`

## Close
Tell the user which env vars they must set and that teammates need them too.
