# Repository Intelligence Index — Design Spec

> **Date:** 2026-05-25
> **Author:** GitHub Copilot (autopilot)
> **Status:** Draft — Awaiting User Review
> **Scope:** A stack-agnostic repository indexing mechanism native to ai-os, powering
> context auto-generation, symbol search MCP tools, and (phase 2) spec traceability.

---

## Executive Summary

This spec introduces the **Repository Intelligence Index (RII)** — a persistent,
structured snapshot of any codebase stored in `.github/ai-os/context/repo-index.jsonl`.
It is built by a new `ai-os index` CLI command, works across every supported tech stack
through pluggable per-language extractor adapters, and serves three goals:

| Goal | Description | Phase |
|---|---|---|
| Context pipeline | Index drives architecture.md / stack.md auto-generation | 1 |
| Symbol search | `search_symbols` MCP tool queries the index | 1 |
| Spec traceability | `validate_spec_coverage` links specs to implementing code | 2 |

**Out of scope for this spec:**
- Vector/embedding search (requires external service; conflicts with "native ai-os" constraint)
- Monorepo multi-workspace support (#173 — separate spec)
- Skill marketplace / community registry (separate spec)

---

## Problem Statement

ai-os already detects languages (`language.ts`), frameworks (`framework.ts`), imports and
exports (`graph.ts`), and build tool patterns (`patterns.ts`). But:

1. These detectors run **on demand** during `init`/`generate` and are not persisted as a
   queryable artifact.
2. The generated context documents (`architecture.md`, `stack.md`) are **manually curated**
   after generation and drift silently as the codebase evolves.
3. The MCP `search_codebase` tool performs a **raw ripgrep text search** — it finds
   occurrences of strings, not semantic concepts like "all authentication functions".
4. Specs in `docs/superpowers/specs/` are **disconnected from code** — there is no machine-
   readable link between a spec requirement and the files that implement it.

The Repository Intelligence Index solves all four problems with a single persistent artifact
and a CI-friendly refresh command.

---

## Design

### Index Format: JSONL

Consistent with `memory.jsonl` convention, the index is a newline-delimited JSON file where
each line is a typed `RepoIndexEntry`. This makes it:
- **Git-friendly** — line-level diffs, easy code review
- **Streamable** — processable without loading the full file
- **Incrementally updatable** — append or replace individual entries

File location: `.github/ai-os/context/repo-index.jsonl`

```typescript
// All entry types share a discriminated union on `type`
type RepoIndexEntry =
  | MetaEntry
  | FileEntry
  | SymbolEntry
  | SpecEntry;

interface MetaEntry {
  type: 'meta';
  generatedAt: string;       // ISO 8601
  version: string;           // ai-os version that produced this
  primaryLanguage: string;
  primaryFramework: string | null;
  frameworks: string[];
  fileCount: number;
  symbolCount: number;
}

interface FileEntry {
  type: 'file';
  path: string;              // relative to repo root
  language: string;
  size: number;              // bytes
  hash: string;              // SHA-1 of content (for incremental indexing)
  purpose: string | null;    // first docstring/comment summary (≤ 120 chars)
  tags: string[];            // inferred from directory + file name + annotations
  exports: string[];         // symbol names exported from this file
}

interface SymbolEntry {
  type: 'symbol';
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'enum' | 'method';
  file: string;
  line: number;
  signature: string | null;  // e.g. "login(email: string, password: string): Promise<User>"
  tags: string[];
  specIds: string[];         // from @spec: <id> annotations on or above this symbol
}

interface SpecEntry {
  type: 'spec';
  specId: string;            // e.g. "AUTH-1"
  title: string;
  specFile: string;          // path to the .md spec file
  requirementCount: number;
  implementedBy: string[];   // file paths that reference this specId
  coverageRatio: number;     // implementedBy.length / requirementCount (0–1)
}
```

### Language Extractor Adapters

The "mechanism for every tech stack" is a `LanguageExtractor` interface. Each language gets
a lightweight adapter. New languages can be added by implementing the interface without
touching core indexing logic.

```typescript
// src/detectors/symbols.ts
export interface LanguageExtractor {
  language: string;
  extensions: string[];

  /** Extract exported symbols from source content. */
  extractSymbols(content: string, filePath: string): SymbolExtract[];

  /** Extract a one-line purpose comment/docstring from the file header. */
  extractPurpose(content: string): string | null;

  /** Infer semantic tags from content (e.g. 'auth', 'database', 'routing'). */
  extractTags(content: string, filePath: string): string[];
}

export interface SymbolExtract {
  name: string;
  kind: SymbolEntry['kind'];
  line: number;
  signature: string | null;
  specIds: string[];
}
```

**Phase 1 extractor adapters:**

| Language | Extraction source | Notes |
|---|---|---|
| TypeScript / JavaScript | Extend `parseExports()` in `graph.ts` | Already parses named exports + class/function keywords |
| Python | `def`/`class` + first docstring | Module docstring = file purpose |
| Go | `func`/`type` declarations with `package`-level visibility | Exported = uppercase first letter |
| Java | `public`/`protected` methods + class name | javadoc first line = purpose |
| Rust | `pub fn`/`pub struct`/`pub trait` | `///` doc comment |
| Ruby | `def`/`class` (module-level) | `# Description` comment |
| PHP | `function`/`class` (global + public class members) | PHPDoc `@summary` |

All other languages produce `FileEntry` records only (no symbols). A `null` extractor is
valid — the file is indexed without symbol-level detail.

### Spec Annotation Convention (Phase 2, documented here for forward compatibility)

Lightweight opt-in convention. No enforcement in Phase 1.

```typescript
// TypeScript example
// @spec: AUTH-1
export function login(email: string, password: string): Promise<User> { ... }
```

```python
# Python example
# @spec: DATA-3
def fetch_user(user_id: str) -> User:
    ...
```

```go
// Go example
// @spec: API-7
func HandleLogin(w http.ResponseWriter, r *http.Request) { ... }
```

Spec IDs are matched to `SpecEntry` records by parsing spec files for headings like
`### AUTH-1:` or `**AUTH-1**` — no external spec registry required.

---

## CLI Command: `ai-os index`

New command added to `src/cli/dispatch.ts`, implemented in `src/actions/index.ts`.

```
ai-os index [options]

  --output <path>       Output file (default: .github/ai-os/context/repo-index.jsonl)
  --incremental         Only re-index files whose SHA-1 hash has changed
  --regen-context       After indexing, regenerate architecture.md and stack.md from index
  --dry-run             Print index to stdout; do not write to disk
  --quiet               Suppress progress output
```

**Processing pipeline:**

```
Walk source files
  → for each file: detect language → select extractor adapter
  → if incremental: skip unchanged files (compare hash)
  → run extractor: symbols + purpose + tags
  → emit FileEntry + SymbolEntries
→ emit MetaEntry (summary counts)
→ write repo-index.jsonl
→ if --regen-context: invoke index-docs generator
→ print summary (N files indexed, M symbols extracted, P specs mapped)
```

**Incremental indexing** uses the `hash` field in existing `FileEntry` records.
On subsequent runs, files with unchanged SHA-1 are skipped — only changed/new/deleted
files are re-processed. This keeps CI re-indexing fast (seconds, not minutes).

**Exit codes:**
- `0` — index written successfully
- `1` — unexpected error
- `2` — recoverable error (uses `AiOsError` with `fix` suggestion)

---

## Context Auto-Generation Pipeline

When `--regen-context` is passed, the index drives regeneration of two context documents.
This is **opt-in** to preserve the existing `preserveContextFiles` safe-mode behaviour.
A future `AiOsConfig.repoIndexAutoRegen: boolean` flag (default: `false`) will allow
persistent opt-in via `config.json`, but that is deferred to Phase 2.

### New generator: `src/generators/index-docs.ts`

Produces two documents from index data:

**`architecture.md`** sections regenerated from index:
- "Languages" — from `MetaEntry.frameworks` + language distribution
- "Top-level modules" — from `FileEntry.tags` grouped by directory
- "Dependency depth" — from existing `dependency-graph.json`
- "Key files" — FileEntry records with `exports.length > 5` or high `importedBy` count

**`stack.md`** sections regenerated from index:
- "Primary language" — `MetaEntry.primaryLanguage`
- "Frameworks" — `MetaEntry.frameworks`
- "Package manager" — from `patterns.ts` output (already in existing stack detector)
- "Test framework", "Linter", "Formatter" — from `patterns.ts` output

Manual sections (preserved):
- `## Architecture decisions` — curated; never overwritten
- `## Conventions` — curated; never overwritten
- Any section wrapped in `<!-- protected -->` markers (uses existing `protected-blocks.ts`)

---

## New MCP Tools (Phase 1)

### `search_symbols`

Queries the repo-index.jsonl for symbols matching a name, kind, or language filter.

```typescript
// Input schema
{
  query: string;         // name substring or keyword (case-insensitive)
  kind?: SymbolEntry['kind'];
  language?: string;
  limit?: number;        // default 20
}

// Output: formatted list of matching symbols with file + line
```

**Example queries:**
- `search_symbols({ query: "login" })` → finds `login()` in auth.ts, login_handler.py, etc.
- `search_symbols({ query: "User", kind: "class" })` → finds all `User` class definitions
- `search_symbols({ query: "validate", language: "TypeScript" })` → TS validate* functions

### `get_file_purpose`

Returns the purpose string and tags for a file from the index.

```typescript
// Input: { path: string }
// Output: { purpose: string | null; tags: string[]; exports: string[]; language: string }
```

This is a fast index lookup — no file read required.

---

## New MCP Tools (Phase 2 — Spec Traceability)

### `validate_spec_coverage`

Reads all `SpecEntry` records from the index and reports:
- Specs with `coverageRatio === 0` (no implementing code found)
- Specs with `coverageRatio < 0.5` (partially implemented)
- Total coverage percentage

```typescript
// Input: { specDir?: string } (default: docs/superpowers/specs/)
// Output: formatted coverage report
```

### `get_spec_for_file`

Given a file path, returns all specs it contributes to (via `@spec:` annotations or
matching `SpecEntry.implementedBy`).

---

## CI Workflow: `ai-os-index.yml`

New workflow in `.github/workflows/ai-os-index.yml`:

```yaml
name: AI OS — Repository Index

on:
  push:
    branches: [master, dev]
    paths-ignore:
      - '.github/ai-os/**'   # avoid self-triggering on index updates
      - 'docs/**'
      - '*.md'

jobs:
  index:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npx ai-os index --incremental
      - name: Commit updated index
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add .github/ai-os/context/repo-index.jsonl
          git diff --staged --quiet || git commit -m "chore: update repo-index [skip ci]"
          git push
```

**`[skip ci]`** prevents re-triggering. The index commit only touches
`.github/ai-os/context/repo-index.jsonl` (paths-ignore above prevents loops).

---

## Files Changed

| File | Status | Notes |
|---|---|---|
| `src/actions/index.ts` | New | `indexRepo()` action — main pipeline |
| `src/detectors/symbols.ts` | New | `LanguageExtractor` interface + 7 adapters |
| `src/generators/index-docs.ts` | New | Regenerates architecture.md + stack.md from index |
| `src/cli/dispatch.ts` | Modified | Route `index` command → `indexRepo()` |
| `src/mcp-server/sdk-server.ts` | Modified | Register `search_symbols`, `get_file_purpose` tools |
| `src/mcp-server/search.ts` | Modified | `searchSymbols()` reads repo-index.jsonl |
| `src/types.ts` | Modified | Add `RepoIndexEntry`, `LanguageExtractor`, `SymbolExtract` types |
| `src/mcp-tools.ts` | Modified | Add `search_symbols`, `get_file_purpose` tool definitions |
| `.github/workflows/ai-os-index.yml` | New | CI indexing workflow |
| `src/tests/indexer.test.ts` | New | Unit tests for index pipeline |
| `src/tests/symbol-extractors.test.ts` | New | Unit tests for all 7 language adapters |
| `docs/mcp-tools.md` | Modified | Document new MCP tools |

---

## Non-Goals

- **No vector embeddings** — search is keyword/substring over the JSONL index, consistent
  with the existing ripgrep-based `search_codebase` approach.
- **No AST parsers** — extractors use regex over source text. Fast, zero-dependency, good
  enough for symbol names + signatures. LSP-quality analysis is a future phase.
- **No breaking changes** — `search_codebase` remains unchanged; `search_symbols` is
  additive. Existing drift/freshness detection is unaffected.

---

## Acceptance Criteria

1. `npx ai-os index` runs on a TypeScript repo and produces a valid `repo-index.jsonl`
2. `npx ai-os index --incremental` skips unchanged files on a second run
3. `search_symbols({ query: "login" })` MCP tool returns results from the index
4. `get_file_purpose("src/auth.ts")` returns a non-null purpose for a file with a docstring
5. `npx ai-os index --regen-context` regenerates `architecture.md` with accurate language/
   framework data and preserves manually-curated `## Architecture decisions` sections
6. CI workflow runs without error on a sample push
7. All new unit tests pass; coverage thresholds maintained
8. All 7 language extractors tested with sample source strings (no real files needed)

---

## Open Questions

None — spec is self-contained. Phase 2 (spec traceability) will be a follow-up spec
once Phase 1 is validated in production.
