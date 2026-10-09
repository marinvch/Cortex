---
name: cortex-next
description: Where this repo is in the Cortex sequence, read off disk, and the one command to run next. Triggers — "what do I run next", "where am I", "I installed Cortex, now what".
effort: low
metadata:
  capability: mechanical
---

# /cortex-next — where this repo is, and the one command to run now

Cortex had an ordering problem, not a capability one. Every ritual knew its own job and none of
them knew what came after, so the honest answer to *"I installed the plugin, now what"* was a table
of eleven commands sorted by nothing. A table is a menu. This is a position.

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-next.mjs" .          # the ordered runbook, ✓ / → / ·
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-next.mjs" . --line   # one line, for a footer
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-next.mjs" . --json   # for a ritual to walk
```

Read-only in the strongest sense: it writes nothing, not even under `.cortex/`.

## The one thing you must not do

**Never mark a step done that no file on disk supports.** Every `✓` traces to something that
exists — `.cortex/index/index.json`, a report in `.cortex/findings/`, `CONTEXT.md`, a
`<dir>/AGENTS.md`, a `SKILL.md` under `.claude/skills/`. A model that "remembers" running
`/cortex-scaffold` last session, and ticks the box on that memory, sends the user past the step
that actually writes their context layer. If the filesystem cannot say, the step is not done.

The same rule is why this is a script and not a judgment call. The sequence is a fact about the
repository; asking a model to re-derive it every session is how a user gets a different answer
each time they ask.

## How to run it

1. **Run the CLI** from the repo the user is asking about — not from the Cortex checkout, unless
   that is the repo. `--json` if you are going to act on the result rather than show it.
2. **Show the runbook as it printed.** Do not re-sort it, do not collapse the done steps into a
   sentence, and do not append the commands it deliberately left out. Its order is the answer.
3. **Say the next command last**, on its own line, so it is the thing the user's eye lands on.
4. **If a step is blocking** (a retired `.ai-os/` engine), say why it jumps the queue: the old
   memory store gets harvested into `AGENTS.md` before anything is deleted, and running the
   sequence around it loses that knowledge permanently.

## What the steps mean

| Step | Done when | Run |
|---|---|---|
| Index the codebase | `.cortex/index/index.json` exists | `/cortex` |
| Read the findings | a report in `.cortex/findings/` | `/cortex` |
| See it as a graph | `.cortex/view/repo.html` exists | `/cortex-view` |
| Reconcile prior agent docs | *not checkable — required while `CONTEXT.md` is missing; afterwards optional, and only while `.github/copilot-instructions.md` holds rules of its own* | `/optimize-context` |
| Write the context layer | `AGENTS.md` **and** `CONTEXT.md` | `/cortex-scaffold` |
| Scoped briefs | any `<dir>/AGENTS.md` | `/cortex-brief <dir>` |
| Skills for this stack | any `.claude/skills/*/SKILL.md` | `/cortex-skills` |
| Refresh drifted skills | *appears only while a skill names a path that is gone, says "no tests" beside a test suite, or runs a script nobody declares — needs an index* | `/cortex-skills` |
| Close the artifact chain | every loop artifact that applies here exists — `index/cortex-loop.mjs` says which | `/cortex` |
| Semantic summaries | `.cortex/index/enrichment.json` | `/cortex-enrich` |
| Shared memory | anything in `.cortex/memory/` | `/dream` |

Optional steps never become "next" and never hold the sequence up. The per-change rituals
(`/cortex-impact`, `/cortex-review`, `/analyze-spec`, `/diagnosing-bugs`, `/catch-me-up`) are a
lookup, not a sequence — they are triggered by what the user is doing, never by how far along the
install is, so they never appear as a step.

## Why "reconcile" sits where it does

An `AGENTS.md` a human wrote before Cortex arrived must be slimmed **before** `/cortex-scaffold`
runs, not after. Scaffold is brownfield-safe and will not clobber it — which means the user ends up
with their curated file *plus* an `AGENTS.generated.md`, and a merge to do by hand. Doing
`/optimize-context` first leaves one file. Once `CONTEXT.md` exists the scaffold has run and an
`AGENTS.md` older than the index is Cortex's own, so the step no longer names it.

One case keeps the step after that, as an optional row: a `.github/copilot-instructions.md` that
holds rules of its own where Cortex writes a one-line pointer at `AGENTS.md`. Copilot reads that
second copy and nobody keeps it true. The row says the file is a second copy, which is all the disk
can show. Whether it is stale is for `/optimize-context` to find by reading both. Present it as an
offer: a team may keep rules for one tool on purpose.

## Related

- `/cortex` is step one: a single run satisfies index through the loop, so on a fresh repo this
  sequence mostly matters for what was deferred. `/cortex-install` is its read-only half and prints
  this same next line when it finishes.
- `/cortex-view` renders the whole sequence as a **Next steps** tab in the graph
  viewer, for a user who would rather see it than read it.
