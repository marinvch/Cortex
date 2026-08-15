# 0003. The indexer asks git what belongs to a repository

**Date:** 2026-08-15
**Status:** accepted

## Context

The indexer needs to know which files are part of a repository. Cortex already had an answer for a
related question — `.cortexignore`, "the single source of truth for what is not knowledge" — with
a parser (`mcp/lib/cortexignore.js`), a bash twin (`tools/_cortex-lib.sh`) and a CI parity check
keeping them honest. Reusing it looked like the principled choice: one notion of noise, no drift.

The first implementation did exactly that, and indexed 91 files of this repo instead of 181. It
had silently dropped `skills/`, `tools/`, `templates/` and `docs/` — because a vault's
`.cortexignore` excludes them from *knowledge*, which has nothing to do with whether they are
*source*.

## Decision

`index/lib/walk.mjs` asks **git**: `git ls-files --cached --others --exclude-standard`, falling
back to a filesystem walk outside a checkout. It does not read `.cortexignore` at all.

## Alternatives rejected

| Option | Why not |
|---|---|
| Honour `.cortexignore` | Answers a different question; drops a repo's own source from its index |
| Reimplement `.gitignore` parsing | Duplicating a well-specified, subtle format git already implements correctly |
| A third ignore file (`.cortexindexignore`) | Another file for users to maintain, and a third notion of noise to keep in sync |

## Consequences

The index matches what a developer actually has under version control, which is the intuition
users bring. It also gives a **privacy property for free**: gitignored files cannot enter the
index, so a personal vault living inside a repo can never leak into a shared artifact.

The costs: an untracked, unignored scratch file is indexed until it is ignored or removed; and
outside a git checkout the fallback walk has no `.gitignore` semantics at all, so it relies purely
on the built-in skip list.

`.cortexignore` remains the source of truth for the vault's `recall` — that seam is unchanged.
Two files answering two questions is correct here; collapsing them was the error.
