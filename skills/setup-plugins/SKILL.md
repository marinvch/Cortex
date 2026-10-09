---
name: setup-plugins
description: Install the Cortex Core plugin bundle, and offer the optional tiers by role. Triggers — "set up plugins", "install the core plugins", "give this machine the Cortex toolset".
effort: low
metadata:
  capability: mechanical
---

# /setup-plugins — provision the Cortex plugin bundle

## What to do
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

## Then

Installing is not staying current: an update to the marketplace does not move the installed plugin,
so a machine can sit for weeks running a version nobody meant to run. `/plugin-sync` is that check,
and it is the first thing to suspect when a skill edit appears to have no effect.

Plugins give this machine the tools; they do not give it recall. `/connect-brain` registers
`mcp/server.js` so capture and recall actually work, and is the step people skip after a clean
plugin install — the commands are all there and nothing remembers anything. Inside a repo,
`/cortex-next` names what that repo is waiting on.

## Don't
- Don't auto-install the heavy/platform tiers — offer them by role.
- Don't fail hard if the CLI is missing; the command degrades to printing commands.
