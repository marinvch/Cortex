---
name: resolve-conflicts
description: Resolve a stopped merge or rebase hunk by hunk, by each side's intent, and finish it. Never aborts. Triggers — "resolve these conflicts", "the rebase is stuck", "CONFLICT (content)".
metadata:
  capability: judgment
  reached-by: git — an interrupted merge or rebase, not another ritual
---

# /resolve-conflicts — keep what each side meant, then finish

Each side of a conflict was written to achieve something. The resolution has to keep both of those
aims, or drop one on purpose and say so. The two ways this goes wrong are choosing whichever side
reads more cleanly, and running `--abort`, which throws away the work in progress.

## 1. Establish what is being merged, and why

```bash
git status
git log --oneline --graph -20
git diff --name-only --diff-filter=U     # the files still in conflict
```

Work out which branch is going into which, and what the merge is meant to achieve. That purpose
settles every case below where both sides cannot be kept.

## 2. Find out what each side intended

For every conflicting hunk, read why each side changed it: `git log -p --merge -- <file>` for the
commits involved, then their PRs and linked issues. If the repo has a `CONTEXT.md` or ADRs (see
[[define-terms]]), check the hunk against them. When one side breaks a recorded decision, that
side is wrong; do not meet it halfway.

If you cannot say what a side was trying to do, do not resolve that hunk. Say which one it is and
ask.

## 3. Resolve, hunk by hunk

Go file by file and hunk by hunk.

- **Keep both aims when they can coexist.** This is the usual case.
- **When they cannot,** keep the one that serves the purpose from step 1, and state what the other
  side loses.
- **Write no new behaviour.** The result is one side, the other, or both combined. If the correct
  code is something neither side wrote, resolve the conflict first and make that change as a
  separate commit afterwards.

Before leaving a file, search it for `<<<<<<<`, `=======` and `>>>>>>>`.

## 4. Run the repo's checks

Find the checks the project runs (the scripts in its manifest, its CI workflow, its `AGENTS.md`) and
run them: usually the type check, then the tests, then the formatter. A merge that does not build is
not resolved. Fix what the merge broke and nothing beyond it.

## 5. Complete the operation

Stage the resolved files and commit, following the repo's own conventions for hooks and for how
changes reach the default branch. During a rebase, run `git rebase --continue` and go back to step 1
for each commit that stops, until the rebase finishes.

Do not abort. If a conflict truly cannot be resolved, stop with the conflict still in place and hand
it back to the user with what you found. Abandoning the merge is their decision.
