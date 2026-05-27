// src/tests/spec-traceability.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveSpecPrefix, parseSpecFiles } from '../generators/spec-parser.js';
import { indexRepo } from '../actions/index.js';
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

function readJsonl(p: string): RepoIndexEntry[] {
  return fs.readFileSync(p, 'utf-8')
    .split('\n').filter(Boolean)
    .map(l => JSON.parse(l) as RepoIndexEntry);
}

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

// ── indexRepo integration ─────────────────────────────────────────────────────

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

  it('matches when absolute path is passed', () => {
    const tmp = makeTmp(); dirs.push(tmp);
    const specEntries: SpecIndexEntry[] = [
      { type: 'spec', specId: 'FOO-1', title: 'R1', specFile: 'foo.md', requirementCount: 1, implementedBy: ['src/a.ts'], coverageRatio: 1.0 },
    ];
    fs.mkdirSync(path.join(tmp, '.github/ai-os/context'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.github/ai-os/context/repo-index.jsonl'),
      specEntries.map(e => JSON.stringify(e)).join('\n') + '\n',
      'utf-8',
    );
    const absPath = path.join(tmp, 'src', 'a.ts');
    const results = getSpecForFile(tmp, absPath);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ specId: 'FOO-1' });
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
