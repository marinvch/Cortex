import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { indexRepo } from '../actions/index.js';
import type { MetaIndexEntry, FileIndexEntry, SymbolIndexEntry, RepoIndexEntry } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rii-test-'));
}

function writeFile(dir: string, relPath: string, content: string): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function readJsonl(filePath: string): RepoIndexEntry[] {
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as RepoIndexEntry);
}

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Full pipeline ─────────────────────────────────────────────────────────────

describe('indexRepo — basic pipeline', () => {
  it('creates repo-index.jsonl with meta + file + symbol entries', async () => {
    const tmp = makeTmpDir();
    created.push(tmp);

    writeFile(tmp, 'src/auth.ts', `
/** Verifies JWT tokens. */
export function verifyToken(token: string): boolean { return true; }
export interface TokenPayload { sub: string; iat: number; }
    `);

    const result = await indexRepo({ cwd: tmp, quiet: true });

    expect(result.fileCount).toBe(1);
    expect(result.symbolCount).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(result.outputPath)).toBe(true);

    const entries = readJsonl(result.outputPath);
    const meta = entries.find((e): e is MetaIndexEntry => e.type === 'meta');
    const files = entries.filter((e): e is FileIndexEntry => e.type === 'file');
    const symbols = entries.filter((e): e is SymbolIndexEntry => e.type === 'symbol');

    expect(meta).toBeDefined();
    expect(meta!.fileCount).toBe(1);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toMatch(/auth\.ts$/);
    expect(files[0]!.language).toBe('TypeScript');
    expect(files[0]!.hash).toMatch(/^[0-9a-f]{40}$/);

    const verifySymbol = symbols.find(s => s.name === 'verifyToken');
    expect(verifySymbol).toBeDefined();
    expect(verifySymbol!.kind).toBe('function');
    expect(verifySymbol!.file).toMatch(/auth\.ts$/);
  });

  it('extracts purpose from JSDoc', async () => {
    const tmp = makeTmpDir();
    created.push(tmp);

    writeFile(tmp, 'src/utils.ts', `/** Formats currency values for display. */\nexport function formatCurrency(n: number) {}`);
    const result = await indexRepo({ cwd: tmp, quiet: true });
    const entries = readJsonl(result.outputPath);
    const fileEntry = entries.find((e): e is FileIndexEntry => e.type === 'file');
    expect(fileEntry?.purpose).toContain('Formats currency');
  });

  it('infers auth tag from file path', async () => {
    const tmp = makeTmpDir();
    created.push(tmp);

    writeFile(tmp, 'src/auth/middleware.ts', `export function checkAuth() {}`);
    const result = await indexRepo({ cwd: tmp, quiet: true });
    const entries = readJsonl(result.outputPath);
    const fileEntry = entries.find((e): e is FileIndexEntry => e.type === 'file');
    expect(fileEntry?.tags).toContain('auth');
  });
});

// ── Dry run ───────────────────────────────────────────────────────────────────

describe('indexRepo — dry run', () => {
  it('does not write output file in dry-run mode', async () => {
    const tmp = makeTmpDir();
    created.push(tmp);

    writeFile(tmp, 'src/foo.ts', `export function foo() {}`);
    const result = await indexRepo({ cwd: tmp, dryRun: true, quiet: true });
    expect(fs.existsSync(result.outputPath)).toBe(false);
    expect(result.fileCount).toBe(1);
  });
});

// ── Incremental indexing ──────────────────────────────────────────────────────

describe('indexRepo — incremental mode', () => {
  it('skips unchanged files on second run', async () => {
    const tmp = makeTmpDir();
    created.push(tmp);

    writeFile(tmp, 'src/stable.ts', `export function stable() {}`);

    // First run
    await indexRepo({ cwd: tmp, quiet: true });

    // Second run — same content, should skip
    const result = await indexRepo({ cwd: tmp, incremental: true, quiet: true });
    expect(result.skippedCount).toBe(1);
    expect(result.fileCount).toBe(0); // 0 new files processed
  });

  it('re-indexes changed files', async () => {
    const tmp = makeTmpDir();
    created.push(tmp);

    writeFile(tmp, 'src/changing.ts', `export function v1() {}`);
    await indexRepo({ cwd: tmp, quiet: true });

    // Modify the file
    writeFile(tmp, 'src/changing.ts', `export function v1() {}\nexport function v2() {}`);
    const result = await indexRepo({ cwd: tmp, incremental: true, quiet: true });
    expect(result.fileCount).toBe(1); // changed file was re-indexed
    expect(result.skippedCount).toBe(0);

    // The output should contain v2
    const entries = readJsonl(result.outputPath);
    const v2 = entries.find((e): e is SymbolIndexEntry => e.type === 'symbol' && e.name === 'v2');
    expect(v2).toBeDefined();
  });
});

// ── Multi-language ────────────────────────────────────────────────────────────

describe('indexRepo — multi-language', () => {
  it('indexes Python files', async () => {
    const tmp = makeTmpDir();
    created.push(tmp);

    writeFile(tmp, 'scripts/process.py', `def run_pipeline(config):\n    pass\n`);
    const result = await indexRepo({ cwd: tmp, quiet: true });

    const entries = readJsonl(result.outputPath);
    const fileEntry = entries.find((e): e is FileIndexEntry => e.type === 'file');
    expect(fileEntry?.language).toBe('Python');

    const sym = entries.find((e): e is SymbolIndexEntry => e.type === 'symbol' && e.name === 'run_pipeline');
    expect(sym).toBeDefined();
  });
});

// ── Custom output path ────────────────────────────────────────────────────────

describe('indexRepo — custom output path', () => {
  it('respects custom output path', async () => {
    const tmp = makeTmpDir();
    created.push(tmp);

    writeFile(tmp, 'src/foo.ts', `export const x = 1;`);
    const customOutput = path.join(tmp, 'my-index.jsonl');
    const result = await indexRepo({ cwd: tmp, output: customOutput, quiet: true });

    expect(result.outputPath).toBe(customOutput);
    expect(fs.existsSync(customOutput)).toBe(true);
  });
});
