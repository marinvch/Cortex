# Domain glossary

The words Cortex uses about itself. Several of these are ordinary English elsewhere and mean
something narrow here — that narrowness is the point.

## Index

The **deterministic** structural map of a repository: files, languages, resolved imports, layers,
test flags, git hot spots. Built by `index/` with no LLM and no network, so the same tree always
produces the same output. Lives at `.cortex/index/index.json` and is the source of truth for
structure.

_Avoid_: "graph" (suggests the semantic knowledge graph that `/understand` builds, which this is
not), "scan" (that is the act, not the artifact).

## Enrichment

The **optional** prose layer on top of the index — summaries, roles, tags — produced by a model.
Lives beside the index at `enriched.json` and is strictly additive: it never edits `index.json`,
and its absence degrades Cortex to deterministic behaviour rather than breaking it.

_Avoid_: "analysis" (too broad — indexing is analysis too).

## Findings

The single ranked markdown report at `.cortex/findings/<date>.md`. **Proposals only.** The module
that produces findings has no authority to modify a repository.

_Avoid_: "issues" (implies a tracker), "problems" (some findings are opportunities), "audit"
(that is `/cortex-audit`, a different vault ritual).

## Memory

`<repo>/.cortex/memory/` — **committed**, append-only, one file per day. What a team and its agents
know about the codebase, travelling with the code, synced by git and nothing else.

_Avoid_: "the vault" (that is the personal second brain, now a separate repo), "cache" (memory is
authored, not derived, and is never regenerated).

## The gate

`core/scrub.js`. The single point at which anything entering memory is checked for credentials.
It **refuses** rather than sanitises, because silently rewriting someone's note is a worse failure
than declining it with a reason.

_Avoid_: "filter", "sanitiser" — both imply the content is modified and let through.

## Brief

A scoped `AGENTS.md` inside a directory, holding what the root cannot: that area's invariants and
gotchas. Reached through the routing table, read only when work happens there.

_Avoid_: "docs" (a brief is instructions to an agent, not documentation for a human), "context
file" (ambiguous — `CONTEXT.md` is a different thing).

## Routing table

The table in the root `AGENTS.md` mapping *where you are working* to *which brief to read*. It is
prose an agent follows — there is no resolver, no hook, no engine.

## Ritual

A `skills/<name>/SKILL.md`. The markdown **is** the implementation; there is no engine executing
it. Exposed as a `/slash` command, and equally usable by naming it to any AI tool.

_Avoid_: "script" (rituals are prose; `tools/*.sh` are scripts), "command" (that is how it is
invoked, not what it is).

## Repo mode / vault mode

Which world the MCP server is serving, decided by the root it is given. A `.cortex/` directory
means **repo mode** (`recall`, `remember`, `recall_memory`); anything else means **vault mode**
(the personal-brain tools). Detected, never configured.

## Layer

Two unrelated meanings — keep them apart:
1. **Index layer** — a group of files sharing a top-level directory, inferred from structure.
2. **Code layer** — `core/` ← `index/` + `mcp/`, the dependency rule enforced by
   `core/test/architecture.test.js`.

Say "index layer" or "code layer" when it is not obvious which.

---

## Notes

- Terms only. Decisions go in `docs/adr/`.
- When the code and this file disagree, one of them is a bug. Say which.
