# Plan: the stamp record, then the agent team

Specs:
- [stamp record](../specs/2026-09-28-stamp-record-design.md)
- [agent team](../specs/2026-09-28-agent-team-design.md)

**Rules for every step:**
- One PR per step against `master`, merged before the next step starts. Never stacked.
- Tests are written first.
- Detection work is validated on cloned public repos and on the private team workspace, and
  mutation-checked. Fixtures alone share the code's blind spots.
- Every step runs the full suite list in `docs/changing-cortex.md`.
- None of this is a wide mechanical change, so every step is a vertical slice.

## Part 1 — the stamp record (ships as one minor release)

| # | Step | Files | Verified by |
|---|---|---|---|
| 1 | `stamps.mjs`: read, record, and the five states (S1, S3), with LF-normalised hashes | `index/lib/stamps.mjs`, `index/test/stamps.test.mjs` | unit tests per state, CRLF, a missing file, an absent record → `null` |
| 2 | `cortex-stamps` CLI: `record` and status `--json` (S2) | `index/cortex-stamps.mjs`, `tools/test/cortex-stamps.test.sh` | shell test on a real git fixture; the target repo is otherwise unchanged |
| 3 | `/cortex` records every loop file it writes, and re-renders `update` files from the recorded placeholder values | `skills/cortex/SKILL.md`, `index/lib/loop.mjs` (values exposed) | e2e: stamp, then bump a template, re-run → `update`; edit the file → `conflict` |
| 4 | A `stamps` row in `cortex-next` and the View; adoption for repos stamped before the record (S4) | `index/lib/next.mjs`, `index/lib/view.mjs`, tests | `next.test` case; a repo stamped by 2.39.x adopts every file as `conflict`, and nothing is rewritten |
| 5 | Name an older plugin, and the auto-update step in the install docs (S5) | `index/lib/stamps.mjs`, `README.md`, `skills/site-sync/PAGES.md` | a test where the record's version is newer than `VERSION`; README check |
| 6 | Offer the shared-plugin settings on team repos (S6) | `skills/cortex/SKILL.md`, `templates/loop/settings.hooks.json` or a sibling | merge test: existing `settings.json` keys survive; offered only on the `work` profile or with a connector |
| 7 | Validate on the team workspace: upgrade its repos from their 2.39.x stamps | none (a record in the PR) | every state reached on a real repo; S1–S4 acceptance still passes |
| 8 | Release: CHANGELOG, `cortex-version.mjs --set`, GitHub release, site sync | release files | the release checklist |

## Part 2 — the agent team (ships as the next minor release)

| # | Step | Files | Verified by |
|---|---|---|---|
| 9 | Role templates for Architect, Implementer, Tester, Reviewer and Project manager, each one job, least tools, and a citation rule | `templates/team/*.md` | each rendered template passes every `claude-setup` subagent check (roadmap Q9) |
| 10 | The Tester's fence: a `PreToolUse` hook in its frontmatter that allows edits to test paths only, failing closed | `templates/team/tester.md`, `templates/team/test-paths.sh`, a shell test | Windows and POSIX paths, a missing `jq`, an empty path list — as `protected-paths.sh` is tested |
| 11 | Existing agents: detect, grade, map each to a role, propose edits (T6) | `index/lib/agents.mjs`, tests | public repos that commit `.claude/agents/`, with the mapping checked by hand; a covered role is never offered again |
| 12 | Sizing: a deterministic single-or-team recommendation from `cortex-impact` signals (T2) | `index/lib/impact.mjs` or `index/lib/sizing.mjs`, tests | fixed fixtures for each signal; thresholds stay provisional (*Not yet specified*) |
| 13 | The playbook: a ~10-line `CLAUDE.md` block and the `team` skill carrying the debate protocol (T1, T5) | `templates/team/playbook.md`, `templates/team/team-skill.md` | the checker still passes the `CLAUDE.md` length rule on a stamped fixture |
| 14 | `/cortex` offers the team: a `team` loop row, roles picked per role, the verifier offered the upgrade to Reviewer (T4, T9), and every file recorded in `stamps.json` | `index/lib/loop.mjs`, `skills/cortex/SKILL.md`, `index/lib/next.mjs` | `loop.test` and `next.test` cases; a repo with a verifier is offered the upgrade and keeps working if it says no |
| 15 | End to end on the team workspace: a real team task, sized, debated with citations, red then green, reviewed; plus a single-agent task that skips the debate | none (a record in the PR) | a new acceptance scenario, S5, in `tools/test/e2e-workspace.mjs` |
| 16 | ADR (the team is written into repos, the main session orchestrates, debate is evidence-only), README, site pages, release | `docs/adr/`, `README.md`, site | the release checklist |

## Where the knowledge goes

- The stamp states and the LF rule go in `index/AGENTS.md`, next to the determinism invariant.
- "The team is written into the repo, never shipped as plugin agents" and "the main session
  orchestrates" go in the ADR from step 16.
- The Tester fence goes in the `templates/` notes of `docs/changing-cortex.md`. After #457, a hook
  promise must have a hook behind it.
