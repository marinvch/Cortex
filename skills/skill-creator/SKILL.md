---
name: skill-creator
description: Use when the user asks to create, add, or scaffold a new Cortex skill or ritual, wants a repeated task turned into a /slash command, or says "make a skill for X", "add a ritual", "turn this into a skill", "give me a command for this". Authors a tailored skill by asking first.
---

# /skill-creator — create a tailored Cortex skill

Turn a repeated need into a reusable **ritual**: a plain `skills/<name>/SKILL.md` that any AI
agent can discover and run as a `/slash` command. A skill captures a *reusable technique*, not a
one-off — if it's a single task, just do it; if you'd reach for it again, make a skill.

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
4. **Wire it in** so it's discoverable and runnable:
   - Add a one-line bullet to the rituals list in `AGENTS.md` (match the existing style).
   - Add a row to the "## The rituals (skills)" table in `README.md`.
   - Expose it as a slash command: `cp skills/<name>/SKILL.md .claude/skills/<name>/SKILL.md`
     (create the dir first).
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
(github.com/anthropics/skills) and `superpowers:writing-skills`. Pairs with [[self-audit]] — which
uses this skill to ship improvements to the operating system itself.
