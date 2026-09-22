---
name: cortex
description: The single install. Give a repo — working or brand new — the whole AI-native SDLC loop in one pass: the root brief, the verification block, the verifier subagent, REVIEW.md, hooks, the intent home, evals and the control bands. Use on "install cortex", "set this repo up", "give this codebase a context layer", "set up the loop", "onboard this project", when opening an unfamiliar repo before work starts, or when a repo has no AGENTS.md and an agent is about to re-derive its architecture from scratch. Works on greenfield and legacy repos. Asks once, writes once, never touches source code.
capability: judgment
---

# /cortex — one install, working project or new one

The front door. Runs in a **target repo**, never in the Cortex repo itself.

Everything Cortex used to ask a user to sequence by hand — index, findings, scaffold, briefs,
skills — happens here, in one pass, behind one confirmation. The other rituals still exist and are
still callable by name; what changed is that nobody has to know their order to get a served repo.

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
propose to do, that the read steps write only to `.cortex/` and never to source, and wait for a
yes. Generated and gitignored is not the same as invisible: these are files appearing in someone's
project on a run they did not ask for.

**If `.cortex/` already exists**, Cortex is established here and re-indexing needs no ceremony.

The gate is on the **first write**, not on reading. Orienting yourself — reading `AGENTS.md`, the
tree, the manifest — needs no permission and never did.

## 2. Index

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-index.mjs" .
```

Deterministic and offline. Writes only `.cortex/index/index.json`.

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
  Deploy    REVIEW.md, .claude/settings.json, .claude/hooks/protected-paths.sh

  Waiting:  bands.yaml — needs REVIEW.md, and a CI system
  Not now:  enrichment (later), the plugin bundle (no)

  [a]ll   [p]ick a subset   [n]one
```

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
| root brief, shims, `CONTEXT.md`, `docs/adr/` | `/cortex-scaffold` — it owns the templates and the never-clobber rules |
| scoped `AGENTS.md` leaves | `/cortex-brief`, once per area they picked |
| `.claude/skills/` | `/cortex-skills`, from `index.stack` |
| the plugin bundle | `/setup-plugins` |
| `.cortex/memory/` | create it, and say it is **committed** on purpose |

The loop artifacts are written here, from `${CLAUDE_PLUGIN_ROOT}/templates/loop/`:

| Template | Lands at | Fill in |
|---|---|---|
| `verification.md` | appended to `CLAUDE.md` | only commands `loop.mjs` **detected**; ask for any it did not |
| `verifier.md` | `.claude/agents/verifier.md` | the run command |
| `REVIEW.md` | `REVIEW.md` | the detected generated paths under out-of-scope, and the suggestion cap |
| `settings.hooks.json` | merged into `.claude/settings.json` | **merge, never replace** — read the file first |
| `protected-paths.sh` | `.claude/hooks/` | the detected paths, as shell glob patterns |
| `intent-README.md`, `intent.md` | `intent/README.md`, `intent/TEMPLATE.md` | who accepts an intent |
| `agent-evals.yml` | `.github/workflows/` | the test command in `--allowedTools`; cases live in `evals/cases/<name>/` |
| `bands.yaml` | repo root | one metric with a stable history, a read-only command, the rollback runbook |

**Never invent a command.** Every `{{PLACEHOLDER}}` that `loop.mjs` could not fill is a question for
the user, not a blank for you. Cortex placeholders are bare `{{NAME}}`; a `${{ … }}` in a
workflow file is GitHub Actions syntax and is left exactly as written. A `CLAUDE.md` telling an
agent to run `npm test` in a repo with no test script fails the first time it runs, and a context
file that is wrong once is not trusted on the parts the reader cannot check.

**Never clobber a curated file.** If `AGENTS.md` or `REVIEW.md` exists with real content, write
`<name>.generated.md` beside it and say to diff. `.claude/settings.json` is merged into, key by
key — replacing it takes out hooks and permissions somebody else depends on.

## 8. Close

State what was written, as the same list of paths from step 6, so the promise and the result can be
read side by side. Then state what was marked **later**, by name — a deferred offer that goes
unmentioned is a decision the user made and Cortex quietly dropped.

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-loop.mjs" . --line
```

**End with that one line, not a menu.** It says what the loop is still missing or that it is closed,
and it is the last thing the user reads. A list of eleven commands sorted by nothing is where an
install stops being useful — they leave holding options instead of a step.

Then: suggest committing what was written so the team shares it, and mention `/dream` at the end of
a working day, because `.cortex/memory/` is the only part of the loop that nothing on disk will
remind them about.

## Gotchas

- **Re-running is the supported path, and it is cheap.** Satisfied rows come back as `present` and
  are not asked again; deferred ones come back as `missing`. There is no separate "update" flow.
- **`.cortex/index/` and `.cortex/findings/` are generated** and gitignored. `.cortex/memory/` is
  **committed** — that asymmetry is deliberate and worth explaining once.
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
