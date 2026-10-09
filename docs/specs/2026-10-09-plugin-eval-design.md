# Design: what `claude plugin eval` can measure for Cortex, and what it cannot

- **Date:** 2026-10-09
- **Status:** Draft for review. Approval was delegated by the maintainer on 2026-10-09; the
  decisions taken under that delegation are listed first.
- **Decided by:** plan step H2 of
  [the next-level roadmap](../plans/2026-10-04-next-level-roadmap.md), from the agent-skills survey
  in [its spec](2026-10-04-next-level-roadmap-design.md)
- **Area:** `evals/` (a generator, a runner and a record, all follow-up work), `.gitignore`,
  `evals/README.md`, [`evals/AGENTS.md`](../../evals/AGENTS.md). This document changes no code.

## Decisions taken for the maintainer

Each line is a decision and the alternative it was chosen over. The reasons are in
[Decisions locked](#decisions-locked).

1. **Adopt it for one question: does a ritual fire.** Alternative: adopt it for everything it
   offers, or for nothing.
2. **Do not adopt it for "what the ritual adds" yet.** The with/without delta on a reply grader is
   deferred until it is run on a machine with a sandbox backend. Alternative: adopt both now.
3. **The prompts come from `evals/triggers/<ritual>.json`.** One list of what people type feeds the
   word check and the router check. Alternative: a second, hand-written set of cases.
4. **Cases are generated at run time into a gitignored directory, `evals/router/`.** Alternative:
   commit about 300 generated files and check them for drift.
5. **`plugin.json` gains no `experimental.evals` key.** The runner passes `--eval-dir`.
   Alternative: record the directory in the manifest that ships to every user.
6. **A maintainer runs it, on their own login, with the model named on the command line. Never in
   CI.** Alternative: a CI job with an API key.
7. **A firing run is one arm, two turns, three runs, read-only tools, no judge model.**
   Alternative: the default two arms and ten turns.
8. **The number is recorded with its model and Claude Code version, and is not a gate.**
   Alternative: refuse a lower number, as `triggers.mjs --record` does.
9. **Step 2.2's harness does not use `claude plugin eval`.** Alternative: reuse its case and grader
   format for the context-layer comparison.
10. **No rule enters `core/claude-code.js` for this.** The facts are cited in `evals/README.md`.
    Alternative: vendor them as rules under ADR 0017.
11. **The hand-run case is not committed.** Its layout is described below. Alternative: commit it
    as the first case.

## Destination

- Cortex can say, for a ritual and a prompt, how many of three sessions invoked the ritual through
  Claude Code's own router, on a named model and a named Claude Code version.
- That number comes from the same prompts the no-model trigger check already holds, so an edit to a
  `description` is checked for words in CI and for routing by the maintainer.
- Nobody reads the word check's rank-1 rate as a firing rate, and nobody reads a firing rate as
  proof the ritual did its job.
- What the command cannot measure on this project is written down, so it is not proposed again.

## Context

**What Cortex has.** `evals/triggers/<ritual>.json` holds, for each of the 39 rituals a model may
invoke, at least three `reach` prompts and one `elsewhere` prompt with its `owner`.
`evals/triggers.mjs` ranks every prompt against every description with BM25. It needs no model and
runs in CI through `node evals/run.mjs --check`. Today 112 of 117 `reach` prompts rank their ritual
first. [`evals/README.md`](../../evals/README.md) says what that is not: "Whether the real router
reaches a ritual is a separate measurement, not made here."

**What Cortex also has.** Five skills have body evals
([ADR 0018](../adr/0018-skill-quality-is-measured-by-evals-not-telemetry.md)). They give the
skill's text to a model as its system prompt and score the answer against ground truth that a
generator built. They say nothing about whether the ritual is chosen.

**What the survey pointed at.** addyosmani/agent-skills keeps plugin eval cases: one folder per
case, graders on the reply, and a with-plugin and a without-plugin arm. The roadmap spec left two
questions for this step: whether the command can measure firing for Cortex, and whether its case
and grader format is worth reusing in step 2.2.

### The command, from Anthropic's docs

Read on 2026-10-09. `P` is <https://code.claude.com/docs/en/plugin-evals.md>, `C` is
<https://code.claude.com/docs/en/plugins/cli-reference.md>, `M` is
<https://code.claude.com/docs/en/plugins/manifest-reference.md>, `S` is
<https://code.claude.com/docs/en/skills.md>. Each sentence is copied, not paraphrased;
only link markup and bold list labels are dropped.

| # | Fact | Source | Sentence |
|---|---|---|---|
| 1 | The command exists | P | "The `claude plugin eval` shell command runs your plugin against a suite of test cases and scores the results." |
| 2 | Minimum version | P | "Claude Code v2.1.269 or later. Run `claude --version` to check and `claude update` to upgrade." |
| 3 | Git floor | P | "Git 2.31 or later, if git is installed." |
| 4 | A case on disk | P | "A case is a directory under the plugin's eval directory that contains a `prompt.md`, a `case.yaml`, or both." |
| 5 | A case needs a grader | P | "Give each case at least one grader, as a `graders/<name>.md` file or a `graders:` entry in `case.yaml`, because a case without one fails to load." |
| 6 | Another eval directory | P | "If `evals/` is already taken by another tool, keep the suite in a different directory." |
| 7 | What that directory may be | P | "Give a relative path of plain directory names such as `qa` or `quality/evals`." |
| 8 | The manifest key is experimental | M | "Container for `themes`, `monitors`, and `evals`, whose manifest shape may still change" |
| 9 | The graders | P | "Of the six types, `regex`, `tool_used`, `tool_order`, and `file_exists` are computed from the transcript and files and cost nothing, while `llm` and `baseline` call a judge model and add to the run's cost." |
| 10 | No code graders | P | "There are no custom-code graders." |
| 11 | The firing grader | P | "This passes when Claude invoked that skill at least once during the run, including by its namespaced `plugin-name:skill-name` form." |
| 12 | What a firing case measures | S | "If the skill ships in a plugin, you can measure how often it triggers across realistic prompts rather than checking one at a time: write an eval case with a `tool_used: Skill` grader and run it with `claude plugin eval` after each description change." |
| 13 | The two arms | P | "The with-arm is its runs with the plugin loaded, and the without-arm is the same number of runs with no plugin at all." |
| 14 | Firing is not scored in two arms | P | "A check like "the skill was invoked" can never pass without the plugin, so counting it would push the without-arm toward zero and inflate `Δ`." |
| 15 | One arm scores everything | P | "under `--ablation none` nothing is excluded, so the same suite can produce a different absolute score in the two modes." |
| 16 | Runs per case | P | "One run of a non-deterministic agent tells you little, so each case runs three times by default." |
| 17 | Pinning the model | P | `--model <model>`: "Model for the agent under test. Pin it in CI so a model rollout isn't mistaken for a plugin regression" |
| 18 | The model when not pinned | P | "Each case's `model`, else `ANTHROPIC_MODEL` if set, else Claude Code's default" |
| 19 | The judge | P | "By default, the judge for `llm` and `baseline` graders is the model Claude Code uses for background tasks." |
| 20 | Isolation | P | "Each run gets a temporary home directory, working directory, and Claude Code configuration, and the agent under test runs there as a `claude -p` child process with only your plugin loaded." |
| 21 | What is absent | P | "Your user settings, hooks, `CLAUDE.md` files, MCP servers, other installed plugins, memory, and skills are absent." |
| 22 | Project files do not load | P | "Project-scoped configuration isn't read anywhere either: no `.claude/` directory, `CLAUDE.md`, or `.mcp.json` loads from above the workspace or inside it, even one a `scaffold_script` wrote, and `add_dirs` directories grant read access only." |
| 23 | Tools without a grant | P | "Built-in tools that need a grant you didn't give, such as `Bash`, `Write`, `Edit`, `WebFetch`, and `WebSearch`, are removed from the session, so Claude can't call them at all." |
| 24 | A shell needs a sandbox | P | "If you grant Bash or PowerShell on a machine with no sandbox backend, Claude Code refuses each run rather than running it unconfined, and the case shows a run error and usually scores 0." |
| 25 | Native Windows has none | P | "Native Windows has no backend, so run shell-granting suites under WSL2; on Linux, install `bubblewrap` and `socat` first." |
| 26 | The fixture script | P | "The script runs as you, outside the agent's sandbox, and only when you pass `--scaffold`, so pass that flag only for suites you or your organization wrote." |
| 27 | The plugin's MCP server | P | "A run never starts your plugin's real MCP servers unless you ask." |
| 28 | The result files | P | "Every run with at least one case writes a `results/<timestamp>/` directory inside the eval directory, containing `aggregate-result.json` and `report.html`." |
| 29 | The JSON | P | "`aggregate-result.json`, and `--json` output, is a versioned document with `schemaVersion: 1` for CI scripts to parse." |
| 30 | What the JSON names | P | `costUsd`, `durationSeconds`, `claudeVersion`: "Estimated cost at list price including judge calls, wall-clock seconds, and the Claude Code version that ran the suite" |
| 31 | The report is published by default | P | "If you're signed in with a claude.ai subscription and artifacts are available for your account, Claude Code also publishes the report as a private artifact and prints `Published: <url>`. Pass `--no-publish` to keep it local." |
| 32 | Every run costs | P | "Every eval run and every judge grader is a real model call on your account, counted against your plan's usage or your API bill" |
| 33 | The size of a suite | P | "In model calls, a suite makes roughly cases × runs agent runs with the plugin and the same number again for the no-plugin baseline, plus three short judge calls per `llm` or `baseline` grader per run." |
| 34 | The cost ceiling | P | `--max-cost-usd`: "A ceiling on the run's list-price cost estimate, not on plan usage." |
| 35 | CI use | P | "In your CI job, run the suite with `--json` to write the result for archiving, and fail the build on the exit code." |
| 36 | CI needs a credential | P | "a CI runner needs a Claude Code install and credentials in the environment such as `ANTHROPIC_API_KEY` or your cloud provider's variables." |
| 37 | Trust without a terminal | P | "When stdin or stdout isn't a terminal, or under `--json`, the run can't ask and is refused with exit 1; pass `--trust-plugin` to assert the trust yourself, only for a plugin you'd run on your own machine." |
| 38 | A capped run is still graded | P | "A run that started but ended badly is still graded on what it produced, so a non-null error doesn't imply score 0" |
| 39 | A rate limit looks like a regression | P | "The suite still finishes and isn't marked `partial`, so the result can look like a regression." |
| 40 | It can be switched off | P | "Anthropic has switched the command off server-side. Nothing on your machine turns it back on; run `claude update` and try again in a fresh session later." |
| 41 | The same summary, shorter | C | "Claude Code runs it several times in an isolated session with only the target plugin loaded, and by default also without the plugin so the report shows the difference." |

### The command, on this machine

```text
$ claude --version
2.1.295 (Claude Code)

$ claude plugin eval --help        (abridged: the usage text and every option name)
Usage: claude plugin eval [options] [command] [target]

Run eval cases (<eval dir>/**/case.yaml or prompt.md + graders/*.md; the eval
dir is evals/ unless --eval-dir or the manifest says otherwise) against a plugin
and report scored results. Target is a path, a plugin name, or a
`plugin@marketplace` id — installed and skills-dir plugins both resolve (and add
a no-plugin baseline arm). [...]

Options:
  --ablation <mode>         none | with-without
  --allow-real-servers
  --allow-tools <tools...>
  --case <glob>
  -j, --concurrency <n>     1-8; default 1
  --eval-dir <dir>
  --json [path]
  --judge-model <model>
  --keep-temp
  --max-cost-usd <usd>
  --mocks <mode>            record | off; default: record
  --model <model>           Override model for all cases
  --no-publish
  --no-scaffold
  --output-dir <dir>
  --publish-report
  --report <path>
  --runs <n>                default: case.runs ?? 3
  --scaffold
  --tag <tag...>
  --threshold <0..1>        default: 1.0
  --trust-plugin
  --verbose

Commands:
  init [options] [name]
```

The installed version is above the documented floor (fact 2), git is 2.47, and the command ran.

## The hand run

**Date:** 2026-10-09. **Machine:** native Windows 11, Claude Code 2.1.295, git 2.47.1.
**Plugin under test:** Cortex 2.41.38, as `git archive HEAD` unpacked into a temp directory outside
the repo, so nothing was written into the checkout. **Model:** `claude-sonnet-5`, passed as
`--model` and confirmed in the kept trace's `init` line. **Judge:** `claude-haiku-4-5`, passed and
never called, because no grader needed one. Three invocations, the limit set for this step.

### The case

```text
<temp>/cortex/                      the plugin, unpacked
└── plugin-evals/                   passed as --eval-dir; evals/ is Cortex's own
    └── resume-in-flight/
        ├── prompt.md               max_turns: 15, allowed_tools: [Read, Glob, Grep, Skill]
        │                           body: continue where we left off
        ├── case.yaml               schema_version "1.1", name, context.scaffold_script: fixture.sh
        ├── fixture.sh              git init; two commits on main; a branch feature/export-csv with
        │                           one commit, not merged; back on main, one line appended to
        │                           src/app.js and left uncommitted
        └── graders/
            ├── skill-fired.md      type: tool_used, tool: Skill,
            │                       input_match: '"skill"\s*:\s*"(?:[\w-]+:)?resume"'
            └── states-the-state.md type: regex, target: last_message, flags: s; four lookaheads,
                                    one each for "Committed:", "Uncommitted:", "Diverged:" and
                                    "Remaining:" as whole words
```

Run 3 added two firing-only cases beside it, tagged `fires`, each with `max_turns: 2` and no
fixture. `fires-reach` sends "let's pick up where we stopped yesterday", the first `reach` prompt in
`evals/triggers/resume.json`, with the same `skill-fired` grader. `fires-elsewhere` sends "what did
I miss while I was away", that file's `elsewhere` prompt, with one grader that `catch-me-up` was
invoked and one that `resume` was not (`min: 0`, `max: 0`).

### Run 1 — both arms, read-only tools

```text
claude plugin eval . --eval-dir plugin-evals --model claude-sonnet-5 --judge-model claude-haiku-4-5
  --runs 3 -j 3 --scaffold --trust-plugin --no-publish --max-cost-usd 3 --output-dir <temp>/run1
```

```text
CASE              WITH  W/OUT Δ      RUNS COST    NOTES
resume-in-flight  0.33  0.00  +0.33  6    $1.37   timed out after 300s

1 case(s) · mean Δ +0.33 · 304s · $1.37        exit 1 (default --threshold 1.0)
```

| Arm | Run | `skill-fired` | `states-the-state` | Turns | Seconds | Cost | Error |
|---|---|---|---|---|---|---|---|
| with | 1 | pass | fail | 8 | 304 | $0.18 | `timed out after 300s` |
| with | 2 | pass | fail | 23 | 89 | $0.26 | none |
| with | 3 | pass | pass | 20 | 110 | $0.32 | none |
| without | 1 | not applicable | fail | 10 | 38 | $0.09 | none |
| without | 2 | not applicable | fail | 1 | 126 | $0.39 | none |
| without | 3 | not applicable | fail | 1 | 51 | $0.12 | none |

`/resume` was invoked in 3 of 3 with-arm runs. The reply carried the four lines in 1 of 3 with the
plugin and 0 of 3 without it.

The trace of the timed-out run shows why two with-arm runs failed the reply grader. The ritual's
first step is four `git` commands. The session had no shell (fact 23), so the model searched for
one, then dispatched a subagent to run git, which dispatched another, three levels deep, each
reading `.git/` files one at a time until the 300 seconds ran out. The grader measured the ritual
without the tool it is written around.

### Run 2 — the same case with git granted

```text
claude plugin eval . --eval-dir plugin-evals --model claude-sonnet-5 --judge-model claude-haiku-4-5
  --runs 1 -j 2 --scaffold --trust-plugin --no-publish --max-cost-usd 2 --output-dir <temp>/run2
  --allow-tools "Bash(git *)"
```

Both runs were refused before any model call, 18 seconds, $0.00, exit 1. The error, verbatim:

```text
error: a PATH directory could not be examined for keychain credential helpers (EPERM), so the Bash
sandbox cannot exclude them — a Bash-granting evaluation cannot run in this environment
```

The docs predict a refusal on native Windows (facts 24 and 25). The run was stopped here and no way
round it was tried.

### Run 3 — firing only, one arm, two turns

```text
claude plugin eval . --eval-dir plugin-evals --tag fires --ablation none --model claude-sonnet-5
  --judge-model claude-haiku-4-5 --runs 3 -j 3 --trust-plugin --no-publish --max-cost-usd 2
  --output-dir <temp>/run3
```

```text
CASE             SCORE PASS% RUNS COST    NOTES
fires-elsewhere  1.00  100%  3    $0.27   exit 1: Reached maximum number of turns (2)
fires-reach      1.00  100%  3    $0.22   exit 1: Reached maximum number of turns (2)

2 case(s) · 54s · $0.49                        exit 0
```

`/resume` was invoked in 3 of 3 runs on the `reach` prompt. On the `elsewhere` prompt,
`/catch-me-up` was invoked in 3 of 3 runs and `/resume` in 0 of 3. Five of the six runs hit the
two-turn cap and were graded anyway (fact 38). A run cost $0.06 to $0.14, against $0.18 to $0.32
for a with-arm run that carried the ritual through.

### What the three runs cost and left behind

- $1.86 at list price in total, about six and a half minutes of wall clock.
- Every run that ended in an error left a `claude-eval-*` directory in the OS temp dir, with a
  warning that it could not be sealed on Windows and the command to remove it. A two-turn firing
  case ends in an error by design, so a sweep on Windows leaves one directory per run.
- No report was published. `--no-publish` was passed on every run (fact 31).

## Decisions locked

### 1. What each check measures that the other cannot

| | The word check (`evals/triggers.mjs`) | `claude plugin eval` with a `tool_used: Skill` grader |
|---|---|---|
| Asks | Does the description share words with what people type? | Did Claude Code's router invoke the ritual? |
| Sees a paraphrase with no shared word | No. It fails, and `evals/README.md` says to replace the prompt | Yes |
| Sees a description that has the words and still loses to a neighbour | Only by rank among Cortex's own descriptions | Yes, among the plugin's skills |
| Sees other plugins, user skills and `CLAUDE.md` competing | No | No (fact 21) |
| Needs a model | No | Yes, a full session per run (fact 32) |
| Same answer twice | Always | Not promised (fact 16) |
| Runs in CI here | Yes | No. A model run never happens in CI (`evals/AGENTS.md`) |
| Cost of all 156 prompts | Seconds, nothing | 468 runs. At run 3's $0.08 a run, about $38 at list price |
| Names what to fix | The missing word, and what outranked the ritual | Only that it did not fire |
| Runs on native Windows | Yes | Firing cases yes. Any case that grants a shell, no (run 2) |

**Choice.** They are two checks of one sentence, and Cortex keeps both. The word check stays the
gate, because it is free, deterministic and says which word is missing. The router check is the
measurement the word check's own README says it is not.

**Rejected.** *Replace the word check with the router check.* It would move a CI gate onto a
sampled model and a credential, which ADR 0018 already rejected for the body evals. *Treat a high
rank-1 rate as a firing rate.* `evals/AGENTS.md` forbids it, and run 3 is one ritual on one model,
not evidence that the two numbers agree.

### 2. Adopt it for firing, by the maintainer, never in CI

**Choice.** Adopt `claude plugin eval` for one measurement: for each model-invocable ritual, how
many of three sessions invoke it on each of its `reach` prompts, and on each `elsewhere` prompt
whether the owner is invoked and the ritual is not.

- **For which rituals.** Every ritual without `disable-model-invocation: true`, which is the set
  `triggers.mjs` already reads. A sweep of one ritual is its four or more prompts, twelve runs,
  about a dollar. That is the usual run: after an edit to a `description`, for the ritual edited
  and for the owners named in its `elsewhere` prompts.
- **Where the cases live.** Nowhere in git. A generator builds them from
  `evals/triggers/<ritual>.json` into `evals/router/`, which is gitignored, results included. The
  eval directory has to sit below the plugin (fact 7), and `evals/` itself is taken (fact 6).
- **Who runs it.** A maintainer, on their own login, as `evals/run.mjs` is run today. The runner
  refuses when `CI` is set, and refuses without `--model`.
- **How.** One arm, because a firing grader cannot pass without the plugin (fact 14) and one arm
  scores it (fact 15). `max_turns: 2`, because the invocation happens in the first turn and the
  rest of the ritual is paid for and not graded. Read-only tools, no `--scaffold`, no
  `--allow-tools`, no judge. `--no-publish` always.
- **What is kept.** A record per ritual and prompt: fired runs, total runs, the model, the Claude
  Code version, the date. It is written from `aggregate-result.json` and never typed.

**Evidence from the hand run.** The firing measurement worked on native Windows at the first
attempt, with free graders, in under a minute, and separated a `reach` prompt from an `elsewhere`
prompt. The with/without measurement of the reply did not: one arm of it could not use a shell, and
the configuration that grants one was refused.

**Rejected alternatives.**

| Option | Why not |
|---|---|
| Adopt both halves now | Run 1's Δ of +0.33 is a ritual with no shell against a model with no shell. Nearly every Cortex ritual starts with a command. On the maintainer's machine a shell cannot be granted (run 2), so the delta would be measured on a configuration no user has. |
| Do not adopt | Nothing else in Cortex can say a ritual was chosen. The docs name this exact use (fact 12), and it cost $0.49 to get six clean answers. |
| Run it in CI with an API key | A model run never happens in CI here. ADR 0018 gives the reasons: every pull request would need a credential and a budget, and its verdict would depend on a sampled model. A rate limit also reads as a regression (fact 39). |
| Commit the generated cases | About 156 case directories that restate `evals/triggers/`. Two copies of one list drift, and the fix for drift would be a second `--check`. |
| Write separate cases by hand | Two lists of "what people type" for one ritual. An edit would update one. |
| Set `experimental.evals` in `plugin.json` | The manifest ships to every user, and the key's shape "may still change" (fact 8). A flag in the runner costs nothing and reaches nobody. |
| Two arms for firing | It doubles the cost to learn that a skill that is not loaded is not invoked. |
| Make the firing number a gate that may only rise | Firing is sampled. Three runs of an unchanged description can differ, and a gate on that fails for no change. The record carries model and version so a person can read a drop. Whether a gate is safe is a question for after several sweeps. |
| Vendor these facts as rules in `core/claude-code.js` | ADR 0017's rules are the ones Cortex enforces on a target repo. No finding reads these. `evals/` also imports nothing from `core/`. The page is already in `tools/claude-docs-seen.json`, and the runner's README section cites the sentences it relies on. |

### 3. The harness in step 2.2 does not use it

**Choice.** Step 2.2 compares a repo with and without the context layer. `claude plugin eval`
cannot make that comparison, and its case format is not reused there.

**Reason.** Its two arms differ in the plugin and in nothing else (fact 13). The context layer is
files in the repo, and a run loads no `CLAUDE.md` from the workspace, "even one a `scaffold_script`
wrote" (fact 22). Cortex's shim is a `CLAUDE.md`. The harness also scores a task by a pass command,
and "There are no custom-code graders" (fact 10).

**Rejected.** *Borrow the folder-per-case layout for the harness.* A layout without the runner that
reads it is a convention to maintain for no reader. Step 2.1 decides the harness's own shape.

### 4. The follow-up steps

Tests first. No runtime dependency ([ADR 0004](../adr/0004-no-runtime-dependencies.md)): the
runner shells out to the `claude` binary a contributor already has, as `evals/run.mjs` does. No
hook and no mod ([ADR 0021](../adr/0021-cortex-ships-no-mod-and-keeps-the-claude-md-shim.md)).

| # | Step | Files | Verified by |
|---|---|---|---|
| H2.1 | Build the cases from the trigger prompts. A pure function from one ritual's triggers to a map of file paths and contents: a `prompt.md` with `max_turns: 2` and the read-only tools, a firing grader for a `reach` prompt, an owner-fired and a not-fired grader for an `elsewhere` prompt | `evals/test/router.test.mjs` first, then `evals/router.mjs` | the test pins the exact files for a triggers file written by hand; every model-invocable ritual yields one case per prompt; a ritual name with a regex character is escaped in `input_match`; importing the module writes nothing |
| H2.2 | Run them. `node evals/router.mjs <ritual> --model <id>` writes the cases under `evals/router/` and calls `claude plugin eval . --eval-dir evals/router --ablation none --no-publish --trust-plugin --model <id> --json <path>` | `evals/test/router.test.mjs`, `evals/router.mjs`, `.gitignore` | with a stub as `deps.call`, the test asserts the exact arguments; it refuses when `CI` is set and when `--model` is missing; `evals/router/` is ignored; no test needs the `claude` binary |
| H2.3 | Record the result. Read the JSON document and write, per ritual and prompt, fired and total runs with `model`, `claudeVersion` and the date | `evals/test/router.test.mjs`, `evals/router.mjs`, `evals/baselines/router.json` | fixture documents shaped like this hand run's: a turn-cap error still counts the run; `partial: true`, or any other run error, refuses to record and names the run; a field the script does not know is ignored |
| H2.4 | Say what the number means, and take the first measurement | `evals/README.md`, `evals/AGENTS.md`, `docs/changing-cortex.md`, a dated note on ADR 0018 | the README section quotes the sentences behind facts 2, 11, 15, 21, 31 and 38; the pull request carries a recorded sweep of the five rituals that have a body eval, with the model and version; the link check passes |

`evals/router.mjs` reads the frontmatter parser in `tools/`, as `triggers.mjs` does, and imports
nothing from `core/`, `index/` or `mcp/`.

## Risks & edges

- **The run is cleaner than a user's session.** Only Cortex is loaded (fact 21). A user also has
  other plugins, their own skills and a `CLAUDE.md`, and any of them can take a prompt first. A
  firing rate here is a ceiling for the ritual among Cortex's own, not a rate in the field.
- **The firing prompt in run 1 was the easy one.** "continue where we left off" is quoted in
  `/resume`'s own description. The trigger check refuses such a prompt as a `reach` prompt for that
  reason. Run 3 used a prompt that is not quoted. The generated cases inherit that rule from the
  trigger files.
- **Three runs is a small sample.** Fact 16 is the docs saying so. A ritual at 2 of 3 is a question
  to look at, not a finding.
- **A new model moves the number with no edit.** The record names the model and the version, and a
  sweep is re-run on purpose when the pinned model changes.
- **The command can change or be switched off** (fact 40). The runner is a thin wrapper around one
  invocation and one documented JSON shape (fact 29). If it stops working, the word check still
  gates, and nothing a user runs depends on it.
- **A sweep on Windows leaves temp directories.** One per capped run, each with its own removal
  command in the output. The README section says so.
- **The trust flag.** `--json` cannot ask, so the runner passes `--trust-plugin` (fact 37). That is
  right for a maintainer running Cortex's own checkout and wrong for anyone pointing the runner at
  another plugin. The runner takes no plugin path: it evaluates the repo it lives in.
- **The MCP server.** The plugin declares one. A run does not start it (fact 27), so a ritual that
  calls `recall` would behave differently. Firing is decided before any such call.
- **Rollback.** The follow-up adds one script, its test, one baseline file and prose. Removing them
  leaves no state in any target repo.

## Not confirmed

Not found in the docs on 2026-10-09. Nothing above relies on these.

- **Which tools a run really has.** The docs say a run allows the read-only tools a case lists. The
  kept trace's `init` line listed `Task`, `TaskStop` and `ToolSearch` beside the four the case
  listed, and the model used the first to dispatch subagents.
- **How `max_turns` counts.** Run 1 reported 20 and 23 `turns` for runs with `max_turns: 15` and no
  error. What the reported number counts is not stated.
- **Whether run 2's error is the documented refusal.** The docs describe a machine "with no sandbox
  backend". The message names a `PATH` directory and `EPERM`. It may be the same refusal or a
  second cause on this machine.
- **Whether a firing run always costs about $0.08.** Measured on two prompts, on one model.
- **Whether `AGENTS.md` loads in a run.** Fact 22 names `CLAUDE.md`, `.claude/` and `.mcp.json`.
- **Whether the skill listing in a run is cut the way an interactive session's is**, with the same
  character budget for descriptions.
- **What `--trust-plugin` records.** Whether it marks the directory as trusted for later
  interactive sessions, as answering the prompt does.
- **Which shell runs a `scaffold_script` on native Windows.** The docs call it a Bash script. It
  ran here with three `bash.exe` on the `PATH`.
- **That a failed run's temp directory is kept.** `--keep-temp` is documented as off by default.
  The output said `kept temp (run failed)` for every run that ended in an error.
- **How the default model is chosen day to day.** The survey's note that it changed twice in one
  day is theirs. The docs say only "Claude Code's default" (fact 18), which is why the runner
  refuses to run without `--model`.

## Out of scope

- Reply graders, `llm` graders and the with/without delta for any ritual. Deferred until a sweep
  can run under WSL2 or Linux, and it gets its own step then.
- `claude plugin eval init`, mocks for the Cortex MCP server, and `--allow-real-servers`.
- A CI job, a threshold, or an exit code that fails anything.
- The `/skill-doctor` report and the plugin cost page. They measure use and context cost, not
  routing.
- Any change to a ritual's `description`. This step measures. H1 and H4 own the text.
- Committing the hand-run case or its results.
- Step 2.2's harness, beyond the one decision that it does not use this command.
