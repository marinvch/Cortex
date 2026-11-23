# 0032. A team clone replays its local commits and never discards them

**Date:** 2026-11-23
**Status:** accepted

## Context

Every write to a team-brain commits in a local clone and then pushes. Two people writing at the same
moment is normal, and one of the two pushes loses. Until now that clone stayed ahead and behind the
remote for good: `pull` was fast-forward only, so it failed on every later call, and the next push
was rejected too. The person's ask never reached the addressee, and they stopped receiving anything
new. Reproduced through the real `ask` tool: `## master...origin/master [ahead 2, behind 1]`, with the
addressee's inbox empty.

The rule until now, in `mcp/lib/catchup.js` and its test, was that a clone with local commits the
remote lacks is left exactly as it is. It protected local work. It also made a lost race permanent.

Recovery has to live in `pull` and not only in a push retry. On `lab`, the write paths never pull
(`if (outwardSync) pull`), so the read tools are the only place such a clone can catch up. A clone
already stuck has no push coming that would repair it either.

## Decision

**When `pull` cannot fast-forward because the clone has diverged, it replays the local commits onto
the remote with a rebase.** Local commits are never lost. Their hashes may change, and their dates do
not, so a date filter does not report an old note as new.

- **A rejected push recovers once and retries once**, in `commitAndPush` and `pushHead`. No loop.
- **Recovery never pushes by itself.** A pull only integrates. Pushing stays behind `outwardSync` and
  the destination check, and the fetch goes through the inbound check (ADR 0030).
- **A conflict leaves the clone as it was.** The rebase is aborted, HEAD is the commit from before the
  attempt, and the error names the conflicted files and points at `/resolve-conflicts`. Two different
  answers to one ask are a disagreement between people, and Cortex does not pick a winner.
- **Nothing is discarded to make a rebase run.** No `--autostash`, `reset --hard` or `clean`. Changed
  tracked files stop the recovery and are reported. Untracked notes stay where they are.
- **The test for "did the remote move" is what git reports after a fetch, not its error text.** Git's
  messages are translated, so matching their words would fail on a machine in another language.

## Alternatives rejected

| Option | Why not |
|---|---|
| Keep fast-forward only and report the failure | That is the bug: one lost race stops a person's asks from arriving and keeps them from receiving new ones |
| Retry only in the push | A `lab` clone never pushes, and a clone already stuck has no write coming to repair it |
| `git pull --no-rebase` (merge) | Keeps hashes, but puts a merge commit into the shared history for every lost race, and those show up in `catch_me_up` and `/whats-changed` |
| Reset to the remote and re-apply the note | Discards a commit to make the clone clean, and a crash in between loses the note |
| Resolve a conflict automatically | The conflicting content is a decision someone made. Either side winning silently hides that two people disagreed |

## Consequences

A lost push now repairs itself, usually on the same call, and the person never hears about it.

The cost: a read tool can now change the hashes of unpushed local commits. Nothing refers to those
hashes before they are pushed, so nothing breaks, but "read-only" for these tools means they change
no content, not that the clone's history is untouched.

A real conflict still needs a person. Until it is resolved, that clone keeps its commit, cannot push,
and says why on each call.
