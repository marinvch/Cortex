---
name: analyze-spec
description: Spec-Driven Development for a repo, grounded by its Cortex brain. Use when starting a non-trivial or risky feature/change and you want a rigorous brainstorm -> design spec -> plan BEFORE code. Bridges Cortex (long-run context) with Superpowers (SDD workflow). Triggers — "spec this", "design before building", "SDD", "write a design doc", "plan a big feature".
---

# /analyze-spec — design before you build, grounded by the brain

Cortex supplies the **context** (cheap to load, always current); Superpowers supplies the
**method** (brainstorm → spec → plan → implement). This ritual runs that method *on top of* the
repo's brain so the design is grounded in real architecture instead of guesses — fewer tokens,
fewer drifts, safer changes. Terminal state is an approved spec + plan; **no code is written here.**

## When to use vs `/plan-feature`
- `/plan-feature` — routine ticket: a short plan, then implement. Use it for most work.
- `/analyze-spec` — new subsystem, risky/irreversible change, or anything touching a **critical
  area** (auth, billing, data, the parts with invariants). Heavier; produces a durable spec.

## Step 1 — Load the brain (context first, cheaply)
1. Read the root `AGENTS.md` (stack, conventions, the dev-cycle rule).
2. Read any **scoped `AGENTS.md`** for the area you're touching (the routing table in root points
   to it). Load only what's relevant — that's the token win.
3. Skim `docs/decisions.md` for prior calls, and the personal vault's `references/operating-principles.md`
   if available (Notice → Decide → Build).

## Step 2 — Brainstorm (diverge, then lock decisions)
Explore approaches with the user — one question at a time. Surface trade-offs, not just one path.
End by **locking the decisions** explicitly (strategy, scope, data boundaries, the autonomy level).
Do not refine details of something that should be decomposed first.

## Step 3 — Write the design spec
Create `docs/specs/<YYYY-MM-DD>-<slug>-design.md`:
```markdown
# Design: <title>
Date · Status: Draft for review · Area: <critical area / scoped brief it belongs to>

## Context        — what exists today (cite AGENTS.md + the scoped brief), why now
## Decisions locked — bullet the choices made in brainstorm
## Architecture   — data flow, components, the invariants this must NOT break
## Risks & edges  — failure modes, security/data-boundary concerns, rollback
## Out of scope   — what this explicitly does not do
```
Tie every claim to the brain; if a fact is missing from the brain, that's a gap to capture.

## Step 4 — Write the plan
Create `docs/plans/<YYYY-MM-DD>-<slug>.md`: small, ordered, independently testable steps; each
names the files it touches and how it's verified (lint/test). Lowest autonomy that works.

## Step 5 — Route the knowledge back
If the spec produced a durable invariant or gotcha, say where it belongs: the relevant **scoped
`AGENTS.md`** (preferred) or root. Append the decision to `docs/decisions.md`. This is how the
brain compounds. Then ask the user to approve the spec + plan before any implementation.

## Rules
- Spec/plan only — never implement in this ritual.
- Ground in the brain; don't re-derive what AGENTS.md already states.
- One source of truth: durable facts go into AGENTS.md (root or scoped), decisions into the log.
