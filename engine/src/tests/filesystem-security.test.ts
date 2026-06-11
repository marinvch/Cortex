/**
 * filesystem-security.test.ts — Path traversal and shell injection tests for #177
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('readFile — path traversal prevention (#177)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fs-sec-test-'));
    // Write a safe file inside the project root
    writeFileSync(join(tmpDir, 'safe.txt'), 'safe content', 'utf-8');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('rejects ../../etc/passwd path traversal', async () => {
    process.env['AI_OS_ROOT'] = tmpDir;
    const { readFile } = await import('../mcp-server/filesystem.js');
    const result = readFile('../../etc/passwd');
    expect(result).toMatch(/path traversal/i);
    expect(result).not.toMatch(/root:/);
  });

  it('rejects absolute path outside project root', async () => {
    process.env['AI_OS_ROOT'] = tmpDir;
    const { readFile } = await import('../mcp-server/filesystem.js');
    const result = readFile('/etc/passwd');
    expect(result).toMatch(/path traversal|not found/i);
  });

  it('reads a valid file within the project root', async () => {
    process.env['AI_OS_ROOT'] = tmpDir;
    const { readFile } = await import('../mcp-server/filesystem.js');
    const result = readFile('safe.txt');
    expect(result).toBe('safe content');
  });

  it('returns error for missing file', async () => {
    process.env['AI_OS_ROOT'] = tmpDir;
    const { readFile } = await import('../mcp-server/filesystem.js');
    const result = readFile('nonexistent.txt');
    expect(result).toMatch(/not found|error/i);
  });

  it('rejects empty path', async () => {
    process.env['AI_OS_ROOT'] = tmpDir;
    const { readFile } = await import('../mcp-server/filesystem.js');
    const result = readFile('');
    expect(result).toMatch(/required|error/i);
  });
});

describe('listDirectory — path traversal prevention (#177)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fs-list-test-'));
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'index.ts'), '', 'utf-8');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('rejects path traversal in directory listing', async () => {
    process.env['AI_OS_ROOT'] = tmpDir;
    const { listDirectory } = await import('../mcp-server/filesystem.js');
    const result = listDirectory('../../');
    expect(result).toMatch(/path traversal/i);
  });

  it('lists valid directory', async () => {
    process.env['AI_OS_ROOT'] = tmpDir;
    const { listDirectory } = await import('../mcp-server/filesystem.js');
    const result = listDirectory('src');
    expect(result).toMatch(/index\.ts/);
  });

  it('lists project root when path is "."', async () => {
    process.env['AI_OS_ROOT'] = tmpDir;
    const { listDirectory } = await import('../mcp-server/filesystem.js');
    const result = listDirectory('.');
    expect(result).toMatch(/src/);
  });
});

describe('run_* tools — disabled by default (#177)', () => {
  beforeEach(() => {
    delete process.env['AI_OS_ALLOW_RUN_TOOLS'];
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env['AI_OS_ALLOW_RUN_TOOLS'];
    vi.resetModules();
  });

  it('runTests returns disabled message when AI_OS_ALLOW_RUN_TOOLS is not set', async () => {
    const { runTests } = await import('../mcp-server/filesystem.js');
    const result = runTests();
    expect(result).toMatch(/disabled|AI_OS_ALLOW_RUN_TOOLS/i);
  });

  it('runLint returns disabled message when AI_OS_ALLOW_RUN_TOOLS is not set', async () => {
    const { runLint } = await import('../mcp-server/filesystem.js');
    const result = runLint();
    expect(result).toMatch(/disabled|AI_OS_ALLOW_RUN_TOOLS/i);
  });

  it('runBuild returns disabled message when AI_OS_ALLOW_RUN_TOOLS is not set', async () => {
    const { runBuild } = await import('../mcp-server/filesystem.js');
    const result = runBuild();
    expect(result).toMatch(/disabled|AI_OS_ALLOW_RUN_TOOLS/i);
  });
});
