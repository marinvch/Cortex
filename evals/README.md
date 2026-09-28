# Skill evals

Scored tasks for the Cortex skills whose **text** decides the outcome — not deterministic code — and
whose outcome can be checked exactly. They exist so a skill can be *measured* before and after an
edit, and trained with an optimizer that only keeps edits that measurably help.

| Skill | What is scored | How |
|---|---|---|
| `/ship` | merge order of an open queue; which local branches are safe to delete | order checked against the skill's ranking rules (any valid order passes); deletions as an exact set |
| `/resume` | which branch this checkout's uncommitted work is on; which branches hold local-only work, including dirt in another worktree; which ritual to route to | exact per field; `ahead N` on a merged branch, a clean extra worktree, and a user whose words outrank an open PR queue are traps |
| `/cortex-review` | which documented lines a change made wrong | set F1 on `path:line`; history (CHANGELOG and ADR lines, even in the present tense), unchanged facts and unverified claims are traps, some stale lines never repeat the old literal, and some changes have nothing stale |

`/cortex` and `/cortex-next` are deliberately absent: their decisions are made by `index/lib/loop.mjs`
and `index/lib/next.mjs`, so tuning their prose would move no score.

## Layout

- `scenarios/<skill>.mjs` — a seeded generator (`generate`), the prompt it renders (`render`), the
  ground truth it knows by construction (`truth`) and the checker (`score`).
- `data/<skill>/{train,val,test}/tasks.json` — generated, committed, reproducible:
  `node evals/generate.mjs --check` fails if a file differs from what its seeds write.
- `score.mjs` — **the one scorer**. Anything that runs these tasks pipes `{task, prediction}` lines
  through it rather than re-implementing a rule.
- `run.mjs` — runs a skill's tasks against a real model and records or checks its baseline.
- `baselines/<skill>.json` — the score the current SKILL.md body earned, keyed to that body's hash.
- `test/` — the scorer is tested before anything trusts it: every correct answer scores 1, and each
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
  them). Each reply is written to `.cortex/evals/<skill>/<split>/`, which is gitignored. All three
  skills take about three minutes: 42 calls, four at a time.
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
effort. The first tasks failed that check (#472). With no skill, `/resume` scored 0.944 soft and
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

## Adding a skill

Add `scenarios/<skill>.mjs` exporting `generate`, `render`, `truth` and `score`; register it in
`skills.mjs`; add its correct-answer builder and at least one trap to `test/evals.test.mjs`; run
`node evals/generate.mjs <skill>`; then `node evals/run.mjs <skill> --record`, because `--check`
fails on a registered skill with no baseline. Also run it once with no skill at all, which is the
control in the table above, so you know whether its alarm can fire. A skill earns a row only if its correct answer is known by
construction — a task judged by a model is a task that can drift.
