# Cortex as a shippable framework — design

**Date:** 2026-08-12
**Status:** **partly superseded** by `2026-08-15-cortex-context-manager-design.md`, which shipped
in v2.0.0. Extends `2026-06-22-ai-agnostic-core-design.md`.
**Supersedes:** nothing.

> **What changed.** Decision 1 (one monorepo, two packages) and Decision 4's destination were
> replaced: Cortex ships as **one repo, one plugin**, and the personal vault moves to a **separate
> private repo** rather than a second package here. The seam, the phase loop and the gate model
> below still describe the intended direction and were not superseded — read this for the *why*,
> and the 2026-08-15 spec for what was actually built.

## Problem

Cortex today is one repo that is simultaneously a product and one person's vault
instance. Eight personal directories are gitignored, so a developer who clones it
gets skills describing folders that, for them, are empty. The workflow stops at
`/analyze-spec` — plan exists, execute/verify/ship do not. Nothing is enforced:
every "process" is prose a model can talk itself past.

The goal is a framework a developer at a company can install into a large work
repo and get value from on day one, without giving up the memory layer that makes
Cortex different from the alternatives.

## Prior art

Three reference projects were read (READMEs; plus `capabilities/tdd/capability.json`
and `capabilities/drift/capability.json` from gsd-core, and `writing-skills/SKILL.md`
from superpowers). Not every skill body in gstack nor every gsd capability was read.

They agree on five things:

1. **Context rot is the enemy, files are the cure.** Durable markdown artifacts —
   gsd's `STATE.md`/`CONTEXT.md`/`STRUCTURE.md`, gstack's design-doc-to-test-plan
   chain, superpowers' plan files — carry state, never the transcript.
2. **One fixed phase loop.** gstack: Think→Plan→Build→Review→Test→Ship→Reflect.
   gsd: Discuss→Plan→Execute→Verify→Ship. superpowers: Brainstorm→Spec→Plan→
   Implement→Review→Finish. The same pipeline three times.
3. **Gates, not suggestions.** gsd has literal `blocking: true` checks at
   `execute:wave:post`; superpowers has `verification-before-completion`; gstack
   has `/review`, `/qa`, `/cso`, `/canary`.
4. **The extension unit is markdown with frontmatter, discovered by description.**
   superpowers is explicit that a description must carry triggers only, never a
   workflow summary, or agents follow the description instead of the skill.
5. **Multi-runtime distribution.** All three install into Claude Code, Cursor,
   Codex, Copilot, opencode, Windsurf.

What each contributes here:

- **gsd-core** — the manifest model: named extension points, declarative prompt
  fragments, config flags, blocking/non-blocking gates, `onError: skip`.
- **superpowers** — authoring discipline: word budgets, triggers-only descriptions,
  RED/GREEN testing of skills themselves.
- **gstack** — role-based review and the ship tail (`/ship` → PR → deploy check).

What Cortex has that none of them do: a persistent memory layer, the employer
firewall, and a per-repo brain. They are workflow-first and memory-thin. This
design is the union.

## Decisions

| # | Decision | Rejected alternatives |
|---|---|---|
| 1 | One monorepo, two packages: `cortex-dev` + `cortex-brain` | per-repo framework only; personal-brain only |
| 2 | Markdown skills, enforcement by hook resolver | pure convention (no real gates); full gsd-style engine |
| 3 | v1 closes the whole loop, thin | verify-half only; plan-half only |
| 4 | The vault instance moves out of this repo | keep in place gitignored; fresh product repo |

Decision 2 is a deliberate, bounded exception to the "no engine, no build step"
rule in `AGENTS.md`. The *skills* stay inert markdown. Only enforcement is code,
it is roughly one script, and it is optional — absent it, the system degrades to
decision 2's rejected first alternative rather than breaking.

## Architecture

```
ai-os/                          pure product
  packages/
    cortex-dev/                 ships INTO a work repo
      skills/                   discuss · plan · execute · verify · ship
      hooks/cortex-gate.sh      the resolver
      templates/                AGENTS.md, SPEC.md, PLAN.md, STATE.md
    cortex-brain/               lives on the MACHINE
      skills/                   capture · daily · weekly-review · audit · reindex · …
      templates/                vault starters
      mcp/                      existing Node server (recall + capture)
  install.sh · install.ps1
  docs/  README.md  AGENTS.md
```

### The seam

`cortex-dev` must never read a vault path. It depends on an interface:

- A repo may contain `.cortex/connector.json` naming a brain location.
- Exactly two operations cross the boundary: `recall(query) -> notes[]` and
  `capture(note) -> void`.
- With no brain installed, `cortex-dev` falls back to repo-local
  `.cortex/memory/` and every phase still completes.

This inverts today's dependency: `/install-project` is currently a vault ritual
that stamps repos; here `cortex-dev` is standalone and discovers a brain at
runtime.

It is also where the employer firewall survives contact with a work repo.
`cortex-dev` running inside a company codebase calls `capture()`; the brain, on
the personal side, refuses day-job content per the existing rule. The firewall is
enforced in one place instead of being re-litigated in every dev skill.

### Skill re-homing

| → cortex-dev | → cortex-brain | retired |
|---|---|---|
| `analyze-spec` (becomes `plan`) | `capture` `daily` `weekly-review` `audit` `level-up` `reindex` `cortex-doctor` `cortex-audit` `onboard` `catch-me-up` | `migrate-engine` |
| `install-project` (becomes the installer) | `scan-projects` `connect-brain` `setup-plugins` | |
| `scope-area` `optimize-context` | `team-init` `team-add` | |
| `skill-creator` `optimize-prompt` — shared, referenced by both | | |

## The loop

Five skills, plugin-namespaced so they coexist with gstack and superpowers:
`/cortex:discuss`, `/cortex:plan`, `/cortex:execute`, `/cortex:verify`,
`/cortex:ship`.

Borrowings: `discuss` takes superpowers' brainstorming dialogue plus gstack's
`/office-hours` forcing questions · `plan` takes gsd's decompose-until-each-task-
fits-a-fresh-context rule · `verify` takes gstack's reviewer role and gsd's drift
check · `ship` takes gstack's PR flow.

### Artifacts

```
.cortex/
  connector.json          optional; names a brain
  memory/                 fallback when no brain
  work/<slug>/
    SPEC.md               what & why          (discuss writes)
    PLAN.md               tasks + checkboxes  (plan writes)
    STATE.md              phase · task · test record · decisions
  archive/<slug>/         after ship
```

`STATE.md` is read first by every phase and is the only thing a fresh subagent
needs. It is a cursor, not a log, and stays small.

### Manifest

In SKILL.md frontmatter, not a sidecar — so manifest and prose cannot drift:

```yaml
---
name: ship
description: Use when the work is verified and ready to open a PR…
cortex:
  phase: ship
  requires: [verify]
  gates:
    - { point: ship:pre, check: tests-green, blocking: true }
---
```

### Gates

One script, `hooks/cortex-gate.sh`, two registrations:

| Gate | Hook | Fires on | Behaviour |
|---|---|---|---|
| `ship:pre` | `PreToolUse` on `Bash` | command matches `git push` / `gh pr create` / `git merge` | blocking |
| `plan:pre` | `PreToolUse` on `Edit`\|`Write` | `.cortex/work/<active>/` exists without `PLAN.md` | warn-only |

The ship gate reads `STATE.md` and requires: every `PLAN.md` checkbox ticked or
explicitly waived, and a test record with exit code 0 whose timestamp is newer
than the newest tracked source file. Failure exits 2, which Claude Code surfaces
as a blocked tool call.

**This is a speed bump, not a sandbox.** `/cortex:verify` writes the test record
by running the command and capturing its exit code, but a model could write that
file by hand. The gate raises the cost of skipping verification from zero to
deliberate forgery. That is the ceiling of hook-based enforcement and it is
accepted.

**The resolver fails open.** On script error, timeout, or unparseable `STATE.md`
it warns and allows. gsd uses `onError: skip` for the same reason: a bug in the
hook must never block a user's `git push`.

**Off Claude Code** (Cursor, Codex, Copilot) hooks do not exist and the gate
reverts to prose in the skill body. Documented as a known limitation.

## Cleanup

Repo hygiene is already good: `mcp/node_modules` is untracked, the packed repo is
912 KiB, and `.gitignore` correctly uses the `dir/*` + `!dir/placeholder` form.
The cleanup is conceptual.

**1. Vault relocation — copy, verify, remove; never move.**

1. Archive the whole repo to a dated backup outside it. Verify it opens.
2. Copy the eight personal directories (`context` `inbox` `daily` `notes`
   `projects` `areas` `resources` `decisions`) plus `home.md` and `brain/` to the
   new vault root. Verify file count and byte size match in both directions.
3. Point `cortex-brain` at the new root; run `/audit` and `/daily` there. **They
   must pass before anything is deleted.**
4. Only then remove those directories here and drop their `.gitignore` entries.
5. Restructure into `packages/` as the last step.

Step 3 is the gate. If the brain cannot operate from its new home, nothing is
removed.

**2. Delete the retired engine's remains** (recoverable from history):
`archives/cortex-init.mjs.legacy`, `archives/package.json.node-legacy`,
`archives/tools-package.json.node-legacy`, `archives/stale-engine/*.chatprompt.md`,
`archives/alive-os-framework.md`, `archives/00-AUDIT-AND-PLAN.md`,
`archives/getting-started.md`, `archives/quick-reference.md`.

Move `docs/superpowers/` (636 KB of past specs and plans) to `docs/history/` so it
reads as a record rather than product documentation.

**3. Privacy check before anything ships publicly.** `AGENTS.md` lists the
gitignored personal paths, and `connections.md` is not among them — yet the same
file describes `connections.md` as holding "every tool/data source the vault can
reach," and it is tracked. Either it is genuinely data-free and the manual should
say so explicitly, or it is leaking. Resolve before the repo is published.

## Verification

- **Seam contract test (CI).** Run `cortex-dev` in a scratch repo with no brain
  installed; all five phases must complete. This is the test that keeps the
  two-package split honest.
- **Gate tests (shell, fixture repo).** Failing tests + `git push` → blocked with
  exit 2. Passing tests + stale timestamp → blocked. Corrupt `STATE.md` →
  allowed with a warning (fail-open is a requirement, so it is tested).
- **Skill tests, superpowers-style.** RED/GREEN on the five new phase skills:
  run the scenario without the skill and confirm the wrong behaviour, add the
  skill, confirm the right one. Not retrofitted to the 22 existing skills.

Word budgets from superpowers' `writing-skills` apply to all new skills: under
200 words for anything loaded every session, under 500 otherwise.

## Implementation sequence

This design is too large for one implementation plan. It decomposes into three,
executed in order, each with its own plan and its own merge:

1. **Separate** — vault relocation (the five steps above), engine-remains
   deletion, `docs/history/` move, `connections.md` privacy resolution, and the
   `packages/` restructure with skills re-homed. No new behaviour. Ends with a
   repo that is pure product and a vault that works from its new home.
2. **Loop** — the five phase skills, the `.cortex/` artifact layout, and the
   frontmatter manifest convention. Gates written as prose only. Ends with a
   working end-to-end workflow at enforcement level "convention."
3. **Enforce** — `hooks/cortex-gate.sh`, its two registrations, the gate tests,
   and the seam contract test in CI. Ends with the blocking ship gate.

Sub-project 1 carries all the data risk and none of the design risk; 3 carries
the reverse. Splitting them keeps a migration bug from being tangled up with a
resolver bug.

## Out of scope for v1

Role-based review panels (gstack's CEO/design/DX reviewers) — one reviewer role
only. Browser automation and QA. Deploy monitoring and canary. Telemetry.
Retrofitting gates onto the brain rituals. Depth in any single phase; v2 is
guided by what actually breaks.
