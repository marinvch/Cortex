# Design: AI-agnostic core — AGENTS.md canonical + auto-detected adapters (demote Copilot)

**Date:** 2026-06-22
**Status:** Approved (brainstorming) — pending implementation plan
**Sub-project of:** #272 v2 (the "MCP-native, all-AI" pillar). First sub-project to build; the
graph-brain BrainStore is deferred (decisions captured at the end of this doc).

## Problem

The engine is architecturally ~90% assistant-pluggable already (`generators/multi-model.ts`
and `generators/multi-editor.ts` are clean adapters for Claude/Gemini/Cursor/JetBrains/Neovim),
but GitHub Copilot is still **privileged** in five concrete ways:

1. **Hardcoded default** `model: 'copilot'` (`cli/args.ts:91`, `actions/init.ts:87`).
2. **Branding** — banner "Portable Copilot Context Engine" (`cli/dispatch.ts:28`); `package.json`
   description is Copilot-centric.
3. **Dead `--copilot` SDK bridge** + `@github/copilot-sdk` dependency — the in-process transport
   is an unimplemented stub (`mcp-server/index.ts:112-122`); real clients use universal stdio MCP.
4. **Copilot framed as "the canonical"** — `.github/copilot-instructions.md` is treated as *the*
   primary output (`generators/instructions.ts:429`) rather than one adapter's view.
5. **Copilot-only artifacts** — `prompts.json` (slash-commands), chatmodes.

The drift/freshness/doctor pipeline and ~8 tests assume `.github/copilot-instructions.md` is the
canonical artifact.

## Goal

Make the engine **assistant-neutral by default** while keeping every existing assistant working:
make **`AGENTS.md`** the canonical primary, render each assistant's native file as an **adapter
view**, **auto-detect** which assistants a repo uses, and **remove** the dead Copilot SDK coupling.
This is the deferred `TODO(agents-canonical)` from the Cortex fusion ("migrate the apply emission
pipeline to canonical AGENTS.md + shims").

## Decisions (from brainstorming)

- **Demote Copilot, do not delete it.** Copilot becomes one ordinary adapter; nothing
  Copilot-specific is removed *except* the dead SDK bridge.
- **`AGENTS.md` is the canonical primary** per-project artifact; `copilot-instructions.md`,
  `CLAUDE.md`, `.cursorrules`, etc. are adapter views of the same neutral source.
- **Default = auto-detect** installed assistants; always emit `AGENTS.md` + MCP.
- **Remove `@github/copilot-sdk` + the `--copilot` flag** + the dead in-process bridge.

## Non-goals (YAGNI)

- **No new** slash-command/chatmode adapters for non-Copilot platforms — that is *adding*
  coverage, a separate "expand platform coverage" sub-project.
- No BrainStore / graph work (deferred — see end).
- No removal of any working adapter (Cursor/JetBrains/Neovim/Claude/Gemini/Copilot all stay).

## Architecture

### 1. Source → adapters
The neutral context bundle already lives in `.github/ai-os/context/*` (stack, architecture,
conventions). Rendering becomes a two-layer flow:
- **Canonical primary:** `AGENTS.md` (repo root) — the universal file agentic tools read.
- **Adapter views:** each assistant's native file is rendered from the same source:
  `copilot → .github/copilot-instructions.md` (+ kept `prompts.json`/chatmodes),
  `claude → CLAUDE.md`, `gemini → GEMINI.md`, `cursor → .cursorrules`,
  `jetbrains → .github/ai-os/jetbrains-ai-context.md`, `neovim → .github/ai-os/nvim-context.md`,
  `local → .github/ai-os/local-instructions.md`.
- **MCP** (`.github/ai-os/mcp-server/`, `.mcp.json` + `.vscode/mcp.json`) is assistant-agnostic —
  **always emitted**.

### 2. Adapter registry (the de-Copilot seam)
Introduce `generators/adapters/` with a registry. Each adapter implements:

```ts
interface AssistantAdapter {
  id: 'copilot' | 'claude' | 'gemini' | 'cursor' | 'jetbrains' | 'neovim' | 'local';
  detect(cwd: string): boolean;          // is this assistant in use in the repo?
  emit(ctx: RenderContext): GeneratedFile[]; // adapter view(s) of the neutral source
}
```

`multi-model.ts` and `multi-editor.ts` are refactored into registry entries. **Copilot becomes
one ordinary entry.** Core/apply code never references the string `"copilot"` except inside the
Copilot adapter — satisfying #272's "no provider names baked into engine code."

### 3. Auto-detection (the new default)
A detector returns the active adapter set from repo markers:
- Claude: `CLAUDE.md` or `.claude/`
- Cursor: `.cursor/` or `.cursorrules`
- Copilot: `.github/copilot-instructions.md` or `.github/copilot/`
- Gemini: `GEMINI.md` or `.gemini/`
- JetBrains: `.idea/`
- Neovim: `.config/nvim/` markers or explicit config
Always include `AGENTS.md` + MCP. **Explicit `--model`/`--editor`/`config.json` override
detection** (explicit wins). **No markers → universal baseline** (`AGENTS.md` + MCP only) plus a
printed hint on how to add a specific assistant. The resolved set persists to `config.json`.

### 4. CLI surface
- Default `model` changes from `'copilot'` to `'auto'` (`cli/args.ts:91`, `actions/init.ts:87`).
  `'auto'` runs detection. Explicit `--model <id>` / `--editor <id>` still force a specific set.
- The init wizard offers the detected set as the default selection (it already lists options).
- `--copilot` flag is **removed** (`mcp-server/index.ts`, arg parsing, docs).

## Removing the dead Copilot SDK coupling

- Delete the `--copilot` branch and the stub in-process bridge (`mcp-server/index.ts:64-156`);
  stdio MCP (`StdioServerTransport`) remains the sole, universal transport.
- Remove `@github/copilot-sdk` from `engine/package.json` dependencies and the esbuild `external`
  list (`scripts/bundle.mjs`). Regenerate `engine/package-lock.json` (keeping the @emnapi records).
- Remove `sync_hosted_memory`'s Copilot-SDK assumptions if any remain (it currently returns a
  manual-sync template — leave the tool, drop any Copilot-SDK references).

## Rebranding (to Cortex, assistant-neutral copy)

The brand target is **Cortex** (confirmed). This sub-project does the assistant-neutral *copy*
only; the full technical rename (package/CLI/paths/env) is a **separate sibling sub-project**
(see roadmap below) to avoid coupling a breaking migration to the Copilot demotion.

- `cli/dispatch.ts:28` banner → "Cortex — portable AI-assistant context engine".
- `package.json` `description` → Cortex, assistant-neutral (drop "GitHub Copilot").
- `actions/apply.ts` next-steps copy (e.g. `:372`) → reference `AGENTS.md` as primary, not
  `copilot-instructions.md`.
- README / engine docs references updated where they call the tool a "Copilot" engine.

## Backward compatibility / migration

- **Existing repos keep working.** Copilot is auto-detected from its existing
  `.github/copilot-instructions.md`/`.github/copilot/`, so `--refresh-existing` still emits the
  Copilot adapter **and** adds `AGENTS.md` as primary. The `manifest.json` tracks ownership so
  nothing is orphaned.
- **Config migration:** an existing `config.model: 'copilot'` is preserved as "Copilot in the
  adapter set" (no surprise drop). A missing/`'copilot'`-default config migrates to `'auto'` only
  when the user opts in on refresh (don't silently change a pinned choice).
- **User-authored `AGENTS.md`:** if a hand-written `AGENTS.md` exists (e.g. this repo's own
  manual), preserve user-authored regions — do not clobber. Reuse the existing
  preserve-user-authored-blocks behavior; engine-owned content lives in marked regions.
- **drift / freshness / doctor:** re-point the "primary artifact" reference from
  `copilot-instructions.md` to `AGENTS.md`; when a Copilot adapter is present, check it as an
  adapter (not the canonical).

## Error handling

- Detection is best-effort; a detector throwing for one assistant must not abort the run (skip +
  warn). No markers → baseline, never an error.
- Removing `@github/copilot-sdk`: ensure no remaining `import` of it (a test asserts this) so the
  bundle never references a missing optional dep.

## Testing

- **Re-point existing** (~8 files: `generators.test.ts`, `generators-extended.test.ts`,
  `examples.test.ts`, `doctor.test.ts`, `drift.test.ts`, `freshness.test.ts`,
  `multi-model.test.ts`, `multi-editor.test.ts`) — assert `AGENTS.md` is primary and the Copilot
  file is an adapter when Copilot is detected.
- **New tests:**
  - detection → adapter-set (each marker yields its adapter; none → baseline).
  - registry `emit` per adapter writes the expected file(s) from a fixed `RenderContext`.
  - explicit `--model`/`--editor`/config override detection.
  - `AGENTS.md` is always emitted; MCP is always emitted.
  - no `@github/copilot-sdk` import anywhere in `src` (grep/AST assert).
  - config migration: `'copilot'` preserved; default → `'auto'`.
  - drift/freshness/doctor treat `AGENTS.md` as canonical.

## Likely plan split (for writing-plans)

1. **Adapter registry + AGENTS.md canonical + auto-detection** (the architectural core; re-point
   drift/freshness/doctor + tests).
2. **Remove `@github/copilot-sdk` + `--copilot` + rebrand** (mechanical cleanup; lower risk).

---

## v2 sub-project roadmap (consolidated)

Tracking the full decomposition of #272 so scope stays explicit. Order is the recommended build
sequence; each gets its own spec → plan → implementation cycle.

1. **Auto session-end memory capture** — ✅ DONE this cycle (`reflect-session.mjs` SessionEnd hook
   → candidates queue → `/level-up` promotion). Will feed the new brain once it lands.
2. **AI-agnostic core (this spec)** — AGENTS.md canonical + auto-detected adapters; demote Copilot;
   remove dead `@github/copilot-sdk`; Cortex-branded copy.
3. **Cortex rename migration** — package/CLI (`ai-os`→`cortex`, `ai-os` alias),
   `.github/ai-os/`→`.github/cortex/` path migration, `AI_OS_*`→`CORTEX_*` env (with aliases),
   MCP server name (`mcp__ai-os__*`→`mcp__cortex__*`), workflow renames, and a migration for
   existing installs. Breaking — its own spec/plan.
4. **BrainStore foundation** — Obsidian-compatible Markdown vault as source of truth + rebuildable
   SQLite index (fast structured + vector search); doubles as the **wiki**. Flip personal brain
   live. (decisions captured below.)
5. **Embedding provider interface** + local impl → semantic search over the index.
6. **LLM/extraction provider interface** → text/sessions → vault notes + `[[wikilinks]]`.
7. **MCP transport seam + multi-agent memory tools** → stdio/HTTP behind a thin layer.
8. **Rewire per-repo project memory** onto the store; retire legacy JSONL.

(Sequencing of #2 vs #3 is open — they overlap on paths/branding; see the open question.)

---

## Captured decisions for the deferred BrainStore sub-project (#272 keystone)

Recorded so they survive until we brainstorm it next:

- **Store scope:** unify personal + project memory onto the graph store where feasible; fall back
  to personal-only if a deployment constraint forces it.
- **First sub-project boundary:** ship the store **and flip the personal brain live**
  (`promote_to_brain`, personal reads); per-repo project memory migrates later.
- **Graph representation = a plain-Markdown knowledge vault (Obsidian/Foam/Logseq-compatible) as
  the source of truth.** FREE and tool-agnostic: it is just Markdown files + `[[wikilinks]]` +
  frontmatter (an open format) — no dependency on the Obsidian app, no paid services (no Obsidian
  Sync/Publish). Viewable free in Obsidian, VS Code (Foam), Logseq, GitHub, or any Markdown tool.
  Notes = nodes, `[[wikilinks]]` = edges, frontmatter = `domain` / `tenant_id` / tags / status.
  The vault is sovereign plain files (git-friendly, human-editable); **Obsidian the app is an
  optional viewer** (free graph visualization → satisfies the v2 "visualization" sub-project), not
  a runtime dependency. The same Markdown vault **is the wiki** — browsable in Obsidian, on GitHub,
  or any Markdown wiki renderer; "graph brain" and "wiki" are one artifact viewed two ways.
- **Index = the `BrainStore` implementation, derived from the vault.** A rebuildable local index
  (default `node:sqlite`, Node ≥22; embeddings-as-BLOB + JS cosine kNN) provides fast structured +
  vector search; `rebuild()` reparses the vault. The vault is authoritative; the index is a
  disposable cache. The index impl stays swappable (local SQLite → Turso/libSQL / Postgres+pgvector)
  per #272's SaaS-readiness seam.
- **Invariant:** every `BrainStore` query is scoped by `tenant_id` + `domain`, enforced as a test.
- **Embeddings/LLM/transport** remain separate sub-projects behind their own provider interfaces.
