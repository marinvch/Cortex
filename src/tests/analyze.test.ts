/**
 * Unit tests for src/analyze.ts — the main stack analysis entry point.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-os-analyze-test-'));
}

function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function write(dir: string, relPath: string, content = ''): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

describe('analyze', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => rmTmp(tmp));

  it('returns a DetectedStack with projectName from package.json', async () => {
    write(tmp, 'package.json', JSON.stringify({ name: 'my-app', version: '1.0.0' }));
    write(tmp, 'tsconfig.json', '{}');
    write(tmp, 'package-lock.json', '{}');
    write(tmp, 'src/index.ts', 'export const app = 1;');
    write(tmp, 'src/server.ts', 'export const s = 2;');
    write(tmp, 'src/utils.ts', 'export const u = 3;');
    write(tmp, 'src/types.ts', 'export type T = string;');
    const { analyze } = await import('../analyze.js');
    const stack = analyze(tmp);
    expect(stack.projectName).toBe('my-app');
    expect(stack.primaryLanguage.name).toBe('TypeScript');
  });

  it('strips scoped prefix from package name', async () => {
    write(tmp, 'package.json', JSON.stringify({ name: '@myorg/my-app' }));
    const { analyze } = await import('../analyze.js');
    const stack = analyze(tmp);
    expect(stack.projectName).toBe('my-app');
  });

  it('falls back to directory name when no package.json', async () => {
    write(tmp, 'src/main.go', 'package main');
    write(tmp, 'go.mod', 'module example.com/app\n\ngo 1.21\n');
    const { analyze } = await import('../analyze.js');
    const stack = analyze(tmp);
    // Should detect project name from go.mod
    expect(typeof stack.projectName).toBe('string');
    expect(stack.projectName.length).toBeGreaterThan(0);
  });

  it('detects TypeScript pattern from tsconfig.json', async () => {
    write(tmp, 'package.json', JSON.stringify({ name: 'test' }));
    write(tmp, 'tsconfig.json', '{}');
    write(tmp, 'package-lock.json', '{}');
    const { analyze } = await import('../analyze.js');
    const stack = analyze(tmp);
    expect(stack.patterns.hasTypeScript).toBe(true);
  });

  it('detects Next.js framework from dependencies', async () => {
    write(tmp, 'package.json', JSON.stringify({
      name: 'test',
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
    }));
    write(tmp, 'package-lock.json', '{}');
    const { analyze } = await import('../analyze.js');
    const stack = analyze(tmp);
    expect(stack.frameworks.some(f => f.name === 'Next.js')).toBe(true);
    expect(stack.primaryFramework?.name).toBe('Next.js');
  });

  it('includes keyFiles that exist in the project root', async () => {
    write(tmp, 'package.json', JSON.stringify({ name: 'test' }));
    write(tmp, 'README.md', '# Test');
    write(tmp, 'package-lock.json', '{}');
    const { analyze } = await import('../analyze.js');
    const stack = analyze(tmp);
    expect(stack.keyFiles.some(f => f.includes('README.md') || f.includes('package.json'))).toBe(true);
  });

  it('reports allDependencies as a flat list of package names', async () => {
    write(tmp, 'package.json', JSON.stringify({
      name: 'test',
      dependencies: { react: '^18.0.0' },
      devDependencies: { vitest: '^2.0.0' },
    }));
    write(tmp, 'package-lock.json', '{}');
    const { analyze } = await import('../analyze.js');
    const stack = analyze(tmp);
    expect(stack.allDependencies).toContain('react');
    expect(stack.allDependencies).toContain('vitest');
  });

  it('detects package manager from lock file', async () => {
    write(tmp, 'package.json', JSON.stringify({ name: 'test' }));
    write(tmp, 'pnpm-lock.yaml', '');
    const { analyze } = await import('../analyze.js');
    const stack = analyze(tmp);
    expect(stack.patterns.packageManager).toBe('pnpm');
  });

  it('returns empty frameworks array when no framework is detected', async () => {
    write(tmp, 'package.json', JSON.stringify({ name: 'test', dependencies: { lodash: '^4.0.0' } }));
    write(tmp, 'package-lock.json', '{}');
    const { analyze } = await import('../analyze.js');
    const stack = analyze(tmp);
    expect(stack.frameworks).toEqual([]);
    expect(stack.primaryFramework).toBeUndefined();
  });

  it('detects test framework from devDependencies', async () => {
    write(tmp, 'package.json', JSON.stringify({
      name: 'test',
      devDependencies: { jest: '^29.0.0' },
    }));
    write(tmp, 'package-lock.json', '{}');
    const { analyze } = await import('../analyze.js');
    const stack = analyze(tmp);
    expect(stack.patterns.testFramework).toBe('Jest');
  });
});
