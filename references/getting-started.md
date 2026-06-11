# Getting Started with Cortex

1. **Clone** this repo and open it in Claude Code.
2. **Run `/onboard`** — it interviews you and seeds `context/*`. No Node required for the
   personal layer; engine steps are skipped gracefully if Node is absent.
3. **Work day-to-day.** Cortex passively notices candidate facts and queues them.
4. **Run `/audit` weekly** — a read-only health and boundary report.
5. **Run `/level-up` biweekly** — confirm queued candidates, promote durable learnings.

If you have code projects, point Cortex at them under `projects/` (or keep them as external
repos). When Node + a codebase are present, the engine lights up: `npx ai-os --init` inside a
project wires its `.github/ai-os/` context.

Your personal data (`context/`, `brain/`, `decisions/`, `projects/`) is gitignored and never
published. Only the shared template (structure, framework, skills) is.
