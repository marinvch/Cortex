# 0033. A decision needs a name on the roster, and that is not authentication

**Date:** 2026-11-23
**Status:** accepted

## Context

A `decided` answer now reaches the whole team through `catch_me_up`, `/whats-changed` and
`/story-map`. Before that, anyone could record one under any name: with `CORTEX_AUTHOR=not-on-team`,
`answer --status decided` succeeded on an ask addressed to `product`. A typo in a handle, or a machine
with the wrong git name, could put a decision in front of everyone signed by nobody the team knows.

Cortex has no accounts. A handle is what `CORTEX_AUTHOR` or git `user.name` says, and the team-brain
is a git repository that anyone with push access can edit directly.

## Decision

**`answer --status decided` is refused when the team has a roster and the caller's handle is not on
it.** The check runs after the pull, against the current `team.json`, and before anything is written.

- A team with no members in `team.json` yet is not checked, because nobody could decide otherwise.
- `answered` and `wontfix` are not checked. Only a decision is presented to the whole team as settled.
- The refusal names the fix: set `CORTEX_AUTHOR` to your handle, or join with `cortex team member`.

**This is a guard against mistakes, not a security control.** It does not stop someone from setting
`CORTEX_AUTHOR=po1`, and it does not check that the person holds the role the ask was sent to. Who may
push to the team-brain is decided by the access rules of the repository that hosts it.

## Alternatives rejected

| Option | Why not |
|---|---|
| Only the addressed role may decide | A lead or architect often settles a question sent to another role. Cortex would refuse a legitimate decision on a guess about the team's process |
| Verify identity with signed commits | Every member would need a signing key before their first answer. That is the setup burden Cortex exists to remove, and the Desktop pack has no way to do it |
| A hosted service with accounts | Rejected for now in the 2026-11-22 audit: it is a different product, with data to host |
| Warn and write anyway | The decision is already in front of the whole team by the time anyone reads the warning |

## Consequences

A mistyped handle now fails at the moment it matters, with the fix in the message. A new member must
be on the roster before they can decide, which `/join-team` already asks for.

The cost: the record can look more trustworthy than it is. A name on a decision means "someone with
push access wrote this name". The docs must keep saying so.
