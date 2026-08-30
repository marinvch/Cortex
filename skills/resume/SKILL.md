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
```

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

Once the user confirms or corrects the remaining work:

- **Nothing durable was written and the session taught something** → `/dream` before continuing, not
  after. It is committed, so it survives the next context window.
- **Leaving again soon** → `/handoff` at the end. It is ephemeral and for the next agent right now,
  which is a different job from `/dream` — running one is not running the other.
- **You were away, not mid-task** → `/catch-me-up` reads brain notes and git history over a date
  range and writes nothing.
- **The repo state is what is unclear, not yours** → `/cortex-next` names the single next command.
- **Work sits in open PRs** → `/ship` walks the queue in an order that will not strand anything.

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
