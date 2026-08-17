# The mattpocock/skills harvest — survey and proposal

**Date:** 2026-08-17 · **Status:** proposal, nothing ported yet · **Upstream:**
[`mattpocock/skills`](https://github.com/mattpocock/skills) (MIT)

This survey was originally run by a parallel Claude session on 2026-08-15. That session was closed
and recorded nothing, so the work was lost. It is written down this time — that is the point of
the file.

Upstream has **18 engineering** skills and **7 productivity** skills. Cortex has 31 skills of its
own plus a bundled plugin set (superpowers, Context7, code-review), so most upstream entries are
already covered. The question is never "is this good" — it is "does Cortex lack this".

## Already ported (5)

| Upstream | Lands in Cortex as | Attribution |
|---|---|---|
| `codebase-design` | `references/codebase-design.md` | present |
| `domain-modeling` | `skills/domain-modeling/` | present |
| `resolving-merge-conflicts` | `skills/resolving-merge-conflicts/` | present |
| `wizard` | `skills/wizard/` | present |
| `improve-codebase-architecture` | `skills/improve-codebase-architecture/` | **MISSING** |

### Two defects in the last row, both shipped in 2.3.0

1. **No MIT attribution.** It was ported by the parallel session without the header every other
   ported file carries. The upstream licence requires it. Fix before anything else.
2. **A dead dependency.** Its step 3 says "run the `/grilling` skill". `grilling` is an upstream
   *productivity* skill that was never ported, so the grilling loop — the part that does the
   actual work after the report is generated — dead-ends. The skill is half-functional today.

## Skip — not ours to take (2)

`ask-matt` is a router over Matt's own skill set; `setup-matt-pocock-skills` installs his repo.
Both are personal infrastructure.

## Skip — already covered by the bundle (5)

| Upstream | Covered by |
|---|---|
| `tdd` | `superpowers:test-driven-development` |
| `diagnosing-bugs` | `superpowers:systematic-debugging` |
| `implement` | `superpowers:executing-plans` + the `/plan-feature` written by `/install-project` |
| `code-review` | the bundled `code-review` plugin |
| `to-spec` | `/analyze-spec` (conversation → design spec → plan) |

Porting any of these would create a second spelling of a ritual Cortex already ships. Two
spellings of one ritual is worse than none.

## Propose porting (4)

**1. `grilling` — required, not optional.** It is the missing dependency above. Systematic
interview of a plan or decision until every branch of the tree resolves. Cortex interviews the
user in `/analyze-spec`, `/level-up` and `/onboard`, each ad hoc; a shared grilling discipline
gives all of them one spelling. Porting it repairs `/improve-codebase-architecture` as a
side effect.

**2. `writing-for-agents` — the strongest fit in the whole upstream repo.** Documentation written
for agent consumption: skills, reference files, briefs. That is *precisely what Cortex produces* —
`AGENTS.md`, `CONTEXT.md`, scoped briefs. Cortex has `/optimize-context` to **audit** those files
and `/skill-creator` to scaffold one, but no discipline for **authoring** them well. This is a
real hole in the middle of Cortex's own product.

**3. `handoff` — distil a live conversation so another agent can pick the work up.** Cortex has
`/dream` (end-of-day, repo-wide, committed) and `/catch-me-up` (reads git + notes after time
away). Neither packages an *in-flight* session for a *different* agent. This is the exact failure
that lost the 08-15 survey and stranded `improve-codebase-architecture` on a gitignored path.
Cortex's whole thesis is not losing context; this is a hole in it.

**4. `wayfinder` — planning large-scale work as decision tickets resolved iteratively.** Cortex
plans per-feature (`/analyze-spec`) but has nothing for work spanning a whole legacy codebase —
which is the audience Cortex claims. Lowest confidence of the four: it may overlap `/analyze-spec`
more than the description suggests. Read it before committing.

## Propose skipping, with reasons (9)

- `to-tickets`, `triage` — both assume an issue tracker in active use. This repo runs on PRs with
  zero open issues, so they would be dead ritual on arrival.
- `prototype` — throwaway prototypes are not context management.
- `research` — genuinely useful and Context7 is already bundled, but it is a general capability,
  not a Cortex gap. Reconsider if the enrichment work ever needs sourced answers.
- `grill-with-docs` — better as an *enhancement to the already-ported* `/domain-modeling` (ground
  terminology against real docs via Context7) than as a second, near-duplicate skill.
- `teach`, `to-questionnaire`, `wait-what`, `grill-me` — general productivity. `grill-me` is the
  user-invoked twin of `grilling`; port the model-invoked one and expose it by name instead of
  shipping both.

## Recommended order

1. Attribution header on `improve-codebase-architecture` — a licence obligation, one line.
2. `grilling` — repairs the broken dependency.
3. `writing-for-agents` — the biggest genuine gap.
4. `handoff` — the gap Cortex's own thesis implies.
5. `wayfinder` — only after reading it.

Every ported file keeps the attribution header in its footer, matching `skills/wizard/SKILL.md`.
