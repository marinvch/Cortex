---
name: connect-brain
description: Set up this machine for Cortex — install the plugin bundle, and connect the live MCP brain so recall and capture work in every project. Per machine, user scope.
effort: low
disable-model-invocation: true
metadata:
  capability: mechanical
---

# /connect-brain — set this machine up

Two jobs a machine needs once, and they are independent: the **plugin bundle** needs no vault, and
the **brain** needs one. Do the half that was asked for, and offer the other in one line.
`/setup-plugins` was a separate ritual until 2.42.0; someone who types that name wants the first half.

## The plugin bundle

1. Run this — it installs the Core tier (superpowers, skill-creator, claude-md-management, claude-code-setup, feature-dev, code-review, code-simplifier, context7):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/mcp/ai-os.js" setup-plugins --tier core --scope user
   ```
   `${CLAUDE_PLUGIN_ROOT}` is the installed plugin; from a clone of the Cortex repo, use that
   clone's path instead. No vault and no `CORTEX_ROOT` are needed — this reads only the bundle
   manifest shipped with Cortex.
2. Read what this machine already has: `node "${CLAUDE_PLUGIN_ROOT}/mcp/ai-os.js" setup-plugins --status --json`.
   It reads Claude Code's plugin registry and installs nothing. Each tier's `state` is `installed`,
   `partial`, `missing` or `unknown`, and each plugin carries `installed`.
3. Then ask the user their role / stack and OFFER the optional tiers whose `state` is not
   `installed` (do not auto-install). For a `partial` tier, name the plugins it still lacks. When
   every tier that fits is `installed`, say so in one line and offer none. `unknown` means there
   was no registry to read: offer by role, as on a machine with nothing installed.
   - Frontend/QA → `--tier browser-qa` (playwright, chrome-devtools-mcp; heavy: downloads browsers).
   - TS repos / lots of PRs → `--tier dev-tools` (typescript-lsp, github).
   - Deploys to Vercel/Cloudflare → `--tier platform`.
4. If the `claude` CLI is unavailable, the command prints the exact commands instead of failing — relay them for guided setup.
5. Confirm which tiers were installed in one line.

Installing is not staying current: an update to the marketplace does not move the installed plugin,
so a machine can sit for weeks running a version nobody meant to run. `/plugin-sync` is that check,
and it is the first thing to suspect when a skill edit appears to have no effect.

- Don't auto-install the heavy or platform tiers — offer them by role.
- Don't fail hard if the CLI is missing; the command degrades to printing commands.

## The brain

Plugins give this machine the tools; they do not give it recall. This half is the step people skip
after a clean plugin install — the commands are all there and nothing remembers anything.

Register the Cortex MCP server at **user scope** so every project on this machine can `recall`/`capture`.

### What to do
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

### Don't
- Don't register at project scope (defeats the "zero setup per project" goal).
- Don't touch the current project's git or files.

Inside a repo, `/cortex-next` names what that repo is waiting on.
