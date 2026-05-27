# Spec Traceability — Design Spec (RII Phase 2)

> **Date:** 2026-05-27
> **Author:** GitHub Copilot (brainstorming session)
> **Status:** Approved — Ready for Implementation
> **Scope:** Phase 2 of the Repository Intelligence Index. Links spec documents to
> implementing code via auto-assigned IDs and lightweight `@spec:` annotations.
> Reporting only — no CI enforcement.

---

## Executive Summary

A developer writes `// @spec: REPO-INTEL-1` above a function. Running `ai-os --index`
connects that annotation to the corresponding heading in
`docs/superpowers/specs/2026-05-25-repo-intelligence-index-design.md`. The MCP tool
`validate_spec_coverage` then shows which spec requirements have implementing code and
which are still gaps — without any external registry, database, or CI gate.

**Value delivered:**
- Know which specs are fully implemented vs. partially vs. not started
- Navigate from a file to its spec requirements (and vice versa)
- Works across TypeScript, JavaScript, Python, Go, Java, Rust, Ruby, PHP

---

## Problem Statement

ai-os has a growing library of design specs in `docs/superpowers/specs/`. After Phase 1,
the repo index tracks every symbol and file. But:

1. There is no machine-readable link between a spec requirement and the code that
   implements it. The only way to know if `REPO-INTEL-1` is implemented is to read both
   the spec and the code manually.
2. The `SpecEntry` type was already drafted in Phase 1 and the `specIds: string[]` field
   already exists on `SymbolExtract` — Phase 2 is the implementation that populates them.

---

## Design

### Spec ID Generation

Spec IDs are auto-assigned from spec file names and their heading structure. No manual
ID maintenance is needed.

**Filename → prefix rules:**

| Spec file | Generated prefix | Example ID |
|---|---|---|
| `2026-05-25-repo-intelligence-index-design.md` | `REPO-INTEL` | `REPO-INTEL-1` |
| `2026-05-11-a2a-orchestrator-design.md` | `A2A-ORCH` | `A2A-ORCH-3` |
| `2026-05-25-prompt-booster-design.md` | `PROMPT-BOOST` | `PROMPT-BOOST-2` |
| `2026-05-27-spec-traceability-design.md` | `SPEC-TRACE` | `SPEC-TRACE-1` |

**Algorithm:**
1. Strip leading date (`YYYY-MM-DD-`) and trailing `-design` from filename
2. Split remaining slug on `-` → word array
3. Keep max 2 words → uppercase → join with `-`
4. Number each H2/H3 heading in document order starting at 1

IDs are **stable across index runs** — adding/removing headings changes only the numbers
of headings after the edit. Renaming the spec file changes the prefix (treat as a new
spec, not an update).

**Headings included:** H2 (`##`) and H3 (`###`) headings only. H1 (title) and H4+ are
skipped. Headings inside code fences are ignored.

### Code Annotation Convention

A single consistent format across all 7 supported languages:

```typescript
// TypeScript / JavaScript
// @spec: REPO-INTEL-3
export function indexRepo(options: IndexOptions): Promise<IndexResult> { ... }
```

```python
# Python
# @spec: PROMPT-BOOST-2
def boost_prompt(raw_prompt: str) -> BoostedPrompt:
    ...
```

```go
// Go
// @spec: A2A-ORCH-1
func RunOrchestrator(ctx context.Context) error { ... }
```

```java
// Java
// @spec: SPEC-TRACE-1
public class SpecParser { ... }
```

```rust
// Rust
// @spec: REPO-INTEL-5
pub fn search_symbols(query: &str) -> Vec<SymbolEntry> { ... }
```

```ruby
# Ruby
# @spec: SPEC-TRACE-2
def validate_coverage(spec_dir)
```

```php
// PHP
// @spec: A2A-ORCH-4
function handleAgentMessage($payload) { ... }
```

**Detection rules:**
- Annotation must appear on the line immediately preceding the symbol declaration
- Multiple `@spec:` annotations on consecutive lines are all captured
- Case-insensitive match: `@Spec:` and `@SPEC:` are accepted
- Unknown IDs (no matching SpecEntry) are stored but flagged as `unmatched: true` in output

### SpecEntry Format

The `SpecEntry` type was already drafted in Phase 1 `src/types.ts`. This phase implements
it with the auto-ID approach:

```typescript
// src/types.ts — SpecIndexEntry (already declared, Phase 2 populates it)
interface SpecIndexEntry {
  type: 'spec';
  specId: string;            // e.g. "REPO-INTEL-3" — ONE entry per H2/H3 heading
  title: string;             // heading text, e.g. "CLI Command: ai-os index"
  specFile: string;          // relative path to .md spec file
  requirementCount: number;  // total H2/H3 headings in the parent spec file (for grouping)
  implementedBy: string[];   // file paths containing // @spec: REPO-INTEL-3
  coverageRatio: number;     // 1.0 if implementedBy.length > 0, else 0.0
}
```

**One `SpecIndexEntry` per heading.** `coverageRatio` is per-requirement: `1.0` (annotated)
or `0.0` (not annotated). The `validate_spec_coverage` MCP tool aggregates per spec file:

```
per-spec coverage = entries with coverageRatio === 1.0 / total entries for that spec file
```

Example: spec with 12 headings, 8 annotated → `8/12 = 67%`.

---

## New Module: `src/generators/spec-parser.ts`

Single-purpose module. No external dependencies.

```typescript
export interface ParsedSpec {
  specId: string;
  title: string;
  specFile: string;
  requirementCount: number;
}

/**
 * Parse all spec markdown files in specDir.
 * Returns one ParsedSpec per H2/H3 heading per file.
 */
export function parseSpecFiles(specDir: string): ParsedSpec[];

/**
 * Derive the spec prefix from a spec filename.
 * e.g. "2026-05-25-repo-intelligence-index-design.md" → "REPO-INTEL"
 */
export function deriveSpecPrefix(filename: string): string;
```

**Implementation notes:**
- Reads files with `fs.readFileSync` (sync, no streaming needed — spec files are small)
- Uses regex to strip code fences before heading extraction
- Returns empty array if `specDir` does not exist (graceful degradation)
- No external markdown parser — simple regex over `^#{2,3}\s+(.+)$`

---

## Indexer Updates: `src/actions/index.ts`

The `indexRepo()` pipeline gets a new **spec scan step** inserted after symbol extraction:

```
Walk source files → extract symbols (existing)
  ↓
Scan spec files → parseSpecFiles(specDir)          ← NEW
  ↓
Match @spec: annotations → populate implementedBy   ← NEW
  ↓
Emit SpecEntry records                              ← NEW
  ↓
Write repo-index.jsonl (now includes SpecEntries)
```

The spec directory defaults to `docs/superpowers/specs/` relative to repo root.
Configurable via `--spec-dir <path>` CLI flag (additive — no existing flags change).

---

## Language Adapter Updates: `src/detectors/symbols.ts`

Each of the 7 language adapters gets a `@spec:` regex scan added to `extractSymbols()`.
The `specIds: string[]` field already exists on `SymbolExtract`.

Pattern added to each adapter:
```
/^\s*(?:\/\/|#)\s*@spec:\s*([A-Z][A-Z0-9-]+)/im
```

Detection is applied to the line(s) immediately preceding each symbol declaration.
Each adapter already iterates over source lines for symbol extraction — the annotation
scan piggybacks on the same loop.

---

## New MCP Tools

### `validate_spec_coverage`

Reports coverage for all specs in the index.

```typescript
// Input schema
{
  specDir?: string;   // default: "docs/superpowers/specs/"
  showAll?: boolean;  // default false — only shows gaps (coverageRatio < 1)
}

// Output (formatted text)
// Spec Coverage Report
// ─────────────────────────────────────────────────────
// REPO-INTEL    repo-intelligence-index-design.md   8/12 reqs  67%  ⚠
// SPEC-TRACE    spec-traceability-design.md          0/8  reqs   0%  ✗
// PROMPT-BOOST  prompt-booster-design.md            3/3  reqs 100%  ✓
// A2A-ORCH      a2a-orchestrator-design.md           0/9  reqs   0%  ✗
// ─────────────────────────────────────────────────────
// Overall: 11/32 requirements annotated (34%)
```

### `get_spec_for_file`

Returns spec IDs annotated in a specific file.

```typescript
// Input schema
{ path: string }  // relative to repo root

// Output (formatted text)
// src/actions/index.ts contributes to:
//   REPO-INTEL-3  — CLI Command: ai-os index
//   REPO-INTEL-5  — Incremental indexing
//   SPEC-TRACE-2  — Indexer Updates
```

---

## Files Changed

| File | Status | Notes |
|---|---|---|
| `src/generators/spec-parser.ts` | **New** | Parse spec markdown; derive IDs |
| `src/detectors/symbols.ts` | **Modify** | Add `@spec:` regex to all 7 adapters |
| `src/actions/index.ts` | **Modify** | Add spec scan + SpecEntry emission step |
| `src/types.ts` | **Modify** | Add `SpecEntry` type (already drafted in Phase 1) |
| `src/mcp-server/search.ts` | **Modify** | Add `validateSpecCoverage()`, `getSpecForFile()` |
| `src/mcp-server/sdk-server.ts` | **Modify** | Register `validate_spec_coverage`, `get_spec_for_file` |
| `src/mcp-tools.ts` | **Modify** | Add tool definitions for 2 new tools |
| `src/tests/spec-traceability.test.ts` | **New** | Unit tests (spec parser + adapter annotations) |

---

## Non-Goals

- **No CI enforcement** — reporting only; coverage gaps never block a build
- **No AST parsing** — annotation detection uses regex, consistent with Phase 1
- **No external spec registry** — IDs derived entirely from file names + headings
- **No retroactive annotation** — existing code is not auto-annotated; developers opt in
- **No spec coverage threshold in config.json** — deferred to a possible Phase 3
- **No monorepo multi-workspace** — single repo root, consistent with Phase 1

---

## Acceptance Criteria

1. `ai-os --index` on a TypeScript repo with annotated symbols produces `SpecEntry` records
   in `repo-index.jsonl`
2. `deriveSpecPrefix("2026-05-25-repo-intelligence-index-design.md")` → `"REPO-INTEL"`
3. `parseSpecFiles("docs/superpowers/specs/")` returns one entry per H2/H3 heading per file
4. `validate_spec_coverage` MCP tool returns a formatted coverage report
5. `get_spec_for_file("src/actions/index.ts")` returns matching spec IDs
6. All 7 language adapters detect `// @spec: ID` (or `# @spec: ID`) annotations
7. Unknown spec IDs in code annotations produce an `unmatched: true` warning, not an error
8. `spec-parser.ts` returns empty array gracefully when `specDir` does not exist
9. All new unit tests pass; 614+ total tests green
