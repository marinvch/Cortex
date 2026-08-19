---
name: catch-me-up
description: Summarize what changed on a project since you were last active. Use when the user says "catch me up", "what did I miss", "what changed while I was away", "summarize recent activity on <project>". Assembles brain notes + git history, then you write the summary.
capability: judgment
---

# /catch-me-up — what changed since <since>

## What to do
1. Determine the project slug and a `since` date (last sync / when the user was last active).
2. Get the raw material: call the MCP `catch_me_up(project, since[, team])` tool, or run
   `node <vault>/mcp/ai-os.js catch-up --project <slug> --since <date> [--team <name>]`.
3. From the returned notes + commits, write a concise "what changed & why", grouped by theme.
4. Only summarize the returned material — do not invent changes.

## Don't
- Don't fabricate changes that aren't in the returned notes/commits.
