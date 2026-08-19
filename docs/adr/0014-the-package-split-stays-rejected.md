# ADR 0014 — the package split stays rejected

**Status:** accepted · 2026-08-19 · Cortex 2.10.0

## Context

The 2026-08-12 design's "Decision 1" was to split Cortex into separate packages. It has been
proposed again since, and the 2026-08-19 architecture review surfaced it a third time. This ADR
records the rejection so the next review does not spend its budget re-deriving it.

## The test a split has to pass

[ADR 0001](0001-two-repos-not-two-packages.md) already set it, when it chose two *repositories* over
one monorepo with two packages:

> the split is a directory boundary, not a distribution one

A package boundary earns its place by changing **what a user downloads**. Cortex's boundaries —
`core/` ← `index/` + `mcp/` — are real and enforced by `core/test/architecture.test.js`, but they
are boundaries of *dependency*, not of *distribution*.

## Why it cannot pass it here

[ADR 0004](0004-no-runtime-dependencies.md) settles it: **a plugin install clones the repository.**
It does not run `npm install`, does not honour a lockfile, does not build. Whatever is in the tree is
what runs.

So three `package.json` files would produce three manifests that no installer ever resolves. Nobody
downloads `@cortex/core` — they clone the repo and get `core/` because it is a directory in it. That
is the failure that killed v2.1.0, when a declared dependency was resolved on the development
machine and on nothing else.

## The empirical argument

`core/package.json` already exists, and it is the manifest for the package that would be split out
first. It sat at **2.2.0 while the product shipped 2.9.1** — six releases of silent rot, because
nothing consumed it and nothing checked it.

A manifest nobody resolves is a manifest nobody notices is wrong. That is not a prediction about
what a package split would cost; it is a measurement of what the one existing package boundary
already costs, taken before it was fixed.

## Decision

**Do not split Cortex into published packages.** The directory boundary plus
`core/test/architecture.test.js` already deliver everything the split was meant to deliver — an
enforced dependency rule — at none of the distribution cost.

Revisit only if the distribution model itself changes: if Cortex is ever installed by a package
manager rather than by cloning, the test in ADR 0001 could be passed, and this ADR should be
reopened rather than worked around.

## Consequences

- `core/package.json` and `mcp/package.json` stay, because `node --test` and the scripts in them are
  useful. They are *manifests*, not *products*, and [ADR 0013](0013-the-version-has-one-home.md) now
  keeps their versions honest so the rot that made this argument cannot recur silently.
- A future review that reaches "we should split the packages" should read this file and stop.
