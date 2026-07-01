---
name: setup-plugins
description: Install the Cortex Core plugin bundle out-of-the-box, and offer the optional tiers by role. Use when the user says "set up plugins", "install the core plugins", "give this machine the Cortex toolset", or after connecting the brain. Core is default; Browser/QA, Dev-tools, Platform are opt-in.
---

# /setup-plugins — provision the Cortex plugin bundle

## What to do
1. Run `node <vault>/mcp/ai-os.js setup-plugins --tier core --scope user` — installs the Core tier (superpowers, skill-creator, claude-md-management, claude-code-setup, feature-dev, code-review, code-simplifier, context7).
2. Then ask the user their role / stack and OFFER optional tiers (do not auto-install):
   - Frontend/QA → `--tier browser-qa` (playwright, chrome-devtools-mcp; heavy: downloads browsers).
   - TS repos / lots of PRs → `--tier dev-tools` (typescript-lsp, github).
   - Deploys to Vercel/Cloudflare → `--tier platform`.
3. If the `claude` CLI is unavailable, the command prints the exact commands instead of failing — relay them for guided setup.
4. Confirm which tiers were installed in one line.

## Don't
- Don't auto-install the heavy/platform tiers — offer them by role.
- Don't fail hard if the CLI is missing; the command degrades to printing commands.
