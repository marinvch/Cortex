# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev                   # Run generate.ts via tsx (no build step)
npm run build                 # TypeScript compile (tsc)
npm run bundle                # esbuild bundles: bundle/generate.js + bundle/server.js

# Testing
npm test                      # vitest run (all tests)
npm run test:watch            # vitest in watch mode
npm run test:coverage         # vitest with coverage

# Run a single test file
npx vitest run src/tests/analyze.test.ts

# Quality checks
npm run lint                  # eslint src/**/*.ts
npm run lint:fix              # eslint --fix
npm run typecheck             # tsc --noEmit
npm run ci                    # typecheck + lint + test (pre-push gate)

# Generation pipeline
npm run generate              # Run against cwd
npm run generate:dry          # Preview without writing (--dry-run)
npm run generate:refresh      # Refresh all AI OS artifacts (--refresh-existing)

# Maintenance
npm run check-hygiene         # Validate generated artifact integrity
npm run doctor                # Diagnostics on installed AI OS state
npm run validate              # Regression test against example repos
```

## Architecture

ai-os is a CLI tool that scans any repository, detects its tech stack, and generates optimised AI context files for GitHub Copilot, Claude Code, and other assistants. It also ships a bundled MCP server that the generated `.vscode/mcp.json` wires into the IDE.

### Pipeline overview

```
generate.ts
  └── cli/dispatch.ts          # parses args, routes to actions
        └── actions/apply.ts   # orchestrates the full generation pipeline
              ├── analyze.ts   # detects stack (languages, frameworks, patterns)
              ├── generators/  # one module per output artifact type
              └── mcp-server/  # MCP server runtime (separate bundle target)
```

**`analyze.ts → DetectedStack`** is the central data contract. Every generator receives a `DetectedStack` and writes files into `.github/` of the target repo. The `AiOsConfig` persisted at `.github/ai-os/config.json` carries user-editable feature flags that survive regeneration.

### Detection layer (`src/detectors/`)

| Module | Responsibility |
|--------|---------------|
| `language.ts` | File-count based language percentages |
| `framework.ts` | Dependency-key matching against a known-framework registry |
| `patterns.ts` | Naming conventions, test framework, linter, package manager |
| `graph.ts` | Import dependency graph for the repo intelligence index |
| `drift.ts` | Detects context drift between generated artifacts and source |
| `freshness.ts` | Snapshot-based freshness scoring |

### Generator layer (`src/generators/`)

Each generator is a pure function `(stack: DetectedStack, cwd: string, opts?) → string[]` returning the list of written absolute paths. All disk writes go through `writeIfChanged()` (skips write if content unchanged) and `writeFileAtomic()`.

| Generator | Primary output |
|-----------|---------------|
| `instructions.ts` | `.github/copilot-instructions.md`, path-specific `.instructions.md` files |
| `context-docs.ts` | `.github/ai-os/config.json`, dependency graph, session context card |
| `mcp.ts` | `.github/ai-os/tools.json`, `.vscode/mcp.json` |
| `agents.ts` | `.github/agents/*.agent.md` (sequential agent flow) |
| `skills.ts` | `.github/skills/`, `.github/copilot/skills/` |
| `prompts.ts` | `.github/copilot/prompts/` |
| `workflows.ts` | `.github/workflows/` |
| `multi-model.ts` | `adaptForClaude()`, `adaptForGemini()`, `adaptForLocal()` — adapts Markdown instructions for each model target |
| `multi-editor.ts` | Cursor, JetBrains, Neovim companion config files |

### MCP server (`src/mcp-server/`)

The MCP server is a separate esbuild entry point (`src/mcp-server/index.ts`) that produces `bundle/server.js`. At install time `apply.ts` copies this bundle into the target repo under `.github/ai-os/mcp-server/index.js` and writes `.vscode/mcp.json` pointing to it.

The server uses `@modelcontextprotocol/sdk` over stdio by default. Tool definitions live in `src/mcp-tools.ts` (the shared catalog) and `src/mcp-server/tool-definitions.ts` reads them at runtime so the generated `tools.json` and the live `tools/list` response always agree.

### Key types (`src/types.ts`)

- `DetectedStack` — output of `analyze()`, the root context for all generators
- `AiOsConfig` — persisted user config at `.github/ai-os/config.json`
- `InstallProfile` — `'minimal' | 'standard' | 'full'`, controls generation density
- `AgentRegistryEntry` / `AgentRegistry` — A2A-style agent cards written to `agents.json`
- `RepoIndexEntry` — union of `MetaIndexEntry | FileIndexEntry | SymbolIndexEntry | SpecIndexEntry` used by the repository intelligence index

### Protection and merging

`apply.ts` reads `.github/ai-os/protect.json` before generation:
- **protected** — files are never overwritten or pruned
- **hybrid** — files are regenerated but `<!-- AI-OS:USER_BLOCK:START id="..." -->` sections authored by users are extracted, then re-inserted after generation via `mergeUserBlocks()` in `src/user-blocks.ts`

### Build outputs

| Path | Content |
|------|---------|
| `bundle/generate.js` | CLI entrypoint (used by `npx ai-os`) |
| `bundle/server.js` | MCP server (copied into target repos at install time) |
| `dist/` | TypeScript compiler output (intermediate, not shipped) |

The `bundle/` files are esbuild single-file bundles that include all dependencies except `@github/copilot-sdk` (marked external — only needed for `--copilot` mode).
