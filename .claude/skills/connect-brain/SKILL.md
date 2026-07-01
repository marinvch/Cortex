---
name: connect-brain
description: Connect this machine to the live Cortex MCP brain in one step. Use when the user says "connect the brain", "wire up recall/capture", "set up the MCP server", or opens a new machine and wants recall/capture in every project. One-time, user-scope.
---

# /connect-brain — one-line live brain

Register the Cortex MCP server at **user scope** so every project on this machine can `recall`/`capture`.

## What to do
1. Resolve the vault path (this repo's root) → `AI_OS_ROOT`. Resolve the absolute path to `mcp/server.js`.
2. Ensure deps are installed: `cd <vault>/mcp && npm install` (once).
3. Print (and offer to run) the registration for the user's agent:

   **Claude Code:**
   ```bash
   claude mcp add --scope user ai-os --env AI_OS_ROOT=<vault> -- node <vault>/mcp/server.js
   ```

   **Cursor / other MCP agents:** add to the agent's `mcpServers` config:
   ```json
   { "ai-os": { "command": "node", "args": ["<vault>/mcp/server.js"], "env": { "AI_OS_ROOT": "<vault>" } } }
   ```
4. Confirm in one line: *"Brain connected (user scope). recall/capture available in every project."*

## Don't
- Don't register at project scope (defeats the "zero setup per project" goal).
- Don't touch the current project's git or files.
