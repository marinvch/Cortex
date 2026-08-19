---
name: daily
description: Start today's daily note and surface what matters this morning — priorities, what's due, what's still open from yesterday. Trigger on "daily", "start my day", "good morning", "what's on today", "open today's note", or as a morning ritual.
capability: mechanical
---

# /daily — open the day

One note per day, `daily/YYYY-MM-DD.md`. Fast: create it, brief the user, stop. This is a
launchpad, not a review — that's `/weekly-review`'s job.

## Step 1 — Create today's note (idempotent)
If `daily/<today>.md` already exists, **open it, never overwrite it** — jump to Step 2.

Otherwise create it from `templates/daily.md`, replacing `{{date}}` with today's date
(`YYYY-MM-DD`). Create `daily/` if it doesn't exist yet.

## Step 2 — Gather the brief (read-only)
- `context/current-focus.md` — what this week is supposed to be about.
- `context/priorities.md` — the standing priorities, if present.
- `projects/*.md` — any `- [ ]` under `## Next actions`, plus any `due:` / `deadline:` that is
  today, overdue, or inside the next 3 days.
- **Yesterday's note** (the most recent `daily/*.md` before today): unchecked `- [ ]` items and
  anything under `## 💡 Captured` that never got processed.

## Step 3 — Propose the Top 3
Fill `## 🎯 Top 3 today` with a *proposal*, drawn from focus + due items + yesterday's leftovers.
Show it and ask the user to confirm or swap. Never invent work that isn't in the vault — if there
is nothing to draw on, leave the boxes empty and say so.

Carry forward yesterday's unchecked items only if the user wants them; a stale checkbox copied
forward every morning is noise, not a plan.

## Step 4 — Brief and stop
Reply with, at most:
- today's Top 3,
- anything **due or overdue** (say which project),
- one line on unprocessed captures (`N items still in the inbox` — suggest `/weekly-review` if it
  is over ~10, or if the last review was more than a week ago).

Then stop. Don't reorganize, don't rewrite notes, don't create projects.

## Don't
- Don't overwrite an existing daily note — ever. Captures live there.
- Don't process the inbox here (that's `/weekly-review`).
- Don't touch `context/` — `/daily` reads it, `/weekly-review` restamps it.
