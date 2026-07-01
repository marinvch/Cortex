---
name: team-init
description: Team leader — create and seed the shared team-brain repo. Use when a lead says "set up the team brain", "create the team context repo", "onboard my team to the shared brain". Creates one private team-brain repo, seeds per-project folders + team config, and pushes.
---

# /team-init — create the shared team-brain (leader)

## What to do
1. Ensure a private team-brain git repo exists (create it via `gh repo create <org>/<team>-brain --private` if the user hasn't) and get its URL.
2. Run `node <vault>/mcp/ai-os.js team init --name <team> --repo <git-url> --projects <slug1,slug2>`.
3. Confirm the team-brain was seeded and pushed. Share the repo URL + the `team add` step with members.

## Don't
- Don't put personal/machine paths anywhere — the team-brain holds only shared knowledge.
- Don't touch any product repo here.
