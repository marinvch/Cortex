---
name: scope-area
description: Give a critical part of a repo its own deep, scoped AGENTS.md "brief" so an AI agent loads narrow, high-signal context for that area instead of the whole monolith — faster, cheaper, less drift. Use when a directory/subsystem is critical, high-churn, or has invariants an agent could violate (auth, billing, webhooks, data layer, a pipeline). Triggers — "give this part its own brain", "scope a brief for X", "this area is critical", "split AGENTS.md".
---

# /scope-area — a deep brief for one critical part

Cortex keeps **one root `AGENTS.md`** as the spine (stack, conventions, dev cycle). For the few
parts that are critical or have invariants, add a **scoped `AGENTS.md` leaf inside that directory.**
Agents that support nested context (Claude Code, Codex) auto-load the nearest leaf by proximity; a
**routing table** in root makes it work for every tool. Result: an agent fixing a webhook bug loads
root + the webhook leaf, not a 500-line monolith — fewer tokens, narrower focus, less drift.

## The rule: split only where it earns its keep
Create a leaf ONLY if the area is critical, high-churn, or holds an invariant an agent could break
(e.g. "webhook needs the raw body", "don't mix embedding models"). Most directories need no leaf.
If it has no gotcha or invariant, don't split it. (Boring is beautiful — lowest structure that works.)

## Step 1 — Pick the area
Confirm the directory (e.g. `src/app/api/webhooks/`). Read the root `AGENTS.md` so the leaf adds
depth without duplicating the spine. Skim the actual code in that dir — the leaf must be true.

## Step 2 — Write the leaf `AGENTS.md` inside that directory
`<area-dir>/AGENTS.md`:
```markdown
# <Area> — scoped brief
> Scoped brief. Read the root `/AGENTS.md` first for stack + conventions; this adds depth for
> `<area>`. Durable cross-project notes live in the Cortex vault.

## What this area does
<the one job of this subsystem>

## Key files & flow
- `<file>` — <role>   (trace the real data/control flow through the dir)

## Invariants (DO NOT break)
- <the rules an agent must never violate here, with the reason>

## Gotchas
- <quirks, failure modes, foot-guns specific to this area>

## Change checklist
- <what to verify before/after editing here: tests, lint, manual checks>
```
Keep it small and high-signal. Deep, not wide.

## Step 3 — Register it in the root routing table
Add (or create) a `## Area map` section in the root `AGENTS.md`:
```markdown
## Area map (load the scoped brief for the part you're touching)
- Auth → `src/app/api/auth/AGENTS.md`
- Billing / webhooks → `src/app/api/webhooks/AGENTS.md`
- RAG pipeline → `src/lib/AGENTS.md`
```
This is the index of record and the fallback for agents that don't auto-load nested files.

## Step 4 — Move, don't duplicate
If a fact now lives in a leaf, REMOVE it from root (leave a pointer via the routing table). Root
holds the global; leaves hold the local. No fact in two places — that's how drift starts.

## Rules
- Same filename everywhere (`AGENTS.md`), nested. Never reintroduce per-topic file sprawl
  (architecture.md / conventions.md / …) — that was the old engine; Cortex killed it.
- Every leaf links UP to root and never restates it.
- Update a leaf in the SAME PR as the code it covers — that's what keeps it from drifting.
- One repo's leaves never reference another repo. Cross-project knowledge belongs in the vault.
