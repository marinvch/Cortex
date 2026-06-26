---
name: weekly-review
description: Weekly maintenance pass that keeps the vault from rotting. Empties the inbox, updates projects, restamps current-focus, and archives stale items. Trigger on "weekly review", "process my inbox", "clean up the vault", or as a Friday ritual.
---

# /weekly-review — keep the brain clean

A vault rots without this. Walk the user through it; act only on confirmation.

## Step 1 — Empty the inbox
For each item in `inbox/` (and `## 💡 Captured` in recent daily notes), route it to exactly one:
- **Trash** — delete.
- **Note** — durable insight → rewrite as an atomic note in `notes/` (from `templates/note.md`),
  linked to related notes. This is the high-value step.
- **Action** → into a `projects/` or `areas/` note as a `- [ ]`.
- **Resource** → file under `resources/`.
Goal: `inbox/` empty (or close) by the end.

## Step 2 — Update projects
For each file in `projects/`: still active? Update `## Next actions`. If done, set `status: done`
and move to `archives/`. If stalled with no next action, either define one or park it in `archives/`.

## Step 3 — Review areas
Skim `areas/*`: are you holding the standard you set? Note anything slipping.

## Step 4 — Restamp focus
Rewrite `context/current-focus.md` for the coming week (this week / blocked / parked). Stamp today.

## Step 5 — Capture decisions
Append any decisions made during review to `decisions/log.md`.

## Close
One-line summary: items processed, notes created, projects closed, focus updated. Suggest running
`/audit` if it's been a week, or `/level-up` if it's been two.
