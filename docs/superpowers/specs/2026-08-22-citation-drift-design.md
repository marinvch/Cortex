# Citation drift — proving a context document has gone stale

**Status:** approved design, not yet implemented
**Date:** 2026-08-22
**Surface:** `index/lib/review.mjs`, `index/cortex-review.mjs`, `skills/cortex-review/SKILL.md`

## The problem

`/cortex-review` already names **Drift** as one of its two axes: *did this change make one of these
documents wrong?* It is change-triggered — it takes a diff and asks what that diff broke.

Nothing answers the other question: **is the context layer wrong right now?** That is the state of
every repo that installed Cortex and then shipped for six months without anyone running a review.
Documents do not rot from one change; they rot from a hundred, each of which individually looked
fine.

### The blind spot is structural, not a matter of coverage

`reviewContext()` flags a document only when the document **names a file the diff touched**
(`index/lib/review.mjs`, the `stale` pass). That rule cannot catch the failure the module's own
header comment cites as motivation:

> `AGENTS.md` pointed at `mcp/lib/scrub.js` for months after scrub moved to `core/`

Once `mcp/lib/scrub.js` stops existing, no diff can touch it, so the document naming it is never
seeded and never flagged. The tool is blind to precisely the example it was built for.

A citation that no longer resolves is provable staleness. It needs no diff and no model.

## Evidence: what a naive check actually returns

Probed against this repository on 2026-08-22, extracting backticked path-shaped tokens from every
context document and testing them against the index:

| Check | Hits |
|---|---|
| Naive — resolve every citation against the repo root | 27 |
| Resolve doc-relative first, then root | **7** |

The single rule that removes 20 of 27: **a citation resolves relative to its own document first.**
`mcp/AGENTS.md` saying `` `lib/resolve.js` `` means `mcp/lib/resolve.js`, which exists. This is the
same lesson as the existing `distinctive()` basename rule — naive matching floods, and the flood is
what makes a checker get switched off.

Of the surviving 7, roughly two are real. The false positives are systematic, and each is a design
requirement rather than noise to tune away:

| Class | Example found | Consequence for the design |
|---|---|---|
| **ADRs are historical records** | `docs/adr/0011` cites `skills/cortex-doctor/SKILL.md`, a retired skill | An ADR *should* name dead things. Never gate on one. |
| **Prose examples** | `index/AGENTS.md` cites `bin/cli.js` illustrating an npm convention | A path can illustrate rather than point. Not mechanically separable. |
| **Deliberate absence** | `docs/adr/0004`: "…and `mcp/package-lock.json` is deleted" | The prose is correct *because* the path is gone. |
| **Gitignored by design** | root `AGENTS.md` cites `decisions/log.md` | Absent from the index without being wrong. |

**Therefore the deterministic pass cannot ship as a gate on its own.** Run as a CI check today it
would fail pull requests over ADRs describing history. It ships as a *ranked candidate list* — the
shape this repository has already chosen twice: `review.mjs` "finds and cites; it never judges", and
`cortex-findings` produces evidence that a ritual weighs.

## Decision: extend `/cortex-review`, do not add a ritual

[ADR 0011](../../adr/0011-four-rituals-covered-two-jobs.md) records this repository consolidating
four rituals that covered two jobs. Citation drift is the second axis of a ritual that already
exists, asked without a diff. A new `/cortex-drift` would duplicate `isContextDoc`,
`governingBriefs` and the whole vocabulary, and add a row to a table that already carries thirty.

Rejected alternatives:

- **New `/cortex-drift` ritual + `cortex-drift.mjs`.** More discoverable to a new user; duplicates
  the core and repeats the mistake ADR 0011 was written about.
- **CI gate only, no ritual surface.** Least code, but it does nothing for the person installing
  Cortex into a six-month-old repo — the case that motivated the work.

## Design

### Core — `citationDrift(index, { readText })`

A new export in `index/lib/review.mjs`, beside `reviewContext`. Deterministic: no model, no diff,
no clock. A pure function of the index and a reader, testable from literals like the rest of
`index/lib/`.

For each context document (`isContextDoc`, minus `templates/**`, whose paths are fictional by
design), extract candidate citations and try to resolve each one.

**Extraction** — two forms, both already conventional in Cortex's own output:
- backticked tokens shaped like a path: contain `/`, end in a short extension
- markdown link targets that are not URLs: `[text](docs/adr/0015-….md)`

**Resolution**, in order: relative to the document's own directory, then relative to the repo root.
A hit against either the file set or any directory prefix in the index resolves. `.cortex/**` is
excluded — it is generated and gitignored by construction.

### Confidence classes

Every unresolved citation carries a class. The report never says "wrong"; it says how much is
proven.

| Class | Condition | Gate | `--fix` |
|---|---|---|---|
| `provable` | Unresolved, document is a brief or `CONTEXT.md` (not an ADR), and git rename detection finds where the file went | fails | rewrites |
| `suspected` | Unresolved, nothing proves a destination | reports | never |
| `historical` | Citation lives in `docs/adr/**`, or the line carries an absence marker (`deleted`, `removed`, `retired`, `no longer`) | reports, flagged | never |

`provable` is the `scrub.js` case and the only class that is auto-fixable — because **git proves
where the file went**, not because a model inferred it. The absence-marker list is a heuristic and
is tested as one; it only ever *downgrades*, and a downgraded finding still appears in the report.

Git history is append-only, so rename lookup stays deterministic and the `index/AGENTS.md`
determinism invariant holds.

### Two entry points, one core

```bash
node index/cortex-review.mjs --citations              # the whole context layer, no diff
node index/cortex-review.mjs --citations --since <ref> # only what this range broke
```

The first is the six-months-at-once pass, and the first thing a new install should run. The second
is the **CI gate**, narrow by construction: it exits non-zero only on `provable`, because that is
the only class carrying proof. `--json` for both, matching the existing flags.

### `--fix`

Rewrites `provable` citations only, using the destination git recorded. It never edits prose, never
touches an ADR, and never commits — the output is a working-tree diff a human accepts. This is what
"self-heal" reduces to once you refuse to guess: a small, provable subset, applied visibly.

### Testing

- `citationDrift` from literals: doc-relative resolution, root resolution, directory citations,
  markdown links, `.cortex/` exclusion.
- One regression per false-positive class above, taken verbatim from the probe — these are real
  findings from this repository, not invented fixtures.
- The `scrub.js` shape end to end: a git fixture where a cited file is renamed, asserting the class
  is `provable` and that `--fix` produces the right path.
- CLI: `--citations` exit codes — zero with only `historical`/`suspected`, non-zero on `provable`.

Per [`docs/changing-cortex.md`](../../changing-cortex.md): the ritual keeps `capability: judgment`;
the CLI half is mechanical and runs in CI without a model. Version stamped with
`node tools/cortex-version.mjs --set`, never by hand.

## Non-goals

**Claim drift is out of scope.** `index/AGENTS.md` saying "Coverage uses two signals" while the code
used three is not detectable from a citation — the path was correct, the sentence was not. Catching
it needs a model reading prose against code. The ritual may take that on as a second phase over this
candidate list; the CLI must not, because a deterministic tool that claims to find *all* drift is
worse than one that states where it stops.

**No autonomous commits.** Considered and rejected: an unattended doc-rewriter is the exact
mechanism by which a context layer becomes confidently wrong, which is the failure Cortex exists to
prevent.
