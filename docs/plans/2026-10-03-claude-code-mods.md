# Plan: mods and native `AGENTS.md` loading

Spec: [what Cortex owes Claude Code mods](../specs/2026-10-03-claude-code-mods-design.md)

**Rules for every step:**
- One PR per step against `master`, merged before the next step starts. Never stacked.
- Tests are written first.
- Every rule enters `core/claude-code.js` with its sentence copied from the live page, and
  `node tools/cortex-claude-docs.mjs --check` exits 0 before the PR opens.
- Detection work (steps 2 and 3) is run against cloned public repos and mutation-checked. Fixtures
  alone share the code's blind spots.
- Every step runs `node --test core/test/*.test.js`, `node --test index/test/*.test.mjs`,
  `npm test` in `mcp/`, and `bash tools/test/run.sh`.
- Versions are stamped with `node tools/cortex-version.mjs --set`.
- None of this is a wide mechanical change, so every step is a vertical slice.

| # | Step | Files | Verified by |
|---|---|---|---|
| 1 | Vendor the nine rules. Key `--pages` fixtures on the path under `/docs/en/` so `plugins/mods/overview` cannot collide with another `overview` | `core/claude-code.js`, `core/test/claude-code.test.js`, `tools/cortex-claude-docs.mjs`, `tools/test/claude-docs.test.sh`, `core/test/plugin.test.js`, `references/claude-code.md` | live `--check` exits 0 with the three mods pages listed; a test with two sources sharing a basename reads two fixtures |
| 2 | Mod findings: `mod-module-missing`, `mod-modules-not-one`, `mod-module-extension`, `mod-present` | `index/lib/claude-setup.mjs`, `index/test/claude-setup.test.mjs`, `index/AGENTS.md` | one test per finding and one per non-finding (a `hooks.json` with settings hooks and no `modules`; a `hooks.json` with no plugin manifest beside it). Run on `anthropics/claude-code` (`mods/diff`, `mods/agents-md`) and `anthropics/claude-code-playground` (`claude-code/mods/*`): every mod there reports `mod-present` and nothing else. Mutation: break each condition and see its test fail |
| 3 | Report that scoped leaves do not load under the shim, as a line in the findings summary and in `cortex-next`, not as a `claude-setup/` finding (chosen 2026-10-03; spec, Risks) | `index/lib/findings.mjs` summary, `index/lib/next.mjs`, their tests | fires on a repo with a root `CLAUDE.md` and one leaf; silent with no leaf, and silent with no `CLAUDE.md` at or above the root. On this repo the self-check stays green and the line appears |
| 4 | State the mod limit on both fences, and why the shim stays | `templates/team/README.md`, the note for `templates/loop/protected-paths.sh`, `skills/cortex-scaffold/SKILL.md` | `index/test/team-templates.test.mjs` gains an assertion that the README names the limit; `node evals/run.mjs --check` passes, with a `--record` if the scaffold skill is under evals |
| 5 | ADR 0021: Cortex ships no mod and keeps the shim | `docs/adr/0021-*.md`, `docs/changing-cortex.md` (one line pointing at it) | `tools/test/changing-cortex.test.sh` |

## Order and size

Step 1 is the base: steps 2 and 3 cite its rules. Steps 4 and 5 are prose and can follow in either
order. Each step is a patch release; none changes what a stamped repo holds, so the stamp record
needs no migration.

## What would stop this

- A mods page rewording a cited sentence between step 1 and its merge. Re-copy the sentence.
- Step 2's real-repo pass finding a layout the reference table does not describe (a module path
  outside `hooks/`, several plugins under one root). Fix detection before merging; do not narrow the
  test to the fixture.
