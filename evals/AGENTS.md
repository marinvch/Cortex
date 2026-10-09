# `evals/` — scored tasks for skills, and the outcome harness

Read [`docs/changing-cortex.md`](../docs/changing-cortex.md) first; it holds the invariants that
apply to every package. [`README.md`](README.md) is the manual for this directory: how to run a
skill's tasks, record a baseline, train with SkillOpt, add a skill, and run the outcome harness. This
file holds what must stay true when you change the code here.

Nothing in the product imports from `evals/`, and `evals/` imports nothing from `core/`, `index/` or
`mcp/`. Its one import from outside is the frontmatter parser in `tools/`, which `triggers.mjs` uses
to read a ritual's description. `harness/` and `claude.mjs` import nothing from outside `evals/` at
all, and `test/harness-run.test.mjs` checks both directions.

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
- **A model run never happens in CI.** `run.mjs` and `harness/run.mjs` refuse one when `CI` is set,
  and CI runs `--check` only. Tests pass a stub as `deps.call`, or as `deps.session` for the
  harness. Do not add a test that needs the `claude` binary.
- **A baseline is recorded, never typed.** `node evals/run.mjs <skill> --record` writes it, and
  refuses a drop past the limits unless `--accept-drop` gives a reason. `triggers.mjs --record`
  refuses to lower its number at all.

## The outcome harness (`harness/`)

It compares one built repo with its context layer against the same repo without it. Every number it
prints rests on the rules below. [`README.md`](README.md#the-outcome-harness) says how to run it, and
[the spec](../docs/specs/2026-10-09-outcome-harness-design.md) holds the reason for each choice.

- **The arms differ in one list.** `fixture.mjs` writes both arms from the same strings, and the
  with-arm adds `CONTEXT_LAYER`. Do not build an arm any other way, and do not add a file to one
  arm outside that list: a second difference would be measured as if the layer had made it.
  `test/harness-fixture.test.mjs` compares the two built trees whole.
- **The launch is the same in both arms.** The prompt, `sessionArgs()` and `SESSION_ENV` never read
  the arm. Only the working directory differs, and its path does not name the arm. Neither does any
  file or the commit.
- **No base file states a rule.** Each rule in `RULES` keeps a list of `phrases` beside its
  sentence, and a test fails if a base file carries one. The code may hold a rule's *evidence* (a
  helper, a pattern to copy), and it must: a task only a reader of the layer could pass is rigged.
- **`accept.mjs` is the harness's one scorer, and a command decides every result.** `run.mjs` calls
  `accept()` and nothing else decides a pass. No model judges a session. A test holds the function
  and the command to one result.
- **The acceptance files never enter a working copy.** `accept/` and `solutions/` stay in Cortex.
  The scorer judges a copy of the tree and writes the shop's own tests back first, so a session
  cannot pass by editing a test or read what it is judged by.
- **A rule check tests a property, never a spelling.** It must not depend on a function name, a file
  name, a status word or an audit label the session chose. Add a correct change spelled another way
  as a test before tightening one.
- **Every rule task has a `good` and a `naive` patch.** `good` touches no layer file and passes in
  both arms. `naive` passes `works` and fails `rule`. A task without both has not been shown to be
  fair, or to be able to fail.
- **A failed call is never a zero.** `classify()` separates a session to score from a call that
  failed. A failed call is retried, listed, and left out of the denominator. Reaching the turn limit
  is a scored session. A scorer that could not run stops the run.
- **`RESULTS.md` is append-only and written by `run.mjs --record`.** Never edit a section, and never
  add a flag that takes a count. The reading comes from `reading()`, whose thresholds were fixed
  before the first session. Changing one after a result is in is choosing the reading.
- **A change to a fixture file or a prompt raises `FIXTURE_VERSION`.** The version and both tree
  hashes go into every record, and `--resume` refuses a run made on another.
- **The reference patches fail loudly.** `applyPatch` throws when its text to replace is absent or
  repeated, so a fixture edit that outdates a patch breaks a test instead of a measurement.

## Gotchas

- **The harness tests are the slow ones.** `test/harness-run.test.mjs` runs several stubbed
  measurements through the real scorer, which is three `node --test` runs per tree. Expect about two
  minutes for the file. Use `--test-name-pattern` while working on one property.
- **A test that calls `main()` with no injected session is one broken guard away from a real run.**
  The CI-refusal test does that on purpose, so it points `CLAUDE_CLI_BIN` at a binary that does not
  exist. Do the same in any new test of that kind, and when mutation-checking the runner: removing
  the refusal has started real sessions on a contributor's login once.
- **`harness/templates/` holds results the real CLI printed**, with ids zeroed. The stub answers with
  them so the parser is tested against the CLI's own shape. Replace one with a new capture; do not
  edit a field by hand to suit a test.
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
node --test evals/test/*.test.mjs     # the scorers, both runners with a stubbed model, the trigger check
node evals/harness/run.mjs --dry      # the harness end to end with a stubbed session; writes nothing here
node evals/generate.mjs --check       # every task file is what its seeds write
node evals/run.mjs --check            # every baseline matches its skill's current body; triggers hold
```
