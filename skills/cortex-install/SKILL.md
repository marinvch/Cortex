---
name: cortex-install
description: Install Cortex into a codebase — index it, report what it finds, and let the user choose what to act on. Use when someone says "install cortex here", "set up cortex on this repo", "give this codebase a context layer", or opens an unfamiliar repo and wants to understand it. Works on greenfield and legacy repos. Writes nothing to source code.
disable-model-invocation: true
---

# /cortex-install — give a codebase a context layer

The entry point. Runs in a **target repo**, never in the Cortex repo itself.

> **The rule that governs this whole skill:** steps 1–3 read and report. They do not modify one
> line of the repository. Scaffolding happens in step 5, only for the items the user picked. If
> you find yourself editing a source file before the user has chosen something, stop — you have
> left the skill.

## 1. Orient

```bash
git rev-parse --show-toplevel 2>/dev/null || pwd
```

Refuse to continue if this is the Cortex repo itself (`.claude-plugin/plugin.json` names `cortex`)
— Cortex installs *into other repos*.

Note whether the repo already has `AGENTS.md`, `CONTEXT.md`, `docs/adr/`, `.cortex/`. An existing
`.cortex/` means Cortex is already installed; offer to re-index instead of reinstalling.

## 2. Index

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-index.mjs" .
```

Deterministic and offline — parse, imports, inventory, layers, git hot spots. Writes only
`.cortex/index/index.json`. On a large repo this is seconds, not minutes.

If the repo is not a git checkout the indexer falls back to a filesystem walk; say so, because
hot spots will be empty and that changes how the findings should be read.

## 3. Report

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-findings.mjs" .
```

Writes exactly one file: `.cortex/findings/<date>.md`.

Read it, then give the user a **short** summary in chat — the top three or four items, most severe
first, in your own words. Do not paste the report; they can open it. Say plainly how many findings
there are and where the file is.

If there are `critical` security findings, lead with them. Those are possible secrets in the repo,
and some will be fixtures — say that, because a false positive presented as a breach destroys
trust in every other finding.

## 4. Ask — and stop

Present the choices and **wait**. This is the point of the whole design:

- Add the context layer? (`AGENTS.md` + shims, `CONTEXT.md`, `docs/adr/`)
- Create scoped briefs for the areas the report proposed? (each one individually — not all or nothing)
- Install the plugin bundle? (superpowers, Context7, and the optional tiers)
- Nothing yet — they keep the report and think about it

A user who wants only the report has been served completely. That is a successful run.

## 5. Apply — only what was chosen

**Context layer** — copy from `${CLAUDE_PLUGIN_ROOT}/templates/`:
- `target-AGENTS.md` → `AGENTS.md`, filled in from the index: stack, layout, how to run tests,
  the invariants you actually observed. Keep it under ~120 lines; detail belongs in leaves.
- `CLAUDE.md` and `GEMINI.md` as one-line shims importing it.
- `CONTEXT.md` from the glossary template, seeded with the domain terms that appear in the code.
- `docs/adr/` with the ADR template. Create records lazily, not preemptively.

Never clobber a curated file. If `AGENTS.md` exists and has real content, write
`AGENTS.generated.md` beside it and tell the user to diff.

**Context layer, the writing itself** — hand off to `/cortex-scaffold`. It owns the templates, the
never-clobber rules and the post-write verification; do not duplicate that logic here.

**Scoped briefs** — hand off to `/cortex-brief` for each area they picked.

**Bundle** — hand off to `/setup-plugins`, which reads `plugins/cortex-core-plugins.json`:

| Tier | Holds | When |
|---|---|---|
| `core` | superpowers, context7, skill-creator, claude-md-management, claude-code-setup, feature-dev, code-review, code-simplifier | always — this is the developer experience Cortex assumes |
| `dev-tools` | typescript-lsp, github | opt-in |
| `browser-qa` | playwright, chrome-devtools-mcp | opt-in; offer it when the index shows a frontend |
| `platform` | vercel, cloudflare, karpathy skills | opt-in |

Core carries **superpowers** because Cortex's workflow is spec- and test-driven and leans on it,
and **Context7** because a context manager whose agents guess at library APIs from stale training
data is not managing much.

There is no Postman plugin in the official marketplace. If the user wants Postman, it is added as
a plain MCP server in their own settings — say that rather than pretending a tier exists.

**Memory** — create `.cortex/memory/` and tell the user it is committed on purpose: it is how
several developers and their agents share one context. Then say the hard part out loud — nothing
personal or secret may go in it, and Cortex will refuse writes that carry credentials.

## 6. Close

State what was written, as a list of paths. Suggest committing it so the team shares the context.
Mention that re-running `index/cortex-index.mjs` refreshes the index after significant changes,
and `/dream` at the end of a working day.

## Gotchas

- `.cortex/index/` and `.cortex/findings/` are generated — gitignore them. `.cortex/memory/` is
  **committed**; that asymmetry is deliberate and worth explaining once.
- The indexer resolves imports by convention, so dynamically loaded files look like orphans.
  Present orphans as "worth checking", never "safe to delete".
- On a monorepo, offer to index one package rather than the whole tree if the top-level file
  count is very large.
