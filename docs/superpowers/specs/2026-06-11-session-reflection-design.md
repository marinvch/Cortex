# Design: Session Reflection — mine session behavior into the candidate queue

**Date:** 2026-06-11
**Status:** Draft for review
**Branch:** `feat/personal-brain-extension`
**Origin:** Evaluating Microsoft's **SkillOpt-Sleep** Claude Code plugin for adoption into Cortex.

---

## Context

SkillOpt-Sleep gives a local agent a "sleep cycle": offline, it replays past sessions and
consolidates what it learns into `CLAUDE.md` / `SKILL.md`. Evaluated against Cortex, it was
**rejected as a dependency** — it duplicates `/level-up` and, fatally, writes session-derived
facts straight into the *committed* `CLAUDE.md` shim, violating the NON-NEGOTIABLE data boundary
(`shared` = ZERO real data) with no sanitization gate.

But it surfaced one genuine gap. Cortex learns from **interviews** (`/level-up` asks "what
changed?") and from **conscious in-session capture** (the `suggest_profile_update` MCP tool, when
the agent remembers to call it). It does **not** learn from **session behavior** — the recurring
corrections, repeated task shapes, and repeat manual fixes that you'd never think to mention in an
interview. That is SkillOpt's one good idea, and this design transplants it **Cortex-native**:
boundary-intact, no third-party plugin, no auto-editing of committed files.

## Goal

Add an offline **session-reflection** step that reads this repo's Claude Code transcripts, mines
recurring behavioral patterns, and queues them as candidates into `brain/candidates.jsonl` — the
existing append-only queue — so the existing `/level-up` confirm/sanitize gate handles the rest.

## Non-goals

- No engine/TypeScript change, no MCP tool change, no build/rebundle (v1 is a skill-prompt change).
- No new write path. The only write to candidate state remains the append-only
  `suggest_profile_update` tool. Nothing writes `context/*` or `brain/memory.jsonl` directly.
- No new ritual/command. Rituals stay at three (`onboard` / `audit` / `level-up`).
- No cross-project sweep in v1 (scoped to this repo's transcripts — see Decisions).

## The data boundary (unchanged, and why this is safe)

`project → personal` ONLY, sanitized, via `promote_to_brain`. This design introduces **zero** new
boundary surface:

- Reflection only ever **suggests**, via the append-only `suggest_profile_update` tool. It cannot
  write `context/*` or `brain/memory.jsonl`. (Enforced in `engine/src/mcp-server/candidates.ts`.)
- Observations derived from repo/project work are tagged `domain: 'project'`, which sets
  `needsSanitization: true` and forces them through the sanitized `promote_to_brain` gate at
  Step 3 — identical to existing ambient capture.
- Reflection is a **read** of transcripts plus **append** to the queue. Same guarantee the OS
  already relies on: ambient capture can *suggest*, never *store*.

## Architecture

One new step at the front of the existing `/level-up` ritual. No new files beyond this spec and
the watermark; exactly one file is edited: `.claude/skills/level-up/SKILL.md`.

### Data flow

```
~/.claude/projects/<this-repo-hash>/*.jsonl        (Claude Code transcripts; NOT the memory/ subdir)
      │  glob top-level *.jsonl with mtime > brain/.last-reflect   ← watermark (gitignored)
      ▼
bounded extraction — targeted Grep over the new transcripts, NOT full-reading megabytes:
   • corrections / preferences   "no, actually…", "don't…", "I prefer…", "always…", "never…"
   • repeated task shapes         same command / sequence recurring across sessions
   • repeat manual fixes          edits the agent had to be told more than once
      ▼
for each DISTINCT pattern → suggest_profile_update(text, domain, trigger)
   │   domain='personal'  → workflow/preference/how-I-work signal
   │   domain='project'   → repo-specific (→ needsSanitization=true)
      ▼
brain/candidates.jsonl            (existing append-only queue)
      ▼
Step 2 (existing): surface each candidate → confirm / edit / reject
Step 3 (existing): project-domain candidates go through sanitized promote_to_brain
      ▼
stamp brain/.last-reflect = today   (next run mines only newer sessions)
```

### The watermark

- File: `brain/.last-reflect` (under the gitignored personal `brain/`), a single ISO date.
- Read at the start of Step 0; only transcripts with `mtime` newer than it are mined.
- Written at the **end** of Step 0, after candidates are queued (not after Step 2/3 — queueing is
  the unit of work reflection owns; confirmation is the user's).
- Missing/unreadable watermark → fall back to "sessions modified in the last ~14 days" so a first
  run is bounded rather than scanning all history.

### Token discipline

Transcripts are large JSONL. Step 0 MUST use targeted `Grep` for the signal patterns above rather
than `Read`-ing whole files, and cap how many transcripts/matches it pulls per run. The biweekly
cadence + watermark keep each run scoped to a handful of new sessions.

## Components

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `/level-up` Step 0 (new) | Glob new transcripts, Grep signals, queue candidates, stamp watermark | `suggest_profile_update` MCP tool; `brain/.last-reflect` |
| `suggest_profile_update` (existing) | Append-only write to `candidates.jsonl`; tag project-domain for sanitization | `brain/candidates.jsonl` |
| `/level-up` Steps 2–3 (existing) | Surface candidates; confirm/edit/reject; sanitized promotion | `promote_to_brain` |

Step 0 is understandable and testable in isolation: input = new transcripts + watermark; output =
appended candidates + updated watermark. It does not change Steps 1–6.

## Error handling / edge cases

- **Transcript dir absent** (different machine, fresh install): Step 0 prints "no transcripts found
  — skipping reflection" and continues to Step 1. Non-fatal.
- **MCP server / `suggest_profile_update` unavailable** (engine not running): print the would-be
  candidates inline for the user to capture manually; skip the watermark stamp so nothing is lost.
- **No new sessions since watermark:** print "nothing new to reflect on" and continue.
- **Boundary self-check:** if a candidate plausibly contains repo/company specifics, it MUST be
  queued `domain: 'project'` (never `'personal'`), deferring the decision to the sanitization gate.
- **`memory/` subdir:** the glob matches top-level `*.jsonl` only and never recurses into the
  `memory/` auto-memory directory.

## Testing / verification

This is a prompt change, not code — verification is a **dry run** of the new step against real
transcripts:

1. Run the Step 0 procedure manually against this repo's transcripts.
2. Confirm it appends sane candidates to `brain/candidates.jsonl` with correct `domain` tags.
3. Confirm it writes/updates `brain/.last-reflect` and that a second immediate run reports
   "nothing new."
4. Confirm it never wrote `context/*` or `brain/memory.jsonl` directly (only the queue moved).
5. Confirm `.gitignore` already covers `brain/` so `.last-reflect` and `candidates.jsonl` stay
   private (they live under the existing gitignored `brain/`).

## Decisions (locked)

- **Form factor:** fold into `/level-up` as Step 0. No 4th ritual. Matches the existing biweekly
  cadence and the promotion flow it feeds.
- **Implementation:** pure skill-prompt change. No engine code (YAGNI — extract a deterministic
  `ai-os --mine-sessions` parser only if v1 proves too noisy/token-heavy).
- **Scope:** v1 mines only **this repo's** transcripts. A cross-project sweep (richer "how I work"
  signal) is deferred — it would pull other repos' possibly-sensitive context into scope.
- **Watermark:** keep `brain/.last-reflect` to avoid re-proposing the same patterns each fortnight.

## Future (explicitly out of scope for v1)

- Deterministic engine helper (`ai-os --mine-sessions --json`) if inline extraction proves noisy.
- Cross-project "how I work" sweep across all `~/.claude/projects/*` transcripts.
- Mining other agents' traces (Copilot/Gemini/Codex session logs).
