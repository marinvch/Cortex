# Getting Started with Cortex

1. **Clone** this repo and open it in Claude Code.
2. **Run `/onboard`** — it interviews you and seeds `context/*`. No Node required for the
   personal layer; engine steps are skipped gracefully if Node is absent.
3. **Work day-to-day.** Cortex passively notices candidate facts and queues them.
4. **Run `/audit` weekly** — a read-only health and boundary report.
5. **Run `/level-up` biweekly** — confirm queued candidates, promote durable learnings.

If you have code projects, point Cortex at them under `projects/` (or keep them as external
repos). When Node + a codebase are present, the engine lights up: `npx cortex --init` inside a
project wires its `.github/cortex/` context.

Your personal data (`context/`, `brain/`, `decisions/`, `projects/`) is gitignored and never
published. Only the shared template (structure, framework, skills) is.

## When the engine lights up

With Node ≥ 20 and a codebase present, the Cortex engine runs and Cortex becomes **Alive**.
The rituals call it for you, but you can run it directly too:

- `npx cortex --check-boundaries --cwd projects/<name>` — read-only cross-domain leak report
  (non-`project` memory entries, missing personal-layer `.gitignore` rules).
- `npx cortex --check-freshness --json` / `--check-drift` — is the project context stale?
- `--personal-brain-path <dir>` — point promotion at your brain root (otherwise `CORTEX_PERSONAL_ROOT`).

A fact crosses from a project into your brain ONLY via the sanitized, audited `promote_to_brain`
gate (surfaced during `/level-up`) — never `project → shared`, never `personal → project`.

Full engine flags: `engine/README.md` and `engine/docs/cli.md`. The boundary model:
`references/alive-os-framework.md`.
