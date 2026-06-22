# Cortex — Operating Manual (canonical, cross-tool)

This is the single source of truth for AI agents working in this personal AI operating system.
Claude Code reads `CLAUDE.md` (a shim importing this file); Gemini reads `GEMINI.md`
(same). Codex / Copilot / Cursor / Windsurf / Amp / Devin read this file natively.

## What this repo is
Cortex: a personal AI operating system. The repo root is the shareable userland; `engine/` is the
Cortex kernel (an npm package) that lights up when a codebase + Node are present.

## The three pillars
Alive (self-maintaining via the engine) · Bounded (three-domain data model) ·
Sovereign (you own the stack). Full text: `references/alive-os-framework.md`.

## The data boundary — NON-NEGOTIABLE
- `shared` = committed template files + `engine/src/templates/` — ZERO real data.
- `personal` = `context/`, `brain/`, `decisions/` — gitignored, private.
- `project` = anything under a project's `.github/cortex/` — encapsulated in that repo.
- A fact moves ONLY `project → personal`, ONLY via the sanitized `promote_to_brain` gate.
- NEVER write project/company data into `shared` or into `context/`/`brain/` directly.

## Personal context (gitignored; created by /onboard)
When present, read these for who the user is and how they work:
`context/about-me.md`, `context/how-i-work.md`, `context/values.md`, `context/current-focus.md`.
If they do not exist yet, the OS has not been onboarded — suggest running `/onboard`.

## The rituals (Claude Code skills)
- `/onboard` (once) — seed identity, init `brain/`, optionally init code projects.
- `/audit` (weekly) — read-only health + boundary report.
- `/level-up` (biweekly) — re-interview, sanitized promotion, evolve this manual.

## Engine integration (only when Node + code present)
Rituals call `npx cortex <flags> --cwd <project>`: `--init`, `--check-freshness --json`,
`--check-drift`, `--compact-memory`, `--check-boundaries`, `--refresh-existing`.
Every engine call is gated by a `node --version` check; if Node is absent, skip and print
the manual command. Engine docs: `engine/README.md`, `engine/docs/`.

## Style
Plain files. No build for the personal layer. Match existing file conventions. Keep the
shared template data-free.
