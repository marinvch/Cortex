# Cortex as a context manager — design

**Date:** 2026-08-15
**Status:** approved (design); no implementation started
**Supersedes:** `2026-08-12-cortex-framework-design.md` Decision 1 (one monorepo, two packages)
and Decision 4's *destination*; `2026-08-15-three-mode-seam-design.md` Decisions 1 and 4.
The seam, the read-only-findings principle and the defect sequence from those specs stand.

## What Cortex is now

**A context manager for new and legacy codebases.** Not a second brain that also stamps repos —
the codebase is the subject, and the personal vault leaves the repo entirely.

The job: take a codebase Cortex knows nothing about, build real knowledge of it, surface issues,
gaps and recommendations, and give the developer a context layer that stays true as the code and
the team move. Every conclusion is a proposal. **The user decides; Cortex never does.**

## Decisions

| # | Decision | Rejected alternatives |
|---|---|---|
| 1 | **Two repositories.** `marinvch/Cortex` is the codebase plugin — public, installable. The personal vault moves to a new private repo. | one monorepo with two packages (2026-08-12 D1); drop the vault; keep fused |
| 2 | **Ship as a Claude plugin marketplace.** `/plugin marketplace add marinvch/Cortex` then `/plugin install cortex`, at user, project or global scope. | bash-installer-first; plugin as a later wrapper |
| 3 | **The bundle declares, it does not vendor.** One install pulls the whole developer experience: superpowers, Context7, Cortex's own MCP as core; Playwright/Chrome DevTools and Postman opt-in. | vendoring others' code (license and drift); make users install one by one |
| 4 | **Vendor our own semantic graph builder**, full LLM-driven — summaries, tags, layers. | deterministic index only; deterministic + one synthesis pass; depend on understand-anything |
| 5 | **Findings are read-only artifacts.** Analysis skills may write a report and nothing else. A separate, explicitly user-invoked apply step acts on chosen items. | propose-diff-and-wait; hook-enforced block |
| 6 | **Memory lives in `.cortex/memory/`, committed.** One context per repo, shared by every developer and every agent, travelling with the code. | team-brain remote repo; local-only per developer |
| 7 | **Many small `AGENTS.md`, not one large one.** Cortex proposes where scoped briefs belong from the index; the user confirms. | user declares only; automatic by threshold |
| 8 | **Root routing table + on-demand leaves.** Root stays small and routes; leaves are read only when work happens there. | hook-injected by path; index-driven lookup |

Decision 4 is the expensive one and was taken with that understood — see *Risks*.

Decision 6 changes the privacy rule from a preference into a **hard requirement**: memory is
committed, so it must never contain secrets, credentials, or personal content. See *The firewall,
inverted*.

## Architecture

```
marinvch/Cortex/                      the installable plugin (public)
  .claude-plugin/
    marketplace.json                  declares cortex + the bundled plugins
    plugin.json                       cortex itself
  skills/                             the rituals, as today
  index/                              the vendored semantic graph builder
  mcp/                                recall/capture, repointed at .cortex/memory
  templates/                          AGENTS.md, CONTEXT.md, ADR, connector
  tools/                              bash fallback for no-Claude installs

<target repo>/                        what Cortex writes
  AGENTS.md                           small: identity, invariants, ROUTING TABLE
  CLAUDE.md · GEMINI.md               one-line shims
  CONTEXT.md                          domain glossary
  docs/adr/                           decisions, created lazily
  <area>/AGENTS.md                    scoped leaves, only where earned
  .cortex/
    index/                            the semantic graph (generated)
    findings/                         dated reports (read-only artifacts)
    memory/                           committed; digests, decisions, drift notes
    connector.json                    optional pointer to a team brain
```

### The install flow

Install into an **empty or greenfield** repo: scaffold the structure, no analysis to do.

Install into a repo that **already has code** — the sequence, in order:

1. **Index.** The graph builder runs. Writes only to `.cortex/index/`.
2. **Report.** One ranked findings document — issues, gaps, recommendations — into
   `.cortex/findings/<date>.md`. Nothing else is written. No source file is touched.
3. **User picks.** The developer reads the report and chooses what to act on.
4. **Apply.** Only now does Cortex scaffold, propose scoped briefs, or change anything.

Steps 1–2 have no authority to modify the repository. That is structural, not a promise: the
skills that find things and the skills that change things are different skills, and only the
second kind is invoked by the user directly.

### Nested briefs and routing

The index already knows layers, hot spots, test coverage and invariant-bearing areas. Cortex uses
that to **propose** a ranked list of directories that deserve their own `AGENTS.md`, each with a
stated reason. The user confirms or declines each one.

Root `AGENTS.md` carries a routing table:

| Working in | Read |
|---|---|
| `billing/` | `billing/AGENTS.md` |
| `auth/` | `auth/AGENTS.md` |

An agent reads the root, then exactly one leaf. Nothing else loads. No hook, no engine — the
routing table is prose an agent follows, which is how `/scope-area` already works.

### Memory and dreaming

`.cortex/memory/` is committed, so context is shared rather than per-developer. Two writers:

- **Dreaming** — an end-of-day consolidation pass. Reads the session's work, writes a dated digest:
  what changed, what was decided, what drifted. Append-only, one file per day, so concurrent
  developers do not collide.
- **Capture** — explicit, in-the-moment notes from `recall`/`capture` via Cortex's MCP.

Multiple developers each run their own agents against the same committed memory. That is the
symbiosis: the context manager is the shared surface, and git is the sync mechanism — no server,
no second repo, no custom protocol.

### The firewall, inverted

In the vault, the rule was "personal content stays gitignored." Here it inverts: **memory is
committed, so nothing personal or secret may enter it.** This is now a correctness requirement
with teeth:

- Dreaming and capture must refuse credentials, tokens, personal notes and employer-sensitive
  detail — refuse the write and say where it belongs, never "sanitize and file anyway."
- A scrubber gate runs before any memory write. This is the one place the rule is enforced, the
  same way the seam is the one place the old firewall was enforced.
- `/cortex-doctor` treats a leak in `.cortex/memory/` as a critical finding.

## Risks, recorded

**The vendored semantic graph is the schedule.** Reproducing a full LLM-driven graph means a
multi-phase pipeline: scan, batch, parallel analysis, merge and normalize, layer assignment, tour,
validation. Building it well is the bulk of this project, and every run costs tokens. Mitigation:
build the deterministic layer first — parse, imports, inventory — so there is a working index
before any LLM phase exists, then add enrichment on top. The deterministic half is also what makes
the graph re-runnable in CI.

**Committed memory is a leak surface.** Mitigated by the scrubber gate above, but the residual
risk is real and is the price of shared context.

**Committed memory conflicts.** Mitigated by append-only dated files; no shared mutable document.

**Bundle drift.** Declaring third-party plugins means their releases can move under us. Pin
versions in the marketplace manifest where the source supports it; treat a bundled plugin's
absence as degraded, never broken.

## Sequence

| # | Work | Gate |
|---|---|---|
| 1 | `.claude-plugin/marketplace.json` + `plugin.json`; `/plugin install cortex` works at all three scopes | installable end-to-end |
| 2 | Extract the personal vault to its private repo; strip it from this one | this repo is data-free |
| 3 | Bundle declaration — superpowers, Context7, Cortex MCP core; Playwright/DevTools/Postman opt-in | one install, whole experience |
| 4 | Deterministic index: parse, imports, inventory, layers by structure | runs offline, re-runnable in CI |
| 5 | Findings report generator, read-only by construction | writes only to `.cortex/findings/` |
| 6 | Install wizard: index → report → user picks → apply | nothing written before step 4 of the flow |
| 7 | Scaffolder: AGENTS.md + shims, CONTEXT.md, docs/adr/, dev-cycle skills | greenfield and legacy both land |
| 8 | Scoped-brief proposer + routing table generator | proposes, never imposes |
| 9 | `.cortex/memory/` + scrubber gate + MCP repointed | no secret can reach a commit |
| 10 | Dreaming: end-of-day digest, append-only | concurrent devs do not collide |
| 11 | LLM enrichment pass over the deterministic index | the full semantic graph |

Steps 1–3 are distribution and can ship before any analysis exists. Step 4 is the first thing
that makes Cortex useful on a legacy repo. Step 11 is the expensive one and deliberately last —
everything before it works without it.

## Out of scope

Rewriting the retired engine. A hosted service. Any UI beyond the generated report and
`cortex.html`. Cross-repo knowledge federation — the optional `connector.json` reserves the seam,
nothing more.

## Attribution

Ported rituals derive from `github.com/mattpocock/skills` (MIT); attribution stays in each ported
file's header. Bundled plugins are declared, never copied.
