---
name: skill-creator
description: Use when the user asks to create, add, or scaffold a new Cortex skill or ritual, wants a repeated task turned into a /slash command, or says "make a skill for X", "add a ritual", "turn this into a skill", "give me a command for this". Authors a tailored skill by asking first.
---

# /skill-creator — create a tailored Cortex skill

Turn a repeated need into a reusable **ritual**: a plain `skills/<name>/SKILL.md` that any AI
agent can discover and run as a `/slash` command. A skill captures a *reusable technique*, not a
one-off — if it's a single task, just do it; if you'd reach for it again, make a skill.

This scaffolds the skill; `/writing-for-agents` is how to *write* it well — and its
`SKILL-MECHANICS.md` decides the one choice this ritual cannot make for you: model-invoked (the
description stays loaded every turn, and other skills can reach it) versus user-invoked
(`disable-model-invocation: true`, zero context load, only a human can fire it).

## What to do

1. **Capture intent.** In one line, state what the skill should let the user do and *when* they'd
   reach for it. If that's genuinely unclear, ask **one or two** questions — no more. Speed matters.
2. **Name it.** Verb-first kebab-case describing the action: `weekly-review`, `scope-area`,
   `catch-me-up` — not `review_helper`. Letters, numbers, hyphens only.
3. **Write `skills/<name>/SKILL.md`** with frontmatter + a concise body:
   - `name:` the kebab name.
   - `description:` **triggering conditions only** — start with "Use when…" and list the phrases /
     situations that should fire it. **Never summarize the workflow in the description** (agents
     will follow the description and skip the body). Keep it data-free (this file is committed).
   - Body: a short **## What to do** (numbered steps), a **## Don't** guardrail list, and *one*
     concrete example if it clarifies. Aim under ~500 words. Link related skills as `[[name]]`.
   - **Follow [[context-engineering]]** when shaping the body — Rules 1–3 especially: principles
     over enumeration, long material in `templates/`, don't restate what the code already says.
4. **Wire it in** so it's discoverable and runnable:
   - Add a row to the ritual **table** in `AGENTS.md` (`| /name | when | does |`). If the skill has a
     non-obvious gotcha — an ordering constraint, or an overlap with a sibling ritual — add it to the
     "Gotchas worth knowing" list below that table instead of padding the row.
   - Add a row to the "## The rituals (skills)" table in `README.md`.
   - Expose it as a slash command: `cp -r skills/<name>/ .claude/skills/<name>/` (`-r` so any
     `templates/` directory comes along).
5. **Verify.** Read it back with fresh eyes: does the description trigger on the right phrases? Are
   the steps followable by an agent with zero context? For a rigorous or discipline-enforcing skill,
   test it — **REQUIRED BACKGROUND for that: `superpowers:writing-skills`** (baseline → write → close
   loopholes). Confirm in one line what you created and how to run it.

## Don't
- Don't write a narrative ("how I solved it once") — write the reusable technique.
- Don't summarize the process in the `description:` — it belongs in the body.
- Don't put personal/business facts in the committed skill (privacy firewall).
- Don't build heavy tooling here — Cortex skills are plain files. Need eval/benchmark rigor? Use the
  `skill-creator` **plugin** (shipped in the Core bundle) or `superpowers:writing-skills`.

## Credits
Adapted for Cortex's plain-files convention from Anthropic's `skill-creator`
(github.com/anthropics/skills) and `superpowers:writing-skills`. Pairs with [[cortex-doctor]], which
keeps the vault's file structure healthy, and [[optimize-context]], which audits agent context
files in other repos against the same rules this skill follows when writing new ones.
