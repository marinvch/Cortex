---
name: audit
description: Weekly read-only health report for the Cortex Vault. Scores the four layers (Capture, Knowledge, Context, Cadence) out of 25 each and lists the top gaps to close. Never edits anything except an optional saved report. Trigger on "audit my vault", "is my brain healthy", "score my setup".
---

# /audit — four-layer health report

Read-only. Score the vault against [[vault-architecture]]. **Never modify files** except the
optional saved report at the end. Be honest, not generous — most real setups land 40-70.

## Step 1 — Read the shape
Glob/Read (frontmatter + counts, don't deep-read everything):
- `context/*` — which exist, and `current-focus.md`'s date.
- `notes/*` — count; how many have `[[links]]`; any MOCs (`type: moc`).
- `inbox/*` — count (a backlog is a capture-processing gap, not a capture failure).
- `daily/*` — recent entries; gap since last one.
- `projects/*`, `areas/*`, `resources/*` — counts.
- `connections.md` — how many domains are actually connected vs `not connected`.
- `decisions/log.md` — last entry date.
- `skills/*` (and `.claude/skills/*`) — what rituals exist.

## Step 2 — Score each layer (25 each)

**Capture (25)** — `/capture` exists (5); `daily/` used in last 7 days (10); inbox flows, i.e.
not 50 items deep and untouched (10).

**Knowledge (25)** — ≥5 notes (5); >50% of notes have ≥1 link (10); ≥1 MOC (5); PARA folders
have real content (5).

**Context (25)** — all `context/*` filled, not placeholders (10); `current-focus.md` < 14 days
old (5); voice captured (5); ≥1 decision logged (5).

**Cadence (25)** — a recurring ritual runs (`/daily`/`/weekly-review` used recently) (10);
activity in last 7 days (10); templates populated (5).

## Step 3 — Top 3 gaps by leverage
For each lost-points criterion, weight by impact: empty `context/` ×3 (brain is blind to the
user), no capture habit ×3 (raw material never arrives), 0 links ×2 (pile not graph), no cadence
×2 (no autonomy). Sort, take top 3, give each one concrete next step (a command or a file to write).

## Step 4 — Print the report
```
# Vault Audit — {date}    Score: {total}/100  ({stage})
  0-39 Foundation · 40-69 Built · 70-89 Compounding · 90-100 Autonomous

Capture      {bar} {n}/25
Knowledge    {bar} {n}/25
Context      {bar} {n}/25
Cadence      {bar} {n}/25

Strengths: …
Top 3 gaps (ranked):
 1. … → next step
 2. … → next step
 3. … → next step
Suggested next: {single most leveraged action}
```
(`bar` = one `#` per 5 pts.)

## Step 5
Offer to save to `archives/audits/audit-{date}.md` so the score can be tracked over time. That's
the only write. To explore what the vault could *do* that it can't yet, point them to `/level-up`.
