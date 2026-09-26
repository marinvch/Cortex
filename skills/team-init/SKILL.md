---
name: team-init
description: For the team lead, once — create the shared private team-brain repo, seed its per-project folders and team config, and push it.
capability: mechanical
disable-model-invocation: true
---

# /team-init — create the shared team-brain (leader)

This is the leader's half of a two-command flow. `/team-add` is the member's half, and the flow is
only done when both have run — a seeded team-brain nobody has joined is a private repo with some
folders in it.

## Before you start

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-preflight.mjs"
```

A team-brain is pushed, so the profile line matters more here than anywhere else: `lab` seals
outward sync entirely and this ritual has nothing to do on it. On `home` or `work`, the profile also
tells you which world's material may land in the shared repo — see `/cortex-profile` if the answer
is not obvious for this machine.

## What to do

1. Ensure a private team-brain git repo exists (create it via `gh repo create <org>/<team>-brain --private`
   if the user hasn't) and get its URL.
2. With `AI_OS_ROOT` set to your vault — the seeded clone lives under it — run
   `node "${CLAUDE_PLUGIN_ROOT}/mcp/ai-os.js" team init --name <team> --repo <git-url> --projects <slug1,slug2>`.
   From a clone of the Cortex repo rather than the plugin, use that clone's path.
3. Confirm the team-brain was seeded and pushed.
4. **Hand off.** Give members the repo URL *and* the exact `/team-add` invocation they run inside
   each product repo — the command, not a description of it. A leader who shares only the URL leaves
   every member to rediscover the joining step, which is how a team-brain ends up with one
   contributor.

## Don't

- Don't put personal/machine paths anywhere — the team-brain holds only shared knowledge.
- Don't touch any product repo here. Wiring a product repo is `/team-add`'s job, run by the person
  who owns that checkout.

Once members have joined, `/catch-me-up` is what reads the team-brain's history back out. The
authoring standard for anything you seed into it is `/writing-for-agents`.
