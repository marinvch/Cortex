---
name: cortex-brief
description: Write a scoped AGENTS.md brief for a part of a repo that earns one, and wire it into a root routing table, so an agent loads narrow context for the area it is touching instead of the whole monolith. Use when a directory is critical, high-churn or holds invariants an agent could violate. Triggers — "this area needs its own context", "give this part its own brain", "split AGENTS.md", "give billing its own brief", "this area is critical". Proposes candidates from the index, or takes a directory you name; the user confirms each one.
capability: judgment
---

# /cortex-brief — many small briefs, not one large file

One large `AGENTS.md` is loaded in full on every turn whether or not it is relevant. A routing
table plus scoped leaves loads detail **only where work happens**.

## 0. Check there is a spine, and ask before the first write

**If there is no root `AGENTS.md`, stop and hand off to `/cortex-scaffold`.** Every leaf opens by
pointing up at the root, and step 3 wires a routing table into it — both need a root that exists.
Do **not** improvise one here: `/cortex-scaffold` owns the templates, the never-clobber rules and
the post-write verification, and duplicating that logic is exactly what `/cortex-install` step 6
forbids. Say plainly that the leaves are deferred until the spine exists, then run the handoff.

**If `.cortex/` does not exist, ask before writing anything** — including the index. This skill is
reachable on a repo where no Cortex ritual has ever run, so it can be the first thing to create that
directory, which is the write [ADR 0005](../../docs/adr/0005-the-install-sequence-may-start-itself.md)
gates. Generated and gitignored is not the same as invisible: these are files appearing in someone's
project on a run they did not ask for. The `.gitignore` entry is written for you at creation time —
the *asking* is still yours.

## 1. Pick the areas

**If the user named a directory, use it** — they have already done the picking. Confirm it, then go
to step 2.

Otherwise propose from evidence. Read `.cortex/index/index.json`. If it is missing or older than the
working tree, re-run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-index.mjs" .
```

The index ranks candidate directories by size, churn and absence of tests, and skips anything
declared `linguist-vendored` or `linguist-generated` in `.gitattributes` — nobody edits vendored
code, so a brief for it is context every session pays for and no one uses. **If a vendored tree
ranks anyway, it has not been declared**: say so and offer the one-line `.gitattributes` entry
rather than briefing it. On one repo the top three candidates were a plugin cache, a generated
server and another tool's instruction files, with the application fourth.

Present the top candidates with **the reason each was surfaced** — never a bare list. A user cannot consent to a
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
