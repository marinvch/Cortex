# Plan: four rituals cover two jobs

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans`. Steps use `- [ ]`.

**Goal:** `/cortex-doctor` folds into `/cortex-audit`, `/scope-area` folds into `/cortex-brief`, and
the 33 lines of `AGENTS.md` prose that existed to tell them apart are deleted rather than rewritten.

**Spec:** none — the top recommendation of the 2026-08-19 architecture review of v2.8.1.

## The finding

Four rituals cover two jobs. The difference between each pair is carried by disambiguation prose,
written three times over: inside each sibling, inside the other sibling, and again in `AGENTS.md`.

Verified against the working tree, not theorised:

- `skills/cortex-doctor/SKILL.md` scans six categories — orphans, dead links, stale, duplicate,
  misplaced, integrity. `agents/cortex-auditor.md` scans the same six **plus** a seventh
  (employer-firewall breach) and a content-health signal. The doctor's scan is a strict subset of
  the auditor's, and `/cortex-audit` already carries an inline fallback for when the subagent is
  unavailable — which is exactly the doctor's job description.
- `skills/scope-area/SKILL.md:57` — "Same filename everywhere (`AGENTS.md`), nested" ≡
  `skills/cortex-brief/SKILL.md:51` — "One filename, `AGENTS.md`." Both write a scoped leaf, both
  wire a root routing table, both refuse to split where no invariant lives. The only real
  difference is where step 1 gets its candidate: `/cortex-brief` ranks them from
  `.cortex/index/index.json`, `/scope-area` takes a directory the user names.

Each sibling also states "I am not my sibling" inside itself
(`cortex-doctor/SKILL.md:14-16`, `cortex-audit/SKILL.md:12-14`) and again in `AGENTS.md:133-144`.
`skills/writing-for-agents/SKILL-MECHANICS.md:30` cites that same triad a fourth time.

## Why this pair and not the others

`AGENTS.md` is loaded by every agent on every run, and it is the second-most-churned file in the
repo. Thirty-three lines of it exist to tell apart rituals that the deletion test says are one
module. The load is paid every turn; the distinction it buys is not real.

It is also the question that paused the capability-floor work. A frontmatter key declaring "this
ritual needs a subagent" would be declared twice, by `/cortex-doctor` and `/cortex-audit`, for one
job — the convention would harden the duplication rather than describe it. Collapse first, declare
second.

## What is NOT collapsing

`/audit` stays. It scores **content** out of 100 and writes nothing; `/cortex-audit` finds and
fixes **structure**. That is a real cut between two jobs, and it survives — the review's own
"before" diagram keeps it. Three rituals become two here, not one.

`/reindex` stays. It regenerates the navigator graph; neither survivor does.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `skills/cortex-doctor/SKILL.md` | subset of `agents/cortex-auditor.md` | **delete** |
| `skills/scope-area/SKILL.md` | same job as `/cortex-brief` | **delete** |
| `skills/cortex-audit/SKILL.md` | absorb the doctor's trigger branches + name the inline fallback | modify |
| `skills/cortex-brief/SKILL.md` | absorb the named-directory entry point + the leaf conventions | modify |
| `AGENTS.md` | drop two table rows and three gotchas; fix the stale `disable-model-invocation` count | modify |
| `README.md` | drop two table rows and the `/scope-area` call-out | modify |
| `skills/{install-project,migrate-engine,optimize-context,skill-creator,writing-for-agents}` | repoint | modify |
| `references/{context-engineering,nested-briefs}.md` | repoint | modify |
| `tools/cortex-init.sh` | repoint the two scaffolded strings | modify |
| `docs/adr/0011-four-rituals-covered-two-jobs.md` | the decision | **create** |

`core/test/plugin.test.js:123` — "skills referenced by other skills exist" — pins the repoint. A
missed reference fails the suite rather than shipping a dead `/slash` name.

## Pointer budget

Deleting a skill deletes its description, and a description is a context pointer: its **wording**
decides whether the material is ever reached. So the surviving descriptions must absorb the dead
ones' genuinely distinct trigger branches — synonyms that rename one branch are one branch written
twice and get dropped, not merged.

- From `/cortex-doctor` into `/cortex-audit`: "clean up cortex", "fix dead links",
  "is the file structure healthy", "find orphan/stale/redundant files". Dropped as synonyms of
  branches `/cortex-audit` already carries: "diagnose the vault", "self audit", "audit the vault
  structure", "make cortex optimal".
- From `/scope-area` into `/cortex-brief`: "give this part its own brain", "this area is critical".
  Dropped as synonyms: "split AGENTS.md" (already present), "scope a brief for X".

---

## 1. Fold `/cortex-doctor` into `/cortex-audit`

**Touches:** `skills/cortex-audit/SKILL.md`, `skills/cortex-doctor/`

- [ ] Absorb the four distinct trigger branches into `/cortex-audit`'s description.
- [ ] Make the inline fallback concrete: name `agents/cortex-auditor.md` as the file to read and run
      when the subagent is unavailable, so the fallback is a pointer rather than a gesture.
- [ ] Delete the "Sits above its siblings" block — with the sibling gone there is nothing to sit
      above. Keep the one line that separates `/audit` (content) from this (structure).
- [ ] Delete `skills/cortex-doctor/`.

## 2. Fold `/scope-area` into `/cortex-brief`

**Touches:** `skills/cortex-brief/SKILL.md`, `skills/scope-area/`

- [ ] Absorb the two distinct trigger branches into `/cortex-brief`'s description.
- [ ] Give step 1 the second entry point: a directory the user names, which skips the ranking.
      This is the two-line difference that was carried by a whole second skill.
- [ ] Carry over the three leaf conventions `/cortex-brief` lacks — every leaf links up to root;
      a fact that moves into a leaf leaves root; a leaf ships in the same PR as the code it covers.
- [ ] Delete `skills/scope-area/`.

## 3. Delete the disambiguation prose

**Touches:** `AGENTS.md`, `README.md`

- [ ] Drop the two ritual-table rows in each file.
- [ ] Delete the three gotchas that existed only to separate the collapsed pairs
      (`AGENTS.md:133-135`, `:142-143`, `:144-145`) and rewrite the `/optimize-context` one to
      point at `/cortex-audit`.
- [ ] Fix `AGENTS.md`'s stale claim that four rituals carry `disable-model-invocation` — eight do.
      The review surfaced this; it is stale because the list was never updated as rituals were added.

## 4. Repoint every cross-reference

**Touches:** five skills, two references, `tools/cortex-init.sh`

- [ ] Repoint each site to its surviving ritual. `CHANGELOG.md` and `docs/superpowers/specs/` are
      history and stay as written — a changelog that describes a ritual which existed at the time
      is accurate, and rewriting it would be the lie.
- [ ] `node --test core/test/plugin.test.js` proves no dead reference is left.

## 5. Record the decision

**Touches:** `docs/adr/0011-four-rituals-covered-two-jobs.md`

- [ ] Write the ADR: the deletion test, what was kept and why `/audit` survived the same pass.
