# `/optimize-context` — design

**Date:** 2026-08-04
**Status:** approved, not yet implemented
**Branch:** `docs/context-engineering-followups`

## Problem

Cortex writes agent context into repos (`/install-project`) and structures it well
(`/scope-area`'s nested leaves are progressive disclosure by another name). But nothing *audits*
that context once it exists, and nothing helps a repo Cortex never touched.

Agent context files rot in a specific, measurable way: they accumulate content the agent could read
from the code itself, they drift out of sync with the shims that point at them, and they inline bulk
that only matters occasionally. Every byte is re-read every session, so the cost is recurring while
the value decays.

The trigger is [the Claude 5 context-engineering rules][article]: newer models handle ambiguity
well, so exhaustive rules cost tokens without buying behavior. The same pass applied to this vault
cut `AGENTS.md` by 29% and `skills/install-project/SKILL.md` by 57% with no loss of capability.

[article]: https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models

## What it is

A ritual run **inside a target repo** — Cortex-installed or not — that measures the repo's agent
context, ranks what costs context without earning it, applies only mechanically-safe fixes, and
proposes every prose deletion with the lines quoted.

It is a **diagnostic-first** ritual, in the family of `/audit` and `/cortex-doctor`, but pointed at
other repos rather than the vault.

### Scope of files read

Root and nested `AGENTS.md` · `CLAUDE.md` · `GEMINI.md` · `.github/copilot-instructions.md` ·
`.github/instructions/*.md` · `.cursor/rules/*.mdc` · `.claude/skills/*/SKILL.md`

## How it works — four passes, cheapest first

### Pass 1 — Measure

Per file: bytes, a rough token estimate (bytes ÷ 4 is sufficient for *ranking*), and whether it
loads **every session** (root `AGENTS.md`, `CLAUDE.md`, shims) or **on demand** (nested leaves,
skill bodies). Always-loaded bytes are the number that matters; the report leads with it.

This baseline is what every later finding is measured against.

### Pass 2 — Find waste

Three categories, kept distinct because each has a different fix:

| Category | Signal | Fix |
|---|---|---|
| **Discoverable from code** | file trees, dependency lists, script names, framework version — all readable from `package.json` and the directory listing | cut, *except* lines carrying a fact the code doesn't state (see below) |
| **Duplicated across files** | a shim holding its own copy instead of a pointer; the same convention stated in root and a leaf | keep one canonical copy, point the rest at it |
| **Inlined bulk** | file templates, long worked examples, reference tables inside a body that loads every time | move to `templates/`, reference by the step that needs it |

**The discoverability test is per-line, not per-section.** A directory listing is waste; the one
line inside it saying `src/legacy/ — do not touch, scheduled for deletion Q3` is the most valuable
line in the file. The skill must quote what it keeps as well as what it cuts.

### Pass 3 — Find missing structure

The only pass that *adds*. Look for directories that are high-churn, security/data sensitive, or
hold invariants an agent could break, and that have **no** scoped `AGENTS.md` leaf. Nominate them
for `/scope-area`.

Do not over-nominate: a directory with no invariant and no gotcha does not earn a leaf. Report a
shortlist with the invariant that justifies each one, and let the user pick.

### Pass 4 — Report and apply

Ranked findings, each tagged:

- **`[safe]`** — content-preserving. Extract an inlined template to a file; replace a drifted shim
  with a pointer. Applied automatically.
- **`[handoff]`** — an approved leaf nomination. This ritual does **not** write scoped leaves
  itself; it invokes `/scope-area <dir>`, which owns that job and already does it well. Duplicating
  that logic here would be the same drift this ritual exists to find.
- **`[propose]`** — reduces total information. Quoted, reasoned, and **waits for a human yes.**

Report ends with measured before → projected after on always-loaded bytes.

## The safety rule (hard rule, stated as such in the skill)

**Never delete prose without a human yes.**

The ritual cannot mechanically distinguish *redundant* from *deliberately repeated because it is
load-bearing*. This is not hypothetical: in this vault, the employer-firewall enforcement repeated
across `/capture`, `/audit`, and `/onboard` scores as textbook duplication by every mechanical
measure, and deleting it would silently remove a safety control.

The skill states this failure mode explicitly, with that example, so the agent running it treats
repetition as a question rather than a finding.

Automatic changes are limited to moves that preserve total information. Anything that reduces it is
proposed.

## Files this adds

| Path | Purpose |
|---|---|
| `skills/optimize-context/SKILL.md` | the ritual |
| `references/context-engineering.md` | the article's rules as a Cortex framework; wikilinked from [[vault-architecture]] |
| `AGENTS.md`, `README.md` | one table row each |
| `.claude/skills/optimize-context/` | mirror, via `cp -r` |

`references/context-engineering.md` is the single source of truth for the rules. `/skill-creator`
and `/install-project` cite it rather than restating it — otherwise the vault reintroduces exactly
the duplication this ritual exists to find.

## Decisions made explicitly

**No new script in `tools/`.** Measurement is `wc -c` and grep. A vault script would not exist in a
target repo, breaking the self-contained promise `/install-project` makes. The determinism argument
from [[operating-principles]] is real but does not outweigh portability here — and the measurements
are simple enough that prose instructions produce consistent results.

**It does not touch the vault.** `/cortex-doctor` owns vault structure. This ritual targets other
repos and says so in its first line, so the two never contend.

**Estimates, not exact token counts.** Findings are *ranked*, and bytes ÷ 4 ranks identically to a
real tokenizer. A tokenizer dependency would violate the plain-files constraint.

## Out of scope

- No auto-rewriting of another tool's rule files beyond pointing them at `AGENTS.md`
- No configuration file
- No CI integration
- Not a linter — it runs on request, not on every commit

## Success criteria

1. Running it in a repo with a bloated `AGENTS.md` produces a ranked report with a measured
   before → projected-after on always-loaded bytes.
2. It never deletes prose without an explicit yes.
3. It correctly *keeps* a non-discoverable line inside an otherwise-discoverable section, and shows
   that it did.
4. It runs in a repo with no Cortex brain at all and still produces useful findings.
5. It nominates a leaf only where a real invariant justifies it.

## Related

[[vault-architecture]] · [[nested-briefs]] · [[operating-principles]] · `/scope-area` ·
`/install-project` · `/cortex-doctor`
