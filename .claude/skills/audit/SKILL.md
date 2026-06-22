---
name: audit
description: Weekly read-only Cortex health report — personal-layer freshness, boundary audit, per-project drift/freshness when the engine is present, memory hygiene. Never auto-fixes.
---

# /audit — read-only health report

Produce a health report. **Never auto-fix** — auditability requires that you only report.

## Steps
1. **Personal-layer freshness** — check the mtime/date stamp of `context/current-focus.md`.
   If older than 14 days, flag: "current-focus is N days old — consider `/level-up`."
   Note any missing `context/*` file.
2. **Boundary audit (gated):** run `node --version`. If present, for each project run
   `npx cortex --check-boundaries --cwd projects/<name>` and report any leaks (non-`project`
   memory entries, missing `.gitignore` rules). If Node is absent, print the skipped command.
3. **Per-project drift/freshness (gated):** when the engine is present, for each project run
   `npx cortex --check-freshness --json --cwd projects/<name>` and `npx cortex --check-drift
   --cwd projects/<name>`. Summarize status (fresh / drifted / stale).
4. **Memory hygiene:** report `brain/memory.jsonl` entry count and stale-entry count if the
   file exists; suggest `--compact-memory` (do not run it).
5. **Decision-log nudge:** if `decisions/log.md` hasn't been touched in 30+ days, nudge.

## Output
A single tidy report with sections for each step. End with a prioritized "what to update
next" list. Report leaks loudly; never modify anything.
