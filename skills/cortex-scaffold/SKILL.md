---
name: cortex-scaffold
description: Write the context layer into a repo — root AGENTS.md, agent shims, CONTEXT.md glossary, docs/adr/ and .cortex/. Use after reading a findings report, or when the user says "add the context layer", "scaffold cortex here", "write the AGENTS.md". This is the apply step; it is invoked explicitly and never runs on its own.
---

# /cortex-scaffold — write the context layer

The **apply** half of Cortex. `/cortex-install` finds and reports; this writes. They are separate
skills on purpose: the one that analyses has no authority to change a repository, so "the user
decides" holds structurally rather than by good intentions.

Run this only when the user has asked for it by name, or picked it from a findings report.

## 1. Read before writing

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-index.mjs" .
```

Refresh the index if it is missing or stale — everything below is filled in from what is actually
in the repo. A scaffold written from assumption is worse than none: it reads as authoritative and
is wrong.

Then read enough source to answer honestly: what does this project do, how is it run, how are its
tests invoked, and what would a competent newcomer get wrong on day one.

## 2. Never clobber

For each target, check first:

| Exists and has real content | Do |
|---|---|
| `AGENTS.md` | write `AGENTS.generated.md` beside it and tell the user to diff |
| `CONTEXT.md` | leave it; offer to add missing terms instead |
| `docs/adr/` | leave it; only add the template if the directory is empty |
| `CLAUDE.md` / `GEMINI.md` | if they hold real content rather than a shim line, leave them |

A curated file is someone's work. Overwriting it is the fastest way to make a team distrust the
tool.

## 3. Write

From `${CLAUDE_PLUGIN_ROOT}/templates/`:

- **`target-AGENTS.md` → `AGENTS.md`.** Fill every `{{placeholder}}` from the index and the code.
  Keep it under ~120 lines — it loads on every turn. Include the routing table heading even if it
  has no rows yet, so `/cortex-brief` has somewhere to add them.
- **`CLAUDE.md` and `GEMINI.md`** — one line each: `@AGENTS.md`. Nothing else, or they drift.
- **`CONTEXT.md`** — seed from terms that genuinely appear in the code and are ambiguous. Three
  sharp entries beat twenty obvious ones. Delete the worked example.
- **`docs/adr/`** — copy `adr.md` as `docs/adr/TEMPLATE.md`. Do **not** invent records; ADRs are
  written when a decision happens.
- **`.cortex/`** — create `memory/` and add the generated dirs to `.gitignore`:

```
.cortex/index/
.cortex/findings/
```

`.cortex/memory/` is deliberately **not** ignored. Say this out loud to the user: memory is
committed so the team and their agents share one context, and that is exactly why Cortex refuses
to write anything carrying a credential into it.

## 4. Verify what you wrote

Do not report success without checking:

- Every `{{placeholder}}` is gone. Grep for `{{` and fix what you find.
- Every command in the *Running it* section actually exists — check `package.json` scripts, the
  Makefile, or whatever this repo uses. A wrong test command is the single most costly error here,
  because every future agent trusts it.
- Every path in the routing table and the layout table exists on disk.

## 5. Report

List the files written, as paths. Suggest committing them so the whole team gets the context.
Then offer the natural next step: `/cortex-brief` for the areas the findings report proposed.

## Gotchas

- **The root brief gets shorter over time, not longer.** As leaves appear, area-specific detail
  moves out of the root into them. If the root is growing, something is being duplicated.
- Do not restate the language's own conventions. Only record where this repo differs from what a
  competent developer would assume.
- On a monorepo, scaffold per package rather than one root brief for everything — the routing
  table then points at each package's own `AGENTS.md`.
