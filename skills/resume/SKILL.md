---
name: resume
description: Pick up work that spans sessions — establish what is committed, what is uncommitted, what has diverged, and what the last session was mid-way through, then state the remaining work before touching anything. Use whenever a session starts on work already in flight, and on "continue where we left off", "what's left to be done", "what's next", "continue our last session", "resume the work", "продължи работата", "възтанови последната сесия". Run it BEFORE reading code or planning, so nothing gets rebuilt that already exists.
capability: judgment
---

# /resume — start from what is already there

The failure this prevents is rebuilding work that exists. An agent opening a repo mid-task has no
memory of the last session and every incentive to look productive, so it reads some code, forms a
plan, and re-derives a decision that was settled two days ago — or worse, re-implements something
already sitting on a branch.

**Read the state first, say what you found, and only then act.** The order is the whole ritual.

## 1. Ask the repo where it is

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-preflight.mjs"
git status --short
git log --oneline -15
git diff --stat "$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo origin/HEAD)"
```

Four questions, in order: which root and profile am I in, what is uncommitted, what landed recently,
and how far has this branch diverged from what it tracks. If the branch has no upstream, say so —
that is itself a finding about where the last session stopped.

Also list the branches. A branch nobody mentioned is where work usually turns out to be hiding:

```bash
git branch -vv --sort=-committerdate | head -10
main=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null); main=${main#origin/}
git branch --no-merged "${main:-master}"
git worktree list
```

**Only `git branch --no-merged <main>` decides which branches hold committed work.** Take that list
and remove the branch you are on. Then remove every branch that is the head branch of an open PR in
`gh pr list`. That work already exists on the remote as a PR, so it belongs to the `/ship` queue and
is not hidden. What remains is every other branch whose work exists only locally. Worked example:
`--no-merged` prints `a, b, c`, and open PRs exist for `b` and `c`. Hidden is then `a`. If only `b`
were printed and `b` has a PR, hidden is none. If it prints nothing, the answer is "none", however
many other branches exist. `-vv` tells you about tracking, not about whether work landed, so its
markers never add a branch to that set:

- no upstream at all → a local branch. If it is not in the `--no-merged` list, its commits are
  already in main and nothing is at risk
- `[origin/x: gone]` → the remote was deleted, usually after a merge. This is cleanup, not hidden work
- `ahead N` → unpushed commits. This counts as hidden work only if the branch is also in the
  `--no-merged` list

**Uncommitted work in another worktree is the one exception, because no branch test can see it.** A
`+` in front of a branch in `-vv` means it is checked out in another worktree. Run
`git -C <path> status --short` for each extra path `git worktree list` prints. A worktree with dirt
holds work even when its branch is not in `--no-merged` — a branch with no commits yet is exactly
what a session left mid-way looks like. Report it with its branch and its path, which is often a
temp dir nobody would think to look in. A clean extra worktree is cleanup, not work.

You may mention stale or cleanup branches as safe to prune. Never put them in the list of branches
holding work. When you describe a branch, copy its marker exactly as `-vv` shows it. Calling a
no-upstream branch "gone" (or the other way round) tells the next reader the wrong story about where
it came from.

## 2. Read what the last session left behind

Deterministic sources, cheapest first — none of these cost a model call:

- `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-next.mjs" . --line` — which step of the sequence this
  repo is on, read off disk.
- `.cortex/memory/` — what `/dream` committed. Read the two or three most recent dated files.
- The OS temp dir handoff, if one exists — `/handoff` writes in-flight state there and it is
  deliberately ephemeral, so a stale one is normal and a fresh one is gold.
- Open PRs: `gh pr list --state open`. A PR is a session's work parked where git status cannot see
  it, and "what's left" is frequently "merge these three, in this order".

If all of these are empty on a repo with real history, that is the finding to report — the previous
sessions wrote nothing durable, so the only record is the commits and the reasoning is gone.
`/dream` is what stops that recurring; say so once, then get on with the work.

## 3. Say what you found before doing anything

Three lines, in this shape, and do not skip to the work:

```
Committed:    <what landed, from the log>
Uncommitted:  <what is dirty, and on which branch>
Diverged:     <ahead/behind, and any branch or PR holding work>
Remaining:    <what you believe is left>
```

The last line is a claim, not a plan. Getting it wrong is cheap here and expensive three tool calls
later, so state it plainly enough that the user can correct it in one word. If the evidence is thin,
say the evidence is thin — an honest "I can see three commits and no notes, so I am guessing" is
worth more than a confident reconstruction the user has to spot and reject.

**Never reconstruct what a previous session decided.** Report what the record shows and what it does
not. A plausible-sounding decision you invented is indistinguishable from one that was actually made,
which is the one failure mode that makes this ritual worse than nothing.

## 4. Route, then work

Once the user confirms or corrects the remaining work, pick exactly one route. Check these
conditions in order and take the first that matches. What the user says about their own situation
comes before anything the repo state suggests:

1. **The user is leaving soon, short on time, or about to stop** → `/handoff` at the end. Do this
   even if branches have unpushed or unmerged work, because recording that work for the next agent
   is the handoff's job. It is ephemeral, which is a different job from `/dream`. Running one is not
   running the other.
2. **The user was away (holiday, days off) and asks what changed, and nothing is mid-flight** →
   `/catch-me-up`. It reads brain notes and git history over a date range and writes nothing.
3. **The session taught something, or a previous session worked something out, and nothing durable
   records it** → `/dream` before continuing, not after. `/dream` commits what it writes, so it
   survives the next context window.
4. **`gh pr list` shows open PRs** → `/ship`. It works through the queue in an order that will not
   strand anything. With no open PRs, `/ship` is the wrong route. Stale or merged local branches are
   not a PR queue.
5. **None of these apply, and the repo state is unclear** → `/cortex-next`, which names the single
   next command.

Then do the remaining work. Resuming is not a deliverable.

## Gotchas

- **Uncommitted changes on the wrong branch are the most common surprise.** Report the branch name
  in the same breath as the dirt; "3 modified files" without a branch sends the next reader to
  `master` to look for changes that are not there.
- **Do not `git stash`, `git checkout` or pull to tidy up before reporting.** You are establishing a
  state, and a state you altered is one nobody can verify. If the tree must move before work can
  continue, say why and ask.
- **A summary from a compacted conversation is not the repo's state.** It is one session's memory of
  it, and it can be confidently wrong about what landed. Check it against the log rather than
  trusting it.
- **A clean tree is still a line in the report.** Write `Uncommitted: none`. Don't drop the line,
  because a missing line reads as "not checked".
- **A memory file you listed but did not read is not evidence.** Say it exists and that you haven't
  read it. Don't guess its contents from its date.
- **Derive the hidden list mechanically, just before writing it.** Check each candidate name for two
  things: it appears verbatim in the `--no-merged` output, and it does not appear in the head-branch
  column of `gh pr list`. Drop any name that fails either check, even if your prose called it "worth
  checking", "no upstream" or "local only". If your report already said a branch "is not in the
  `--no-merged` list" or "has an open PR", then listing it as hidden contradicts your own evidence.
  A dirty extra worktree is the one entry that skips this check — it goes in as `<branch> (uncommitted,
  worktree <path>)`. If nothing survives, write `none`.
