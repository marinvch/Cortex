---
name: cortex-impact
description: Answer "what breaks if I change this" before the change, from the repo's own import graph — who depends on these files, how far out, and which of them no test exercises. Use when the user asks what a file touches, what a diff could break, which tests to run for a change, or whether an edit is safe. Deterministic; writes nothing.
capability: mechanical
---

# /cortex-impact — what breaks if this changes

The index has carried import edges since the first version, and everything read them forwards:
*what does this file import*. Nobody asks that. Before touching a file, the question is the reverse
one — **who depends on me, and is any of it tested?**

This walks the graph backwards. No LLM, no network, no clock: it is arithmetic over data
`/cortex-install` already produced, which is why it sits in the `mechanical` tier and runs on any
model or none at all.

## The one thing you must not do

**Never report the count as a total.** Import resolution upstream is regex-based (ADR 0004 — a
plugin install clones the repo and runs no build, so there is no parser), which means dynamic
imports, computed paths and framework-discovered files are invisible.

The files named **will** be affected. Others may be. So the output says *at least N*, and no flag
turns that into a complete answer. "3 files affected" when the truth is 5 is worse than "at least
3", because the first invites the reader to stop looking. Carry the hedge into whatever you write.

## Run it

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-impact.mjs" src/lib/db.ts        # named files
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-impact.mjs" --staged             # what you are about to commit
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-impact.mjs" --since HEAD~3       # what changed over a range
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-impact.mjs" --staged --json      # machine-readable, for a ritual to walk
```

`--depth N` bounds the walk when the radius is enormous; the output says it stopped.
`--staged` falls back to unstaged files when nothing is staged, because someone mid-edit asking
"what does this touch" means their working tree.

Needs `.cortex/index/index.json`. If it is missing, exit 2 says so and names the command that
builds it — **do not** guess a radius without an index.

## Read the output

```
    ok  d1  mcp/server.js   (9 commits)
    ??  d2  mcp/lib/recall.js   (4 commits)
  test  d1  core/test/date.test.js
```

- **`d1` / `d2`** — hops from the change. A depth-1 dependent is where a break shows up first.
- **`ok`** — a test exercises it. **`??`** — none that Cortex can see. **`test`** — it is a test.
- **commits** — churn, the tiebreak within a depth. A file that changes weekly is the one to check.

Three sections carry the answer, in descending order of how much they should change what you do:

1. **Not in the index** — a path Cortex does not know: new, ignored, or a typo. Reported rather
   than dropped, because a typo contributing nothing silently reads as *nothing depends on this*.
   Resolve it before trusting the rest.
2. **Exercised by no test** — the actionable half. A large radius that is covered is an ordinary
   change; a small one that is not is where the regression comes from. Say this plainly.
3. **Tests worth running** — the ones covering anything in the radius, plus the changed file's own.

Coverage is three signals (name, import, string-mention) and is itself a floor — a file marked
`??` may still be exercised in a way the index cannot see. Never write "this is untested"; write
"no test Cortex can see exercises this".

## When you are asked, not run

Someone asking "is it safe to change X" wants a judgment, not a table. Run it, then answer in
prose: name the depth-1 dependents, name what is unverified, name the tests to run, and state the
floor. Paste the raw output only if they ask for it.

If the radius is empty, that is a real answer worth giving carefully: *nothing in the index imports
these — a floor, not a proof.* An entry point, a config file, or something loaded dynamically will
look exactly like dead code here, and calling it dead is the mistake this ritual makes if you let it.
