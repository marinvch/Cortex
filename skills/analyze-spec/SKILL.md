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

Use `/grilling` to work the decision tree: ask the whole settled frontier in one round, each with a
recommended answer, and let the answers push the frontier outward.

### Name the destination, and admit the fog

Two words carry the weight here:

- **Destination** — what reaching the end of this effort looks like. Name it *first*; it fixes the
  scope, and every later decision is judged against it.
- **Fog of war** — the questions you can tell are coming but cannot yet phrase sharply, because
  they hang on decisions still open. Charting fog as though it were settled is how a spec acquires
  confident detail about things nobody has decided.

The test is whether you can state the question **precisely now** — not whether you can answer it
now. A sharp question you cannot yet answer belongs in the spec as a decision. A question you
cannot yet phrase belongs under **Not yet specified**, and graduates when the fog clears.

Keep this distinct from **Out of scope**: that is a ruling about *scope* — beyond the destination,
never graduates. Fog is about *sharpness* — inside the destination, waiting to be seen. Merging the
two is how in-scope work gets silently abandoned.

If naming the destination surfaces **no fog at all**, the way is already clear and this is
`/plan-feature` work, not a spec. Say so and stop.

## Step 3 — Write the design spec
Create `docs/specs/<YYYY-MM-DD>-<slug>-design.md`:
```markdown
# Design: <title>
Date · Status: Draft for review · Area: <critical area / scoped brief it belongs to>

## Destination    — what reaching the end of this looks like; scope is judged against it
## Context        — what exists today (cite AGENTS.md + the scoped brief), why now
## Decisions locked — bullet the choices made in brainstorm
## Architecture   — data flow, components, the invariants this must NOT break
## Risks & edges  — failure modes, security/data-boundary concerns, rollback
## Not yet specified — in scope, not yet sharp enough to decide. Revisit as the fog clears
## Out of scope   — beyond the destination. Ruled out, never graduates
```
Tie every claim to the brain; if a fact is missing from the brain, that's a gap to capture.

## Step 4 — Write the plan
Create `docs/plans/<YYYY-MM-DD>-<slug>.md`: small, ordered, independently testable steps; each
names the files it touches and how it's verified (lint/test). Lowest autonomy that works.

**Wide mechanical changes get expand–contract, not a vertical slice.** The default above assumes
each step is a thin slice that ships on its own. When one change breaks hundreds or thousands of
call sites — a renamed export, a changed signature, a moved module — forcing it into vertical
slices produces a plan that cannot compile between steps. Plan three phases instead:

1. **Expand** — add the new form alongside the old. Nothing is removed, so the tree stays green
   and the change is independently reviewable and revertible.
2. **Migrate** — move call sites in batches sized by blast radius, not by count. One batch per
   area or per owning team, each verifiable on its own.
3. **Contract** — remove the old form once nothing references it. Verify with a search, and put
   that search command in the plan so the check is reproducible rather than remembered.

Say in the plan which phase each step belongs to. The failure this avoids is a "small ordered
step" that is actually 400 files and therefore neither small, reviewable, nor revertible.

## Step 5 — Route the knowledge back
If the spec produced a durable invariant or gotcha, say where it belongs: the relevant **scoped
`AGENTS.md`** (preferred) or root. Append the decision to `docs/decisions.md`. This is how the
brain compounds. Then ask the user to approve the spec + plan before any implementation.

## Rules
- Spec/plan only — never implement in this ritual.
- Ground in the brain; don't re-derive what AGENTS.md already states.
- One source of truth: durable facts go into AGENTS.md (root or scoped), decisions into the log.
