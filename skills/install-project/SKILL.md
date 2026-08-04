---
name: install-project
description: Install a "codebase brain" into a specific repo so the AI knows ONLY that codebase and supports its dev cycle. Use when the user says "install cortex on this project", "give this repo a brain", "set up the project brain", or opens a work repo and wants AI help scoped to it. Plain files — no engine, no Node. Self-contained: works on any machine.
---

# /install-project — give one repo its own brain

Scaffolds a per-codebase brain **inside the target repo**, so the AI knows that one codebase and
helps run its development cycle (plan → implement → review).

Fully isolated in both directions: this never reads or writes the personal vault, and the vault
never absorbs the repo's company code or data. If a durable, **non-sensitive** lesson is worth
keeping personally, tell the user — they add it by hand. No automatic promotion.

## Step 1 — Point at the repo

Confirm the target repo path (default: cwd). Everything below is relative to that root.

## Step 2 — Check for an OLD engine first

Look for a pre-existing engine-based AI OS: `.ai-os/`, `.github/ai-os/` (especially its `memory/`),
`.github/agents/`, `.github/COPILOT_CONTEXT.md`, or an `ai-os` entry in `.mcp.json` /
`.vscode/mcp.json`.

If any exist, **stop.** That memory store holds hand-verified knowledge a plain `/install-project`
would silently discard. Tell the user, and offer `/migrate-engine` first — it harvests the memory
into `AGENTS.md` before removing anything. Continue only once they decide; if they decline, warn
that engine knowledge won't carry over.

## Step 3 — Learn the codebase (read-only)

Read, don't guess:
- `package.json` (deps + `scripts`) and the lockfile → framework, package manager, run/test/build
- top-level folders + entry points → architecture and the directories that actually matter
- `README`, `tsconfig`, lint/prettier config, CI files → conventions and tooling
- test setup (jest/vitest/playwright) → how tests run

Summarize the findings back in 5–8 lines and ask the user to correct anything before you write.

## Step 4 — Stamp the brain

Back up any existing `AGENTS.md`/`CLAUDE.md` to `*.bak` first. Then write, in order:

1. **`AGENTS.md`** — the canonical project manual. Fill `templates/AGENTS.md.template` from the
   scan plus the user's corrections. Never invent stack details. Follow [[context-engineering]]
   while writing it.
2. **Cross-agent shims** — see `templates/cross-agent-shims.md`. Every teammate's tool reads the
   same brain.
3. **Dev-cycle skills + decision log** — see `templates/dev-cycle-skills.md`.

## Step 5 — Offer scoped briefs for critical areas

From the scan, nominate the directories that are high-churn, security/data sensitive, or hold
invariants an agent could break (auth, billing/webhooks, the data layer, a pipeline). Present the
shortlist and **ask which deserve their own deep brief.** For each one picked, run
`/scope-area <dir>`.

Keep the root lean — overview plus a `## Area map` routing table; depth lives in the leaves. Only
areas with a real gotcha or invariant earn a leaf.

## Step 6 — Close

The brain files (`AGENTS.md`, `.claude/`, `docs/decisions.md`) are normally committed so the team
shares them; if this repo should keep them private, tell the user to gitignore them.

Confirm what was written, then: *"Open this repo in Claude Code and run `/plan-feature` when the
ticket lands."* Suggest growing `## Gotchas` as they learn the codebase.

## Rules

- Idempotent — re-run to refresh after the codebase changes; back up before overwriting.
- Scan before writing.
- One repo = one brain. Never merge knowledge across repos.
