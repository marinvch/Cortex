---
name: level-up
description: Biweekly Cortex growth ritual — mine recent session behavior, re-interview what changed, surface queued ambient-capture candidates for confirmation, sanitized promotion of project learnings into brain/, evolve AGENTS.md.
---

# /level-up — grow your OS

Cortex gets richer the more it's used. This is the recurring re-interview. Respect the
data boundary: project-derived learnings reach `brain/` ONLY via sanitized promotion.

## Steps
0. **Reflect on recent sessions (fallback miner):** the `SessionEnd` hook
   (`.claude/hooks/reflect-session.mjs`) already auto-mines each finished session into
   `brain/candidates.jsonl` and stamps the watermark. This step is the **fallback** for sessions
   the hook missed (e.g. Node absent): it mines only transcripts newer than the watermark, ONLY
   queues candidates, and never writes `context/*` or `brain/memory.jsonl`. Storage stays gated by
   Step 2. If the watermark is current and no newer transcripts exist, print "queue is current —
   skipping fallback mine" and go to Step 1.
   - **Locate transcripts:** Claude Code stores this repo's session logs under
     `~/.claude/projects/<repo-dir>/` where `<repo-dir>` is this repo's absolute path with the
     drive colon and every path separator replaced by `-` (e.g. `D:\Projects\Personal\ai-os` →
     `D--Projects-Personal-ai-os`). Match **top-level `*.jsonl` only** — never recurse into the
     `memory/` subdirectory. If the directory does not exist, print "no transcripts — skipping
     reflection" and go to Step 1.
   - **Watermark:** read `brain/.last-reflect` (an ISO date; gitignored under `brain/`). Mine only
     transcripts whose mtime is newer than it. If the file is missing/unreadable, fall back to
     transcripts modified in the last ~14 days (bounds a first run).
   - **Extract, token-bounded:** use targeted `Grep` over the new transcripts — do NOT full-read
     megabytes of JSONL. Look for recurring signal: corrections/preferences ("no, actually…",
     "don't…", "I prefer…", "always…", "never…"), repeated task shapes (the same command/sequence
     across sessions), and repeat manual fixes (things you had to be told more than once). Cap how
     many transcripts/matches you pull per run.
   - **Queue each distinct pattern** via the `suggest_profile_update` MCP tool: `domain: 'personal'`
     for workflow/preference/how-I-work signal; `domain: 'project'` for anything repo/company
     specific (this sets `needsSanitization` and routes it through Step 3's gate). When unsure,
     choose `'project'`. If the MCP server isn't running, print the would-be candidates for manual
     capture and **skip the watermark stamp** so nothing is lost.
   - **Stamp** `brain/.last-reflect` with today's date once candidates are queued. These candidates
     flow into Step 2 alongside any ambient-capture queue.
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
4. **Optional compaction:** offer `npx cortex --compact-memory --cwd projects/<name>` (gated).
5. **Evolve `AGENTS.md`:** if structure/operating conventions changed, update the canonical
   `AGENTS.md` — but keep it DATA-FREE. Personal facts stay in `context/*`.
6. **Capture decisions:** append any decisions made to `decisions/log.md`.

## Boundary reminder
`project → personal` only, sanitized. Never `project → shared`. Never `personal → project`.
