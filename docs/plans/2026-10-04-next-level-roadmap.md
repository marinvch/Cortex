# Plan: Cortex keeps itself current, proves it helps, and holds several projects and a large team

Spec: [the next-level roadmap](../specs/2026-10-04-next-level-roadmap-design.md)

**Rules for every step:**
- One PR per step against `master`, merged before the next step starts. Never stacked.
- Tests are written first.
- Steps marked **spec** write a short design spec for their part and stop for approval. No code in
  those steps.
- Every step runs `node --test core/test/*.test.js`, `node --test index/test/*.test.mjs`,
  `npm test` in `mcp/`, `node --test .claude/hooks/*.test.mjs` and `bash tools/test/run.sh`.
- Versions are stamped with `node tools/cortex-version.mjs --set`. A step that changes nothing the
  plugin ships (a workflow, a spec, an ADR) is not stamped.
- Detection work is run against cloned public repos and mutation-checked.
- Part 4 is the one wide change, and it is planned as expand, then migrate. Every other step is a
  vertical slice.

## Owed before part 1

| # | Step | Files | Verified by |
|---|---|---|---|
| 0a | Vendor the checkable rules from the skill authoring page; watch the platform docs index for the agent-skills, prompt-engineering and test-and-evaluate sections only | `core/claude-code.js`, `core/test/claude-code.test.js`, `tools/cortex-claude-docs.mjs`, `tools/claude-docs-seen.json`, `tools/test/`, `index/lib/claude-setup.mjs` and its test, `tools/README.md` | each rule's sentence copied from the live page; `node tools/cortex-claude-docs.mjs --check` exits 0; the new findings stay silent on Cortex itself (`cortex-follows-its-own-rules`); run on cloned public repos |
| 0b | Sync the site from 2.41.15 to the current release, including the two captured files | the site repo, through `/site-sync` | the site builds; `cortex-site-facts.mjs --check` exits 0 against the site's `main` after merge |

## Part 1 — upkeep

| # | Step | Files | Verified by |
|---|---|---|---|
| 1.0 | **spec** — the release workflow and the drift agent: the token question, the trigger, the path limits, how the chain closes | `docs/specs/` | approved by the maintainer |
| 1.1 | Extract a version's release notes with a tested script; fail on an empty section or one that does not end at the next version heading | `tools/cortex-release-notes.mjs`, `tools/test/release-notes.test.sh`, `README.md` Tools table, `tools/README.md` | the script's output for 2.41.8–2.41.18 equals the bodies of the releases already published; a changelog with a swallowed heading exits non-zero |
| 1.2 | Release automatically when a merge changes `VERSION`; ADR for it | `.github/workflows/release.yml`, `docs/adr/0022-*.md`, `docs/changing-cortex.md` | the next stamped merge produces a tag on its merge commit and a release marked Latest; a merge with no version change produces none; a re-run with the tag present does nothing |
| 1.3 | The drift agent for `site-drift`: one run per bot-opened issue, a PR on the site repo, nothing else | `.github/workflows/drift-agent.yml`, `docs/adr/0023-*.md` | a dispatched `site-drift` issue yields one site PR that builds; an issue opened by another account starts nothing; the job's token cannot push to `master` or edit workflows |
| 1.4 | The same agent for `docs-drift`, limited to the rules file, its tests and the changelog | `.github/workflows/drift-agent.yml`, a path check | a seeded drift (a reworded sentence in a fixture page set) yields a PR touching only allowed paths; a PR touching any other path fails the check |

## Part 2 — the outcome harness

| # | Step | Files | Verified by |
|---|---|---|---|
| 2.0 | A scoped brief for `evals/` and tests for its six untested modules | `evals/AGENTS.md`, `AGENTS.md` routing table, `evals/test/` | the findings report no longer lists `evals/` under briefs or untested modules |
| 2.1 | **spec** — the fixture, the five tasks, the pass command for each, the model, what the first measurement must show | `docs/specs/` | approved by the maintainer |
| 2.2 | The harness: build the fixture, run each task in both arms, score, print the table | `evals/harness/`, `evals/README.md`, `evals/AGENTS.md` | a dry run with a stubbed model produces the table; the two arms differ only in the context layer (asserted on the built repos) |
| 2.3 | The first measurement, recorded with its date, model and raw counts, whatever it shows | `evals/harness/RESULTS.md` | 30 sessions run; failed calls are counted and reported, never scored as zero |

## Part 3 — several projects in one place

| # | Step | Files | Verified by |
|---|---|---|---|
| 3.0 | **spec** — the project file's fields, removal, the workspace page's layout; ADR that a workspace is project files | `docs/specs/`, `docs/adr/0024-*.md`, `CONTEXT.md` (the terms *workspace* and *project file*) | approved by the maintainer |
| 3.1 | The project file: written by `/team-add`, validated, listed by the brain; a way to remove one | `mcp/`, `skills/team-add/`, `skills/team-init/`, `mcp/AGENTS.md` | tests with generic fixture projects; a file with an employer-shaped link is refused under a `home` profile |
| 3.2 | The workspace page: every project, its links shown and never fetched | `index/lib/view.mjs`, `index/lib/view-html.mjs`, `index/cortex-view.mjs`, `skills/cortex-view/` | the page is self-contained; the contrast and 13px tests cover the new surfaces; a workspace of one renders as today |
| 3.3 | Relations: found by the route map, or declared in a project file, drawn differently; unlinked projects stand alone | `index/lib/routes.mjs`, `index/lib/view*.mjs` | a fixture workspace with one found, one declared and one unlinked project renders all three states |

## Part 4 — a large team

| # | Step | Phase | Files | Verified by |
|---|---|---|---|---|
| 4.0 | **spec** — what names an author, how recall presents many authors, whether existing repos migrate; reproduce the same-day conflict first | — | `docs/specs/` | the conflict is reproduced in a test repo, or the part is re-scoped if it is not real |
| 4.1 | Readers learn both layouts | expand | `core/memory.js`, `mcp/` recall and catch-me-up, `index/lib/view.mjs` timeline | each reader has a test with both layouts present and loses no entry |
| 4.2 | The writer writes one file per author per day | expand | `core/memory.js`, `index/cortex-memory.mjs`, `mcp/` | two writers on two branches merge with no conflict in a test repo; the secret gate still refuses |
| 4.3 | Templates, briefs and rituals describe the new layout | migrate | `templates/`, `skills/dream/`, `skills/catch-me-up/`, `CONTEXT.md`, [ADR 0002](../adr/0002-committed-repo-memory.md) amended | `rg -n "one file per day" skills templates docs CONTEXT.md` returns only the ADR's history |

There is no contract step. Existing memory files are never rewritten.

## Where the knowledge goes

- Three ADRs: 0022 (releases are automatic), 0023 (the agent opens pull requests only), 0024 (a
  workspace is project files).
- `evals/AGENTS.md` is new in step 2.0 and takes the harness's invariants.
- `mcp/AGENTS.md` takes the project file's rules; `index/AGENTS.md` takes the workspace page's.
- `docs/changing-cortex.md` gains the release rule in step 1.2: stamping a version on master is
  releasing it.
