# The Cortex Framework: Alive · Bounded · Sovereign

Cortex is a personal AI OS. Three properties define it.

## Alive — the OS maintains itself
When a codebase is present, the Cortex engine re-scans your code, refreshes context,
reconciles memory, and flags drift. Cortex is not a static folder of notes; the rituals
call the engine to keep it current. Backed by: `rememberRepoFact()`, memory compaction,
freshness snapshots, `--check-drift`, `--compact-memory`.

## Bounded — nothing crosses a boundary without your consent
Cortex enforces a three-domain data model:

| Domain   | What lives there                              | Movement rule |
|----------|-----------------------------------------------|---------------|
| shared   | structure, framework, skills — ZERO real data | the only thing published |
| personal | your brain: your context + memory             | private, gitignored |
| project  | company/client data, encapsulated in its repo | never absorbed upward |

A fact can move in exactly ONE direction — `project → personal` — and only via an
explicit, audited, sanitized promotion. Never `project → shared`. Never `personal → project`.

## Sovereign — you own the whole stack
Plain files. MIT. Forkable. No cloud lock-in. Your hardware, your data.

See `quick-reference.md` for the cheat sheet and `getting-started.md` for first steps.
