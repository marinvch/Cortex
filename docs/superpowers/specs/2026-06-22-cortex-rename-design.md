# Design: Cortex rename migration (ai-os → cortex, hard cut)

**Date:** 2026-06-22
**Status:** Approved (brainstorming) — pending implementation plan
**Sub-project of:** #272 v2. Builds **first** (foundation); the AI-agnostic-core spec
(`2026-06-22-ai-agnostic-core-design.md`) rebases onto the renamed `.github/cortex/` paths after.

## Problem

The engine/kernel is named **`ai-os`** throughout — package, CLI, generated paths, env vars, MCP
server name, workflows, and ~735 string references in `engine/src`. The product brand is **Cortex**
(the repo root is already Cortex; the engine is "the ai-os kernel"). v2 unifies everything under
**Cortex**.

## Goal

Rename `ai-os` → `cortex` everywhere, as a **hard cut**: no backward-compat aliases, no dual-path
reads, no migration shims. Existing third-party installs must re-run init; acceptable for a pre-1.0
solo project. The only install we actively migrate is **this repo's own dogfood setup** (we own it).

## Decisions (from brainstorming)

- **Full rename now** (package/CLI, paths, env, MCP name, workflows, copy).
- **Hard cut** — no aliases or migration code. Cleanest surface.
- **GitHub repo renamed** `marinvch/ai-os` → `marinvch/cortex` (manual GitHub step by the owner;
  GitHub auto-redirects old URLs so `npx github:marinvch/ai-os` keeps resolving). Doc references
  updated to `…/cortex`.

## Non-goals (YAGNI)

- No alias/compat/migration layer (that was explicitly rejected).
- No de-Copilot / AGENTS.md work (separate sub-project #2, lands after).
- No publishing to the npm registry in this sub-project.

## Naming map (authoritative)

| From | To |
| --- | --- |
| package `name` `ai-os` (root + engine) | `cortex` |
| `bin` key `ai-os` | `cortex` |
| `.github/ai-os/` (config, memory, mcp-server, context) | `.github/cortex/` |
| `AI_OS_ROOT` | `CORTEX_ROOT` |
| `AI_OS_PERSONAL_ROOT` | `CORTEX_PERSONAL_ROOT` |
| `AI_OS_CONFIG` | `CORTEX_CONFIG` |
| `AI_OS_ALLOW_RUN_TOOLS` | `CORTEX_ALLOW_RUN_TOOLS` |
| `AI_OS_MCP_DEBUG` | `CORTEX_MCP_DEBUG` |
| MCP server `name: 'ai-os'` → tools `mcp__ai-os__*` | `name: 'cortex'` → `mcp__cortex__*` |
| workflows `ai-os-{drift-check,index,update-check,validate}.yml` | `cortex-*.yml` |
| user-facing "AI OS" / "ai-os" copy | "Cortex" / "cortex" |

## Architecture: centralize, then replace

To avoid 735 scattered magic strings, introduce **one brand module** as the single source of truth,
then replace literals with references.

`engine/src/brand.ts` (new):

```ts
export const BRAND = 'cortex';
export const BRAND_TITLE = 'Cortex';
export const CONFIG_DIR = '.github/cortex';            // was '.github/ai-os'
export const MCP_SERVER_NAME = 'cortex';               // was 'ai-os'
export const ENV = {
  ROOT: 'CORTEX_ROOT',
  PERSONAL_ROOT: 'CORTEX_PERSONAL_ROOT',
  CONFIG: 'CORTEX_CONFIG',
  ALLOW_RUN_TOOLS: 'CORTEX_ALLOW_RUN_TOOLS',
  MCP_DEBUG: 'CORTEX_MCP_DEBUG',
} as const;
```

- Replace `process.env.AI_OS_*` reads with `process.env[ENV.*]`.
- Replace `'.github/ai-os'` literals with `CONFIG_DIR` (path joins use it).
- Replace the MCP server `name: 'ai-os'` with `MCP_SERVER_NAME` (`sdk-server.ts:81`).
- Remaining brand strings in copy/docs → `BRAND_TITLE`.
- This both fixes the rename and satisfies #272's "no hardcoded provider/brand names scattered in
  core" principle.

## This repo's own dogfood install (migrated as part of the work)

We own this repo, so the rename regenerates its self-applied artifacts:

- Move `.github/ai-os/` → `.github/cortex/` (config.json, memory/, mcp-server/, context/). Update
  `config.json` if it stores brand/paths.
- Rewrite root `.mcp.json`: server key `ai-os` → `cortex`, args path
  `.github/ai-os/mcp-server/index.js` → `.github/cortex/mcp-server/index.js`, `AI_OS_ROOT` →
  `CORTEX_ROOT`.
- Rename the 4 workflows `ai-os-*.yml` → `cortex-*.yml` and update their bodies (paths, the
  self-version update-check that reads `.github/cortex/config.json`, the index/drift/validate steps
  pointing at `engine/`).
- Update `.claude/settings.local.json` permissions `mcp__ai-os__*` → `mcp__cortex__*` and
  `enabledMcpjsonServers: ['cortex']`.
- Update root `README.md`, `AGENTS.md`, `CLAUDE.md`/`GEMINI.md` references and the engine subtree
  pointer copy.

## CLI / package

- `engine/package.json` and root `package.json`: `name` → `cortex`; `bin` → `{ "cortex": ... }`.
- `engine/docs` + scripts referencing `ai-os` command → `cortex`.
- Bundle: `scripts/bundle.mjs` banner and `bundle-manifest.json` brand → Cortex; rebuild
  `bundle/generate.js` + `dist/server.js`.

## Tests

- Re-point every test asserting `.github/ai-os/` paths, `AI_OS_*` env, MCP server name `ai-os`, or
  the `ai-os` CLI/brand string → Cortex equivalents (across the generator/apply/doctor/drift/
  freshness/mcp test files).
- Add a guard test: **no `AI_OS_` or `.github/ai-os` or `'ai-os'`-as-brand literal remains in
  `engine/src`** (allow-list any legitimate external references, e.g. the GitHub redirect note).
- `npm run build && npm run lint && npm test` green; regenerate `engine/docs/mcp-tools.md` so the
  freshness check passes.

## Manual steps (owner, outside code)

- Rename the GitHub repo `marinvch/ai-os` → `marinvch/cortex` (Settings → rename). GitHub redirects
  old URLs, so existing `github:marinvch/ai-os` references keep working; docs are updated to the new
  URL regardless.
- (Optional, later) If publishing to npm, `cortex` is likely taken — use scoped `@marinvch/cortex`.

## Risk / ordering

- Low conceptual risk, high thoroughness requirement — success = catching every reference (the guard
  test enforces it).
- Lands **before** the AI-agnostic-core sub-project, which then targets `.github/cortex/` directly.

## Likely plan split (for writing-plans)

1. **Core rename** — `brand.ts` + engine/src literals + env + MCP name + package/bin + tests + guard
   test + rebundle.
2. **Repo self-migration + workflows + docs** — `.github/ai-os`→`.github/cortex`, `.mcp.json`,
   `cortex-*.yml`, `.claude` settings, README/AGENTS copy.
