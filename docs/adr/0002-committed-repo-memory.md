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
