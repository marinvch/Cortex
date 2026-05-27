# Spec Traceability (RII Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link spec markdown files to implementing code via `@spec:` annotations and expose coverage reporting through two new MCP tools.

**Architecture:** A new `spec-parser.ts` module parses spec files and auto-assigns stable IDs from filenames + heading order. The `indexRepo()` pipeline gains a spec scan step that matches those IDs against `@spec:` annotations already captured by `parseSpecIds()` (already live in `symbols.ts`). Two new MCP tools (`validate_spec_coverage`, `get_spec_for_file`) query the emitted `SpecIndexEntry` records.

**Tech Stack:** TypeScript, Node.js `fs`, Vitest, `@modelcontextprotocol/sdk`, Zod.

---

## Key Codebase Facts (read before touching code)

- `parseSpecIds()` in `src/detectors/symbols.ts` **already captures** `@spec: ID` annotations — no changes needed to `symbols.ts`.
- `SpecIndexEntry` **already declared** in `src/types.ts` lines 282–290 — no changes needed to `types.ts`.
- `specIds: string[]` **already flows** from `SymbolExtract` → `SymbolIndexEntry` in `src/actions/index.ts` line 158.
- `src/mcp-server/utils.ts` re-exports `export * from './search.js'` — new functions in `search.ts` are automatically available in `sdk-server.ts` imports.
- All tools registered in `sdk-server.ts` must also be mirrored in `src/mcp-tools.ts`.
- Default spec dir: `docs/superpowers/specs/` relative to repo root.
- Run with: `npm run build && npm run test`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/generators/spec-parser.ts` | **Create** | `deriveSpecPrefix()` + `parseSpecFiles()` |
| `src/tests/spec-traceability.test.ts` | **Create** | All unit + integration tests |
| `src/cli/args.ts` | **Modify** | Add `specDir?: string` to `ParsedArgs` + `--spec-dir` flag |
| `src/actions/index.ts` | **Modify** | Add `specDir?` to `IndexOptions`, `buildSpecEntries()` helper, emit `SpecIndexEntry` records |
| `src/cli/dispatch.ts` | **Modify** | Pass `specDir` to `indexRepo()` |
| `src/mcp-server/search.ts` | **Modify** | Add `validateSpecCoverage()` + `getSpecForFile()` |
| `src/mcp-server/sdk-server.ts` | **Modify** | Register tools #42 and #43 |
| `src/mcp-tools.ts` | **Modify** | Add tool definitions #42 and #43 |

---

## Task 1: Write failing tests for `spec-parser.ts`

**Files:**
- Create: `src/tests/spec-traceability.test.ts`

- [ ] **Step 1.1: Create the test file**

```typescript
// src/tests/spec-traceability.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveSpecPrefix, parseSpecFiles } from '../generators/spec-parser.js';
import type { SpecIndexEntry, RepoIndexEntry } from '../types.js';

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-trace-test-'));
}
function write(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

// ── deriveSpecPrefix ──────────────────────────────────────────────────────────

describe('deriveSpecPrefix', () => {
  it.each([
    ['2026-05-25-repo-intelligence-index-design.md', 'REPO-INTEL'],
    ['2026-05-11-a2a-orchestrator-design.md', 'A2A-ORCH'],
    ['2026-05-25-prompt-booster-design.md', 'PROMPT-BOOST'],
    ['2026-05-27-spec-traceability-design.md', 'SPEC-TRACE'],
    ['2026-01-01-single-design.md', 'SINGLE'],
    ['plain.md', 'PLAIN'],
  ])('%s → %s', (input: string, expected: string) => {
    expect(deriveSpecPrefix(input)).toBe(expected);
  });
});

// ── parseSpecFiles ────────────────────────────────────────────────────────────

describe('parseSpecFiles', () => {
  it('returns [] when specDir does not exist', () => {
    expect(parseSpecFiles('/this/path/does/not/exist')).toEqual([]);
  });

  it('returns one entry per H2/H3 heading in document order', () => {
    const tmp = makeTmp(); dirs.push(tmp);
    write(tmp, 'specs/2026-01-01-my-feature-design.md', [
      '# My Feature',
      '## Overview',
      '## API Shape',
      '### Sub-section',
      '#### H4 is ignored',
    ].join('\n'));
    const results = parseSpecFiles(path.join(tmp, 'specs'));
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ specId: 'MY-FEAT-1', title: 'Overview', requirementCount: 3 });
    expect(results[1]).toMatchObject({ specId: 'MY-FEAT-2', title: 'API Shape', requirementCount: 3 });
    expect(results[2]).toMatchObject({ specId: 'MY-FEAT-3', title: 'Sub-section', requirementCount: 3 });
  });

  it('ignores headings inside code fences', () => {
    const tmp = makeTmp(); dirs.push(tmp);
    write(tmp, 'specs/2026-01-01-example-design.md', [
      '## Real Heading',
      '```',
      '## Fake Heading inside fence',
      '```',
      '## Another Real Heading',
    ].join('\n'));
    const results = parseSpecFiles(path.join(tmp, 'specs'));
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ specId: 'EXAMPLE-1', title: 'Real Heading' });
    expect(results[1]).toMatchObject({ specId: 'EXAMPLE-2', title: 'Another Real Heading' });
  });

  it('processes multiple spec files sorted alphabetically by filename', () => {
    const tmp = makeTmp(); dirs.push(tmp);
    write(tmp, 'specs/2026-01-02-beta-design.md', '## Beta Req\n## Beta Req 2');
    write(tmp, 'specs/2026-01-01-alpha-design.md', '## Alpha Req');
    const results = parseSpecFiles(path.join(tmp, 'specs'));
    expect(results[0]).toMatchObject({ specId: 'ALPHA-1', specFile: '2026-01-01-alpha-design.md' });
    expect(results[1]).toMatchObject({ specId: 'BETA-1', specFile: '2026-01-02-beta-design.md' });
    expect(results[2]).toMatchObject({ specId: 'BETA-2', specFile: '2026-01-02-beta-design.md' });
  });

  it('returns [] for a spec file with no H2/H3 headings', () => {
    const tmp = makeTmp(); dirs.push(tmp);
    write(tmp, 'specs/2026-01-01-empty-design.md', '# Only H1\n#### Only H4');
    expect(parseSpecFiles(path.join(tmp, 'specs'))).toHaveLength(0);
  });
});
```

- [ ] **Step 1.2: Run the tests to verify they fail (module not found)**

```
npm run test -- --reporter=verbose src/tests/spec-traceability.test.ts
```

Expected: FAIL — `Cannot find module '../generators/spec-parser.js'`

---

## Task 2: Implement `src/generators/spec-parser.ts`

**Files:**
- Create: `src/generators/spec-parser.ts`

- [ ] **Step 2.1: Create the module**

```typescript
/**
 * spec-parser.ts — Parses spec markdown files and derives stable spec IDs.
 *
 * Part of the Repository Intelligence Index (RII) Phase 2.
 * No external dependencies — regex over file content only.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface ParsedSpec {
  /** Stable ID, e.g. "REPO-INTEL-3". One per H2/H3 heading. */
  specId: string;
  /** Heading text, e.g. "CLI Command: ai-os index". */
  title: string;
  /** Basename of spec file, e.g. "2026-05-25-repo-intelligence-index-design.md". */
  specFile: string;
  /** Total H2/H3 headings in this file (for context display). */
  requirementCount: number;
}

/**
 * Derives the spec ID prefix from a spec filename.
 * "2026-05-25-repo-intelligence-index-design.md" → "REPO-INTEL"
 */
export function deriveSpecPrefix(filename: string): string {
  const base = path.basename(filename, '.md');
  const slug = base
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')  // strip YYYY-MM-DD-
    .replace(/-design$/, '');             // strip trailing -design
  const words = slug.split('-').filter(Boolean);
  return words.slice(0, 2).join('-').toUpperCase();
}

/**
 * Parses all .md files in specDir and returns one ParsedSpec per H2/H3 heading per file.
 * Returns [] gracefully when specDir does not exist.
 */
export function parseSpecFiles(specDir: string): ParsedSpec[] {
  if (!fs.existsSync(specDir)) return [];

  let files: string[];
  try {
    files = fs.readdirSync(specDir).filter(f => f.endsWith('.md')).sort();
  } catch {
    return [];
  }

  const results: ParsedSpec[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(specDir, file), 'utf-8');
    } catch {
      continue;
    }

    const prefix = deriveSpecPrefix(file);
    const headings = extractHeadings(content);

    for (let i = 0; i < headings.length; i++) {
      results.push({
        specId: `${prefix}-${i + 1}`,
        title: headings[i] ?? '',
        specFile: file,
        requirementCount: headings.length,
      });
    }
  }

  return results;
}

/** Extracts H2/H3 heading text, ignoring content inside code fences. */
function extractHeadings(content: string): string[] {
  const stripped = content.replace(/```[\s\S]*?```/g, '');
  const re = /^#{2,3}\s+(.+)$/gm;
  const headings: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const text = m[1]?.trim();
    if (text) headings.push(text);
  }
  return headings;
}
```

- [ ] **Step 2.2: Run the spec-parser tests**

```
npm run test -- --reporter=verbose src/tests/spec-traceability.test.ts
```

Expected: all `deriveSpecPrefix` and `parseSpecFiles` tests PASS (integration tests for `indexRepo` will still fail — that's expected).

- [ ] **Step 2.3: Commit**

```bash
git add src/generators/spec-parser.ts src/tests/spec-traceability.test.ts
git commit -m "feat(spec-trace): add spec-parser module with tests"
```

---

## Task 3: Add `--spec-dir` CLI flag

**Files:**
- Modify: `src/cli/args.ts`

- [ ] **Step 3.1: Add `specDir` to `ParsedArgs` and `parseArgs()`**

In `src/cli/args.ts`, find the `ParsedArgs` interface and add after `incremental: boolean;`:

```typescript
  specDir: string | undefined;
```

Find `let incremental = false;` and add after it:

```typescript
  let specDir: string | undefined = undefined;
```

Find the block `} else if (args[i] === '--incremental') {` and add after its closing `}`:

```typescript
    } else if (args[i] === '--spec-dir' && args[i + 1]) {
      specDir = path.resolve(args[i + 1] as string);
      i++;
    } else if (args[i]?.startsWith('--spec-dir=')) {
      specDir = path.resolve(args[i].slice('--spec-dir='.length));
```

Find the return statement and add `specDir` to it (after `incremental`):

```typescript
  return { cwd, dryRun, mode, action, prune, verbose, cleanUpdate, regenerateContext,
           pruneCustomArtifacts, profile, json, fullDiff, editorTargets, model,
           incremental, specDir };
```

- [ ] **Step 3.2: Run the existing CLI args tests**

```
npm run test -- --reporter=verbose src/tests/cli-args.test.ts
```

Expected: all existing CLI args tests PASS (no regressions).

- [ ] **Step 3.3: Commit**

```bash
git add src/cli/args.ts
git commit -m "feat(spec-trace): add --spec-dir CLI flag"
```

---

## Task 4: Update `indexRepo()` to emit `SpecIndexEntry` records

**Files:**
- Modify: `src/actions/index.ts`

- [ ] **Step 4.1: Add the spec scan step**

At the top of `src/actions/index.ts`, add to the existing imports block:

```typescript
import { parseSpecFiles } from '../generators/spec-parser.js';
import type { SpecIndexEntry } from '../types.js';
```

Add `specDir?: string` to `IndexOptions` (after `quiet?: boolean`):

```typescript
  /** Directory containing spec .md files. Defaults to docs/superpowers/specs/. */
  specDir?: string;
```

Add `buildSpecEntries` function at the bottom of the file (before or after `inferLanguage`):

```typescript
function buildSpecEntries(
  specDirPath: string,
  allSymbols: SymbolIndexEntry[],
): SpecIndexEntry[] {
  const parsed = parseSpecFiles(specDirPath);
  if (parsed.length === 0) return [];

  // Map specId (normalised uppercase) → set of files that annotate it
  const implementedByMap = new Map<string, Set<string>>();
  for (const sym of allSymbols) {
    for (const specId of sym.specIds) {
      const normalized = specId.toUpperCase();
      if (!implementedByMap.has(normalized)) {
        implementedByMap.set(normalized, new Set<string>());
      }
      implementedByMap.get(normalized)!.add(sym.file);
    }
  }

  return parsed.map(p => {
    const implementedBy = [...(implementedByMap.get(p.specId) ?? [])];
    return {
      type: 'spec' as const,
      specId: p.specId,
      title: p.title,
      specFile: p.specFile,
      requirementCount: p.requirementCount,
      implementedBy,
      coverageRatio: implementedBy.length > 0 ? 1.0 : 0.0,
    };
  });
}
```

- [ ] **Step 4.2: Add spec scan in `indexRepo()` after the file scanning loop**

In `indexRepo()`, find the line:

```typescript
  const allEntries: RepoIndexEntry[] = [meta, ...fileEntries, ...symbolEntries];
```

Replace with:

```typescript
  // Build spec entries — include unchanged symbols too in incremental mode
  const specDirPath = opts.specDir ?? path.join(cwd, 'docs', 'superpowers', 'specs');
  const existingSymbolsForSpec = incremental && fs.existsSync(outputPath)
    ? loadExistingEntries(outputPath)
        .filter((e): e is SymbolIndexEntry => {
          const changedPaths = new Set(fileEntries.map(f => f.path));
          return e.type === 'symbol' && !changedPaths.has(e.file);
        })
    : [];
  const specEntries = buildSpecEntries(specDirPath, [...symbolEntries, ...existingSymbolsForSpec]);

  const allEntries: RepoIndexEntry[] = [meta, ...fileEntries, ...symbolEntries, ...specEntries];
```

- [ ] **Step 4.3: Update the incremental merge block to regenerate spec entries**

Find the incremental write block. Change the `return true; // keep spec entries` line:

```typescript
      if (e.type === 'spec') return false; // regenerated fresh on every run
```

And update the merged array to include `specEntries`:

```typescript
      const merged: RepoIndexEntry[] = [meta, ...fileEntries, ...symbolEntries, ...specEntries, ...keptEntries];
```

- [ ] **Step 4.4: Plumb `specDir` through `dispatch.ts`**

In `src/cli/dispatch.ts`, find the `indexRepo({` call and add `specDir`:

```typescript
    await indexRepo({
      cwd,
      incremental: args.incremental,
      regenContext: args.regenerateContext,
      dryRun: args.dryRun,
      quiet: args.json,
      specDir: args.specDir,
    });
```

- [ ] **Step 4.5: Add indexRepo integration tests to the test file**

Append to `src/tests/spec-traceability.test.ts`:

```typescript
// ── indexRepo integration ─────────────────────────────────────────────────────

import { indexRepo } from '../actions/index.js';

function readJsonl(p: string): RepoIndexEntry[] {
  return fs.readFileSync(p, 'utf-8')
    .split('\n').filter(Boolean)
    .map(l => JSON.parse(l) as RepoIndexEntry);
}

describe('indexRepo — SpecIndexEntry emission', () => {
  it('emits SpecIndexEntry records when spec files and annotations exist', async () => {
    const tmp = makeTmp(); dirs.push(tmp);
    write(tmp, 'src/index.ts', [
      '// @spec: MY-FEAT-1',
      'export function doThing(): void {}',
    ].join('\n'));
    write(tmp, 'docs/superpowers/specs/2026-01-01-my-feature-design.md', [
      '## Overview',
      '## Detail',
    ].join('\n'));

    const result = await indexRepo({ cwd: tmp, quiet: true });
    const entries = readJsonl(result.outputPath);
    const specs = entries.filter((e): e is SpecIndexEntry => e.type === 'spec');

    expect(specs).toHaveLength(2);

    const covered = specs.find(s => s.specId === 'MY-FEAT-1');
    expect(covered).toBeDefined();
    expect(covered!.implementedBy).toContain('src/index.ts');
    expect(covered!.coverageRatio).toBe(1.0);

    const uncovered = specs.find(s => s.specId === 'MY-FEAT-2');
    expect(uncovered).toBeDefined();
    expect(uncovered!.implementedBy).toHaveLength(0);
    expect(uncovered!.coverageRatio).toBe(0.0);
  });

  it('emits no spec entries when spec dir is absent', async () => {
    const tmp = makeTmp(); dirs.push(tmp);
    write(tmp, 'src/index.ts', 'export function foo() {}');
    const result = await indexRepo({ cwd: tmp, quiet: true });
    const entries = readJsonl(result.outputPath);
    expect(entries.filter(e => e.type === 'spec')).toHaveLength(0);
  });

  it('uses custom specDir when provided', async () => {
    const tmp = makeTmp(); dirs.push(tmp);
    write(tmp, 'src/index.ts', '// @spec: FOO-1\nexport function foo() {}');
    write(tmp, 'custom/2026-01-01-foo-design.md', '## Req One');
    const result = await indexRepo({
      cwd: tmp,
      quiet: true,
      specDir: path.join(tmp, 'custom'),
    });
    const entries = readJsonl(result.outputPath);
    const specs = entries.filter((e): e is SpecIndexEntry => e.type === 'spec');
    expect(specs).toHaveLength(1);
    expect(specs[0]!.implementedBy).toContain('src/index.ts');
  });
});
```

- [ ] **Step 4.6: Run all spec-traceability tests**

```
npm run test -- --reporter=verbose src/tests/spec-traceability.test.ts
```

Expected: spec-parser tests PASS, indexRepo integration tests PASS.

- [ ] **Step 4.7: Commit**

```bash
git add src/actions/index.ts src/cli/dispatch.ts src/tests/spec-traceability.test.ts
git commit -m "feat(spec-trace): emit SpecIndexEntry records in indexRepo pipeline"
```

---

## Task 5: Add MCP helper functions to `search.ts`

**Files:**
- Modify: `src/mcp-server/search.ts`

- [ ] **Step 5.1: Add the import and interfaces**

At the top of `src/mcp-server/search.ts`, add after the existing imports:

```typescript
import { deriveSpecPrefix } from '../generators/spec-parser.js';
```

Add these interfaces and functions at the bottom of `src/mcp-server/search.ts`:

```typescript
export interface SpecCoverageGroup {
  specPrefix: string;
  specFile: string;
  covered: number;
  total: number;
  ratio: number;
  requirements: Array<{
    specId: string;
    title: string;
    implemented: boolean;
    implementedBy: string[];
  }>;
}

/**
 * Groups SpecIndexEntry records by spec file and computes per-file coverage.
 * Falls back gracefully when no index file exists.
 */
export function validateSpecCoverage(projectRoot: string): SpecCoverageGroup[] {
  const raw = readRepoIndex(projectRoot);
  if (!raw) return [];

  const entries = parseIndexEntries(raw);
  const specEntries = entries.filter(e => e.type === 'spec');
  if (specEntries.length === 0) return [];

  const byFile = new Map<string, typeof specEntries>();
  for (const e of specEntries) {
    const file = (e['specFile'] as string | undefined) ?? 'unknown';
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push(e);
  }

  const results: SpecCoverageGroup[] = [];
  for (const [specFile, reqs] of byFile) {
    const requirements = reqs.map(e => {
      const implementedBy = (e['implementedBy'] as string[] | undefined) ?? [];
      return {
        specId: (e['specId'] as string | undefined) ?? '',
        title: (e['title'] as string | undefined) ?? '',
        implemented: implementedBy.length > 0,
        implementedBy,
      };
    });
    const covered = requirements.filter(r => r.implemented).length;
    results.push({
      specPrefix: deriveSpecPrefix(specFile),
      specFile,
      covered,
      total: requirements.length,
      ratio: requirements.length > 0 ? covered / requirements.length : 0,
      requirements,
    });
  }

  return results.sort((a, b) => a.specFile.localeCompare(b.specFile));
}

export interface SpecForFileEntry {
  specId: string;
  title: string;
  specFile: string;
}

/**
 * Returns spec requirements implemented by a given file path.
 * Falls back gracefully when no index file exists.
 */
export function getSpecForFile(projectRoot: string, filePath: string): SpecForFileEntry[] {
  const raw = readRepoIndex(projectRoot);
  if (!raw) return [];

  const normalised = filePath.replace(/\\/g, '/');
  const entries = parseIndexEntries(raw);
  const results: SpecForFileEntry[] = [];

  for (const entry of entries) {
    if (entry.type !== 'spec') continue;
    const implementedBy = (entry['implementedBy'] as string[] | undefined) ?? [];
    const isImplemented = implementedBy.some(f => {
      const fn = f.replace(/\\/g, '/');
      return fn === normalised || fn.endsWith(`/${normalised}`);
    });
    if (isImplemented) {
      results.push({
        specId: (entry['specId'] as string | undefined) ?? '',
        title: (entry['title'] as string | undefined) ?? '',
        specFile: (entry['specFile'] as string | undefined) ?? '',
      });
    }
  }

  return results;
}
```

- [ ] **Step 5.2: Add tests for `validateSpecCoverage` and `getSpecForFile`**

Append to `src/tests/spec-traceability.test.ts`:

```typescript
// ── validateSpecCoverage ──────────────────────────────────────────────────────

import { validateSpecCoverage, getSpecForFile } from '../mcp-server/search.js';

describe('validateSpecCoverage', () => {
  it('returns [] when no index file exists', () => {
    const tmp = makeTmp(); dirs.push(tmp);
    expect(validateSpecCoverage(tmp)).toEqual([]);
  });

  it('groups spec entries by specFile and computes coverage', () => {
    const tmp = makeTmp(); dirs.push(tmp);
    const specEntries: SpecIndexEntry[] = [
      { type: 'spec', specId: 'FOO-1', title: 'R1', specFile: 'foo.md', requirementCount: 2, implementedBy: ['src/a.ts'], coverageRatio: 1.0 },
      { type: 'spec', specId: 'FOO-2', title: 'R2', specFile: 'foo.md', requirementCount: 2, implementedBy: [], coverageRatio: 0.0 },
    ];
    fs.mkdirSync(path.join(tmp, '.github/ai-os/context'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.github/ai-os/context/repo-index.jsonl'),
      specEntries.map(e => JSON.stringify(e)).join('\n') + '\n',
      'utf-8',
    );
    const results = validateSpecCoverage(tmp);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ specFile: 'foo.md', covered: 1, total: 2 });
    expect(results[0]!.ratio).toBeCloseTo(0.5);
    expect(results[0]!.requirements[0]).toMatchObject({ specId: 'FOO-1', implemented: true });
    expect(results[0]!.requirements[1]).toMatchObject({ specId: 'FOO-2', implemented: false });
  });
});

// ── getSpecForFile ────────────────────────────────────────────────────────────

describe('getSpecForFile', () => {
  it('returns [] when no index file exists', () => {
    const tmp = makeTmp(); dirs.push(tmp);
    expect(getSpecForFile(tmp, 'src/a.ts')).toEqual([]);
  });

  it('returns spec IDs where the file is in implementedBy', () => {
    const tmp = makeTmp(); dirs.push(tmp);
    const specEntries: SpecIndexEntry[] = [
      { type: 'spec', specId: 'FOO-1', title: 'R1', specFile: 'foo.md', requirementCount: 2, implementedBy: ['src/a.ts'], coverageRatio: 1.0 },
      { type: 'spec', specId: 'FOO-2', title: 'R2', specFile: 'foo.md', requirementCount: 2, implementedBy: ['src/b.ts'], coverageRatio: 1.0 },
    ];
    fs.mkdirSync(path.join(tmp, '.github/ai-os/context'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.github/ai-os/context/repo-index.jsonl'),
      specEntries.map(e => JSON.stringify(e)).join('\n') + '\n',
      'utf-8',
    );
    const results = getSpecForFile(tmp, 'src/a.ts');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ specId: 'FOO-1', specFile: 'foo.md' });
  });

  it('returns [] when file has no annotations', () => {
    const tmp = makeTmp(); dirs.push(tmp);
    const specEntries: SpecIndexEntry[] = [
      { type: 'spec', specId: 'FOO-1', title: 'R1', specFile: 'foo.md', requirementCount: 1, implementedBy: ['src/other.ts'], coverageRatio: 1.0 },
    ];
    fs.mkdirSync(path.join(tmp, '.github/ai-os/context'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.github/ai-os/context/repo-index.jsonl'),
      specEntries.map(e => JSON.stringify(e)).join('\n') + '\n',
      'utf-8',
    );
    expect(getSpecForFile(tmp, 'src/unrelated.ts')).toEqual([]);
  });
});
```

- [ ] **Step 5.3: Run all spec-traceability tests**

```
npm run test -- --reporter=verbose src/tests/spec-traceability.test.ts
```

Expected: ALL tests PASS.

- [ ] **Step 5.4: Commit**

```bash
git add src/mcp-server/search.ts src/tests/spec-traceability.test.ts
git commit -m "feat(spec-trace): add validateSpecCoverage and getSpecForFile to search.ts"
```

---

## Task 6: Register MCP tools in `sdk-server.ts` and `mcp-tools.ts`

**Files:**
- Modify: `src/mcp-server/sdk-server.ts`
- Modify: `src/mcp-tools.ts`

- [ ] **Step 6.1: Add imports to `sdk-server.ts`**

Find the existing imports from `./utils.js`. Add `validateSpecCoverage` and `getSpecForFile` to the destructured import list:

```typescript
import {
  // ... existing imports ...
  searchSymbols,
  getFilePurpose,
  validateSpecCoverage,
  getSpecForFile,
} from './utils.js';
```

- [ ] **Step 6.2: Register `validate_spec_coverage` (Tool #42)**

Find the closing `// ── Prompts ───` comment in `sdk-server.ts` and insert before it:

```typescript
  // ── Tool 42: validate_spec_coverage ────────────────────────────────────────
  server.registerTool(
    'validate_spec_coverage',
    {
      description: 'Reports spec requirement coverage across all spec files in the repo index. Groups requirements by spec file and shows which are annotated with @spec: (implemented) and which are gaps. Requires `ai-os --index` to have run first.',
      inputSchema: {
        show_all: z.boolean().optional().describe('Show all requirements including implemented ones (default: false — gaps only).'),
      },
    },
    wrap('validate_spec_coverage', (args) => {
      const root = getProjectRoot();
      const showAll = args['show_all'] === true;
      const groups = validateSpecCoverage(root);

      if (groups.length === 0) {
        return 'No spec entries found. Run `ai-os --index` first. Ensure spec files exist in docs/superpowers/specs/.';
      }

      const totalCovered = groups.reduce((sum, g) => sum + g.covered, 0);
      const totalReqs = groups.reduce((sum, g) => sum + g.total, 0);
      const overallPct = totalReqs > 0 ? Math.round((totalCovered / totalReqs) * 100) : 0;

      const lines: string[] = ['Spec Coverage Report', '─'.repeat(60)];
      for (const group of groups) {
        const pct = Math.round(group.ratio * 100);
        const icon = pct === 100 ? '✓' : pct === 0 ? '✗' : '⚠';
        lines.push(
          `${group.specPrefix.padEnd(14)} ${group.specFile.padEnd(45)} ${group.covered}/${group.total} reqs  ${String(pct).padStart(3)}%  ${icon}`,
        );
        if (showAll) {
          for (const req of group.requirements) {
            const status = req.implemented ? '  ✓' : '  ✗';
            lines.push(`  ${status} ${req.specId} — ${req.title}`);
            if (req.implemented && req.implementedBy.length > 0) {
              lines.push(`       ↳ ${req.implementedBy.join(', ')}`);
            }
          }
        }
      }
      lines.push('─'.repeat(60));
      lines.push(`Overall: ${totalCovered}/${totalReqs} requirements annotated (${overallPct}%)`);
      return lines.join('\n');
    }),
  );

  // ── Tool 43: get_spec_for_file ──────────────────────────────────────────────
  server.registerTool(
    'get_spec_for_file',
    {
      description: 'Returns the spec requirements (with IDs and titles) that a given source file implements, based on @spec: annotations in the repo index. Requires `ai-os --index` to have run first.',
      inputSchema: {
        path: z.string().describe('Relative path to the source file, e.g. "src/actions/index.ts".'),
      },
    },
    wrap('get_spec_for_file', (args) => {
      const root = getProjectRoot();
      const filePath = String(args['path'] ?? '');
      const results = getSpecForFile(root, filePath);

      if (results.length === 0) {
        return `No spec annotations found for "${filePath}". Run \`ai-os --index\` first, or add // @spec: ID comments above exported functions.`;
      }

      const lines = [`${filePath} contributes to:`];
      for (const r of results) {
        lines.push(`  ${r.specId.padEnd(20)} — ${r.title}`);
        lines.push(`  ${''.padEnd(20)}   (${r.specFile})`);
      }
      return lines.join('\n');
    }),
  );
```

- [ ] **Step 6.3: Add tool definitions to `mcp-tools.ts`**

Find the closing `];` line of `MCP_TOOL_DEFINITIONS` array. Insert before it:

```typescript
  // ── Tool #42: Spec Coverage ───────────────────────────────────────────────
  {
    name: 'validate_spec_coverage',
    description: 'Reports spec requirement coverage across all spec files in the repo index. Groups requirements by spec file and shows which are annotated with @spec: (implemented) and which are gaps. Requires `ai-os --index` to have run first.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        show_all: { type: 'boolean', description: 'Show all requirements including implemented ones (default: false — gaps only).' },
      },
    },
    condition: always,
  },
  // ── Tool #43: Spec for File ───────────────────────────────────────────────
  {
    name: 'get_spec_for_file',
    description: 'Returns the spec requirements (with IDs and titles) that a given source file implements, based on @spec: annotations in the repo index. Requires `ai-os --index` to have run first.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path to the source file, e.g. "src/actions/index.ts".' },
      },
      required: ['path'],
    },
    condition: always,
  },
```

- [ ] **Step 6.4: Commit**

```bash
git add src/mcp-server/sdk-server.ts src/mcp-tools.ts
git commit -m "feat(spec-trace): register validate_spec_coverage and get_spec_for_file MCP tools"
```

---

## Task 7: Full build, test, version bump, and PR

- [ ] **Step 7.1: Build**

```
npm run build
```

Expected: 0 TypeScript errors, 0 warnings.

- [ ] **Step 7.2: Run full test suite**

```
npm run test
```

Expected: 614+ tests pass (all existing + new spec-traceability tests). 0 failures.

- [ ] **Step 7.3: Bump version to 0.22.4**

In `package.json`, change:

```json
"version": "0.22.3"
```

to:

```json
"version": "0.22.4"
```

Run:
```
npm install
```

- [ ] **Step 7.4: Create feature branch and final commit**

```bash
git checkout -b feat/spec-traceability
# (all previous commits should already be on this branch if you checked it out at start)
git add package.json package-lock.json
git commit -m "chore: bump version to 0.22.4"
```

- [ ] **Step 7.5: Push and open PR to dev**

```bash
git push origin feat/spec-traceability
gh pr create \
  --base dev \
  --head feat/spec-traceability \
  --title "feat: Spec Traceability (RII Phase 2) — v0.22.4" \
  --body "## Spec Traceability — RII Phase 2

Links spec markdown files to implementing code via \`@spec:\` annotations.

### What's new
- \`src/generators/spec-parser.ts\` — derives stable spec IDs from filenames + headings
- \`ai-os --index\` now emits \`SpecIndexEntry\` records in \`repo-index.jsonl\`
- \`--spec-dir <path>\` CLI flag (default: \`docs/superpowers/specs/\`)
- MCP tool \`validate_spec_coverage\` — per-spec and overall coverage report
- MCP tool \`get_spec_for_file\` — shows which specs a file implements
- 20+ new unit + integration tests; 614+ total tests green

### Usage
\`\`\`
# Annotate a function:
// @spec: SPEC-TRACE-1
export function parseSpecFiles(...) { ... }

# Index the repo:
ai-os --index

# Check coverage:
validate_spec_coverage    # → SPEC-TRACE 0/8 reqs 0% ✗
\`\`\`"
```

---

## Acceptance Criteria Checklist

- [ ] `deriveSpecPrefix("2026-05-25-repo-intelligence-index-design.md")` → `"REPO-INTEL"`
- [ ] `parseSpecFiles("docs/superpowers/specs/")` returns one entry per H2/H3 heading per file
- [ ] `parseSpecFiles()` returns `[]` gracefully when directory does not exist
- [ ] `ai-os --index` on a TypeScript repo with `@spec:` annotations produces `SpecIndexEntry` records
- [ ] `coverageRatio` is `1.0` for annotated requirements, `0.0` for unannotated ones
- [ ] `validate_spec_coverage` MCP tool returns a formatted coverage report
- [ ] `get_spec_for_file("src/actions/index.ts")` returns matching spec IDs
- [ ] `--spec-dir <path>` CLI flag overrides default spec directory
- [ ] All 7 language adapters work (annotation detection via existing `parseSpecIds()`)
- [ ] 0 TypeScript build errors
- [ ] 614+ total tests pass
