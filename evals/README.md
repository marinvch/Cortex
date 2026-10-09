# Skill evals

Changing code here? [`AGENTS.md`](AGENTS.md) holds the rules that must stay true.

Scored tasks for the Cortex skills whose **text** decides the outcome — not deterministic code — and
whose outcome can be checked exactly. They exist so a skill can be *measured* before and after an
edit, and trained with an optimizer that only keeps edits that measurably help.

| Skill | What is scored | How |
|---|---|---|
| `/ship` | merge order of an open queue; which local branches are safe to delete | order checked against the skill's ranking rules (any valid order passes); deletions as an exact set |
| `/resume` | which branch this checkout's uncommitted work is on; which branches hold local-only work, including dirt in another worktree; which ritual to route to | exact per field; `ahead N` on a merged branch, a clean extra worktree, and a user whose words outrank an open PR queue are traps |
| `/cortex-review` | which documented lines a change made wrong | set F1 on `path:line`; history (CHANGELOG and ADR lines, even in the present tense), unchanged facts and unverified claims are traps, some stale lines never repeat the old literal, and some changes have nothing stale |
| `/cortex` | on a repo it already serves, what the one confirmation offers for the files an earlier pass stamped, from `cortex-stamps.mjs --json` | `UPDATE` as an exact set (only `update` files); `ASK` as an exact set (every `review` and `conflict`, a `missing` file optional); `WRITTEN: none` and no write claimed in the prose; the plugin update named when a newer Cortex stamped the repo. Traps: `review` (untouched, but not re-renderable), `edited`, a newer Cortex's record whose states read as updates, nothing to update, and a user who says to "just update everything" |
| `team-ask` — the team playbook, `templates/team/playbook.md` | before any work, the session reports the `--size` recommendation, ends with "Single agent or team?" and stops (#498) | per part: the exact question; it is the last line; no code, plan or hand-off; the recommendation reported (or "cannot size" when there is none); no claim the developer answered or that it asked. Traps: team-sized, single-sized, a request to "just do it", and no recommendation |

A second measurement lives here too. [The outcome harness](#the-outcome-harness) asks a different
question: whether a repo's context layer makes an agent do a task right more often. It is a working
session with tools, in a built repo, and it shares nothing with the skill evals but the code that
starts `claude`.

`/cortex-next` is deliberately absent: `index/lib/next.mjs` makes its decisions, so tuning its prose
would move no score. `/cortex` is measured only where its prose decides. `index/lib/loop.mjs` decides
which loop rows exist, and is not measured. How a stamp state becomes a row of the one confirmation is
the skill's own table, and so is the promise to write nothing before that confirmation.

## Layout

- `scenarios/<skill>.mjs` — a seeded generator (`generate`), the prompt it renders (`render`), the
  ground truth it knows by construction (`truth`) and the checker (`score`).
- `data/<skill>/{train,val,test}/tasks.json` — generated, committed, reproducible:
  `node evals/generate.mjs --check` fails if a file differs from what its seeds write.
- `score.mjs` — **the one scorer**. Anything that runs these tasks pipes `{task, prediction}` lines
  through it rather than re-implementing a rule.
- `run.mjs` — runs a skill's tasks against a real model and records or checks its baseline.
- `claude.mjs` — starts the `claude` CLI and reads the one JSON object it prints. `run.mjs` and
  `harness/run.mjs` both call it; each keeps its own arguments.
- `harness/` — [the outcome harness](#the-outcome-harness): its fixture, tasks, scorer and runner.
- `baselines/<skill>.json` — the score the current SKILL.md body earned, keyed to that body's hash.
  A skill whose text is not a `skills/<name>/SKILL.md` names its file in `SKILL_FILES` in
  `skills.mjs`. `team-ask` names the playbook template this way, and `--check` follows that file.
  Its scenario's `system(body)` fills `{{ROSTER}}` first. SkillOpt's adapter still reads
  `skills/<name>/SKILL.md` only, so `team-ask` is measured here but not trained there.
- `test/` — `evals.test.mjs` runs every generated task, and `<skill>.test.mjs` pins one scenario's
  weights and reasons on a state written by hand. The scorer is tested before anything trusts it: every correct answer scores 1, and each
  trap (deleting a squash-merged branch that kept commits, flagging a CHANGELOG line, inventing a
  finding on a clean change) scores below 1. A scorer that passed a wrong answer would train a skill
  toward the wrong behaviour and report it as an improvement.

## Did my edit make it worse?

Edit the body of a skill listed in `skills.mjs` and CI fails until you re-measure it:

```bash
node evals/run.mjs --check                 # no model: does every baseline match its skill's current body?
node evals/run.mjs ship                    # score the current body; writes no baseline
node evals/run.mjs ship --record           # score it and store evals/baselines/ship.json
node evals/run.mjs ship --record --accept-drop "why the lower score is worth it"
```

- **What a run is.** The same rollout SkillOpt does, in Node: the SKILL.md body is the system
  prompt, each task's `prompt` is the user message, and `score.mjs` scores the reply. It runs
  through `claude -p` on your own login, isolated: an empty temp cwd, local settings only, and no
  tools, MCP servers or skills. `CLAUDE_CLI_BIN` names a non-default binary. The default target is
  `claude-sonnet-5` at `medium` effort, the SkillOpt target (`--model` and `--effort` override
  them). Each reply is written to `.cortex/evals/<skill>/<split>/`, which is gitignored. All five
  take about five minutes: 70 calls, four at a time.
- **What the baseline is keyed to.** The hash covers the body only. Frontmatter is stripped and CRLF
  becomes LF first, so a description edit or a Windows checkout never demands a re-measure.
- **The alarm.** `--record` refuses, leaving the file untouched, when mean `soft` falls more than
  0.1 below the previous baseline, **or mean `hard` falls more than 0.2**. Soft is partial credit,
  so a skill that gets every task *nearly* right keeps most of it. Hard counts whole tasks: on 14
  tasks, one task is 0.071. The hard limit is therefore three tasks, because repeated runs of one
  unchanged body differed by one task, never three. `--accept-drop "<reason>"` records either drop
  anyway and keeps the reason as `note`. It also refuses when any model call failed: a timeout
  scores 0, so a baseline recorded through an outage would set a bar low enough to hide the next
  real regression.
- **Where it runs.** CI runs `--check` only. A model run spends your subscription, and `run.mjs`
  refuses one when `CI` is set.

**Can the alarm fire?** Only if deleting the skill costs more than the limit. So each skill is also
run with **no skill at all**: a one-line generic system prompt, on the same `test` tasks, model and
effort (`node evals/run.mjs <skill> --no-skill`, which never records). The first tasks failed that check (#472). With no skill, `/resume` scored 0.944 soft and
`/cortex-review` 0.986, so either body could have been deleted without tripping the alarm. Their
generators now build traps from each skill's own rules:

- `/resume`: `ahead N` on a branch that `--no-merged` does not list; dirt in another worktree; a
  user who is leaving, or back from time away, while open PRs are present.
- `/cortex-review`: ADR and CHANGELOG lines written in the present tense; claims that depend on
  hunks the summary does not show; stale lines that never repeat the old literal.

Measured on 2026-09-28 with `claude-sonnet-5` at medium effort:

| Skill | tasks | with skill (hard / soft) | no skill (hard / soft) | drop (hard / soft) | alarm fires on |
|---|---|---|---|---|---|
| `/ship` | unchanged | 1.000 / 1.000 | 0.357 / 0.869 | 0.64 / 0.13 | both |
| `/resume` | first version | 1.000 / 1.000 | 0.786 / 0.944 | 0.21 / 0.06 | hard, by one task |
| `/resume` | harder | 0.857 / 0.952 | 0.143 / 0.653 | 0.71 / 0.30 | both |
| `/resume` | harder, skill text fixed | 1.000 / 1.000 | 0.143 / 0.670 | 0.86 / 0.33 | both |
| `/cortex-review` | first version | 1.000 / 1.000 | 0.929 / 0.986 | 0.07 / 0.01 | neither |
| `/cortex-review` | harder | 0.643 / 0.927 | 0.357 / 0.864 | 0.29 / 0.06 | hard only |
| `/cortex-review` | harder, skill text fixed | 0.929 / 0.992 | 0.286 / 0.840 | 0.64 / 0.15 | both |
| `team-ask` | first version (2026-09-29) | 1.000 / 1.000 | 0.000 / 0.354 | 1.00 / 0.65 | both |
| `/cortex` | first version (2026-09-30) | 0.929 / 0.998 | 0.714 / 0.975 | 0.21 / 0.02 | hard, by one task |
| `/cortex` | with adoption, skill text fixed | 1.000 / 1.000 | 0.571 / 0.953 | 0.43 / 0.05 | hard only |

**`/cortex`'s soft score cannot carry its alarm.** `cortex-stamps.mjs --json` explains most states
by itself, so a reply with no skill gets most of each task right and loses whole tasks instead. It
asks about an `edited` or `update` file one by one. Under pressure, it said "I'm applying them"
before any confirmation. The hard drop of 0.43 is six tasks, so the hard limit of three fires.
Adding adoption did not widen the gap: the reply with no skill got all three adopt tasks right.
The first run found a gap in the skill text. When a newer Cortex stamped the repo, the skill said
to offer no stamp row, and the model still listed the states as what the pass after the plugin
update would offer. Those states are measured against older templates and will read differently
then. The skill now says not to list them, and the recorded run scored 1.000.

`team-ask` also ran the playbook as it was before #498: 0.000 / 0.418. It could not know the exact
sentence. A looser reading counts a closing single-or-team question in any words, with no work
started. On that reading it asked and stopped on 11 of 14 tasks, and the three it missed were all
requests to "just do it".

The first draft of the fix scored between 0.786 and 1.000 hard over four runs. Its misses were
replies that listed every reason and never named the recommendation. The playbook now says to
name it in words; the recorded run and a repeat both scored 1.000.

Those runs also showed the scorer marking down correct replies: "couldn't produce a real
recommendation", "returned none" and "recommends working solo". Each phrase is now accepted, and
each has a test.

The with-skill row is the recorded baseline. An unrecorded repeat of the fixed text scored
0.857 / 0.990 on `/resume` and 1.000 / 1.000 on `/cortex-review`. No-skill runs vary more: two runs
of the first `/resume` tasks scored 0.786 and 0.571 hard.

**The harder tasks exposed two gaps in the skill text, and fixing the text closed both.** In
`/cortex-review`, almost every miss was a present-tense ADR `Decision:` line flagged as stale,
because the body called only "ADR rationale" history. It now says that every ADR line and every
CHANGELOG entry is history in whatever tense it is written, as `index/lib/review.mjs` already
treats them. In `/resume`, a branch whose only dirt was in another worktree went on the
`UNCOMMITTED` line. The report shape now says `Uncommitted` covers this checkout alone, and that
the other worktree goes on `Diverged`. The first try at that edit only reworded the two shape
lines, and it scored *worse* (0.714 / 0.905): the model put the worktree on both lines. Stating
where the worktree goes, in its own sentence, is what fixed it.

## Training a skill with SkillOpt

[SkillOpt](https://github.com/microsoft/SkillOpt) treats the skill document as trainable state:
the target model runs tasks with the skill as its system prompt, an optimizer model proposes bounded
edits from the failures, and an edit is kept only if it raises the score on the held-out `val` split.
`skillopt/` holds the adapter; nothing in it ships to or runs for a plugin user.

```bash
git clone https://github.com/microsoft/SkillOpt ~/src/SkillOpt
python -m venv .venv && .venv/bin/pip install "git+https://github.com/microsoft/SkillOpt.git@main"
export SKILLOPT_SRC=~/src/SkillOpt
export CLAUDE_SETTING_SOURCES=local      # isolate each `claude -p` from your plugins and hooks
# Windows: export CLAUDE_CLI_BIN=".../npm/claude.cmd"

python evals/skillopt/run.py eval  --cortex-skill ship --skill .cortex/skillopt/ship/initial_skill.md --split valid_unseen
python evals/skillopt/run.py train --cortex-skill ship
```

Both roles run through `claude -p` on your own Claude login (`claude_chat`), so there is no API key
and the budget is your subscription's. Output goes to `.cortex/skillopt/<skill>/` (gitignored). The
trained document is a **proposal**: compare its test score to the baseline, read the diff, and carry
the edits into `skills/<skill>/SKILL.md` by hand. Frontmatter is never trained — it is routing
metadata, checked by `tools/cortex-frontmatter.mjs`.

## Triggers: is a ritual's description made of the words people use?

A ritual a model may invoke is found through its `description`. Edit that sentence and nothing
fails; the ritual is reached less. `triggers/<ritual>.json` holds, for each of those rituals:

- `reach`: at least three things a person would type to get it;
- `elsewhere`: at least one prompt that sounds close and belongs to a named other ritual (`owner`).

`node evals/triggers.mjs` ranks every prompt against every model-invocable ritual's name and
description, with BM25 and no model. `node evals/run.mjs --check` runs it too, so CI does. It fails
when a `reach` prompt ranks its ritual below the top three, when an `elsewhere` prompt ranks the
ritual above its owner, when a `reach` prompt is only one of the description's own quoted triggers,
or when the share of `reach` prompts ranked first falls below `baselines/triggers.json`.
`--record` writes that share and refuses to lower it. `node evals/triggers.mjs <ritual>` shows one
ritual prompt by prompt, with what outranked it.

**It measures words, not routing.** Claude Code's router reads meaning; this counts shared words. A
prompt ranked first here can still go elsewhere, and a paraphrase that shares no word with the
description fails here while the router would reach it. So a failing prompt is a question, with two
honest answers: the description lacks a word people say (add it), or the prompt is a paraphrase
this ranker cannot see (replace it, and do not bend the description to a word nobody uses).
Whether the real router reaches a ritual is a separate measurement, not made here.

## The outcome harness

**The claim under test:** an agent given a task in a repo that has the Cortex context layer (a root
`AGENTS.md`, scoped briefs, `CONTEXT.md`, ADRs) does the task right more often than the same agent
in the same repo without it. "Right" has two parts: the change does what was asked, and it respects
the rule the repo's documents state. The design, with the reason for every choice, is
[`docs/specs/2026-10-09-outcome-harness-design.md`](../docs/specs/2026-10-09-outcome-harness-design.md).

```bash
node evals/harness/run.mjs --dry                        # no model: the schedule, and a table from a stubbed run
node evals/harness/run.mjs --probe                      # the preflight and the two probe calls, nothing else
node evals/harness/run.mjs --tasks search-empty --once  # a partial run: some tasks, one repeat. Never read
node evals/harness/run.mjs                              # the measurement: 2 probes, then 30 sessions
node evals/harness/run.mjs --record                     # the same, appended to harness/RESULTS.md
node evals/harness/run.mjs --resume <run> [--record]    # continue an interrupted run from its records
node evals/harness/accept.mjs <task> <tree>             # the scorer alone: exit 0 pass · 1 fail · 2 could not run
```

Only `--dry` and `accept.mjs` run without a model. Everything else spends your own Claude login,
is run by hand, and refuses when `CI` is set. No flag takes a number: the model, the effort, the
repeats and the turn limit are constants in `harness/run.mjs`, and a result is never typed.

### What it builds and runs

- **The fixture** is a generated repo named `shop`, a small checkout service in Node with no
  dependencies. `harness/fixture.mjs` holds every file as a string and builds it twice. The
  **with-arm** adds the nine files listed in `CONTEXT_LAYER`; the **without-arm** is the same build
  minus that list. Both are a git repo with one pinned commit, in a directory whose path does not
  name the arm.
- **Four rules** are stated only in the layer, are followed by every line of the existing code, and
  are enforced by no test in the shop's own suite: money goes through one rounding helper, an order
  is never removed and each status change writes one audit entry, a stored shape changes only
  through a new migration, and a route module imports services only.
- **Five tasks** (`harness/tasks.mjs`), each sent as written to both arms. Four depend on one rule
  each. The fifth, `search-empty`, is the control: the layer says nothing that bears on it.

| Task | Asks for | Rule it depends on |
|---|---|---|
| T1 `discount` | 10% off carts of 100.00 or more | R1 money |
| T2 `cancel` | `DELETE /orders/:id` | R2 orders, reached through the root's routing table |
| T3 `note` | a free-text note on orders, old ones included | R3 migrations |
| T4 `by-status` | `GET /orders?status=` | R4 layering |
| T5 `search-empty` | fix a 500 on an empty catalog search | none (control) |

- **One session** is one `claude -p` process in a fresh copy of one arm, with the prompt on stdin:
  `claude-sonnet-5` at `medium` effort, `acceptEdits` with an allow-list for `node`, `npm test` and
  read-only `git`, project and local settings only, no MCP servers, no skills, no saved session, 40
  turns and 15 minutes at most. `sessionArgs()` is the list, and the spec quotes the docs sentence
  behind each flag. Both arms get the same bytes of prompt, the same arguments and the same
  environment. Only the working directory differs.
- **The schedule** is 5 tasks × 2 arms × 3 repeats. Each repeat runs the tasks in an order rotated
  by one, and the two arms of a task start together, so whatever drifts during a run reaches both
  arms of a pair alike. The fifteen pairs run one after another.
- **Before any session**, the run stops if a `CLAUDE.md`, `CLAUDE.local.md` or `AGENTS.md` sits in
  any directory above the temp directory (it would load in both arms), or if Claude Code is older
  than 2.1.259. Then **two probe calls**, one per arm, ask for a codename that only the root brief
  states. The with-arm must answer it and the without-arm must not, or the run stops before the
  thirty sessions are spent.

### How a result is decided

`harness/accept.mjs` is the only scorer, and no model judges anything. On a copy of the tree a
session left, it runs three things under `node --test`:

1. the shop's own tests, written back from the fixture first, so a session that edited or deleted
   a test cannot pass by it;
2. `accept/<task>.works.test.mjs`, which tests only what the prompt asks for;
3. `accept/<task>.rule.test.mjs`, which tests the rule by its property and never by a name the
   session chose.

`works` is 1 and 2 together, `rule` is 3, and a session **passes** when both hold. The control has
no rule check. The acceptance files stay in Cortex and are never copied into a working copy.

`harness/solutions/` holds two reference patches for each rule task. `good` is written from the
base tree alone and passes in both arms, so every task can be done without the layer. `naive` does
what was asked and breaks the rule, so every rule check can fire. The tests hold both.

**A failed call is not a failed task.**

| What happened | Counted as |
|---|---|
| The session ended and the scorer answered pass or fail | a scored session |
| The session reached `--max-turns` | a scored session, on the tree as left, marked `budget` |
| The process could not start, printed no result object, reported an error, ran past 15 minutes, or never ran the pinned model | a **failed call**: not scored, retried up to twice, every attempt listed |
| The scorer itself could not run | a harness fault: the run stops |

A cell's count is over the sessions that were scored. Three repeats with one call lost read `2/2`,
never `2/3`.

### Reading the table

The table prints raw counts per task and arm, the totals over the four rule tasks, and one reading.
It prints no percentage and no mean of passes, because twelve sessions do not carry one. Turns and
tokens are the median with the range, and they never decide anything.

The reading is computed from the counts by a rule fixed before any session ran. The primary number
is **passes on the rule tasks, out of twelve per arm**. The rows are tried from the top:

| Reading | Condition |
|---|---|
| **suspect** | the control differs by 2 or more of 3 between the arms, or more than 6 calls failed. Nothing is read from the run |
| **tasks do not discriminate** | the without-arm passes 11 or 12 of 12, or the with-arm passes 0 or 1 |
| **supported, at this size** | the with-arm leads by 4 or more, and leads on at least two tasks |
| **not shown** | the lead is 1 or less, or the without-arm leads |
| **inconclusive** | a with-arm lead of 2 or 3, or a lead of 4 or more carried by one task |
| **not read** | the run was not the full schedule (`--tasks`, `--once`, or cells left unfinished) |

- **No significance is claimed, whatever the result.** If both arms truly passed half the time, a
  lead of four or more of twelve would still turn up about one run in thirteen. "Supported" means
  "worth the next thirty sessions".
- **Five tasks on one fixture is one repo's worth of evidence.** It says nothing about a large
  codebase, another language, or a stale or bloated layer, and it cannot say which document did the
  work.
- **No sentence anywhere cites the harness as evidence unless the reading is "supported".**

### The records and `RESULTS.md`

Each attempt writes its result JSON, the scorer's verdict and the session's diff to
`.cortex/evals/harness/<run>/`, which is gitignored, and the working copy is deleted. Every record
carries the fixture's version and the hash of its arm's tree. A run that stops says how to continue
it, and `--resume` refuses a run made with another fixture version, model or effort.

`harness/RESULTS.md` does not exist until the first `--record`. It is written by that command from
a run's records and is only ever appended to: one dated section per measurement, holding the model
the sessions reported, the Claude Code version, the fixture version and both tree hashes, the
table, every failed session and failed call with its reason, the cost, the time, and whether
`~/.claude/CLAUDE.md` existed during the run. A section is never edited, and the same run is never
recorded twice. An incomplete run can be recorded, and its heading says how many of thirty sessions
were scored. The file is a log and gates nothing, which is how it differs from `baselines/`.

### Before the first measurement

Run these in order. Each one is cheaper than the next and can stop you before it:

1. `node --test evals/test/harness-*.test.mjs` and `node evals/harness/run.mjs --dry`: the harness
   favours neither arm, shown with a stub.
2. `node evals/harness/run.mjs --probe`: two calls. The with-arm knows the codename and the
   without-arm does not.
3. `node evals/harness/run.mjs --tasks search-empty --once`: one real session of the control in
   each arm. Read both records under `.cortex/evals/harness/<run>/`. A `denials` count above zero
   means the session was refused a command; if it was `node` or `npm test`, widen the allow-list in
   `sessionArgs()`, for both arms.
4. `node evals/harness/run.mjs --record`: the measurement.

### Not confirmed

The spec listed what the docs did not state. This is where each stands. Nothing below was settled
by a measured run: step 2.2 made no session, and the first real ones belong to step 2.3.

| Question | Where it stands |
|---|---|
| What `--output-format json` prints when `--max-turns` is reached | **Settled** by the captured result in `harness/templates/result-max-turns.json`: `subtype` is `error_max_turns`, `is_error` is true, there is an `errors` list and no `result` text, and `total_cost_usd`, `num_turns` and `modelUsage` are present. `classify()` scores such a session on its tree |
| Whether `permission_denials` appears in `json` output | **Settled** by both captured results: it is there, as a list. The record keeps its length as `denials`; nothing depends on it |
| `CLAUDE_SETTING_SOURCES` | The harness does not set it. It relies on `--setting-sources` alone |
| Whether leaving `user` out of `--setting-sources` keeps `~/.claude/CLAUDE.md` and `~/.claude/rules/` out of a session | **Open.** If they load, they reach both arms alike, which cannot favour one and can move both. Each recorded section says whether the file existed |
| Whether a project `CLAUDE.md` loads when `project` is left out | **Open, and not depended on.** `project` stays in, and the probe checks at the start of every run that the root brief loads |
| Whether `acceptEdits` plus the allow-list lets a session finish these tasks | **Open** until step 3 above has run once |
| The cost and length of a session | **Open.** The spec's guess is 3 to 8 minutes a session and one to two hours a run. The first recorded section replaces the guess with a number |

### Changing the harness

- A change to any fixture file or any prompt raises `FIXTURE_VERSION`. Results from two versions
  are never added together.
- A new task is a row in `tasks.mjs`, a `works` check, a `rule` check unless it is a control, and a
  `good` and a `naive` patch. `test/harness-accept.test.mjs` then asks the same questions of it as
  of the others: not done already, solvable without the layer, and a rule check that can fire.
- [`AGENTS.md`](AGENTS.md) holds what must stay true.

## What was tried and dropped

[`REJECTED.md`](REJECTED.md) lists changes to a ritual's text that an eval did not support: the text,
the runs, the numbers. Read it before proposing an edit to an evaled ritual, and add to it when a
measured change is not kept, or is kept without a gain.

## Adding a skill

Add `scenarios/<skill>.mjs` exporting `generate`, `render`, `truth` and `score`; register it in
`skills.mjs`; add its correct-answer builder and at least one trap to `test/evals.test.mjs`, and a
`test/<skill>.test.mjs` that pins its weights on a state written by hand; run
`node evals/generate.mjs <skill>`; then `node evals/run.mjs <skill> --record`, because `--check`
fails on a registered skill with no baseline. Also run it once with no skill at all, which is the
control in the table above, so you know whether its alarm can fire. A skill earns a row only if its correct answer is known by
construction — a task judged by a model is a task that can drift.
