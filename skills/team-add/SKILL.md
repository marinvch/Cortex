---
name: team-add
description: Team member — join the shared team-brain from inside a product repo. Use when a dev says "connect this repo to the team brain", "add me to the team context", "join the team brain". Clones the team-brain locally and drops a generic connector into the product repo.
capability: mechanical
---

# /team-add — join the team-brain (member), run inside a product repo

The member's half of `/team-init`. The leader created and seeded the shared repo; this wires one
product checkout to it. Run it once per product repo you work in, not once per machine.

## Before you start

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-preflight.mjs" .cortex/connector.json
```

Two answers you need from it. **`root`** must be the product repo, not the vault — this ritual
writes into a checkout and running it one directory off puts a connector somewhere no teammate will
look. **The connector must come back `COMMITTED`**, because that is the whole point: teammates
inherit the wiring by pulling it. If preflight says the path is ignored, the repo's `.gitignore`
covers `.cortex/` wholesale and step 3 will silently do nothing.

Note the inversion — everywhere else in Cortex a `COMMITTED` verdict on a preflight is a stop sign.
Here it is the requirement, and it holds only because the connector carries no local state.

## What to do

1. From the product repo root, with `AI_OS_ROOT` set to your vault, run
   `node "${CLAUDE_PLUGIN_ROOT}/mcp/ai-os.js" team add --name <team> --repo <team-brain-git-url> --project <this-project-slug>`.
   The script ships with the plugin; the vault is only where the clone goes. From a clone of the
   Cortex repo rather than the plugin, use that clone's path. `--name` is the team — the name in
   the team-brain's `team.md`, the same for every repo — and `--project` is this repo.
2. It clones the team-brain under your local vault and writes a generic `.cortex/connector.json`:
   `{ team, project, teamBrainRepo }` and nothing else. A connector already committed in the old
   `{ slug, teamBrainRepo }` shape still works — the startup line says it is the old shape — and
   running step 1 again rewrites it; commit that change.
3. Offer to commit the connector so teammates inherit the wiring:
   `git add .cortex/connector.json && git commit -m "chore: add cortex team connector"`.
4. Tell the user that `/catch-me-up` now works in this repo — it pulls the team-brain and returns
   what every repo of the team captured, alongside the local brain notes, and it is the reason
   joining was worth doing.

## Don't

- NEVER auto-commit to the product repo — always leave that to the user.
- The connector must stay generic (no personal/machine paths). Local state (AI_OS_ROOT, clone path)
  lives in user config only. This is what makes committing it safe, so it is not a style rule.
