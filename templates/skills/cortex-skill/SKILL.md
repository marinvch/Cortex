---
name: cortex-skill
description: Create a new skill scoped to THIS repo. Use when the user says "make a skill for X", "turn this into a command", "add a ritual", or when a task keeps repeating and deserves a repeatable procedure.
---

# /cortex-skill — author a repo-scoped skill

## Before writing anything
1. Read `AGENTS.md` for this project's stack, conventions and dev cycle.
2. Read `## Project skills` in `AGENTS.md` and list `.claude/skills/`. **If a skill already covers
   this, say so and stop** — improve the existing one instead of adding a near-duplicate.
3. Ask the user what triggers the skill and what a good result looks like. One question at a time.

## Write it
Create `.claude/skills/<kebab-name>/SKILL.md`:

```
---
name: <kebab-name>
description: <when to use this, in trigger language the model will match on>
---

# /<kebab-name>

<numbered steps, each one concrete action, grounded in THIS repo's real paths and commands>
```

Rules:
- The `name` must match the directory name exactly.
- The `description` is the only thing a model sees when deciding to invoke it — write triggers, not a summary.
- Reference real files and real commands from this repo. Never invent paths.
- Keep it short. A skill that is not read is not a skill.

## Register it
Append a line to the `## Project skills` section of `AGENTS.md`:

`- \`/<kebab-name>\` — <one-line purpose> (created <YYYY-MM-DD>)`

That section is outside the `cortex:generated` markers, so `cortex-init --refresh` will not remove it.

## Close
Tell the user the skill exists and to commit it, so the whole team gets it.
