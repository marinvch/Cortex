---
name: cortex
description: The single install — give a repo, new or legacy, the whole Cortex loop in one pass (root brief, verification, verifier, PR review, hooks, evals, an agent team). Asks once, never touches source code. Triggers — "install cortex", "set this repo up", "onboard this project", or an unfamiliar repo with no AGENTS.md.
metadata:
  capability: judgment
---

# /cortex — one install, working project or new one

The front door. Runs in a **target repo**, never in the Cortex repo itself.

Everything Cortex used to ask a user to sequence by hand — index, findings, scaffold, briefs,
skills — happens here, in one pass, behind one confirmation. The other rituals still exist and are
still callable by name; what changed is that nobody has to know their order to get a served repo.

One pass writes everything that can be written today. Two rows cannot be: **evals** need real past
tasks to seed cases from, and **bands** need a production metric with a stable history. Both also
wait on files this same pass writes (`CLAUDE.md`, `REVIEW.md`), so they come back as `missing`
afterwards. Say that in the playback. Do not promise them in the first pass. `cortex-next` then
names `/cortex evals` and `/cortex bands` ([RUNS.md](RUNS.md#invoked-with-a-row)).

> **The rule that governs this whole skill:** steps 1–5 read, report and *ask*. They do not modify
> one line of the repository. Writing happens in step 7, only for what the user confirmed. If you
> find yourself editing a file before the user has chosen something, stop — you have left the skill.

## What "served" means here

A repo is served when the artifact chain is closed: an idea becomes `intent.md`, which becomes
`spec.md`, which becomes `plan.md`, which becomes a diff with tests, which becomes a PR judged
against a written policy, which passes a gate — and production writes the next `intent.md`.

```
Plan        Design      Build       Test        Deploy      Maintain
intent.md → spec.md  →  plan.md  →  the diff →  the PR   →  the breach
    ↑                                                           │
    └───────────────────────────────────────────────────────────┘
```

Each stage ends by committing a file the next stage reads, which is why "is this repo served" is a
question about files on disk and not a judgment call. `index/lib/loop.mjs` answers it.

## Invoked with a row, or run unattended

Read [RUNS.md](RUNS.md) before step 1 in either of these cases:

- **Invoked with a row** — `/cortex evals`, `/cortex bands` or `/cortex team`. Only that row is
  taken, and evals and bands stop when there is no real history to build them from.
- **Run unattended** — `claude -p`, where nobody answers the consent gate or step 6. Claude Code
  refuses every write under `.claude/` there unless the run is in auto mode, and the install still
  reads as finished.

## 1. Orient

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-preflight.mjs"
```

Root, profile and index freshness, from the one place that owns them. Do not re-derive any of the
three — every prose copy is a copy that drifts.

Refuse to continue if this is the Cortex repo itself (`.claude-plugin/plugin.json` names `cortex`).
Cortex installs *into other repos*.

### The consent gate

This skill is **model-invocable** — you may start it yourself when a repo plainly needs it. That
makes the gate below the thing protecting the repository, not the invocation rules.

**If `.cortex/` does not exist, ask before writing anything** — including the index. Say what you
propose to do, and what the read steps write: files under `.cortex/`, plus three ignore lines
appended to `.gitignore` the first time. They never write to source. Then wait for a yes. Generated and gitignored is not the same as invisible: these are files appearing in someone's
project on a run they did not ask for.

**If `.cortex/` already exists**, Cortex is established here and re-indexing needs no ceremony.

The gate is on the **first write**, not on reading. Orienting yourself — reading `AGENTS.md`, the
tree, the manifest — needs no permission and never did.

## 2. Index

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-index.mjs" .
```

Deterministic and offline. Writes `.cortex/index/index.json`. The run that first creates `.cortex/`
also appends `.cortex/index/`, `.cortex/findings/` and `.cortex/view/` to the target's `.gitignore`,
and creates that file if there is none. That is the one write outside `.cortex/`. The indexer
prints the lines it added; tell the user.

**Index before reading the loop.** Two loop rows cite the index — the root brief names the detected
stack, the hooks row names the generated paths — and without one they report "nothing detected",
which a user cannot tell from "looked and found none". Running the loop first is not wrong, it is
just half an answer, and it will say so in its own header.

### The fork: working project or new one

The indexer prints the file count, and **zero files is the greenfield flow** — a different
sequence, not a degenerate case of the other:

- **New project** — nothing to analyse, so skip the ceremony. Interview for the stack and the
  commands instead of reading them, since there is nothing to read them from. Offer no scoped
  briefs and no enrichment: both describe code, and there is none. Offer no `REVIEW.md` yet either
  — a review policy about nothing is a file that will be wrong by the time it is read. Say the
  honest version: the loop now grows *with* the code instead of being reverse-engineered from it.
- **Working project** — continue below.

The fork is on the index, never on a guess. A repo with a README and no source is greenfield; a
repo whose only code is a build script is not. And an index that has not been built is not evidence
of either — `loop.mjs` refuses to call a repo greenfield on a missing index, because the first run
of this module announced "no code yet" over several hundred files.

## 3. Report what is wrong

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-findings.mjs" .
```

Writes exactly one file, `.cortex/findings/<date>.md`. Read it, then give a **short** summary in
chat — the top three or four, most severe first, in your own words. Do not paste the report.

Lead with `critical` security findings if there are any, and say in the same breath that some will
be fixtures. A false positive presented as a breach destroys trust in every other finding.

## 4. Read what is missing

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-loop.mjs" . --json
```

Writes nothing. Returns three buckets, and the difference between them is the whole interview:

| Bucket | Meaning | What you do |
|---|---|---|
| `present` | already on disk | report it as served; never offer to rewrite it |
| `missing` | applies here and absent | **this is the worklist** |
| `blocked` | does not apply *yet* | name it, with its `needs` |

Walk `missing` in the order it comes — the rank is control flow, so the first row is the first
question. Each entry carries `why` (what was detected) and `brief` (what the body must contain).

**A blocked row is named, never dropped.** `bands.yaml` waiting on `REVIEW.md` is a fact the user
should hear once; an offer that silently vanishes is indistinguishable from a bug. One line each,
with the `needs` attached, and move on.

**Never offer to overwrite a `present` artifact.** A hollow `REVIEW.md` still counts as present,
because silently replacing a file someone wrote is the worse failure. If one looks thin, say so as
an observation and let them ask.

## 5. Also walk the findings worklist

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-findings.mjs" . --offers
```

The ranked worklist from the findings, writing nothing. It covers what the loop does not: scoped
briefs, the plugin bundle, enrichment, the memory store, and secrets triage.

Merge it with the loop worklist into **one** list of questions. The user is being asked once; they
should not be able to tell which of two modules produced which question.

**Agent docs that were already here go first.** If `CLAUDE.md`, `.cursorrules` or another agent
doc exists and `CONTEXT.md` does not, a human wrote it before Cortex arrived. Ask `cortex-next.mjs`
rather than re-deriving it — a `reconcile` step in its `--json` output is the signal:

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-next.mjs" . --json
```

When it is there, the **first** question is whether to slim that doc with `/optimize-context`
before the scaffold runs. Scaffold never clobbers a curated file, so skipping this does not lose
anything — it leaves the user with their file *plus* an `AGENTS.generated.md` to merge by hand,
which is the double-file a single install exists to avoid. The first version of this skill left
the step out and produced exactly that.

**Skills an earlier pass wrote are checked on every re-run.** A `skill-drift` step in the same
`--json` output lists each skill the repo now contradicts, with its lines in `drift[].findings` —
a path that is gone, "no tests" beside a test suite, a script no manifest declares. Every line is
provable from disk. Add each drifted skill to the merged worklist as one row naming its lines, so
the single confirmation in step 6 covers exactly what the user saw. When `drift[].editedNote` is
set, a person worked on that skill after it was written: put the note on the row, word for word.
The confirmation then covers the edit too, and nothing is asked about that skill afterwards. `present` in the loop means the
file exists; it never meant the file is still true.

**Loop files an earlier pass stamped are checked against this release's templates.**

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-stamps.mjs" . --json
```

It writes nothing. **When `olderPlugin` is not null**, a newer Cortex stamped this repo: say its
`advice` and offer no stamp row. Every state below is measured against this plugin's older templates,
so none of them is what the updated plugin will find. Do not list them, not even as what the pass
after the update will offer or ask. That pass reads them again.

`files` is `null` when there is no `.cortex/stamps.json` yet. Otherwise each file has a `state`, and
the state decides the row:

| State | Row |
|---|---|
| `update` | one row, *Update N files Cortex stamped*: the template changed and the file is untouched |
| `review`, `conflict` | one row **per file**, with its diff shown; never covered by `[a]ll` |
| `missing` | ask whether to stamp it again or drop it (`cortex-stamps.mjs forget . <path>`) |
| `retired` | name it; nothing to update it from. Drop it with `forget` if they agree |
| `edited` | nothing. The team changed it and the template did not, so it is theirs |
| `adopt` is non-empty | one row, *Adopt N loop files an earlier Cortex stamped*. It covers a repo installed before the record existed. On yes, run `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-stamps.mjs" adopt .`. That writes the record only; each file then reads `conflict` and is asked about file by file on the next run |

Get each diff from the CLI. It compares the file now with this release's template, filled with the
recorded values: `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-stamps.mjs" diff . <path>`.

**The team section in `CLAUDE.md` is not in the record**, so it is checked against every text Cortex
shipped: `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-section.mjs" . --json`. [TEAM.md](TEAM.md) holds its rows.

**When `ignored` is not null**, the record this pass writes would be hidden from git, so the team
would never share it. That can be true before any record exists. Add one row that offers the
`advice` it carries. Edit `.gitignore` only if the user picks that row.

**The agent team is asked role by role.** The `team` row carries `state.agentTeam`: each role on
`offer` is its own yes/no, `withheld` roles are named with their reason, the verifier's `upgrade` is
one more yes/no, and each agent's `proposals` are asked one agent at a time with the diff, never
under `[a]ll`. Read [TEAM.md](TEAM.md) before asking; it holds the questions and the writing.

Two rules survive the merge intact:

- **`enrich` states its token cost before the question, not after.** It is the only offer that
  spends real money, and a user who says yes and then learns the price has been sold something.
- **`triage-secrets` shows and stops.** Present the possible secrets, say some will be fixtures,
  and take no remediation action — not rotation, not redaction, not a commit. It is a finding to
  hand over, not an offer to accept.

## 6. One playback, one confirmation

Play back everything as a list of paths, grouped by stage, and take **one** confirmation:

```
Cortex will write, in one pass:

  Plan      intent/README.md, intent/TEMPLATE.md
  Build     AGENTS.md, CLAUDE.md, GEMINI.md, CONTEXT.md, docs/adr/
            src/billing/AGENTS.md, src/api/AGENTS.md
  Test      CLAUDE.md § Verifying your work, .claude/agents/verifier.md
  Team      [x] architect  [x] tester (+ .claude/hooks/test-paths.sh)  [ ] implementer
            .claude/skills/team/SKILL.md, CLAUDE.md § Working as a team
            changes: every later session here stops before a code task and asks
            "Single agent or team?", and plans or edits nothing until you answer
  Deploy    REVIEW.md, .github/workflows/cortex-review.yml,
            .claude/settings.json, .claude/hooks/protected-paths.sh
  Refresh   .claude/skills/type-check/SKILL.md — lines 8, 55 (no tests; a moved path);
            edited since it was written, 2 commits
  Update    .claude/hooks/protected-paths.sh, CLAUDE.md § Working as a team (templates changed)
  Ask each  REVIEW.md — you edited it and its template changed (diff shown above)

  After this pass, waiting on history:
            evals — cases are real past tasks; /cortex evals once there are some
            bands.yaml — one metric with a stable history; /cortex bands, or never
  Not now:  enrichment (later), the plugin bundle (no)

  [a]ll   [p]ick a subset   [n]one
```

**A row that changes more than its files says so.** A worklist row with an `effect` gets that
sentence under its paths, as the Team row above shows. A path does not tell the user that the
playbook changes how every later session starts, and a yes to something they were not told is not
consent.

Name the ADR directory the scaffold will use. It is `docs/adr/`, or `adr/` when `docs/` is a
published site ([`/cortex-scaffold`](../cortex-scaffold/SKILL.md) step 3).

`[a]ll` is offered first and on purpose: a user who wants the whole loop should not have to answer
eight questions to get it. `[p]ick` drops back into the worklist one row at a time. `[n]one` is a
complete and successful run — a repo that was already served, or a user who wanted to see the gap
and not close it, has been served either way.

This is the **single** gate between deciding and doing. Not one per file, not one per stage. A user
who has answered the worklist and is then asked again for each path has been interviewed twice.

## 7. Apply — one pass, in worklist order

Hand off wherever a ritual already owns the logic. Do not reimplement it here; the duplicate is
what drifts.

| Item | Who writes it |
|---|---|
| root brief, shims, `CONTEXT.md`, `docs/adr/` or `adr/` | `/cortex-scaffold` — it owns the templates, the never-clobber rules and the ADR location |
| scoped `AGENTS.md` leaves | `/cortex-brief`, once per area they picked |
| `.claude/skills/` | `/cortex-skills`, from `index.stack` |
| a drifted skill | `/cortex-skills` § Refreshing a skill that drifted — the flagged lines only, and it asks again before touching a skill someone edited |
| the plugin bundle | `/setup-plugins` |
| `.cortex/memory/` | create it, and say it is **committed** on purpose |
| the team plugin (`team-plugin`) | `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-shared-plugin.mjs" . --write`. It merges and refuses a file that does not parse; never hand-edit the JSON |

`team-plugin` is offered only on a team's repo: the `work` profile or a team-brain connector. Its
offer says what committing it does not do: once a teammate trusts the folder, Claude Code registers
the marketplace, but each teammate still installs once with `claude plugin install cortex@cortex --scope project`.
Auto-update is its own yes/no in the confirmation, unticked by default: `[ ] auto-update — every
teammate's Claude Code pulls new Cortex releases in the background`. Only a yes adds `--auto-update`.

The loop artifacts are written here, from `${CLAUDE_PLUGIN_ROOT}/templates/loop/`:

| Template | Lands at | Fill in |
|---|---|---|
| `verification.md` | appended to `CLAUDE.md` | only commands `loop.mjs` **detected**; ask for any it did not. The opening comment is addressed to you, so leave it out |
| `verifier.md` | `.claude/agents/verifier.md` | the run command |
| `REVIEW.md` | `REVIEW.md` | the detected generated paths under out-of-scope, and the suggestion cap |
| `settings.hooks.json` | merged into `.claude/settings.json` | **merge, never replace** — read the file first |
| `protected-paths.sh` | `.claude/hooks/` | the detected paths, as shell glob patterns |
| `format-changed.sh` | `.claude/hooks/` | one `<glob>) <command> "$path" >/dev/null 2>&1 ;;` line per entry in `state.formatters`; none if it is empty |
| `intent-README.md`, `intent.md` | `intent/README.md`, `intent/TEMPLATE.md` | who accepts an intent |
| `agent-evals.yml` | `.github/workflows/` | `{{TEST_CMD}}` with the detected test command; replace the `{{SETUP_STEPS}}` line with the toolchain and install steps from the repo's own CI, at that indentation, or delete it if there are none; keep checkout pinned by SHA with `persist-credentials: false`, and use the SHA the repo's own CI pins if it has one; cases live in `evals/cases/<name>/` |
| `cortex-review.yml` | `.github/workflows/` | `{{CORTEX_REF}}` with `v` plus the version in `${CLAUDE_PLUGIN_ROOT}/VERSION`, so each PR runs the release that stamped it; keep checkout pinned by SHA with `persist-credentials: false`; leave it advisory, and tell the user that setting the repository variable `CORTEX_REVIEW_BLOCKING` to `true` makes a provable broken citation fail the PR |
| `bands.yaml` | repo root | one metric with a stable history, a read-only command, the rollback runbook |
| `team/architect.md`, `team/implementer.md`, `team/tester.md`, `team/reviewer.md`, `team/project-manager.md` | `.claude/agents/`, one per role picked | the `values` from `cortex-loop.mjs . --team <roles>`, plus an answer to each of its `needs` ([TEAM.md](TEAM.md)) |
| `team/test-paths.sh` | `.claude/hooks/` | the same values; only ever with `tester.md` |
| `team/team-skill.md` | `.claude/skills/team/SKILL.md` | nothing to fill |
| `team/playbook.md` | appended to `CLAUDE.md` | `ROSTER` from the same command: the team as picked, never edited by hand |

**Never invent a command.** Every `{{PLACEHOLDER}}` that `loop.mjs` could not fill is a question for
the user, not a blank for you. Cortex placeholders are bare `{{NAME}}`; a `${{ … }}` in a
workflow file is GitHub Actions syntax and is left exactly as written. A `CLAUDE.md` telling an
agent to run `npm test` in a repo with no test script fails the first time it runs, and a context
file that is wrong once is not trusted on the parts the reader cannot check.

**Never clobber a curated file.** If `AGENTS.md` or `REVIEW.md` exists with real content, write
`<name>.generated.md` beside it and say to diff. `.claude/settings.json` is merged into, key by
key — replacing it takes out hooks and permissions somebody else depends on.

### Render each whole-file row

Every row above that lands a whole file is rendered by the CLI, not filled by hand. That is what
lets a later release update the file safely.

1. Put the values you decided in a JSON object in the OS temp dir, for example
   `{ "TEST_CMD": "npm test", "SETUP_STEPS": "" }`. The values are the detected commands, the
   user's answers, and the multi-line blocks such as CI steps or formatter lines. Two rules:
   - an empty value deletes a placeholder that sits alone on its line;
   - a placeholder with no value is left as written, which is right only for `intent/TEMPLATE.md`.
2. Render it:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/index/cortex-stamps.mjs" render loop/<template> --values-file <json> > <lands at>
   ```

   GitHub Actions `${{ … }}` passes through untouched.

`verification.md`, `playbook.md` and `settings.hooks.json` are **not recorded**: two are appended to
`CLAUDE.md` and one merged into `settings.json`. Each is a block inside a file the team also writes.
Append a block with the CLI, never by hand: save the filled block to a file outside the repo and run
`node "${CLAUDE_PLUGIN_ROOT}/index/cortex-section.mjs" . --append CLAUDE.md --from <that file>`. It
gives the block the line endings `CLAUDE.md` already has, so a CRLF checkout is not left with both
kinds, and it refuses a block whose heading is already there.
`cortex-section.mjs` tracks the playbook by its shipped texts instead. The
`team-plugin` entries are such a block too, and the CLI above writes them. Every other team file in
the table above is recorded.

### Format what you wrote, then run the repo's own check

A stamped file has to pass the target repo's own checks. On the first real install it did not:
the repo's test script ran `prettier --list-different`, and ten files Cortex had just written
failed it. The format hook stamped in this pass only takes effect in the *next* session, so this
session has to format by hand.

1. **Write LF line endings** in every file you create, whatever your checkout of the templates has.
   A block added to a file that is already there takes that file's endings, which is what `--append` does.
2. **Run the repo's formatter on exactly the files you wrote.** `state.formatters` in the step 4
   `--json` output lists what this repo declares, as `{ glob, command }`. Run
   `<command> <file>` for each file you wrote that matches a glob. Never run it on `.`: that
   reformats files you did not write, and nobody asked for that diff.
3. **Run the repo's own lint/format check**: the verification block's lint row, or the
   `format:check` / `lint` script the manifest declares. Then run
   `node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-placeholders.mjs" <the files you wrote>`, which exits 1
   and names every template placeholder still left in them.
4. **If the check still fails on a file you wrote, fix that file.** If you cannot, report the
   failure with its output in step 8. Never edit the repo's formatter or lint config to make it
   pass. If no formatter is declared, say so; step 3 still runs.

### Record what you stamped, and apply the updates

**After formatting, record each whole-file loop file**, with the same values file:

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-stamps.mjs" record . <lands at> loop/<template> --values-file <json>
```

Record what is on disk now. The command writes `.cortex/stamps.json` and nothing else.

If it warns **not re-renderable**, the file holds lines its values do not produce, usually because
the formatter rewrote them. It is still recorded, but a later template change will ask about it
instead of updating it. Name those files in step 8.

**Apply the `Update` row the user confirmed** through the CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-stamps.mjs" update . <each confirmed path>
```

It re-renders each file from its recorded values, records it again, and refuses anything not in
state `update`. Never re-render a stamped file yourself. A section in the row goes through
`cortex-section.mjs . --replace <id>` ([TEAM.md](TEAM.md)); never edit `CLAUDE.md` by hand for it.

For each `review` or `conflict` file the user answered, apply their choice by hand, then `record`
it again.

## 8. Close

State what was written, as the same list of paths from step 6, so the promise and the result can be
read side by side — **read back from disk, not from what you meant to write**. Rerun
`cortex-loop.mjs . --json`: a confirmed row still in `missing` was not written, whatever your tool
calls looked like. If it carries a non-empty `protectedWrites`, Claude Code refused it — see
[RUNS.md](RUNS.md#running-unattended). Then state what was marked **later**, by name — a
deferred offer that goes unmentioned is a decision the user made and Cortex quietly dropped.

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-loop.mjs" . --line
```

**End with that one line, not a menu.** It says what the loop is still missing or that it is closed,
and it is the last thing the user reads. A list of eleven commands sorted by nothing is where an
install stops being useful — they leave holding options instead of a step. If the line names
`evals/` or `bands.yaml`, add one sentence saying what each is waiting for: task history, or a
metric with a history. Do not present it as work this pass left undone.

Then: suggest committing what was written so the team shares it, `.cortex/stamps.json` included (it
is how the next release's re-run tells the team's edits from Cortex's own), and mention `/dream` at the end of
a working day, because `.cortex/memory/` is the only part of the loop that nothing on disk will
remind them about.

## Gotchas

- **Re-running is the supported path, and it is cheap.** Satisfied rows come back as `present` and
  are not asked again; deferred ones come back as `missing`. What an earlier pass wrote is kept, so a
  re-run looks again at whether a skill is still true (`skill-drift`), and whether a stamped file or
  a section in `CLAUDE.md` is behind this release (the stamp record, `cortex-section.mjs`). Step 5.
- **`.cortex/index/` and `.cortex/findings/` are generated** and gitignored. `.cortex/memory/` and
  `.cortex/stamps.json` are **committed** — that asymmetry is deliberate and worth explaining once.
- **A hook that asks a human belongs at the release gate, not the build.** An approval prompt
  during implementation puts a person on the critical path of every session running in parallel,
  which is the bottleneck this whole loop exists to remove.
- **The indexer resolves imports by convention**, so dynamically loaded files look like orphans.
  Present orphans as "worth checking", never "safe to delete".
- **On a monorepo**, offer to run against one package rather than the whole tree when the top-level
  file count is very large. The commands are detected at the root, so a repo keeping its manifests
  one level down reports none — say that rather than inventing them.

## Where the shape came from

The loop, the artifact chain and the six stages are Anthropic's AI-native SDLC playbook. The plays
Cortex stamps here are: capture as `intent.md`, requirements and design, plan mode, `CLAUDE.md`,
skills as institutional knowledge, the feedback loop, continuous evals, AI in the PR review loop,
hooks as approval gates, and closing the loop on metrics.

Two plays are deliberately **not** stamped, because they are decisions an install cannot make:
parallel sessions (how many streams one person can review is theirs to find) and CI/CD deployment
through MCP (which needs credentials and an environment Cortex must not touch).
