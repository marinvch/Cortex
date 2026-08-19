---
type: reference
title: Nested briefs — scoped AGENTS.md for critical parts
updated: 2026-06-30
tags: [reference, framework, agents]
---

# Nested briefs — one spine, deep leaves

A repo's brain is **one root `AGENTS.md`** plus, for the few critical parts, a **scoped `AGENTS.md`
leaf inside that directory.** Same filename, nested — never a sprawl of per-topic files
(`architecture.md`, `conventions.md`, …); that was the old engine, and Cortex retired it.

## Why
- **Speed + cost.** An agent fixing a webhook bug loads root (small) + the webhook leaf (focused),
  not a 500-line monolith. Less context = fewer tokens, faster, cheaper.
- **Less drift.** Narrow scope physically keeps the model on the part it's editing.
- **Obvious home for new facts.** A gotcha about RAG goes in the RAG leaf, not a growing root pile.

## How agents find leaves
- **Auto (Claude Code, Codex):** the nearest `AGENTS.md` up the tree is loaded by proximity.
- **Everywhere (fallback):** the root keeps a `## Area map` routing table — "Auth → `…/auth/AGENTS.md`".
  Tools without nested-loading still get pointed to the right brief.

## The rule: split only where it earns its keep
Create a leaf only for areas that are **critical, high-churn, or hold an invariant an agent could
break** (auth, billing/webhooks, data layer, a pipeline). Most directories need none. If it has no
gotcha or invariant, don't split it.

## Discipline
- Root = global (stack, conventions, dev cycle, the Area map). Leaf = local (flow, invariants,
  gotchas, change checklist). **No fact in two places** — move it, don't copy it.
- Every leaf links UP to root and never restates it.
- Update a leaf in the **same PR** as the code it documents — that's what stops it drifting.
- Add one with `/cortex-brief <dir>`. `/install-project` nominates candidates on install.

> See [[vault-architecture]] (the four layers) and [[operating-principles]] (split only what earns it).
