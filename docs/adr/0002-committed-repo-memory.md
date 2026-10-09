# 0002. Repo memory is committed, and the secret gate is therefore mandatory

**Date:** 2026-08-15
**Status:** accepted

## Context

Cortex needs somewhere to keep what a team learns about a codebase: decisions, drift, the gotcha
found the hard way. The requirement was explicit — several developers, each running their own
agents, working "in symbiosis" without context drift.

That rules out per-developer local state immediately: it cannot be shared, so there is no
symbiosis. The remaining options differ in where the shared copy lives.

## Decision

Memory lives in `<repo>/.cortex/memory/`, **committed to the product repository**, as append-only
dated files. Git is the entire sync mechanism.

Because memory ships with the code, `core/scrub.js` gates every write and **refuses** anything
carrying a credential rather than sanitising it.

## Alternatives rejected

| Option | Why not |
|---|---|
| A separate team-brain repo, synced by git | A second repo per team, plus a sync story, plus a way to relate memory to the code it describes |
| Local-only per developer | Zero leak risk and zero conflicts, but no sharing — which was the entire requirement |
| Sanitise secrets on write instead of refusing | Silently rewriting a developer's note is a worse failure than declining it with a reason, and a sanitiser that misses one writes the secret to history |

## Consequences

Context travels with the code, arrives with a clone, and needs no server or protocol. A developer
joining the repo inherits everything the team's agents have learned.

The costs are real and accepted:

- **Memory is a leak surface.** The gate mitigates it; it does not eliminate it. A pattern the
  scanner does not know still gets through.
- The old privacy rule **inverts**. In the vault, personal content stayed gitignored; here nothing
  personal may enter memory at all.
- Concurrent writers require append-only, dated files. Any future feature that mutates an existing
  entry reintroduces the lost-update problem this design avoids.
- Fixture files containing secret-shaped strings need a `cortex:allow-secrets` marker, or the
  scanner reports the project's own security tests as a critical finding.

## Amendment, 2026-10-09: one file per author per day

Everything above stands as written. This section adds the layout of the dated files, which the
decision left open and the code had settled as a single shared file for each day, `<date>.md`.

**The layout is one file per author per day: `.cortex/memory/<date>/<author>.md`.** The writer
has used it since 2.41.48. `<author>` is a slug (`a-z`, `0-9`, `-`, at most 40 characters) of
`CORTEX_AUTHOR`, or of git `user.name` when that is not set. No email address is read or written.
With no usable name the entry goes to the day file `<date>.md`, and the writer says so on every
such write.

**Why.** The code, its brief and the `/dream` ritual said that two developers appending to the
same day's file merge as text. It was tried on 2026-10-09 with git 2.47.1 and the real writer, and
it is false:

- The day's file is new on both branches: `CONFLICT (add/add)`, and the merge exits 1.
- The day's file already existed on the base branch: `CONFLICT (content)`, also when the two
  entries were written hours apart.
- `<date>/dev-a.md` on one branch and `<date>/dev-b.md` on the other: the merge succeeds.

A team where every developer writes memory at the end of the day would hit the conflict on every
merge after the first one of each day. Append-only dated files, the consequence named above, keep
an update from being lost. They do not make two writers of one file merge. A path per author does,
and it says who wrote an entry, which a day file cannot.

**`merge=union` was weighed and not taken.** One `.gitattributes` line,
`.cortex/memory/*.md merge=union`, removes both conflicts locally with no code. It was run on the
same cases, and it was rejected for what it does to the result:

| What it does | Why that matters |
|---|---|
| Two entries written in the same minute share one heading | Readers make one entry per heading, so the second developer's entry is in the file and missing from the timeline, with nothing reporting it |
| Entries come out in the order of the merges | Every reader assumes the newest entry is last in the file |
| It never reports a conflict, whatever the edit | A hand edit of an old entry merges silently with both versions kept |
| It names no author | Attribution was half of what was asked for |
| It is a line in a file the team owns | Cortex would have to stamp `.gitattributes` behind the consent gate and track it |
| A host's merge button may not apply it | Not confirmed for any host. If it is ignored, the pull request shows the conflict anyway |

Cortex does not stamp the line. A team may add it by hand for its day files, knowing this list.

**What does not change.**

- Old day files are valid memory. Every reader reads both layouts, one date can hold both, and no
  file is moved, split or rewritten. There is no migration.
- The secret gate runs before the author is resolved and before any path is computed. A refused
  write leaves no file and no day directory.
- Append-only holds for both layouts, and the warning above about mutating an existing entry holds
  with it.

**Accepted costs.**

- The same person on two machines, or two people whose names give the same slug, share one file
  and can conflict as before. Setting `CORTEX_AUTHOR` ends it.
- A writer with no usable name keeps the day file and its conflict.
- A Cortex older than 2.41.43 does not read day directories. A developer on one sees fewer
  entries, never wrong ones, until they update.

The reproduction's full output, the rejected layouts (a flat `<date>.<author>.md`, a directory per
author) and the rejected names (an email address, its local part, a hash of it) are in
[the design](../specs/2026-10-09-team-memory-design.md).
