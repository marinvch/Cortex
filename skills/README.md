---
type: system
title: Skills (Rituals)
tags: [system, skills]
---

# 🔁 Skills — the vault's rituals

Each subfolder is a ritual the AI can run. They are plain `SKILL.md` files with YAML frontmatter
(`name`, `description`) — no engine, no Node.

| Skill | When | Does |
|---|---|---|
| `onboard` | Once | Interviews you, fills `context/`, seeds `home.md` + `connections.md` |
| `capture` | Anytime | One-line drop to `inbox/` or today's daily note |
| `daily` | Each morning | Opens today's note, surfaces priorities + due items |
| `weekly-review` | Weekly | Empties inbox, updates projects, restamps focus, archives stale |
| `audit` | Weekly | Four-layer health score + top gaps |
| `level-up` | Biweekly | Find one piece of leverage, ship one artifact |
| `install-project` | Per repo | Stamps a codebase brain into a specific project (scoped to that repo) |

> **Two kinds of brain.** This vault is your *personal* brain (knows you, cross-project).
> `install-project` creates a *codebase* brain inside a specific repo (knows only that codebase
> and runs its dev cycle). They stay isolated — company code never enters the personal vault.

## Activating them as slash commands (optional)

In Cowork or Claude Code you can just say *"run my onboard skill"* and the agent will read the
file here and follow it. To register them as real `/slash` commands in this checkout:

```
bash tools/cortex-sync-skills.sh            # sync
bash tools/cortex-sync-skills.sh --check    # report drift, change nothing
```

**This folder is canonical.** `.claude/skills/` is a gitignored, machine-local mirror, so nothing
keeps it current: a plain `cp -r` never refreshes a changed skill and never removes a deleted one.
It had drifted to 22 of 30 skills with 9 local copies stale — five v2.0 rituals were simply
missing. The script replaces each skill wholesale and **reports mirror-only skills without
deleting them**, since a directory that exists only there has no git history to recover from.

An **installed plugin loads `skills/` directly** and needs no mirror at all.
