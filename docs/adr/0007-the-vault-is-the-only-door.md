# 0007. The Vault is the only door onto a vault root

**Date:** 2026-08-18
**Status:** accepted

## Context

`core/paths.js` holds a correct root guard. `resolveInRoot` resolves a candidate, realpaths its
nearest existing ancestor, and throws `OutsideRootError` if the result escapes. It works.

It was also optional. Five modules read and wrote vault content, and each decided for itself whether
to use it:

- `projects.js` called it for `getProjectContext` — added after a caller-supplied slug of
  `../../secret` was found to read any file on disk — and then joined `projects` onto the root
  directly, unguarded, three lines earlier.
- `cortexignore.js` read `join(root, ".cortexignore")` with a bare `readFileSync`.
- `recall.js` seeded a recursive walk with `walk(root, "")` and joined onto a local `dir` on every
  entry. It never wrote `join(root, …)` at all, so it would survive any check looking for that.
- `capture.js` did use the guard, then wrote through `appendFileSync` itself.

The traversal patch that landed standalone was correct and insufficient: **a lock on one door in a
building with three.** Path safety was a thing five modules had to remember, and the way you find
out one of them forgot is a disclosure bug.

## Decision

One module — `mcp/lib/vault.js` — owns every filesystem operation on a vault root. It exposes
`abs` · `exists` · `isFile` · `isDirectory` · `mtimeMs` · `entries` · `list` · `read` · `append` ·
`write`. Every operation takes a **root-relative** path and resolves it through `resolveInRoot`.

**No other module under `mcp/` may join a path onto a vault root**, enforced by
`mcp/test/vault-is-the-only-door.test.js` rather than by convention. The guard stops being a
function callers remember to call and becomes the only way in.

The test states the rule at two altitudes, because one is not enough. A syntactic scan for
`join(root, …)` catches `cortexignore` and `projects` but is blind to `recall`, which reaches the
same place through a variable in a closure. So the four converted modules are additionally asserted
to import no `node:fs` at all. Teaching the regex to chase a variable through a closure would have
made the check clever and unreadable; stating the rule twice, plainly, is cheaper.

### What deliberately stays out

**Scrubbing.** Secret refusal lives in `core/scrub.js` with the callers that apply it. Folding it
into the Vault would make every write pay for it and would hide a policy refusal behind a path
operation — two different kinds of "no" wearing one face.

**Naming** (`slug.js`) and **remote sync** (`gitsync.js`). Genuinely different concerns; `gitsync` is
the team mode's dependency, not the vault's.

**The allowlist** is three files, each with a reason, and the test asserts its own size so growth is
a decision rather than a drift. `version.js` and `setup-plugins.js` join onto the **Cortex install
directory** — a different root the vault guard has no authority over, where refusing would be a
category error. `gitsync.teamCloneDir` joins `slugify(team)` onto the root, and `slugify` reduces any
run of non-alphanumerics — `..` included — to a dash or the empty string, so a traversal cannot
survive it. That was verified against `slug.js`, not assumed.

Also checked and left alone: `catchup.js` and `team.js` join onto the team clone directory (git
plumbing, not vault content), and `digest.js` writes to an `--out` path the user named on the CLI.

## Alternatives rejected

**Guards at each call site.** This is the state that produced the bug. It was never a decision, just
what happened, and it fails the same way every time: the guard is correct and someone does not call
it. Five places to remember is five places to forget.

**A lint rule.** Nothing in this repo runs a linter, and ADR 0004 keeps it dependency-free. A test
is the enforcement mechanism this codebase already has — `core/test/architecture.test.js` guards the
layering the same way, and for the same reason: it was already broken once.

**Put the Vault in `core/`.** Superficially tidy, since `core/paths.js` is already there. Rejected:
`core/` is the kernel **both** leaves share, and `index/` has no use for vault semantics at all — it
asks git what belongs to a repo (ADR 0003) and deliberately does not read `.cortexignore`, because
those answer different questions. Moving vault logic into `core/` would grow the kernel with
concepts one of its two consumers never touches, which is the mistake the layering was introduced to
fix. `core/paths.js` stays the primitive; the Vault is the door built around it.

**Have `list` return absolute paths**, matching what `recall` and `listProjects` returned before.
Rejected: root-relative is the safer internal currency, and it makes the conversion back to absolute
an explicit, greppable step instead of an accident of how a path was built. The two callers convert
via `abs()` at their boundary, so observable output is unchanged — pinned by characterization tests
written before any code moved.

## Consequences

`getProjectContext`'s traversal fix is now structural rather than remembered. Its three regression
tests still pass untouched, which is how we know the collapse did not quietly undo the thing it was
built to generalise.

`cortexignore.js` is pure — it decides what patterns **mean** and never fetches text. Its test file
imports no `node:fs`; a test that needed a temp directory to check a regex was a signal.

`vault.js` is the only importer of `core/paths.js` inside `mcp/`. If a second one appears, either the
Vault is missing an operation or someone has cut a new door.

The Vault interface is also the seam the three-mode resolver (solo / team / server) will sit behind.
That is the next piece of work, and it is only meaningful because this one exists.
