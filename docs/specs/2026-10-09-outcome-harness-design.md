# Design: the outcome harness — does the context layer make an agent do a task right?

- **Date:** 2026-10-09
- **Status:** Approved under delegation. The maintainer delegated approval of this step on
  2026-10-09; every choice made on their behalf is listed in the next section so it can be reversed.
- **Decided by:** the roadmap's Q9, Q11 and Q19 (2026-10-04), and this spec for what they left open
- **Plan step:** 2.1 of [the next-level roadmap plan](../plans/2026-10-04-next-level-roadmap.md).
  It gates 2.2 (the harness) and 2.3 (the first measurement).
- **Parent:** [the next-level roadmap](2026-10-04-next-level-roadmap-design.md), Part 2
- **Area:** `evals/harness/` (new), `evals/test/`, `evals/README.md`, `evals/AGENTS.md`. Scoped
  brief: [`evals/AGENTS.md`](../../evals/AGENTS.md).

This is a spec. It writes no code. Claude Code facts were read from the docs on 2026-10-09 and
carry their page and sentence, quoted with link markup removed. The installed CLI on the machine
that read them was 2.1.295. What the docs do not state is under [Not confirmed](#not-confirmed).

## The claim under test

**An agent given a task in a repo that has the Cortex context layer (a root `AGENTS.md`, scoped
briefs, `CONTEXT.md`, ADRs) does the task right more often than the same agent in the same repo
without it.**

"Right" has two parts, from Q19: the change does what was asked, and it respects the rule the
repo's documents state. Turns and tokens are reported second and never decide the result.

## Decisions taken for the maintainer

One line each, with the alternative. Reversing one is an edit to this file before 2.2 starts.

| # | Decision | Alternative |
|---|---|---|
| M1 | The with-arm's context layer is **written by the fixture's code**, in the shape `/cortex-scaffold` and `/cortex-brief` write. Q9 called the arm "after `/cortex`"; this reads that as "holding what `/cortex` leaves", not "produced by a model run of `/cortex`" | Run `/cortex` with a model to build the arm: the arm would differ between builds, and its invariants would have to be invented by that run |
| M2 | The layer is the **documents only**: `AGENTS.md`, the `CLAUDE.md` and `GEMINI.md` shims, `CONTEXT.md`, `docs/adr/`, two scoped briefs. No hooks, verifier, `REVIEW.md` or team files | The whole `/cortex` loop: a hook that refuses an edit would be measured as if a document had worked |
| M3 | The fixture is the **"shop" checkout service** the roadmap named, rebuilt inside `evals/harness/` with no dependencies | Import it from `tools/cortex-site-demo.mjs`: that one needs `express` installed, has three source files, and `evals/` does not import from `tools/` |
| M4 | The model is **`claude-sonnet-5` at `medium` effort**, the skill evals' target | An Opus model (likelier to pass everything in both arms, and dearer); Haiku (cheaper, and not what a team would run) |
| M5 | Sessions run in **`acceptEdits`** with an allow-list for `node`, `npm test` and read-only `git` | `auto` (needs a qualifying account and adds a classifier that can differ run to run); `bypassPermissions` (the docs confine it to containers and VMs) |
| M6 | **A session that reaches `--max-turns` is scored on the tree it left.** A wall-clock timeout, a crash, an API error or a wrong model is a failed call | Count every unfinished session as a failed call: an arm that wanders would have its worst sessions removed from its count |
| M7 | A failed call is **retried up to twice**, every attempt counted and reported | No retries: one rate limit would leave a cell at two repeats |
| M8 | The two arms of one task and repeat **run at the same time**; the fifteen pairs run one after another | All thirty in sequence, or four at a time as the skill evals do |
| M9 | The reading rule in [What the first measurement must show](#what-the-first-measurement-must-show) is fixed now: a lead of four or more of twelve is "supported", one or less is "not shown" | Decide what the numbers mean after seeing them |
| M10 | **No sentence anywhere cites the harness as evidence unless the reading is "supported".** A "not shown" reading opens an issue listing every sentence in `README.md` and on the site that asserts an outcome benefit, for the maintainer to decide | Leave the claims as they are whatever the result |
| M11 | `evals/harness/RESULTS.md` is **written by the harness and append-only**; it is a log and gates nothing | A baseline file that CI compares against, like `evals/baselines/` |
| M12 | The harness **does not wait for H2**. It keeps its own task shape; if H2 finds `claude plugin eval`'s case format worth reusing, that is a later change | Block 2.2 on H2 |

## Destination

- `node evals/harness/run.mjs` builds one small repo twice, with and without its context layer,
  runs five tasks three times in each, decides every result with a command, and prints one table.
- A reader of `evals/harness/RESULTS.md` sees, for each measurement, the date, the model, the raw
  counts per task and arm, and how many calls failed. Nothing in it was typed by hand.
- The harness can be shown to favour neither arm without spending a model call: a stubbed run in
  the test suite proves it.

## Context

- **Nothing measures outcomes today.** The five skill evals give a skill's text to a model with no
  tools and score the reply
  ([ADR 0018](../adr/0018-skill-quality-is-measured-by-evals-not-telemetry.md)).
  They answer "did my edit make this ritual worse". They cannot answer "does a repo with Cortex's
  documents get better work out of an agent".
- **Two specs left this open.** The roadmap lists the five tasks, the model and the pass command as
  not yet specified. [The mods spec](2026-10-03-claude-code-mods-design.md) says nothing has
  measured an agent with and without scoped briefs.
- **The rules `evals/` already holds apply here**, from [`evals/AGENTS.md`](../../evals/AGENTS.md):
  one scorer; ground truth is built, never judged by a model; a model run never happens in CI; a
  baseline is recorded, never typed; one run is noisy. `evals/` imports nothing from `core/`,
  `index/` or `mcp/`.
- **What repeated runs have shown here.** Repeats of one unchanged skill body differed by one task
  in fourteen. One comparison of two means hid a real regression that reading the failed tasks
  found ([`evals/REJECTED.md`](../../evals/REJECTED.md)). Both shape the reading rule below.
- **H2 has not run.** The roadmap gives `claude plugin eval` to step H2 and says it compares a
  session with and without the *plugin*, which is a different question.

## The fixture

**A generated repo named `shop`: a small checkout service.** `evals/harness/fixture.mjs` exports
`buildFixture(dir, { arm })` and holds every file as a string, the way `tools/cortex-site-demo.mjs`
holds its service. It is generic by construction and vendored from nobody.

- **Language:** Node, ES modules, `node:http` and `node:test` only. `package.json` has no
  dependencies, so nothing is installed and `node --test` runs at once.
- **Size:** about 30 files and 700 lines in the base tree, plus 9 context-layer files of about 200
  lines. Small enough that a session costs minutes, large enough that a rule's evidence is not in
  the file being edited.
- **Shape.** `createApp({ db, clock })` in `src/server.js` returns `request(method, path, body)`,
  which answers `{ status, body }`. Acceptance checks call that function, so no port is opened.

```
package.json  README.md
src/server.js                      createApp, the route table
src/routes/{carts,orders,catalog,health}.js
src/cart/{cart,pricing}.js         totals; today only integer sums
src/orders/{service,repository,audit,tax}.js    placed → paid → shipped
src/catalog/{catalog,stock}.js
src/money/money.js                 percent(amount, basisPoints), rounds half to even
src/store/{db,migrate}.js  src/store/migrations/{001,002,003}-*.js
src/lib/{clock,ids,errors}.js
test/*.test.js                     the repo's own suite; covers today's behaviour only
```

**The context layer** (the with-arm only), listed once as `CONTEXT_LAYER` in `fixture.mjs`:

```
AGENTS.md  CLAUDE.md  GEMINI.md  CONTEXT.md
docs/adr/0001-money-is-integer-minor-units.md
docs/adr/0002-migrations-are-append-only.md
docs/adr/0003-routes-call-services.md
src/orders/AGENTS.md  src/store/AGENTS.md
```

`CLAUDE.md` and `GEMINI.md` are the one-line shim `@AGENTS.md`, as `/cortex-scaffold` writes them.
The root brief follows `templates/target-AGENTS.md` and its routing table names the two leaves.

**The four rules.** Each is real (it has a reason a team would give), is stated only in the layer,
is followed by every line of the existing code, and is enforced by no test in the repo's own suite.

| Rule | Where it is written | The sentence |
|---|---|---|
| R1 money | root brief § Invariants, `CONTEXT.md` (*amount*), ADR 0001 | An amount is an integer number of minor units. Any calculation that can leave a fraction goes through `src/money/money.js`, which rounds half to even; never `Math.round` on money. The ledger export is reconciled to the cent against a payment provider that rounds the same way. |
| R2 orders | `src/orders/AGENTS.md`, `CONTEXT.md` (*cancelled*) | An order is never removed from the store. Every status change appends exactly one audit entry, in the service function that makes the change. Refunds and the monthly export read the audit log. |
| R3 migrations | ADR 0002, `src/store/AGENTS.md`, one line in the root brief | The stored shape of a table changes only through a new numbered migration. A migration that has shipped is never edited, because deployed stores have already run it. A read path does not paper over a missing field. |
| R4 layering | root brief § Invariants, ADR 0003 | A module under `src/routes/` imports services only. It never imports from `src/store/` or a `repository.js`. |

**The without-arm is the same build minus `CONTEXT_LAYER`.** `buildFixture` writes the base tree
for both arms from the same strings and adds the layer for one. Then:

- Each working copy is a git repo with one commit. Author, committer, date and message are pinned,
  so the same arm has the same commit on every machine. Line endings are written as LF.
- The directory is `<tmp>/cortex-harness-<random>/shop` in both arms. The arm's name is not in the
  path, the commit message or any file.
- `FIXTURE_VERSION` and a SHA-256 of each arm's tree go into every record. A change to any fixture
  file raises the version, and results from different versions are never added together.

*Rejected:* a real open-source repo as the fixture (its rules are not known by construction, and a
model may have seen it in training); deleting the layer from a copy after building (two code paths
where one list will do); a larger fixture (cost per session, for a first measurement).

## The five tasks

Every prompt is sent as written, to both arms, followed by the same closing line: *"Make the change
in this repository, and run its tests before you finish."* No prompt names a document or states a
rule.

Each task has two checks. **`works`** tests only what the prompt asks for. **`rule`** tests the
rule from the layer, by its property and not by a spelling: no check depends on a function name,
a file name or an audit entry's label that the agent chose. A session **passes** when both hold.

| Task | Prompt | Depends on | `works` | `rule` |
|---|---|---|---|---|
| T1 `discount` | Orders of 100.00 or more should get 10% off. Add it to the cart totals: `GET /carts/:id` should return a `discount` field next to `subtotal`, and `total` should be the subtotal minus the discount. Below 100.00 the discount is 0. | R1 | subtotals 20000, 10000 and 9999 give discounts 2000, 1000 and 0, and matching totals | subtotals 10005, 10015 and 12345 give discounts 1000, 1002 and 1234, and every amount is an integer. Rounding half up fails the first and third; truncating fails the second |
| T2 `cancel` | Add order cancellation. `DELETE /orders/:id` cancels an order that has not shipped and answers 204. For a shipped order it answers 409, and for an unknown id 404. | R2, through the routing table to `src/orders/AGENTS.md` | the three status codes | after the 204 the order is still in the store with a changed status, and the audit table grew by exactly one entry carrying that order's id; after the 409 neither changed |
| T3 `note` | Orders need a free-text `note`. `POST /orders` should accept an optional `note` and `GET /orders/:id` should return it; an order placed without one has an empty string. Orders that already exist must read back with an empty note too. | R3 | on a new store, a note round-trips and a missing one reads as `""`; on a store that already holds an order, that order reads back with `""` | the three shipped migration files are byte-identical to the fixture's; a store built at version 3 by the harness's own copy of them reports a higher version after the tree's `migrate()`; and the stored order row itself has `note: ""` |
| T4 `by-status` | Add `GET /orders?status=<status>`: it returns the orders in that status, oldest first. With no `status` it returns all orders. | R4 | the filtered list, its order, and the unfiltered list | no module under `src/routes/` has an import, static or dynamic, that resolves into `src/store/` or to a `repository.js` |
| T5 `search-empty` (control) | `GET /catalog` with no `q`, or an empty one, answers 500. It should answer 200 with every product, sorted by name. `GET /catalog?q=mug` should keep working. | nothing | the three requests | none: `works` alone decides |

**The pass command** is the same for every task, and it is the only thing that decides a result:

```bash
node evals/harness/accept.mjs <task> <tree>     # exit 0 pass · 1 fail · 2 could not run
```

It prints one JSON line, `{ task, works, rule, pass, reason }`. For the given tree it runs, in
order: the fixture's own test files as built (restored from the fixture first, so a session that
edited or deleted a test cannot pass by it); `evals/harness/accept/<task>.works.test.mjs`; and
`evals/harness/accept/<task>.rule.test.mjs`. All three run under `node --test` with the tree's path
in the environment. The acceptance files live in Cortex and are never copied into the tree, so no
session can read them. Exit 2 is a harness fault and is never counted as a failed task.

`accept.mjs` exports the same decision as a function. A test holds the function and the command to
one result, as `evals/test/score.test.mjs` does for the skill scorer: this is the harness's one
scorer, and no rule is written a second time elsewhere.

**Why each task is fair.** A task is rigged if only a reader of the layer could pass it. None is:

- **T1.** `src/money/money.js` exports `percent`, and `src/orders/tax.js` already computes tax with
  it. A session that looks for how the repo takes a percentage finds the helper and passes. The
  evidence is two directories away from the file being edited, which is what makes it not obvious.
- **T2.** `payOrder` and `shipOrder` sit in the same service file, and each sets a status and
  records one audit entry. Copying them passes. The store's generic `remove` exists because carts
  use it, so the wrong path is a real one and not a trap built for the test.
- **T3.** `src/store/migrations/` holds three numbered files and `migrate.js` applies those above
  the stored version. Adding `004` is what the directory suggests. The prompt itself states that
  existing orders must read back correctly.
- **T4.** All four existing route modules import services only. A session that follows the file it
  is editing passes.
- **T5.** The layer says nothing that bears on it. The catalog has one row in the layout table.

For every rule task the harness holds two reference patches, `good` and `naive`. `good` is written
from the base tree alone. The tests in [The dry run](#the-dry-run) prove `good` passes in both arms
and `naive` passes `works` and fails `rule`, so each task is solvable without the layer and each
rule check can fire.

**The control.** T5 is the only task where the layer should not help. If the arms differ on it by
two or more of three, the run is marked suspect and read by nobody until the cause is found: the
likeliest causes are a difference between the arms that is not the layer, or a layer whose length
alone is costing the with-arm its turns.

*Rejected:* a task whose prompt asks for what a rule forbids (the right answer is then a refusal,
and judging a refusal needs a model); a task whose rule appears nowhere in the code (passable only
by luck without the layer, so the measurement would be rigged); a `rule` check that greps for a
helper's name (it would fail a correct change that spelled it another way); ten tasks (Q9 fixed
five).

## The run

**One session** is one `claude -p` process, with the prompt on stdin and its working directory set
to a fresh copy of one arm:

```bash
claude -p --model claude-sonnet-5 --effort medium \
  --permission-mode acceptEdits --permission-prompts none \
  --allowedTools "Bash(node *)" "Bash(npm test)" "Bash(npm test *)" "Bash(npm run *)" \
                 "Bash(git status *)" "Bash(git diff *)" "Bash(git log *)" \
  --setting-sources project,local --strict-mcp-config --disable-slash-commands \
  --no-session-persistence --max-turns 40 --output-format json
```

with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in its environment and a wall-clock limit of 15 minutes.
Both arms get the same bytes of prompt, the same flags and the same environment. Only the working
directory differs. Each flag, with the sentence that says what it does:

| Flag | Why | Source |
|---|---|---|
| no `--bare` | The session must load the repo's instructions, on the contributor's login. "Without it, `claude -p` loads the same context an interactive session would, including anything configured in the working directory or `~/.claude`." Bare mode skips `CLAUDE.md` and "doesn't use your subscription login" | [headless](https://code.claude.com/docs/en/headless.md) |
| `--model claude-sonnet-5` | "To pin to a specific version, use the full model name". The flag "Overrides the `model` setting and `ANTHROPIC_MODEL`" | [model-config](https://code.claude.com/docs/en/model-config.md), [cli-reference](https://code.claude.com/docs/en/cli-reference.md) |
| `--permission-mode acceptEdits` | "`acceptEdits` mode lets Claude create and edit files in your working directory without prompting." | [permission-modes](https://code.claude.com/docs/en/permission-modes.md) |
| `--allowedTools …` | Under `acceptEdits`, "Apart from the read-only command set, other shell commands and network requests still need an `--allowedTools` entry or a `permissions.allow` rule." The session has to run the tests | [headless](https://code.claude.com/docs/en/headless.md) |
| `--permission-prompts none` | "In a `-p` run with no host, these requests are denied either way, and the flag also tells Claude not to retry them." It "requires Claude Code v2.1.259 or later"; the harness checks `claude --version` first | [headless](https://code.claude.com/docs/en/headless.md) |
| `--setting-sources project,local` | "Comma-separated list of setting sources to load (`user`, `project`, `local`)." Leaving out `user` keeps the contributor's plugins and hooks out, as the skill evals already do. `project` stays in because the docs do not say a project `CLAUDE.md` survives without it | [cli-reference](https://code.claude.com/docs/en/cli-reference.md) |
| `--strict-mcp-config` | "Only use MCP servers from `--mcp-config`, ignoring all other MCP configurations." None is passed | [cli-reference](https://code.claude.com/docs/en/cli-reference.md) |
| `--disable-slash-commands` | "Disable all skills and commands for this session" | [cli-reference](https://code.claude.com/docs/en/cli-reference.md) |
| `--no-session-persistence` | "Disable session persistence so sessions are not saved to disk and cannot be resumed." | [cli-reference](https://code.claude.com/docs/en/cli-reference.md) |
| `--max-turns 40` | "Limit the number of agentic turns (print mode only). Exits with an error when the limit is reached. No limit by default." | [cli-reference](https://code.claude.com/docs/en/cli-reference.md) |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` | "Set to `1` to disable auto memory." and "When disabled, Claude does not create or load auto memory files". Without it one session could leave a note the next one reads | [env-vars](https://code.claude.com/docs/en/env-vars.md) |

**How the layer reaches the agent**, which is what the with-arm measures:

- The root brief loads at launch through the shim. Claude Code "loads `CLAUDE.md` and
  `CLAUDE.local.md` from your current working directory and every directory above it", and imported
  files "are expanded and loaded into context at launch alongside the CLAUDE.md that references
  them" ([memory](https://code.claude.com/docs/en/memory.md)).
- The two scoped briefs do **not** load by themselves. For "A `CLAUDE.md` that already imports
  `AGENTS.md`" Claude reads "Your `CLAUDE.md`, with `AGENTS.md` included through the import", and
  "By default, Claude reads `AGENTS.md` only when you have no `CLAUDE.md` in your working directory
  or above it." The root has one, so a leaf `AGENTS.md` is read only when the agent follows the
  root's routing table. That is the layer as Cortex ships it, and T2 is the task that depends on
  it.
- `CONTEXT.md` and the ADRs are plain files the root brief points at.

**Before any session**, a preflight that needs no model:

- No `CLAUDE.md`, `CLAUDE.local.md` or `AGENTS.md` exists in any directory above the working
  copies. One there would load in both arms and the run stops with its path.
- The installed CLI is new enough for every flag, and its version is recorded.

**Then two probe calls**, one per arm, which are not sessions of the measurement. The root brief
carries one line, `Project codename: larkspur`. The probe asks for the project's codename, or
`NONE`. The with-arm's reply must contain the word and the without-arm's must not. If either
fails, the arms are not what this spec says they are, and the run stops before spending the other
thirty calls.

**The thirty sessions** are 5 tasks × 2 arms × 3 repeats. The schedule is fixed and printed by
`--dry`: for each repeat, the tasks in an order rotated by one from the repeat before; for each
task, its two arms started together. Whatever drifts during a run (load, rate limits, a model
update) therefore reaches both arms of a pair alike.

**A failed call is not a failed task.**

| What happened | Counted as |
|---|---|
| The session ended and `accept.mjs` exited 0 or 1 | a scored session: pass or fail |
| The result's subtype is `error_max_turns` | a scored session, on the tree as left, marked `budget` |
| The process could not start, its output was not JSON, it reported an API or login error, it ran past 15 minutes, or the pinned model is absent from its `modelUsage` | a **failed call**: not scored, retried up to twice |
| `accept.mjs` exited 2 | a harness fault: the run stops |

A cell's count is written over the sessions that were scored, so three repeats with one call lost
read `2/2`, never `2/3`. Every attempt, failed or not, is in the record.

**What is kept.** Each attempt writes its result JSON, the acceptance output and the session's
diff to `.cortex/evals/harness/<run>/`, which is gitignored like the skill evals' predictions. The
working copy is then deleted. An interrupted run continues from those records.

**Cost.** Thirty sessions and two probes on the contributor's subscription, run on request. There
is no measured basis here for a tool-using session: the skill evals are single replies, 70 of them
in about five minutes. The expectation, which is a guess, is 3 to 8 minutes a session and one to
two hours for the run, with fifteen pairs in sequence. The bound that is not a guess is 40 turns a
session. 2.3 records the sum of `total_cost_usd` and the wall-clock time, so the next estimate is a
number.

*Rejected:* `--restricted`, which the docs describe for "an evaluation harness … on a shared
machine" (it does not read "that machine's user and project settings", and whether the project's
`CLAUDE.md` still loads under it is not stated); `--max-budget-usd` as a second cap (a third way
for a session to end, and its behaviour on a subscription login is not stated); replacing the
system prompt as the skill evals do (the session would no longer be Claude Code working in a repo).

## Scoring, the table and the record

`node evals/harness/run.mjs` prints raw counts. No percentage and no mean of passes is printed,
because twelve sessions do not carry one.

```
outcome harness · shop v1 · claude-sonnet-5 · medium · 2026-10-..  ·  30 scored, 0 failed calls
task             arm       pass   works  rule   turns        cost     failed calls
T1 discount      with      ./3    ./3    ./3    med (min–max)  $.      .
                 without   ./3    ./3    ./3    …
T2 cancel        …
T3 note          …
T4 by-status     …
T5 search-empty  with      ./3    ./3    —      …
  (control)      without   ./3    ./3    —      …
rule tasks T1–T4 with      ./12   ./12   ./12
                 without   ./12   ./12   ./12
reading: supported | not shown | inconclusive | tasks do not discriminate | suspect
```

- `pass` is the result. `works` and `rule` say why a session failed. Turns, tokens and cost come
  from the result JSON and are shown as the median with the range over scored sessions.
- The reading is computed from the counts by the rule in the next section. Nobody chooses it.

**`evals/harness/RESULTS.md`** is written by `node evals/harness/run.mjs --record` from a run's
records. No flag takes a number. Each measurement is one dated section holding:

- the date, the model as the sessions reported it, the effort, the Claude Code version, the fixture
  version and the two tree hashes;
- the table above, the count of failed calls with the reason for each, and the total cost and time;
- the reading, and every failed session with its `reason`, since which task failed has told more
  here than a total has;
- whether the contributor's `~/.claude/CLAUDE.md` existed during the run, as yes or no.

A section is never edited afterwards. A later measurement is a new section. An incomplete run can
be recorded, and its heading says how many of thirty sessions were scored. This differs from
`evals/baselines/` on purpose: a baseline is a bar that the next edit is held to, so it refuses a
run with failed calls. This file is a log that holds nothing to anything, so it refuses only to be
typed.

## What the first measurement must show

Written before any session has run. The primary number is **passes on the rule tasks, out of
twelve per arm**. The rows are tried from the top and the first that fits is the reading. A
without-arm lead of any size reads "not shown", and the counts in the record say how large it was.

| Reading | Condition | What follows |
|---|---|---|
| **suspect** | the control differs by 2 or more of 3, or more than 6 calls failed | Nothing is read from the run. The cause is found and the measurement repeated |
| **tasks do not discriminate** | the without-arm passes 11 or 12 of 12, or the with-arm passes 0 or 1 | The tasks are too easy or too hard to show anything. The fixture gets a new version; this run stays in the record |
| **supported, at this size** | the with-arm leads by 4 or more of 12, and it leads on at least two different tasks | The harness is worth extending: more repeats first, then a second fixture |
| **not shown** | the lead is 1 or less, in either direction, or the without-arm leads | The claim is not supported by this measurement. M10 applies |
| **inconclusive** | a with-arm lead of 2 or 3, or a lead of 4 or more carried by one task | More repeats of the same five tasks before anything else is built on it |

What three repeats can and cannot show:

- **No significance is claimed, whatever the result.** If both arms truly passed half the time, a
  lead of four or more of twelve would still turn up about one run in thirteen (7.6%), and that
  figure treats twelve sessions as independent, which three repeats of four tasks are not. So
  "supported" means "worth the next thirty sessions", and nothing stronger is written anywhere.
- **A lead of one or two is inside what one arm does against itself.** Repeats of one unchanged
  skill body have differed by one task in fourteen in this repo.
- **Five tasks on one fixture is one repo's worth of evidence.** It says nothing about a large
  codebase, another language, or rules of a kind these four do not cover.
- **It measures the layer whole.** With one task per rule, it cannot say whether the root brief,
  a scoped brief, `CONTEXT.md` or an ADR did the work.
- **The fixture's documents were written by the people testing them.** They are short and correct.
  A stale or bloated layer in a real repo may do worse, and this does not measure that.

**The harness is worth keeping if the dry run's properties hold and the run completes**, whichever
way the counts fall. A harness that only earns its place when it flatters the product is the one
that should not be kept. **The result is recorded whatever it shows.** A result that was hoped for
and one that was not are written by the same command into the same file.

## The dry run

Step 2.2 writes these tests first, in `evals/test/`, so `node --test evals/test/*.test.mjs` runs
them and none needs the `claude` binary. The session is injected as `deps.session`, as the skill
runner injects `deps.call`. The stub applies a reference patch to the working copy and returns a
result object. A real result JSON, and a real one that ended at `--max-turns 1`, are captured once
by hand and committed as the stub's templates, so the parser is tested against what the CLI prints.

1. **The build is deterministic.** Two builds of one arm have the same tree hash, and every file
   has LF endings.
2. **The arms differ only in the context layer.** The with-arm's file list minus the without-arm's
   is exactly `CONTEXT_LAYER`, and every other file is byte-identical.
3. **Nothing leaks.** No file in the base tree names a context-layer path, and none contains any
   phrase on the list kept beside each rule's sentence.
4. **The base repo is healthy and no task is done already.** Its own suite passes in both arms.
   `accept.mjs` fails every task on an untouched tree.
5. **Every task is solvable without the layer.** Each `good` patch passes in both arms.
6. **Every rule check can fire.** Each `naive` patch passes `works` and fails `rule`.
7. **The function and the command agree** on every patch.
8. **A session cannot pass by editing tests.** A patch that edits or deletes one of the repo's own
   tests, or adds a file named like an acceptance test, changes no result.
9. **The launch is identical across arms.** Over all thirty stubbed sessions, the prompt, the
   arguments and the environment differ between the two arms of a pair in nothing but the
   working directory, and no prompt names a layer file.
10. **The harness favours neither arm.** A stub that behaves the same in both arms gives two
    identical rows for every task. A stub that applies `good` in one arm and `naive` in the other
    gives 12 against 0, and swapping the arms swaps the table.
11. **A failed call is not a zero.** A stub that throws once leaves that cell's denominator at the
    sessions scored, lists the failure, and shows the retry. A `max-turns` result is scored and
    marked `budget`. A result reporting another model is a failed call.
12. **The schedule** printed by `--dry` is the one in this spec, and is the same on every call.
13. **A model run never happens in CI.** With `CI` set and no injected session, the run refuses,
    in the words `evals/run.mjs` uses.
14. **The record is written, not typed.** `--record` produces the section from a run's records,
    leaves every earlier section byte-identical, and accepts no number from a flag.
15. **The reading rule** returns each of its five readings on counts chosen to land on each side
    of every threshold.

The step is done when `node evals/harness/run.mjs --dry` prints the table from a stubbed run, and
the checks in the plan's rules pass.

## Architecture

```
evals/harness/
  fixture.mjs    buildFixture(dir, { arm }) · CONTEXT_LAYER · FIXTURE_VERSION · treeHash
  tasks.mjs      the five tasks: id, prompt, rule id, control flag — the only list of them
  accept.mjs     the one scorer: accept(task, tree) and the command
  accept/        <task>.works.test.mjs · <task>.rule.test.mjs
  solutions/     <task>/good · <task>/naive — reference patches, used by tests only
  run.mjs        preflight · probes · schedule · sessions · table · --dry · --record
  RESULTS.md     the log, written by run.mjs --record
```

- The part of `evals/run.mjs` that spawns `claude` (the `.cmd` quoting on Windows, the kill on
  timeout, reading the JSON) moves to one module both runners use. The arguments stay with each
  caller, since they differ on purpose.
- Nothing here imports from `core/`, `index/`, `mcp/` or `tools/`, and nothing in the product
  imports from here ([`evals/AGENTS.md`](../../evals/AGENTS.md)). No dependency is added
  ([ADR 0004](../adr/0004-no-runtime-dependencies.md)).
- `evals/AGENTS.md` takes the harness's invariants in step 2.2: the arms differ in one list; the
  acceptance files never enter a working copy; a failed call is never a zero; `RESULTS.md` is
  append-only.

## Risks & edges

- **Acceptance runs code an agent wrote**, on the contributor's machine. It runs under `node
  --test` in a temp directory with a time limit. The harness is run by hand, by its maintainer, on
  a fixture with no network code.
- **`Bash(node *)` is a wide allow rule.** It is needed to run tests and it is the same in both
  arms. It is a reason this never runs in CI or on a shared machine.
- **A model that was updated between two measurements.** The model name is pinned, and the record
  keeps the name the session reported and the CLI version. Two sections with different values are
  two measurements, not a trend.
- **The contributor's own instructions.** If `--setting-sources` without `user` does not keep
  `~/.claude/CLAUDE.md` out, it reaches both arms alike. That cannot favour an arm, and it can move
  both. The record says whether the file existed.
- **A session that reads the layer and stops to ask.** With nobody to answer, a question is an
  unfinished task and scores as one. This counts against the with-arm, and it should.
- **Ceiling.** If the model passes nearly everything without the layer, the reading says so in
  those words instead of reporting "no difference".
- **Rollback.** Everything is new files under `evals/harness/` and tests. Reverting the step
  removes it; nothing a plugin user runs changes.

## Not confirmed

Each is settled by 2.2 before the code depends on it, by reading the docs again or by one real
call, and the answer is written into this section's successor in `evals/README.md`.

- **Whether excluding `user` from `--setting-sources` keeps `~/.claude/CLAUDE.md` and
  `~/.claude/rules/` out of the session.** The memory page states it only for `CLAUDE.local.md`
  ("skipped if you exclude `local`") and project rules ("skipped if you exclude `project`").
  `claudeMdExcludes` passed through `--settings` is the candidate if they do load.
- **Whether a project `CLAUDE.md` loads when `project` is excluded.** Not stated. The spec keeps
  `project` in and lets the probe decide.
- **What `--output-format json` prints when `--max-turns` is reached.** The CLI reference says the
  run "Exits with an error". The Agent SDK page says the result then has subtype `error_max_turns`
  and that "All result subtypes carry `total_cost_usd`, `usage`, `num_turns`, and `session_id`"
  ([agent-loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md)). That the CLI prints the
  same object is assumed from `evals/run.mjs` reading `subtype`, `is_error` and `modelUsage`, and
  is confirmed by the captured `--max-turns 1` result.
- **Whether `permission_denials` appears in `json` output.** The headless page states it for
  `stream-json`. It is recorded when present and nothing depends on it.
- **`CLAUDE_SETTING_SOURCES`**, which `evals/run.mjs` sets, is not on the env-vars page. The
  harness relies on the flag only.
- **Whether `acceptEdits` plus the allow-list is enough for a session to finish these tasks**
  without a denied command it needed. One real session of T5 in each arm, before the thirty,
  answers it; a denied `node` or `npm test` call is a reason to widen the list, for both arms.
- **The cost of a session.** Unknown until one has run.

## Out of scope

- Running the harness in CI or on a schedule, and any gate that compares against `RESULTS.md`.
- A second fixture, a second language, a large repo, or more than five tasks.
- A third arm: leaves loading automatically (the mods spec's question), the layer plus the hooks
  and the verifier, or a layer written by a model run of `/cortex`.
- Measuring a stale, wrong or oversized context layer.
- Which document in the layer did the work.
- `claude plugin eval` and whether a ritual fires (H2).
- Any model as a judge of a result.
- Changing a sentence in `README.md` or on the site. M10 says when that question is opened; it does
  not answer it.
