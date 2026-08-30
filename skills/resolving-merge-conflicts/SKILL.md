---
name: resolving-merge-conflicts
description: Work through an in-progress git merge or rebase conflict hunk by hunk, resolving by intent traced back to each side's primary source, then finish the operation. Use when a merge or rebase has stopped with conflicts. Triggers — "resolve these conflicts", "the rebase is stuck", "CONFLICT (content)", "help me merge this branch". Never aborts.
capability: judgment
reached-by: git — an interrupted merge or rebase, not another ritual
---

# /resolving-merge-conflicts — resolve by intent, never by `--abort`

A conflict is two intentions colliding, not two blobs of text. Resolve the **intentions**. The
failure mode this ritual exists to prevent is picking a side because it looks tidier, or bailing
out with `--abort` and losing the work.

## Process

### 1. See the current state

`git status`, `git log --oneline --graph -20`, and `git diff --name-only --diff-filter=U` for the
conflicting files. Establish what is being merged into what, and what the merge is *for* — the
stated goal decides every tie-break below.

### 2. Find the primary sources

For each conflicting hunk, understand deeply **why** each side changed. Read the commit messages
(`git log -p --merge -- <file>`), the PR, the linked issue. Where the repo has a `CONTEXT.md` or
ADRs (see [[domain-modeling]]), check them — a conflict that contradicts an ADR is a signal that
one side is wrong, not that you must split the difference.

Don't resolve a hunk you can't explain. If neither side's intent is recoverable, say so and ask.

### 3. Resolve each hunk

**Preserve both intents where possible.** Where they're genuinely incompatible, pick the one
matching the merge's stated goal and state the trade-off out loud.

**Do not invent new behaviour.** A resolution that is neither side is how silent bugs get born —
if the right answer really is a third thing, that's a follow-up commit, not a conflict resolution.

Work file by file, hunk by hunk. Leave no conflict markers behind — grep for `<<<<<<<` before
moving on.

### 4. Run the checks

Discover the project's automated checks and run them — typically typecheck, then tests, then
format. A clean merge that doesn't compile isn't resolved. Fix whatever the merge broke, keeping
it to what the merge broke and nothing else.

### 5. Finish the operation

Stage everything and commit. If rebasing, `git rebase --continue` and repeat from step 1 for each
remaining commit until the rebase is done.

**Always resolve; never `--abort`.** If you truly cannot, stop and hand back to the user with the
conflict intact and an explanation — that's their call, not yours.

> In this vault specifically, commits need `SKIP_SIMPLE_GIT_HOOKS=1` and reach `master` by PR
> only. Check the repo's own conventions before committing anywhere else.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).
