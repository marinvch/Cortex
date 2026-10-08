# `evals/` — scored tasks for skills

Read [`docs/changing-cortex.md`](../docs/changing-cortex.md) first; it holds the invariants that
apply to every package. [`README.md`](README.md) is the manual for this directory: how to run a
skill's tasks, record a baseline, train with SkillOpt, and add a skill. This file holds what must
stay true when you change the code here.

Nothing in the product imports from `evals/`, and `evals/` imports nothing from `core/`, `index/` or
`mcp/`. Its one import from outside is the frontmatter parser in `tools/`, which `triggers.mjs` uses
to read a ritual's description.

## The rules

- **There is one scorer.** `score.mjs` sends a reply to its scenario's `score`. `run.mjs` calls
  `scoreTask`, and SkillOpt's Python adapter shells out to the command. Do not write a rule a second
  time in a harness. Two scorers that disagree train a skill against a number its baseline never
  saw. `test/score.test.mjs` holds the function and the command to the same result.
- **Ground truth is built, never judged.** A scenario's `truth(s)` is known because `generate(seed)`
  built the situation. A task whose right answer needs a model to decide does not belong here: it
  can drift between runs, and then a baseline means nothing.
- **A scenario is four exports**: `generate(seed)`, `render(state)`, `truth(state)` and
  `score(prediction, truth)`. `system(body)` is a fifth, optional one, for a skill whose text has a
  placeholder to fill. `skills.mjs` is the only list of scenarios. Everything else reads it.
- **`score` returns `hard`, `soft` and `reason`.** `hard` is 1 only when every part is right. `soft`
  is partial credit and its weights are part of the contract: `run.mjs --record` compares both
  against the last baseline. `test/<skill>.test.mjs` pins the weights and the reason text on a
  state written by hand. Change a weight and that test in the same commit.
- **The task files are generated and committed.** After changing a generator, run
  `node evals/generate.mjs <skill>`; `node evals/generate.mjs --check` fails in CI if a file differs
  from what its seeds write. Importing `generate.mjs` writes nothing. Only running it does, and a
  test checks that.
- **A model run never happens in CI.** `run.mjs` refuses one when `CI` is set, and CI runs
  `--check` only. Tests pass a stub as `deps.call`. Do not add a test that needs the `claude` binary.
- **A baseline is recorded, never typed.** `node evals/run.mjs <skill> --record` writes it, and
  refuses a drop past the limits unless `--accept-drop` gives a reason. `triggers.mjs --record`
  refuses to lower its number at all.

## Gotchas

- **A baseline is keyed to the skill's body, not to its tasks.** Change a generator and `--check`
  still passes, while the recorded score was earned on tasks that no longer exist. Record the
  baseline again in the same pull request as the generator change.
- **One run is a noisy baseline.** Repeated runs of one unchanged body have differed by one task.
  The limits in `run.mjs` are set from that. Before reading a small change as a gain or a loss, run
  it more than once, and write what you ran in [`REJECTED.md`](REJECTED.md) if the change is dropped.
- **An answer is the last `KEY: value` line for each key.** A reply may reason first and correct
  itself. `readAnswer` and `listOf` in `lib.mjs` hold the reading rules, including what ends a list.
  A scenario that parses a reply its own way will score a real reply as a miss.
- **A scorer's regex is evidence from real replies.** Several patterns in `scenarios/` carry a
  comment naming the reply that needed them. Loosening one to pass a new reply can pass a wrong
  answer: add the reply as a test case first, with a wrong reply beside it.
- **The trigger check counts shared words.** It can say a description lacks a word people type. It
  cannot say a ritual would be chosen. Do not report its number as how often a ritual fires.
- **`skillopt/` is Python and has no test here.** The suite is Node only. Keep the adapter thin:
  it reads tasks, calls the model, and pipes `{task, prediction}` lines through `score.mjs`.

## Checks

```bash
node --test evals/test/*.test.mjs     # the scorers, the runner with a stubbed model, the trigger check
node evals/generate.mjs --check       # every task file is what its seeds write
node evals/run.mjs --check            # every baseline matches its skill's current body; triggers hold
```
