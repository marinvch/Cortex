---
name: connect-brain
description: Connect this machine to the live Cortex MCP brain, so recall and capture work in every project. One-time, user scope.
effort: low
disable-model-invocation: true
metadata:
  capability: mechanical
---

# /connect-brain — one-line live brain

Register the Cortex MCP server at **user scope** so every project on this machine can `recall`/`capture`.

## What to do
1. Ask for the vault's absolute path → `CORTEX_ROOT`. The vault is its own private repo, not this
   one and not the plugin. The server is `${CLAUDE_PLUGIN_ROOT}/mcp/server.js` — it ships with the
   plugin, not the vault. From a clone of the Cortex repo rather than the plugin, use that clone's
   path.
2. There is nothing to install — the server has no dependencies. Node 20+ is the only requirement.
3. Check what is already registered: `claude mcp list`. A server named `ai-os` whose command ends in
   `mcp/server.js` is this same brain, registered before the name changed. It keeps working as it
   is: `AI_OS_ROOT`, the variable it carries, is still read. Say so and stop, unless the user wants
   the new name. To move, remove it first (`claude mcp get ai-os` prints the remove command for its
   scope), then register as below. Never leave both: two servers over one vault show every tool
   twice.
4. Print (and offer to run) the registration for the user's agent. A registration stores a literal
   path, so expand `${CLAUDE_PLUGIN_ROOT}` to its absolute value before printing:

   **Claude Code:**
   ```bash
   claude mcp add --scope user cortex --env CORTEX_ROOT=<vault> -- node "${CLAUDE_PLUGIN_ROOT}/mcp/server.js"
   ```

   **Cursor / other MCP agents:** add to the agent's `mcpServers` config:
   ```json
   { "cortex": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.js"], "env": { "CORTEX_ROOT": "<vault>" } } }
   ```

   The tools then appear as `mcp__cortex__recall`, `mcp__cortex__capture` and so on.

   The plugin's path carries its version (`…/plugins/cache/cortex/cortex/<version>/`), so a plugin
   update can leave the registration pointing at a folder that is gone. Say so, and tell the user to
   re-run `/connect-brain` after updating — or register a Cortex clone's path, which does not move.
5. Confirm in one line: *"Brain connected (user scope). recall/capture available in every project."*

## Don't
- Don't register at project scope (defeats the "zero setup per project" goal).
- Don't touch the current project's git or files.
