---
name: install-project
description: Install a "codebase brain" into a specific repo so the AI knows ONLY that codebase and supports its dev cycle. Use when the user says "install cortex on this project", "give this repo a brain", "set up the project brain", or opens a work repo and wants AI help scoped to it. Plain files — no engine, no Node. Self-contained: works on any machine.
---

# /install-project — give one repo its own brain

Scaffolds a per-codebase brain **inside the target repo**. The AI then knows that one codebase and
helps run its development cycle (plan → implement → review). Fully isolated: this never reads or
writes the personal vault, and the personal vault never absorbs this repo's company code/data.

## Boundary (important)
- Write ONLY inside the target repo. Never copy company code, secrets, or client data into the
  personal Cortex Vault (`context/`, `notes/`, …).
- If a durable, **non-sensitive** lesson is worth keeping personally, tell the user — they add it
  to the vault by hand. No automatic promotion.

## Step 1 — Point at the repo
Confirm the target repo path (default: the current working directory). Everything below is written
relative to that root.

## Step 1.5 — Check for an OLD engine first (don't lose its memory)
Before scanning, look for a pre-existing engine-based AI OS: `.ai-os/`, `.github/ai-os/`
(especially `.github/ai-os/memory/`), `.github/agents/`, `.github/COPILOT_CONTEXT.md`, or an
`ai-os` entry in `.mcp.json` / `.vscode/mcp.json`. If any exist:
- **Stop and tell the user** this repo has the old engine, whose memory store holds hand-verified
  knowledge that a plain `/install-project` would not capture.
- **Offer to run `/migrate-engine` first** — it harvests that memory into `AGENTS.md`, logs the
  change, backs everything up, then removes the old files. Only continue once the user decides.
- If the user declines, proceed but warn that engine knowledge won't be carried over.

If no engine is present, continue normally.

## Step 2 — Learn the codebase (read-only scan)
Read, don't guess:
- `package.json` (deps + `scripts`), lockfile → framework, package manager, run/test/build commands.
- Top-level folders + entry points → architecture and key directories.
- `README`, `tsconfig`, `.eslintrc`/`prettier`, CI files → conventions and tooling.
- Test setup (jest/vitest/playwright) → how tests run.
- For a React app: routing, state mgmt, component structure, styling approach, API layer.
Summarize what you found back to the user in 5-8 lines and ask them to correct anything.

## Step 3 — Stamp the brain (write into the repo)
Back up any existing `AGENTS.md`/`CLAUDE.md` to `*.bak` first. Then write:

### a) `AGENTS.md` — the project manual (canonical)
Fill from the scan + the user's corrections:
```markdown
# <Project> — Project Brain (codebase-scoped)

## What this is
<one paragraph: what the app does, who uses it>

## Stack & tooling
- Framework: <e.g. React 18 + Vite> · Pkg mgr: <npm/pnpm/yarn> · Language: <TS/JS>
- Styling / state / data: <…>

## Run it
- install: `<cmd>` · dev: `<cmd>` · test: `<cmd>` · build: `<cmd>` · lint: `<cmd>`

## Architecture (key directories)
- `src/...` — <what lives where>  (only the dirs that matter)

## Conventions
- <naming, file structure, component patterns, import rules — pulled from lint config + observed code>
- Standard to hold: clear, maintainable, scalable code.

## Development cycle (the hard rule)
1. **Plan before implementing.** No code until there's a written plan (use `/plan-feature`).
2. Break the plan into small, reviewable steps.
3. Implement step by step; run tests/lint after each.
4. Self-review against the conventions above before opening a PR.

## Gotchas / tribal knowledge
- <quirks, flaky areas, build traps — grows over time>

## Glossary
- <domain terms specific to this codebase>
```

### b) Cross-agent shims — so EVERY teammate's AI reads the same brain
`AGENTS.md` is the one source of truth. Each AI tool reads a different filename, so write a tiny
shim for each that points back to it. This is what makes a mixed-tool team work (one dev on Claude,
one on Copilot, one on Gemini — all read the same project knowledge).

- `CLAUDE.md` (Claude Code) →
  ```markdown
  @AGENTS.md
  ```
- `GEMINI.md` (Gemini CLI) →
  ```markdown
  See AGENTS.md for all project context, architecture, and conventions.
  ```
- `.github/copilot-instructions.md` (GitHub Copilot) →
  ```markdown
  All project context and conventions live in AGENTS.md at the repo root. Follow it.
  ```
- `.cursor/rules/project.mdc` (Cursor) →
  ```markdown
  ---
  alwaysApply: true
  ---
  Read AGENTS.md at the repo root for architecture, conventions, and the dev cycle.
  ```
> Codex, Amp, Aider, Jules and most newer agents read `AGENTS.md` natively — no shim needed.
> Keep the real content in `AGENTS.md` only; shims must never hold their own copy (it drifts).

### c) `.claude/skills/plan-feature/SKILL.md` — dev-cycle ritual
```markdown
---
name: plan-feature
description: Write an implementation plan for a feature/ticket in THIS repo before any code. Use when a feature or ticket is assigned. Enforces plan-before-implementing.
---
# /plan-feature
Read AGENTS.md for stack + conventions. Then produce a plan ONLY (no code):
1. Restate the requirement + acceptance criteria. Ask for missing criteria.
2. List the files/components this touches (search the repo to confirm).
3. Design: data flow, state, UI states (loading/empty/error), edge cases.
4. Break into small ordered steps, each independently testable.
5. Call out risks + a test plan.
End by asking the user to approve the plan before implementation starts.
```

### d) `.claude/skills/investigate-bug/SKILL.md` — dev-cycle ritual
```markdown
---
name: investigate-bug
description: Systematically investigate a bug in THIS repo. Use when given a bug report or failing behavior. Find root cause before proposing a fix.
---
# /investigate-bug
1. Reproduce: restate expected vs actual; find where the behavior is triggered in the code.
2. Trace: follow the data/render path; form a root-cause hypothesis (don't patch symptoms).
3. Confirm the root cause with evidence (code refs, a failing test if possible).
4. Propose the smallest correct fix + how to verify it. Plan before editing (the hard rule).
```

### e) `docs/decisions.md` — ADR-style log (create if absent)
```markdown
# Decision Log — <Project>
Append-only. Newest on top. Why a technical call was made, so it isn't re-litigated.
```

## Step 4 — Gitignore note
The brain files (`AGENTS.md`, `.claude/`, `docs/decisions.md`) are usually fine to commit so the
team shares them. If this should stay private, tell the user to add them to the repo's `.gitignore`.

## Step 5 — Close
Confirm what was written and tell the user: *"Open this repo in Claude Code / Cowork and run
`/plan-feature` when the ticket lands."* Suggest growing `## Gotchas` as they learn the codebase.

## Cross-agent note
- **Knowledge is cross-agent:** `AGENTS.md` + the shims mean Claude, Copilot, Gemini, Cursor, etc.
  all read the same project brain. Commit them so the whole team benefits.
- **Skills are mostly Claude-specific:** the `/plan-feature` and `/investigate-bug` slash commands
  only fire in Claude Code. That's fine — the *same dev-cycle rules* are written in `AGENTS.md`'s
  "Development cycle" section, so Copilot/Gemini users follow plan-before-implementing too, just
  without the slash command. Put the rules in `AGENTS.md`; treat skills as a Claude convenience.

## Rules
- Idempotent — re-run to refresh after the codebase changes; back up before overwriting.
- Scan before writing. Never invent stack details — read them from the repo.
- One repo = one brain. Don't merge knowledge across repos.
