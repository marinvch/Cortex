---
name: ship
description: Get finished work onto the main branch without stranding any of it — judge the change against the repo's own docs, open one PR at a time, merge in an order that keeps every branch mergeable, and clean up what merged. Use on "open a PR", "which PR do I merge first", "push this to master", "merge and continue", "clean up the old branches", "качи го", "комитни и push". Also use when several branches or open PRs have piled up and the order is unclear.
capability: judgment
---

# /ship — land the work, in an order that strands nothing

Shipping fails in two ways that look nothing alike. The first is a bad change landing. The second is
a good change never landing — parked on a branch, stacked behind a PR that merged first, or sitting
in a queue nobody knows the order of. The second one is quieter and happens more.

## 1. Is it ready

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-preflight.mjs"
git status --short
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-review.mjs" --staged
```

`/cortex-review` is the half no other check performs: it asks whether the change breaks a documented
rule, **and whether it just made one of those documents wrong**. A rename that leaves `AGENTS.md`
pointing at the old path breaks no test and is a defect anyway — this repo shipped exactly that
twice. If the change touched behaviour a document describes, fix the document in the same commit.

Then run whatever the repo runs. Discover it rather than assuming: a `test` script, a CI workflow, a
`tools/test/run.sh`. Do not open a PR on red — a reviewer's first job should not be re-running your
tests.

## 2. One PR at a time

Push to a branch and open one PR against the main branch. Not a stack.

**Stacked PRs strand their content.** When the base of a stack merges first, the PRs above it are
left pointing at a branch that no longer exists as they knew it — GitHub retargets them, the diff
turns into somebody else's work, and the honest fix is to re-open them by hand. If the work genuinely
has to be sequenced, land the base, then branch again from the updated main. Slower once, versus
untangling it every time.

Say what the PR does in the body, not just the title. The reader is deciding whether to merge, and
"fix stuff" gives them nothing to decide with.

## 3. When several are already open

```bash
gh pr list --state open
gh pr view <n> --json mergeable,mergeStateStatus,baseRefName,headRefName
```

Merge order is not arbitrary. Rank it — these are **strict tiers**, not suggestions:

1. **Anything another PR is based on**, first — it is the base of an accidental stack and merging it
   later is what strands the rest.
2. **Anything touching files a second PR also touches**, next, so the conflict surfaces once in a
   branch rather than repeatedly in main.
3. **Everything else**, in any order.

How to apply it mechanically:

- Give each PR exactly one tier (the lowest-numbered one it qualifies for), using only two tests:
  *is some other PR's `baseRefName` this PR's `headRefName`?* → tier 1. Otherwise, *does any file in
  its list appear in another open PR's list?* → tier 2. Otherwise → tier 3. Compare file lists
  pairwise across **all** open PRs; a shared file with the base of a stack still counts.
- Output **every** tier-1 PR, then **every** tier-2 PR, then tier-3 PRs. An independent PR never goes
  ahead of a tier-1 or tier-2 PR, even if it is "easy", "isolated", or "no reason to hold it back".
  Merging the easy ones first to "get them out of the way" gets the order backwards.
- **Being stacked on another PR is not a tier.** A child PR whose files overlap nothing is tier 3.
  It goes after all tier-2 PRs, not straight after its base.
- Before stating the order, check it: scan left to right and confirm the tier numbers never decrease.
- Write the evidence before the order, one line per PR, e.g. `#357 → T1 (base of #364)` ·
  `#356 → T2 (routes.ts with #362, #364)` · `#385 → T3 (child of #380, shares nothing)`.
  Name the actual shared file. If you cannot name one, it is not tier 2. A PR with no line has not
  been tiered yet. A PR whose only file partner is a tier-1 base is still tier 2, and the base stays
  tier 1. If every PR comes out tier 3, say so and use PR number as the tiebreak.

Say the order and why before merging anything, then merge them one at a time, checking the next one
still reports mergeable after each. A queue that was fine three merges ago is not evidence.

If a merge stops with conflicts, `/resolving-merge-conflicts` — resolve by intent, never `--abort`.

## 4. After it lands

```bash
git branch --merged <main> | grep -v '^\*\|main\|master'   # local, already merged
git branch -r --merged origin/<main>                       # and the remotes
```

Delete only branches that are **actually merged** — that is what `--merged` answers, and it is the
one safe basis for deleting a branch. **Squash and rebase merges never show as `--merged`**,
because the commits in main have new hashes. For those branches, a branch counts as merged when its
PR state is *merged* **and** the branch has **0 commits after the merge point**. If there are commits
after the merge, that is work main does not have, so keep the branch. A PR that was *closed without
merging*, a branch with no PR, and a branch behind a still-open PR are all unmerged. List them for
the user and don't delete them. "Looks old" is not: a stale-looking branch is exactly where
abandoned-but-wanted work lives. Show the user the list and let them confirm before deleting remote
branches; a local branch is recoverable from reflog, a remote one is a phone call.

Decide each branch by its state **now**, not after the merges you just planned, using this table and
nothing else:

| state | verdict |
|---|---|
| `--merged` yes | delete |
| PR merged (squash/rebase), 0 commits after | delete |
| PR merged, ≥1 commit after | keep (unlanded work) |
| PR open (even one you are about to merge) | keep, because it is not merged *yet* |
| PR closed unmerged / no PR, however old | keep, ask |

Give every branch a one-line verdict and the reason
(`merged, 0 after → delete`, `1 commit after merge → keep`, `closed unmerged → keep, ask`,
`PR still open → keep`, `no PR → keep, ask`), so the user can see why a branch was kept as well as
why one was deleted.

Close by saying what landed and what is left open. If the day produced a decision worth keeping,
`/dream` — the PR description is not where a future reader will look.

Shipping Cortex itself: if a `site-drift` issue opens after the merge, run `/site-sync`.

## Gotchas

- **Never skip hooks or bypass signing** (`--no-verify`, `--no-gpg-sign`) unless the user asks. A
  failing hook is a finding, not an obstacle.
- **`gh pr edit` fails in some setups**; `gh api repos/{owner}/{repo}/pulls/{n} -X PATCH -f body=...`
  is the fallback that works.
- **Never force-push a branch someone may have pulled**, and never force-push the main branch at all.
- **Committing and pushing are the user's call** unless they said otherwise. Getting the branch ready
  is this ritual's job; pressing the button is theirs.
- **`git pull` refusing to merge unrelated histories** means the local and remote are genuinely
  different trees — usually a re-init, or the wrong remote. Do **not** reach for
  `--allow-unrelated-histories` to make the message go away; find out which tree is the real one
  first, because the flag will happily weld two unrelated projects together.
