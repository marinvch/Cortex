---
name: cortex-brief
description: Propose and write scoped AGENTS.md briefs for the areas of a repo that earn one, and wire them into a root routing table. Use when a directory is critical, high-churn or holds invariants an agent could violate, or when the user says "this area needs its own context", "split AGENTS.md", "give billing its own brief". Proposes from the index; the user confirms each one.
---

# /cortex-brief — many small briefs, not one large file

One large `AGENTS.md` is loaded in full on every turn whether or not it is relevant. A routing
table plus scoped leaves loads detail **only where work happens**.

## 1. Propose, from evidence

Read `.cortex/index/index.json`. If it is missing or older than the working tree, re-run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-index.mjs" .
```

The index ranks candidate directories by size, churn and absence of tests. Present the top
candidates with **the reason each was surfaced** — never a bare list. A user cannot consent to a
proposal they cannot evaluate.

Then wait. The user picks which areas get a brief. Some will be declined; that is a correct
outcome, not a failure.

## 2. Write one leaf per accepted area

`<area>/AGENTS.md`, and keep it **narrow**. A leaf earns its place by holding what the root cannot:

- What this area is responsible for, in two or three sentences.
- The invariants — the things that must stay true, that an agent could plausibly break.
- The gotchas: the non-obvious coupling, the thing that looks wrong but is deliberate.
- How to run just this area's tests.

Do not restate the stack, the conventions or anything already in the root. Duplication is how
these files rot: two copies drift and neither is trusted.

Everything in a leaf must be **observed**, not assumed. Read the code. If you cannot name a real
invariant, the area does not need a brief yet — say so and move on.

## 3. Wire the routing table

The root `AGENTS.md` gets a table, and nothing else changes:

```markdown
## Where to look

| Working in | Read first |
|---|---|
| `billing/` | [`billing/AGENTS.md`](billing/AGENTS.md) |
| `auth/` | [`auth/AGENTS.md`](auth/AGENTS.md) |
```

An agent reads the root, matches its work to a row, opens exactly one leaf. No hook, no engine —
the routing table is prose an agent follows.

If the root has grown past ~150 lines, this is the moment to move area-specific paragraphs *out*
of it into the leaves they belong to. The root should get shorter as leaves appear.

## 4. Report

List the files written and show the routing table you added. Suggest committing them together —
a leaf without its routing row is invisible.

## Gotchas

- **One filename, `AGENTS.md`.** Never a sprawl of per-topic files in a directory.
- **Split where an invariant lives, not where the file count is high.** A 40-file directory of
  similar components needs one line in the root; a 6-file payment module may need a full brief.
- A leaf that only says "this is the auth directory" is worse than no leaf: it costs context and
  teaches nothing. Delete it.
- Re-run after big refactors — a brief describing a module that moved is actively misleading.
