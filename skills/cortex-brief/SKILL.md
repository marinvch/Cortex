---
name: cortex-brief
description: Write a scoped AGENTS.md brief for a part of a repo that earns one, and wire it into a root routing table, so an agent loads narrow context for the area it is touching instead of the whole monolith. Use when a directory is critical, high-churn or holds invariants an agent could violate. Triggers — "this area needs its own context", "give this part its own brain", "split AGENTS.md", "give billing its own brief", "this area is critical". Proposes candidates from the index, or takes a directory you name; the user confirms each one.
---

# /cortex-brief — many small briefs, not one large file

One large `AGENTS.md` is loaded in full on every turn whether or not it is relevant. A routing
table plus scoped leaves loads detail **only where work happens**.

## 1. Pick the areas

**If the user named a directory, use it** — they have already done the picking. Confirm it, then go
to step 2.

Otherwise propose from evidence. Read `.cortex/index/index.json`. If it is missing or older than the
working tree, re-run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-index.mjs" .
```

The index ranks candidate directories by size, churn and absence of tests. Present the top
candidates with **the reason each was surfaced** — never a bare list. A user cannot consent to a
proposal they cannot evaluate.

Then wait. The user picks which areas get a brief. Some will be declined; that is a correct
outcome, not a failure.

## 2. Write one leaf per accepted area

`<area>/AGENTS.md`, opening with a line that points **up** to the root — a leaf adds depth to the
spine, it never replaces it:

> Scoped brief. Read the root `/AGENTS.md` first for stack and conventions; this adds depth for
> `<area>`.

Keep the body **narrow**. A leaf earns its place by holding what the root cannot:

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

Then **move, don't duplicate**: a fact that now lives in a leaf comes *out* of the root, leaving the
routing row as its pointer. Root holds the global, leaves hold the local, and no fact lives in two
places — that is where drift starts. The root gets shorter as leaves appear.

## 4. Report

List the files written and show the routing table you added. Suggest committing them together —
a leaf without its routing row is invisible.

## Gotchas

- **One filename, `AGENTS.md`.** Never a sprawl of per-topic files in a directory
  (`architecture.md` / `conventions.md` / …) — that was the retired engine's shape.
- **Ship a leaf in the same PR as the code it covers.** That is what keeps it true; a leaf updated
  later is a leaf updated never.
- **One repo's leaves never reference another repo.** Cross-project knowledge belongs in the vault.
- **Split where an invariant lives, not where the file count is high.** A 40-file directory of
  similar components needs one line in the root; a 6-file payment module may need a full brief.
- A leaf that only says "this is the auth directory" is worse than no leaf: it costs context and
  teaches nothing. Delete it.
- Re-run after big refactors — a brief describing a module that moved is actively misleading.
