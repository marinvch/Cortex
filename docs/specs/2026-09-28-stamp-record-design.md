# Design: the stamp record, and knowing when a repo's Cortex files are out of date

- **Date:** 2026-09-28
- **Status:** Draft for review
- **Decided by:** the maintainer, in the same brainstorm as [the agent team](2026-09-28-agent-team-design.md),
  which asked for it to ship first
- **Area:** `index/` (a new `stamps` module and CLI, and a `next.mjs` row), `skills/cortex/` (the re-run)

## Destination

- Every file `/cortex` writes into a repo is **recorded when it is written**: which template, which
  Cortex version, and a hash of what was written.
- On any later run, Cortex can say for each file whether it is current, safe to update, edited by
  the team, or gone.
- A re-run of `/cortex` offers the safe updates behind its one confirmation, and asks per file
  where the team edited something Cortex also changed.
- A developer whose plugin is older than the Cortex that stamped the repo is told so, together with
  the exact command to update it.

This ships before the agent team. That feature writes more files into repos, and they will need the
same way to update.

## Context

- **What goes stale today.** `/cortex` stamps from `templates/loop/`: `verifier.md`, `REVIEW.md`,
  the hooks, `agent-evals.yml`, `cortex-review.yml`, `intent/` and `bands.yaml` (the table in
  `skills/cortex/SKILL.md`). Nothing records which release wrote a file, so a repo stamped by
  2.36.0 keeps 2.36.0's hook after 2.39.0 fixes it. 2.39.0's protected-paths fix for bash 3.2 and
  2.39.1's fix for Windows paths reach only repos stamped after them.
- **The one exception.** `cortex-review.yml` pins `{{CORTEX_REF}}` to `v<version>`, so it is the
  single file that knows its release.
- **The part that is already solved.** #462 (2.39.1) catches stale **skills**, with
  `index/lib/skill-drift.mjs` and a `skill-drift` row in `cortex-next`. It checks their *content*
  against the disk. This spec checks stamped *files* against the templates that wrote them. The two
  are different questions and both stay.
- **Anthropic doc changes are already caught for maintainers.** `.github/workflows/claude-docs.yml`
  re-reads the docs weekly and opens a `docs-drift` issue. They reach users through a release, and
  that is how they reach a user's repo too, through this record.
- **Plugin updates.** Checked 2026-09-28, from the Claude Code docs:
  - Auto-update is *off by default* for third-party marketplaces, Cortex's included. A user turns
    it on in `/plugin` → Marketplaces. A plugin author has no documented way to turn it on for them.
  - After an update, the running session keeps its version and shows `Run /reload-plugins to
    apply`.
  - A repo can commit `enabledPlugins` and `extraKnownMarketplaces` to `.claude/settings.json`.
    Each collaborator still installs once.

## Decisions locked

| # | Decision | Rejected alternative, and why |
|---|---|---|
| S1 | A committed **`.cortex/stamps.json`** records each stamped file: path, template id, Cortex version, a hash of the template source, and a hash of what was written | A version comment inside every file: breaks formats that take no comments (JSON), and invites hand-editing |
| S2 | **The record is written by a deterministic CLI** (`cortex-stamps record`), called by `/cortex` after each write | The model computing hashes: the one step that must never be approximate |
| S3 | **Five states, decided without a model.** From two comparisons (the file now against the file as written, and the template now against the template then): `current`, `update` (template changed, file untouched: safe), `conflict` (both changed: show both, ask), `edited` (only the team changed it: theirs, say nothing), `missing` | Re-rendering everything on a re-run: clobbers the team's edits, which `/cortex` promises never to do |
| S4 | **Surfaced where the team already looks.** A `stamps` row in `cortex-next`, shown only while something is out of date, and the same list in `/cortex`'s re-run confirmation and the View's Next steps | A `SessionStart` hook: Cortex ships no hooks in its plugin (the #407 decision), and a repo hook cannot find the plugin's templates |
| S5 | **A plugin older than the stamps is named.** When a file was stamped by a newer Cortex than the one running, the developer gets the two update commands. The install docs also add the auto-update step | Silence: a teammate on an old plugin re-stamps old templates over new ones |
| S6 | **Team repos are offered the shared-plugin settings.** On the `work` profile, or with a team-brain connector, `/cortex` offers to commit `extraKnownMarketplaces` and `enabledPlugins`, so every collaborator is prompted to install the same Cortex | Leaving each developer to find the plugin alone |

## Architecture

```
/cortex writes a file ──► cortex-stamps record <repo> <path> <template>
                              └─► .cortex/stamps.json   (committed)

cortex-next / /cortex re-run / View
        └─► stamps.mjs status(repo, templatesDir)
               ├─ file hash  now vs recorded ─┐
               └─ template hash now vs recorded┴─► current | update | conflict | edited | missing
```

- `index/lib/stamps.mjs` exports `readStamps`, `recordStamp` and `stampStatus`. It is pure, apart
  from reading files, and is given the plugin's `templates/` directory, as `/cortex` already is
  through `${CLAUDE_PLUGIN_ROOT}`.
- `index/cortex-stamps.mjs` has two commands: `record` (write one entry) and a status command,
  `<repo> [--json]`.
- **Hashes.** Line endings are normalised to LF before hashing, so a checkout with `core.autocrlf`
  never looks edited. That is the lesson of `.gitattributes templates/** text eol=lf` from 2.39.0.
- **Rendered files, not raw templates.** The recorded file hash is of the rendered output, so
  placeholders filled per repo never register as edits.
- **Updating a file** means re-rendering the new template with the values recorded at stamp time.
  So the record also keeps the placeholder values, which are the detected commands and paths, and
  none of which is secret. When a value is detected differently now, the update shows the change.

### Invariants this must not break

- **Never clobber.** `conflict` and `edited` files are never rewritten without a per-file yes.
- **Consent before the first write** ([ADR 0016](../adr/0016-a-guarantee-belongs-to-the-act-not-to-the-skill.md)).
  `stamps.json` is written only as part of an approved write.
- **Deterministic** (`index/AGENTS.md`). Same tree, same templates, same status.
- **No runtime dependencies.** Node's own `crypto` does the hashing.

## Risks & edges

- **Repos stamped before this ships** have no record. On their first re-run, each loop file that
  matches a known template location is offered for **adoption**: recorded at "unknown version",
  with its template treated as changed, so it shows as `conflict` with the diff. Nothing is
  rewritten silently.
- **Merged artifacts.** The verification block is appended to `CLAUDE.md`, and the hooks are merged
  into `.claude/settings.json`. They are part of a file the team also writes. See *Not yet
  specified*.
- **Two developers on different plugin versions.** S5 names the older one. The record keeps the
  newest version seen, so an old plugin never lowers it.
- **Rollback.** Delete `.cortex/stamps.json`. Everything falls back to today's behaviour.

## Not yet specified

- **How to track a block inside a shared file**: the verification block in `CLAUDE.md` and the
  hooks inside `settings.json`. Candidates are marker comments around the block (not possible in
  JSON), or hashing just the keys Cortex owns inside `settings.json`.
- **Whether `update` files are applied in one yes or listed one by one.** It depends on how many a
  typical upgrade touches, which the first real upgrade will show.
- **The agent team's files** join the record when that feature ships. Whether an agent's grounded
  lines drift like a skill's, and so need an `agent-drift` check beside `skill-drift`, is answered
  there.

## Out of scope

- Updating the plugin itself on a user's machine. The docs give plugin authors no way to do it,
  so Cortex names the commands (S5) and documents the auto-update switch.
- Changing any file a team wrote themselves.
- A background or scheduled check inside a user's repo.
