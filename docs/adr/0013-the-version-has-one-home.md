# ADR 0013 — the version has one home

**Status:** accepted · 2026-08-19 · Cortex 2.10.0

## Context

A Cortex release wrote the version by hand into seven files and verified it in four:

| Site | Verified before this ADR |
|---|---|
| `VERSION` | yes — the source |
| `.claude-plugin/plugin.json` | yes |
| `.claude-plugin/marketplace.json` | yes |
| `mcp/package.json` | yes |
| `README.md` | yes |
| `CHANGELOG.md` link reference | **no** |
| `core/package.json` | **no** |

Releasing was therefore a memory exercise with a test that fired *after* the mistake, and two sites
where it never fired at all. Both unverified sites had failed:

- `core/package.json` read `2.2.0` while `mcp/package.json` read `2.9.1` — **six releases behind**,
  drifting in silence because nothing compared it to anything. This is the exact failure
  `mcp/test/version.test.js` was written to prevent, occurring in a site it does not cover.
- The changelog link reference is the one that gets missed by hand. A missing one breaks no build
  and fails no test; it renders `[2.9.0]` as literal text and nobody notices for months.

## Decision

`tools/cortex-version.mjs` owns propagation. `VERSION` is its interface; the other sites become
implementation.

```
node tools/cortex-version.mjs             # check — exit 1 on drift, writes nothing
node tools/cortex-version.mjs --set 2.10.0  # propagate to every site
node tools/cortex-version.mjs --list      # what is a site, and what it holds now
```

Adding a site means adding one entry to `SITES`. **The check and the writer read that same list** —
which is what stops them drifting apart the way the sites themselves did. A checker with its own
private idea of where versions live is how you get four verified sites out of seven.

`core/package.json` is in the list, so it stops rotting.

## The changelog entry is checked, never generated

Seven sites are written. The eighth — the `## [x.y.z]` release entry — is **checked and refused**,
never generated. A release entry says what changed and why, which no string substitution knows, and
a generator that invented one would be worse than a missing line. `--set` exits non-zero and names
the missing heading.

The link *reference* is a different thing: fully derivable from the version, so it is generated. The
cut is between what follows from the version and what a human has to think about.

## Why `tools/` and not `core/`

This runs at release time and never at runtime. [ADR 0004](0004-no-runtime-dependencies.md) says a
plugin install clones the repo and runs no build step, so a release tool must not sit in the path of
anything a user executes. `core/test/architecture.test.js` does not walk `tools/`, so the layering
rule is untouched.

## Consequences

- `tools/test/version-sites.test.sh` fails a build whose sites disagree — the guard behind the
  generator, not instead of it. `mcp/test/version.test.js` keeps its separate job: proving the
  *runtime* version reader works.
- The writer is exercised against a scratch repo, not only read. `CORTEX_VERSION_ROOT` exists for
  that: a writer that has only ever been checked is the shape of bug this module removes.
- Version bumps stop appearing in the top churn cluster, because they stop being seven edits.
- The site matcher takes the **first** `"version"` key in a manifest, so a nested dependency version
  is left alone. Pinned by a test, because clobbering one would corrupt a manifest while looking
  like a successful release.
