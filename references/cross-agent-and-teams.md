---
type: reference
title: Cross-agent & teams — how Cortex works with Claude, Copilot, Gemini
updated: 2026-06-27
tags: [reference, teams, agents]
---

# Cross-agent & teams

Two questions answered: (1) how a brand-new user makes Cortex work on a project, and (2) how it
holds up when a team uses different AI agents (Claude, GitHub Copilot, Gemini, Cursor…).

## The core idea: one brain file, many readers

There's an emerging convention that every coding AI reads a project-instructions file. They use
different filenames, so Cortex keeps the **real content in `AGENTS.md`** and drops a tiny **shim**
for each tool that just says "read AGENTS.md":

| AI agent | File it reads | Cortex writes |
|---|---|---|
| Claude Code | `CLAUDE.md` | shim → `@AGENTS.md` |
| Gemini CLI | `GEMINI.md` | shim → "see AGENTS.md" |
| GitHub Copilot | `.github/copilot-instructions.md` | shim → "see AGENTS.md" |
| Cursor | `.cursor/rules/*.mdc` | shim → "read AGENTS.md" |
| Codex / Amp / Aider / Jules | `AGENTS.md` (native) | nothing — they read it directly |

One source of truth, no copies to drift. `/install-project` generates all of these in one shot.

## New user — making it work on a project (zero prior knowledge)

1. **Get Cortex** — clone the vault; run `bash tools/cortex-sync-skills.sh` to expose the rituals.
2. **Open the project repo** and run **`/install-project`**. This is the "discover the architecture"
   step — it scans `package.json`, folders, configs, tests, and writes the project brain
   (`AGENTS.md` + agent shims + `/plan-feature` + `/investigate-bug` + `docs/decisions.md`).
3. **Work the cycle:** `/plan-feature` (plan first) → approve → implement → log decisions.
4. That's it. You didn't need to know the architecture up front — `/install-project` discovered it
   and wrote it down for you (and for every other agent).

### Which skills you actually need
- **Per repo:** `install-project` (once), then `plan-feature` + `investigate-bug` (it created them).
- **Personal vault:** `onboard` (once), `daily`, `capture`, `weekly-review`, `audit`, `level-up`.
- Everything else is optional. Don't add skills you won't run — see [[operating-principles]].

## Team — different people, different agents

This is the important part. Split it into two layers:

**Shared layer = the repo (committed to git).**
`AGENTS.md` + the shims live in the repo and get committed. So:
- You (Claude) run `/install-project` once and commit the result.
- Your colleague on **Copilot** pulls the repo → Copilot reads `.github/copilot-instructions.md` →
  same project knowledge.
- The third dev on **Gemini** pulls → Gemini reads `GEMINI.md` → same knowledge.
- Nobody re-discovers the architecture. One person writes the brain; everyone's agent reads it.

**Private layer = each person's vault (never committed).**
Your personal Cortex vault (`context/`, `notes/`, `daily/`…) is yours alone and gitignored. Your
colleagues don't have it and can't see it. Each teammate keeps their own private vault if they want
one. So personal knowledge never crosses people — only the project brain is shared, on purpose.

```
        SHARED (in the repo, committed)            PRIVATE (each person's machine)
   ┌─────────────────────────────────────┐     ┌──────────────┐ ┌──────────────┐
   │ AGENTS.md  (the project brain)       │     │ your vault   │ │ colleague's  │
   │ ├─ CLAUDE.md      → Claude  (you)    │     │ context/     │ │ (optional)   │
   │ ├─ copilot-instr. → Copilot (dev B)  │     │ notes/       │ │              │
   │ └─ GEMINI.md      → Gemini  (dev C)  │     └──────────────┘ └──────────────┘
   └─────────────────────────────────────┘        never shared unless copied by hand
```

### Keeping the shared brain healthy in a team
- **One source of truth.** Only `AGENTS.md` holds real content; shims just point to it.
- **Update it in pull requests.** When conventions or architecture change, edit `AGENTS.md` in the
  same PR — code review keeps it honest, like any other file.
- **Decisions go in `docs/decisions.md`** (committed) so the whole team sees why a call was made.
- **Skills are a bonus, not a requirement.** Claude users get `/plan-feature`; others just follow
  the same rules written in `AGENTS.md`. No one is blocked by their tool choice.

> Bottom line: agents differ, the brain doesn't. Project knowledge is shared through the repo and
> read by every tool; personal knowledge stays on each person's machine and never crosses.
