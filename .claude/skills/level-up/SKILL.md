---
name: level-up
description: Biweekly Cortex growth ritual — re-interview what changed, surface queued ambient-capture candidates for confirmation, sanitized promotion of project learnings into brain/, evolve AGENTS.md.
---

# /level-up — grow your OS

Cortex gets richer the more it's used. This is the recurring re-interview. Respect the
data boundary: project-derived learnings reach `brain/` ONLY via sanitized promotion.

## Steps
1. **What changed?** Re-interview briefly. Update the relevant `context/*` files. Re-stamp
   `context/current-focus.md` with today's date.
2. **Surface ambient-capture candidates:** if `brain/candidates.jsonl` exists, read each
   queued candidate (each tagged with source domain `personal`/`project` + trigger text).
   For each: show it, let the user **confirm / edit / reject**.
   - Confirmed `personal` candidates → write to `context/*` or `brain/` (via the normal
     memory path).
   - Confirmed `project`-domain candidates → MUST go through the sanitized promotion gate
     (Step 3). Never write project-derived text directly into `context/`/`brain/`.
   - Rejected candidates → drop from the queue.
   - Nothing is stored until the user confirms.
3. **Promotion interview (per project, gated):** for each code project, ask what durable,
   non-sensitive learning is worth promoting. For each approved item call the
   `promote_to_brain` MCP tool with `sanitized_confirmed: true` ONLY after the user confirms
   the secret-pattern warnings. The tool appends to `brain/memory.jsonl` and logs to
   `brain/memory-log.md`. If the engine/MCP server isn't running, print the skipped action.
4. **Optional compaction:** offer `npx ai-os --compact-memory --cwd projects/<name>` (gated).
5. **Evolve `AGENTS.md`:** if structure/operating conventions changed, update the canonical
   `AGENTS.md` — but keep it DATA-FREE. Personal facts stay in `context/*`.
6. **Capture decisions:** append any decisions made to `decisions/log.md`.

## Boundary reminder
`project → personal` only, sanitized. Never `project → shared`. Never `personal → project`.
