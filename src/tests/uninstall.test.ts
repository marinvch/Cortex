import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runUninstall, formatUninstallReport } from '../uninstall.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const d = path.join(os.tmpdir(), `ai-os-uninstall-${Date.now()}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function writeFile(dir: string, rel: string, content: string): string {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

function writeManifest(dir: string, files: string[]): void {
  const manifestPath = path.join(dir, '.github', 'ai-os', 'manifest.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({ version: '0.0.0', generatedAt: '', files }), 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runUninstall', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty report when no manifest exists', () => {
    const report = runUninstall(tmpDir);
    expect(report.removed).toHaveLength(0);
    expect(report.skipped).toHaveLength(0);
    expect(report.notFound).toHaveLength(0);
    expect(report.errors).toHaveLength(0);
  });

  it('removes files listed in manifest', () => {
    writeFile(tmpDir, '.github/copilot-instructions.md', '# Instructions');
    writeFile(tmpDir, '.github/agents/expert.agent.md', '# Agent');
    writeManifest(tmpDir, ['.github/copilot-instructions.md', '.github/agents/expert.agent.md']);

    const report = runUninstall(tmpDir, { verbose: false });

    expect(report.removed).toContain('.github/copilot-instructions.md');
    expect(report.removed).toContain('.github/agents/expert.agent.md');
    expect(fs.existsSync(path.join(tmpDir, '.github/copilot-instructions.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.github/agents/expert.agent.md'))).toBe(false);
  });

  it('records not-found files gracefully', () => {
    writeManifest(tmpDir, ['.github/some-missing-file.md']);

    const report = runUninstall(tmpDir);

    expect(report.notFound).toContain('.github/some-missing-file.md');
    expect(report.removed).toHaveLength(0);
  });

  it('dry-run does not delete files', () => {
    writeFile(tmpDir, '.github/copilot-instructions.md', '# Instructions');
    writeManifest(tmpDir, ['.github/copilot-instructions.md']);

    const report = runUninstall(tmpDir, { dryRun: true });

    expect(report.removed).toContain('.github/copilot-instructions.md');
    expect(report.dryRun).toBe(true);
    // File must still exist
    expect(fs.existsSync(path.join(tmpDir, '.github/copilot-instructions.md'))).toBe(true);
  });

  it('skips files protected by protect.json', () => {
    writeFile(tmpDir, '.github/copilot-instructions.md', '# My Instructions');
    writeFile(tmpDir, '.github/ai-os/protect.json', JSON.stringify({
      never: ['.github/copilot-instructions.md'],
    }));
    writeManifest(tmpDir, ['.github/copilot-instructions.md']);

    const report = runUninstall(tmpDir);

    expect(report.skipped).toContain('.github/copilot-instructions.md');
    expect(report.removed).toHaveLength(0);
    expect(fs.existsSync(path.join(tmpDir, '.github/copilot-instructions.md'))).toBe(true);
  });

  it('skips files that contain user blocks', () => {
    const content = [
      '# Instructions',
      '',
      '<!-- AI-OS:USER_BLOCK:START id="my-block" -->',
      'My custom content',
      '<!-- AI-OS:USER_BLOCK:END id="my-block" -->',
    ].join('\n');
    writeFile(tmpDir, '.github/copilot-instructions.md', content);
    writeManifest(tmpDir, ['.github/copilot-instructions.md']);

    const report = runUninstall(tmpDir);

    expect(report.skipped).toContain('.github/copilot-instructions.md');
    expect(report.removed).toHaveLength(0);
    expect(fs.existsSync(path.join(tmpDir, '.github/copilot-instructions.md'))).toBe(true);
  });

  it('report.dryRun reflects the dryRun option', () => {
    writeManifest(tmpDir, []);
    const dry = runUninstall(tmpDir, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    const wet = runUninstall(tmpDir, { dryRun: false });
    expect(wet.dryRun).toBe(false);
  });
});

describe('formatUninstallReport', () => {
  it('includes removed count', () => {
    const report = {
      cwd: '/some/dir',
      dryRun: false,
      removed: ['a.md', 'b.md'],
      skipped: [],
      notFound: [],
      errors: [],
    };
    const text = formatUninstallReport(report);
    expect(text).toContain('Removed:   2');
  });

  it('includes [DRY RUN] tag when dryRun is true', () => {
    const report = {
      cwd: '/some/dir',
      dryRun: true,
      removed: [],
      skipped: [],
      notFound: [],
      errors: [],
    };
    expect(formatUninstallReport(report)).toContain('[DRY RUN]');
  });
});
