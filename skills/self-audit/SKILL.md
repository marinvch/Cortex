---
name: self-audit
description: Use when the user says "self audit", "audit the vault structure", "find orphan/old/redundant files", "clean up cortex", "fix dead links", "is the file structure healthy", "make cortex optimal", or wants an architecture / file-structure health pass. Scans the WHOLE vault for non-connected, stale, duplicate, misplaced files and broken links — then fixes them. Structural, not content-scoring (that's /audit).
---

# /self-audit — vault architecture & file-structure doctor

Keep Cortex **structurally clean and optimal**. This is the file-architecture health pass: scan
*every* file and find what's dragging the vault down — **orphan (non-connected) files, dead links,
stale/old files, redundant duplicates, misplaced files, and structural bugs** — then fix them.

> Distinct from siblings: `/audit` scores the four **knowledge** layers (content health); `/reindex`
> regenerates the visual navigator + nominates MOCs. `/self-audit` is the **structure/architecture**
> doctor — it finds and fixes the underlying file problems those rely on.

## What to scan for (report each finding with the exact file path)

1. **Orphans / non-connected files** — notes with **no inbound and no outbound `[[wikilinks]]`**,
   unreachable from `home.md`/MOCs (e.g. a registered project stub like `projects/ai-saas.md`).
   These float disconnected in the graph and are invisible to link-navigation.
2. **Dead links** — `[[links]]` pointing at notes that don't exist (broken references).
3. **Stale / old** — files untouched for a long time that look abandoned: lingering `inbox/` items,
   `projects/` marked done/dropped, far-past `daily/` notes, superseded drafts.
4. **Redundant / duplicate** — multiple files covering the same topic, duplicate stubs, near-identical
   notes that should be one canonical note.
5. **Misplaced / malformed** — a permanent note stuck in `inbox/`, a project without proper
   frontmatter, wrong PARA bucket (`projects` vs `areas` vs `resources`), inconsistent naming.
6. **Integrity bugs** — a **committed** file containing personal/business data (privacy-firewall
   leak), a skill not wired into `AGENTS.md`/README/`.claude/skills`, `.cortexignore` violations.

## What to do

1. **Gather signal (read-only first).** Run `bash tools/cortex.sh` — it reports node/link counts and
   **dead-link count**. Glob the vault; check file mtimes for staleness; grep for `[[wikilinks]]` to
   build the in/out link map and find orphans; scan frontmatter and folder placement.
2. **Produce a prioritized findings list** grouped by the six categories above, each with the exact
   path and a one-line "why it hurts."
3. **Fix the safe/clear ones** (with a quick confirm): resolve dead links; wire orphans in (add
   `[[links]]` from `home.md`/a MOC/related notes) or **archive** truly-dead ones (`move` to
   `archives/`, never delete); move misplaced files to the right folder.
4. **Propose the judgment calls** (redundant merges, "is this stale or just quiet?") — don't guess;
   let the user decide, then execute.
5. **Re-run `tools/cortex.sh`** to confirm the graph improved (fewer orphans, `0 dead`), and report:
   the findings by category, what you fixed, and what's left for the user to decide.

## Don't
- **Never delete** — move to `archives/` (things resurface). Deletion is the user's call only.
- Don't touch personal *content* quality — that's `/audit` and `/weekly-review`. Stay on structure.
- Read first; make changes only with a green light. Keep committed files data-free.

Pairs with [[reindex]] (regenerate the graph after cleanup) and [[skill-creator]]; complements
`/audit` (content health) and `/weekly-review` (inbox/stale processing).
