# ADR 0018 — Skill quality is measured by evals, not runtime telemetry; Cortex ships no hooks for it

**Status:** accepted · 2026-09-28 · closes #407

## Context

Two tools answer questions about rituals. `tools/cortex-skill-usage.mjs` says which were reached,
and `tools/cortex-skill-graph.mjs --check` says which are connected. Neither sees a ritual that
fires reliably and does the wrong thing. The alarm #407 asked for is narrower: **tell me when my own
edit made a ritual worse.**

The issue proposed a `PostToolUse` hook on the `Skill` tool. It would append `{skill_id,
skill_version, outcome, recorded_at}` to a JSONL file, and an aggregator would flag a skill whose
success rate fell by 0.1. It also named the blocker: `.claude-plugin/plugin.json` declares no
`hooks`, so Cortex's two existing hooks are repo-local dev tooling that reach no user.

A way to measure a skill already existed. `evals/` scores `/ship`, `/resume` and `/cortex-review`
against generated tasks whose answers are known by construction. What was missing was a recorded
score for each skill's current text, a check that the recorded score is for the text that ships,
and a way to run the tasks without Python and SkillOpt.

## Decision

**A skill's quality is its score on its evals, recorded per version of its body.**
`evals/run.mjs <skill> --record` runs the tasks through `claude -p` on the contributor's own login
and writes `evals/baselines/<skill>.json`, keyed to a SHA-256 of the SKILL.md body. Frontmatter is
excluded and line endings are normalised. It refuses to record when mean soft falls more than 0.1
below the previous baseline, unless `--accept-drop "<reason>"` gives a reason, which is kept.
`node evals/run.mjs --check` needs no model and runs in CI. It fails when an evaled skill's body no
longer matches its baseline, so an edit cannot merge unmeasured.

**Cortex ships no hooks for this.** The plugin still declares none, and nothing about measuring a
skill needs one.

## Alternatives rejected

| Option | Why not |
|---|---|
| `PostToolUse` telemetry on `Skill`, as #407 proposed | The hook fires when the skill **loads**, before any outcome exists, so `outcome` would be the model grading its own work. That is unscored, and it would drift the way a model-judged task drifts. It needs a `hooks` key the plugin has never shipped. Its JSONL would land in users' repos or home directories, which conflicts with the consent gate and the data-free rule. |
| Mining the session record, as `cortex-skill-usage.mjs` does | It measures reach. A ritual reached 40 times and wrong 40 times looks the same as one that works. |
| Running the model evals in CI | Every PR would need a model credential and a budget, and its verdict would depend on a sampled model. The hash check is deterministic, and it puts the measuring in front of the one person whose edit needs it. |
| Re-measuring on any change to SKILL.md | Frontmatter is routing metadata and is never trained. A description edit or a CRLF checkout would demand a paid run that measures nothing new. |

## Consequences

- An edit to an evaled skill's body costs its author a run: about three minutes for all three
  skills, on their own subscription. That cost is the point, because the edit is now measured
  before it merges.
- Only skills listed in `evals/skills.mjs` are covered, which is three out of the whole collection.
  A skill whose outcome cannot be checked exactly has no alarm, and none is faked for it.
- The alarm only works when the tasks depend on the skill. With no skill at all, the `test` split
  scored 0.817 soft on `/ship`, 0.944 on `/resume` and 0.986 on `/cortex-review`. Deleting the
  `/resume` or `/cortex-review` body would therefore pass the 0.1 soft threshold.
  `evals/README.md` records the control. Harder tasks for those two are follow-up work.
- The hash covers the body, not the tasks, the scorer or the model. A new model, or a generator
  change, can move scores with no alarm. The baseline records `model` and `effort` so that a
  difference can at least be seen.
