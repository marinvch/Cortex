# Skill evals

Scored tasks for the Cortex skills whose **text** decides the outcome — not deterministic code — and
whose outcome can be checked exactly. They exist so a skill can be *measured* before and after an
edit, and trained with an optimizer that only keeps edits that measurably help.

| Skill | What is scored | How |
|---|---|---|
| `/ship` | merge order of an open queue; which local branches are safe to delete | order checked against the skill's ranking rules (any valid order passes); deletions as an exact set |
| `/resume` | which branch the uncommitted work is on; which branches hold local-only work; which ritual to route to | exact per field |
| `/cortex-review` | which documented lines a change made wrong | set F1 on `path:line`; history (CHANGELOG, ADRs) and unchanged facts are traps, and some changes have nothing stale |

`/cortex` and `/cortex-next` are deliberately absent: their decisions are made by `index/lib/loop.mjs`
and `index/lib/next.mjs`, so tuning their prose would move no score.

## Layout

- `scenarios/<skill>.mjs` — a seeded generator (`generate`), the prompt it renders (`render`), the
  ground truth it knows by construction (`truth`) and the checker (`score`).
- `data/<skill>/{train,val,test}/tasks.json` — generated, committed, reproducible:
  `node evals/generate.mjs --check` fails if a file differs from what its seeds write.
- `score.mjs` — **the one scorer**. Anything that runs these tasks pipes `{task, prediction}` lines
  through it rather than re-implementing a rule.
- `test/` — the scorer is tested before anything trusts it: every correct answer scores 1, and each
  trap (deleting a squash-merged branch that kept commits, flagging a CHANGELOG line, inventing a
  finding on a clean change) scores below 1. A scorer that passed a wrong answer would train a skill
  toward the wrong behaviour and report it as an improvement.

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
`node evals/generate.mjs <skill>`. A skill earns a row only if its correct answer is known by
construction — a task judged by a model is a task that can drift.
