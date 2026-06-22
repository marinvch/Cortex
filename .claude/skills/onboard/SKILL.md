---
name: onboard
description: One-time Cortex onboarding — seeds your identity into context/, initializes brain/, and optionally lights up the engine for code projects. Use the first time you set up Cortex.
---

# /onboard — seed your personal AI OS

You are onboarding the user into Cortex. This is a **starting point**, not a one-time form —
`/level-up` will keep growing it. Be warm and brief. Write ONLY to the personal layer.

## Boundary rules (enforce strictly)
- Steps 1–5 write ONLY to `context/*` (personal). Never to `engine/` or any project.
- Project init (Step 7) writes ONLY inside that project's folder.
- Never commit `context/`, `brain/`, or `decisions/` — they are gitignored. Tell the user so.

## Steps
1. **Identity** — ask who they are (role, domain, experience). Write `context/about-me.md`.
2. **Working style** — how they like to work, tools, communication. Write `context/how-i-work.md`.
3. **Values** — what they optimize for, non-negotiables. Write `context/values.md`.
4. **Current focus** — what they're working on now (this file goes stale fast; `/audit`
   tracks its age). Write `context/current-focus.md`. Stamp today's date at the top.
5. **Confirm** the four files back to the user in one summary.
6. **Initialize `brain/`** — create `brain/` with empty `memory.jsonl`, a `memory-log.md`
   header, and `sessions/`. (These are gitignored.)
7. **Engine check + project init (gated):**
   - Run `node --version`. If it fails, print "Engine not available — skipping project
     setup. Install Node ≥20 and run `npx cortex --init --cwd projects/<name>` later." and
     continue.
   - If Node is present, for each code project the user names, optionally run
     `npx cortex --init --cwd projects/<name>` (writes only inside that project).
8. **Personalize `CLAUDE.md`** — leave the shim as `@AGENTS.md`; do NOT inline personal data
   into committed files. Confirm `context/*` exist so AGENTS.md's personal-context section resolves.

## Done
Tell the user: onboarding seeds the OS; `/audit` checks health weekly, `/level-up` grows it
biweekly. Remind them their personal files are gitignored and were not committed.
