# ADR 0011 — four rituals covered two jobs

**Status:** accepted · 2026-08-19 · Cortex 2.9.0

## Context

Cortex shipped `/cortex-doctor` and `/cortex-audit` for vault health, and `/scope-area` and
`/cortex-brief` for scoped `AGENTS.md` leaves. Each pair arrived at a different time and each new
one was written as an addition rather than a replacement.

By v2.8.1 the pairs had converged:

- `skills/cortex-doctor/SKILL.md` scanned six categories. `agents/cortex-auditor.md` — the subagent
  `/cortex-audit` dispatches — scanned the same six, plus employer-firewall breach, plus a
  content-health signal. The doctor's scan was a strict subset, and `/cortex-audit` already carried
  an inline fallback for when the subagent is unavailable, which is the doctor's entire remit.
- `/scope-area` and `/cortex-brief` both wrote one `AGENTS.md` leaf into a critical directory, both
  wired a root routing table, both refused to split where no invariant lived. Their rules were the
  same sentence twice: "Same filename everywhere (`AGENTS.md`), nested" and "One filename,
  `AGENTS.md`." The only real difference was where step 1 got its candidate — from
  `.cortex/index/index.json`, or from a directory the user names.

Nothing enforced the distinction, so the distinction was carried by prose. Each sibling said "I am
not my sibling" in its own body, again in the other's body, and a third time in `AGENTS.md`'s
gotchas — 33 lines of a file every agent loads on every run, and the second-most-churned file in
the repo.

This is also what paused the capability-floor work. A frontmatter key declaring "this ritual needs a
subagent" would have been declared twice, by `/cortex-doctor` and `/cortex-audit`, for one job. The
convention would have hardened the duplication instead of describing it.

## Decision

Fold `/cortex-doctor` into `/cortex-audit`, and `/scope-area` into `/cortex-brief`. Delete the two
absorbed skills and the disambiguation prose that existed to separate them.

The survivors absorb what was genuinely theirs and nothing else:

- `/cortex-audit`'s inline fallback becomes a **pointer** rather than a gesture — it names
  `agents/cortex-auditor.md` as the file to read and run when the subagent is unavailable. The
  report is identical either way; only the context isolation is lost.
- `/cortex-brief` gains a second entry point: a directory the user names skips the ranking. Two
  lines, where a whole second skill stood.

A deleted skill's `description` is a context pointer, so the survivors absorb the dead ones'
genuinely distinct trigger branches — "clean up cortex", "fix dead links", "is the file structure
healthy" for the first; "give this part its own brain", "this area is critical" for the second.
Synonyms that renamed a branch already present were dropped rather than merged.

## What was NOT collapsed, and why

`/audit` survives the same test. It scores **content** out of 100 and writes nothing;
`/cortex-audit` finds and fixes **structure**. Read-only scoring and mutating repair are two jobs,
and the seam between them is real. `/reindex` survives too — it regenerates the navigator graph,
which neither survivor does.

Three health rituals became two, not one. The gotcha separating them stays, because it describes a
difference that exists.

## Consequences

- `AGENTS.md` and `README.md` each lose two ritual rows; `AGENTS.md` loses three gotchas outright
  and rewrites a fourth.
- Four ritual names to learn become two. `/cortex-doctor` and `/scope-area` stop resolving; a user
  who types either gets nothing, which is why this is a minor-version interface change and is called
  out at the top of the changelog entry.
- `core/test/plugin.test.js:123` — "skills referenced by other skills exist" — pins the repoint: a
  cross-reference left pointing at a deleted ritual fails the suite instead of shipping.
- `CHANGELOG.md` and `docs/superpowers/specs/` keep their references. They are history, and a
  document describing a ritual that existed when it was written is accurate; rewriting it would be
  the lie.

## The test this establishes

**When the prose separating two rituals grows longer than the difference it describes, they are one
ritual.** Recorded in `skills/writing-for-agents/SKILL-MECHANICS.md`, beside the router-skill note
that first justified the gotcha list.
