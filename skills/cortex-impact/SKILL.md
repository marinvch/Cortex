---
name: cortex-impact
description: What breaks if I change this — the files' dependents, how far out, and which no test covers, from the import graph. --against checks a collision with another session's change set, --size recommends one agent or a team. Triggers — "is this edit safe", "which tests to run", "what does this file touch".
effort: low
metadata:
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

`--size` answers "one agent or a team?" for the files a task will touch: `single`, `team` or no recommendation, with one numbered reason per signal. The lines are provisional and the developer chooses, so relay it as a recommendation, never a decision.

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

## Two sessions, one repo — `--against`

Parallel sessions on one repository are normal, and until this flag the only defence was noticing
stale mtimes by hand. A test run once reported nine failures and then none minutes later, because
another agent was landing edits underneath it. `--against` compares **your** change set (paths,
`--staged` or `--since`, exactly as above) with **theirs**, and reports two things:

- **In both change sets** — a file you both touch. Decide who edits it before either of you goes on.
- **One-hop collisions** — `x (mine) imports y (theirs)`: they are changing something you depend on;
  `y (theirs) imports x (mine)`: you are changing something they depend on. This is the case path
  comparison misses, and the reason to run it at all.

```bash
# their branch, committed work only — the other session's worktree is on feat/x
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-impact.mjs" --staged --against-ref feat/x

# their uncommitted work, as a list (one path per line; CRLF, a BOM and # comments are fine)
git -C ../other-worktree diff --name-only HEAD > theirs.txt
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-impact.mjs" --staged --against theirs.txt

# the same, piped
git -C ../other-worktree diff --name-only HEAD | node "${CLAUDE_PLUGIN_ROOT}/index/cortex-impact.mjs" --staged --against -
```

`/resume` finds the other worktrees (`git worktree list`, and the dirty ones it reports by path);
this is the check to run on each before editing. `--against-ref` reads `HEAD...ref` — what their
branch did since the two diverged — so a session that has not committed yet shows as an **empty**
set, and the command says so (exit 2) rather than reporting "no overlap". Use the list form for that
session. Paths are normalised on both sides (`\` or `/`, `./`, absolute paths inside the repo), so a
list written on Windows compares correctly.

Only one hop, and the blast radius is not printed in this mode — run without `--against` for each
side's full radius. `--depth` with `--against` is refused. `--json` returns `overlap`, `collisions`
(each with `mine`, `theirs`, and `edge`: `mine-imports-theirs` or `theirs-imports-mine`), `unknown`
and `atLeast`.

**The same floor applies.** Say "at least N": a dynamic import coupling the two sets is invisible,
and each list is only what its side reported. "No file is in both change sets, and no import edge
joins them" is not "you cannot collide".

**Exit codes are the command's usual ones and do not signal findings:** `0` an answer was printed,
overlap or not; `1` an unknown flag, a bad `--root`, an `--against` file that does not exist, or
`--depth` with `--against`; `2` no index, an empty change set on either side, or git could not read
one. To block on overlap, read `--json` and decide.
