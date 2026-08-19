---
name: team-add
description: Team member — join the shared team-brain from inside a product repo. Use when a dev says "connect this repo to the team brain", "add me to the team context", "join the team brain". Clones the team-brain locally and drops a generic connector into the product repo.
capability: mechanical
---

# /team-add — join the team-brain (member), run inside a product repo

## What to do
1. From the product repo root, run `node <vault>/mcp/ai-os.js team add --name <team> --repo <team-brain-git-url> --slug <this-project-slug>`.
2. It clones the team-brain under your local vault and writes a generic `.cortex/connector.json` (slug + team-brain URL only — safe to commit).
3. Offer to commit the connector so teammates inherit the wiring: `git add .cortex/connector.json && git commit -m "chore: add cortex team connector"`.

## Don't
- NEVER auto-commit to the product repo — always leave that to the user.
- The connector must stay generic (no personal/machine paths). Local state (AI_OS_ROOT, clone path) lives in user config only.
