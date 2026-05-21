/**
 * Unit tests for src/actions/check-hygiene.ts
 * Tests that the hygiene checker correctly identifies common issues.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-os-hygiene-test-'));
}

function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function write(dir: string, relPath: string, content = ''): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

describe('runCheckHygieneAction', () => {
  let tmp: string;
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

  beforeEach(() => {
    tmp = mkTmp();
    consoleSpy.mockClear();
    exitSpy.mockClear();
  });

  afterEach(() => {
    rmTmp(tmp);
  });

  it('passes when no legacy artifacts or issues exist', async () => {
    // Create a valid manifest so the manifest check passes
    write(tmp, '.github/ai-os/manifest.json', JSON.stringify({
      version: '1',
      generatedAt: new Date().toISOString(),
      files: [],
    }));
    const { runCheckHygieneAction } = await import('../actions/check-hygiene.js');
    runCheckHygieneAction(tmp, true);
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('"passed":true');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('detects legacy .ai-os/context/ directory as issue', async () => {
    write(tmp, '.ai-os/context/stack.md', '# Legacy stack');
    const { runCheckHygieneAction } = await import('../actions/check-hygiene.js');
    runCheckHygieneAction(tmp, true);
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.issues.some((i: string) => i.includes('Legacy'))).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('detects stale .memory.lock file as issue', async () => {
    write(tmp, '.github/ai-os/memory/.memory.lock', '');
    const { runCheckHygieneAction } = await import('../actions/check-hygiene.js');
    runCheckHygieneAction(tmp, true);
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.issues.some((i: string) => i.includes('lock'))).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('detects orphaned .tmp files in .github/ai-os/', async () => {
    write(tmp, '.github/ai-os/temp-output.tmp', 'orphaned temp');
    const { runCheckHygieneAction } = await import('../actions/check-hygiene.js');
    runCheckHygieneAction(tmp, true);
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.issues.some((i: string) => i.includes('.tmp'))).toBe(true);
  });

  it('reports no manifest.json as an issue', async () => {
    const { runCheckHygieneAction } = await import('../actions/check-hygiene.js');
    runCheckHygieneAction(tmp, true);
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.issues.some((i: string) => i.includes('manifest'))).toBe(true);
  });
});
