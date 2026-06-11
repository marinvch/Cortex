/**
 * Unit tests for src/detectors/*.ts
 * Tests language detection, pattern detection, and framework detection
 * using real temp directories (no mocking required).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ─── helpers ──────────────────────────────────────────────────────────────────

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-os-detectors-test-'));
}

function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function write(dir: string, relPath: string, content = ''): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

// ─── detectLanguages ──────────────────────────────────────────────────────────

describe('detectLanguages', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => rmTmp(tmp));

  it('returns TypeScript as primary language for .ts files', async () => {
    write(tmp, 'src/a.ts', 'export const x = 1;');
    write(tmp, 'src/b.ts', 'export const y = 2;');
    const { detectLanguages } = await import('../detectors/language.js');
    const langs = detectLanguages(tmp);
    expect(langs[0].name).toBe('TypeScript');
    expect(langs[0].fileCount).toBe(2);
  });

  it('returns multiple languages sorted by file count', async () => {
    write(tmp, 'a.ts', '');
    write(tmp, 'b.ts', '');
    write(tmp, 'c.py', '');
    const { detectLanguages } = await import('../detectors/language.js');
    const langs = detectLanguages(tmp);
    expect(langs[0].name).toBe('TypeScript');
    expect(langs[1].name).toBe('Python');
  });

  it('ignores node_modules directory', async () => {
    write(tmp, 'node_modules/pkg/index.js', '');
    write(tmp, 'src/index.ts', '');
    const { detectLanguages } = await import('../detectors/language.js');
    const langs = detectLanguages(tmp);
    const jsLang = langs.find(l => l.name === 'JavaScript');
    const tsLang = langs.find(l => l.name === 'TypeScript');
    expect(jsLang).toBeUndefined();
    expect(tsLang).toBeDefined();
  });

  it('returns empty array for directory with no recognized files', async () => {
    write(tmp, 'README', 'hello');
    const { detectLanguages } = await import('../detectors/language.js');
    const langs = detectLanguages(tmp);
    expect(langs).toEqual([]);
  });

  it('includes extension list for each language', async () => {
    write(tmp, 'a.ts', '');
    write(tmp, 'b.tsx', '');
    const { detectLanguages } = await import('../detectors/language.js');
    const langs = detectLanguages(tmp);
    const ts = langs.find(l => l.name === 'TypeScript');
    expect(ts?.extensions).toEqual(expect.arrayContaining(['ts', 'tsx']));
  });

  it('computes percentage relative to total file count', async () => {
    write(tmp, 'a.ts', '');
    write(tmp, 'b.ts', '');
    write(tmp, 'c.py', '');
    write(tmp, 'd.py', '');
    const { detectLanguages } = await import('../detectors/language.js');
    const langs = detectLanguages(tmp);
    // 2 of 4 = 50% for both TypeScript and Python
    const ts = langs.find(l => l.name === 'TypeScript');
    const py = langs.find(l => l.name === 'Python');
    expect(ts?.percentage).toBe(50);
    expect(py?.percentage).toBe(50);
  });
});

// ─── detectPatterns ───────────────────────────────────────────────────────────

describe('detectPatterns', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => rmTmp(tmp));

  it('detects npm package manager from package-lock.json', async () => {
    write(tmp, 'package-lock.json', '{}');
    const { detectPatterns } = await import('../detectors/patterns.js');
    const patterns = detectPatterns(tmp);
    expect(patterns.packageManager).toBe('npm');
  });

  it('detects yarn package manager from yarn.lock', async () => {
    write(tmp, 'yarn.lock', '');
    const { detectPatterns } = await import('../detectors/patterns.js');
    const patterns = detectPatterns(tmp);
    expect(patterns.packageManager).toBe('yarn');
  });

  it('detects pnpm from pnpm-lock.yaml', async () => {
    write(tmp, 'pnpm-lock.yaml', '');
    const { detectPatterns } = await import('../detectors/patterns.js');
    const patterns = detectPatterns(tmp);
    expect(patterns.packageManager).toBe('pnpm');
  });

  it('detects bun from bun.lockb', async () => {
    write(tmp, 'bun.lockb', '');
    const { detectPatterns } = await import('../detectors/patterns.js');
    const patterns = detectPatterns(tmp);
    expect(patterns.packageManager).toBe('bun');
  });

  it('detects go from go.mod', async () => {
    write(tmp, 'go.mod', 'module example.com/app');
    const { detectPatterns } = await import('../detectors/patterns.js');
    const patterns = detectPatterns(tmp);
    expect(patterns.packageManager).toBe('go');
  });

  it('detects TypeScript from tsconfig.json', async () => {
    write(tmp, 'tsconfig.json', '{}');
    const { detectPatterns } = await import('../detectors/patterns.js');
    const patterns = detectPatterns(tmp);
    expect(patterns.hasTypeScript).toBe(true);
  });

  it('returns hasTypeScript=false when no tsconfig.json exists', async () => {
    const { detectPatterns } = await import('../detectors/patterns.js');
    const patterns = detectPatterns(tmp);
    expect(patterns.hasTypeScript).toBe(false);
  });

  it('detects vitest as test framework from package.json devDependencies', async () => {
    write(tmp, 'package.json', JSON.stringify({ devDependencies: { vitest: '^2.0.0' } }));
    const { detectPatterns } = await import('../detectors/patterns.js');
    const patterns = detectPatterns(tmp);
    expect(patterns.testFramework).toBe('Vitest');
  });

  it('detects jest test framework', async () => {
    write(tmp, 'package.json', JSON.stringify({ devDependencies: { jest: '^29.0.0' } }));
    const { detectPatterns } = await import('../detectors/patterns.js');
    const patterns = detectPatterns(tmp);
    expect(patterns.testFramework).toBe('Jest');
  });

  it('returns unknown package manager when no lockfile present', async () => {
    const { detectPatterns } = await import('../detectors/patterns.js');
    const patterns = detectPatterns(tmp);
    expect(patterns.packageManager).toBe('unknown');
  });
});

// ─── detectFrameworks ─────────────────────────────────────────────────────────

describe('detectFrameworks', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => rmTmp(tmp));

  it('detects Next.js from package.json dependencies', async () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { next: '^14.0.0' } }));
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    expect(frameworks.some(f => f.name === 'Next.js')).toBe(true);
  });

  it('detects React from package.json dependencies', async () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { react: '^18.0.0' } }));
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    expect(frameworks.some(f => f.name === 'React')).toBe(true);
  });

  it('detects Express from package.json dependencies', async () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { express: '^4.0.0' } }));
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    expect(frameworks.some(f => f.name === 'Express')).toBe(true);
  });

  it('returns empty array for project with no recognized frameworks', async () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    // lodash is not a framework
    expect(frameworks).toEqual([]);
  });

  it('returns empty array for directory without package.json', async () => {
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    expect(frameworks).toEqual([]);
  });

  it('detects Prisma from devDependencies', async () => {
    write(tmp, 'package.json', JSON.stringify({ devDependencies: { prisma: '^5.0.0' } }));
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    expect(frameworks.some(f => f.name === 'Prisma')).toBe(true);
  });

  // ── Bug fix regressions (#168, #169, #170, #172) ──────────────────────────────

  it('detects SvelteKit before Svelte when @sveltejs/kit is present', async () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { svelte: '^4.0.0', '@sveltejs/kit': '^2.0.0' } }));
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    expect(frameworks.some(f => f.name === 'SvelteKit')).toBe(true);
    expect(frameworks.some(f => f.name === 'Svelte' && f.template !== 'sveltekit')).toBe(false);
  });

  it('detects Fastify with fastify template (not express)', async () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { fastify: '^4.0.0' } }));
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    const f = frameworks.find(f => f.name === 'Fastify');
    expect(f).toBeDefined();
    expect(f?.template).toBe('fastify');
  });

  it('detects Hono with hono template (not express)', async () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { hono: '^4.0.0' } }));
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    const f = frameworks.find(f => f.name === 'Hono');
    expect(f).toBeDefined();
    expect(f?.template).toBe('hono');
  });

  it('detects Koa with koa template (not express)', async () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { koa: '^2.0.0' } }));
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    const f = frameworks.find(f => f.name === 'Koa');
    expect(f).toBeDefined();
    expect(f?.template).toBe('koa');
  });

  it('detects Flask with python-flask template', async () => {
    write(tmp, 'requirements.txt', 'flask==3.0.0\nclick==8.1.0\n');
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    const f = frameworks.find(f => f.name === 'Flask');
    expect(f).toBeDefined();
    expect(f?.template).toBe('python-flask');
  });

  it('detects Starlette with python-starlette template', async () => {
    write(tmp, 'requirements.txt', 'starlette==0.36.0\nhttpx==0.26.0\n');
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    const f = frameworks.find(f => f.name === 'Starlette');
    expect(f).toBeDefined();
    expect(f?.template).toBe('python-starlette');
  });

  it('detects Quarkus with java-quarkus template', async () => {
    write(tmp, 'pom.xml', '<project><dependencies><groupId>io.quarkus</groupId></dependencies></project>');
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    const f = frameworks.find(f => f.name === 'Quarkus');
    expect(f).toBeDefined();
    expect(f?.template).toBe('java-quarkus');
  });

  it('detects Micronaut with java-micronaut template', async () => {
    write(tmp, 'pom.xml', '<project><dependencies><groupId>io.micronaut</groupId></dependencies></project>');
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    const f = frameworks.find(f => f.name === 'Micronaut');
    expect(f).toBeDefined();
    expect(f?.template).toBe('java-micronaut');
  });

  it('detects generic Java with java template (not java-spring)', async () => {
    write(tmp, 'pom.xml', '<project><groupId>com.example</groupId></project>');
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    const f = frameworks.find(f => f.name === 'Java');
    expect(f).toBeDefined();
    expect(f?.template).toBe('java');
  });

  it('does not duplicate Remix when @remix-run/react is present', async () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { '@remix-run/react': '^2.0.0', '@remix-run/node': '^2.0.0' } }));
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    const remix = frameworks.filter(f => f.name === 'Remix');
    expect(remix.length).toBe(1);
  });

  it('does not duplicate Bun when bun.lockb is present', async () => {
    write(tmp, 'bun.lockb', '');
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    const bun = frameworks.filter(f => f.name === 'Bun');
    expect(bun.length).toBe(1);
  });

  it('detects Bun via packageManager field in package.json', async () => {
    write(tmp, 'package.json', JSON.stringify({ name: 'myapp', packageManager: 'bun@1.0.0' }));
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    expect(frameworks.some(f => f.name === 'Bun')).toBe(true);
  });

  // ── Edge cases (#182) ─────────────────────────────────────────────────────────

  it('handles malformed package.json gracefully (returns empty array)', async () => {
    write(tmp, 'package.json', '{ invalid json !!!');
    const { detectFrameworks } = await import('../detectors/framework.js');
    expect(() => detectFrameworks(tmp)).not.toThrow();
    const frameworks = detectFrameworks(tmp);
    expect(frameworks).toEqual([]);
  });

  it('handles empty repo (no files) gracefully', async () => {
    const { detectFrameworks } = await import('../detectors/framework.js');
    expect(() => detectFrameworks(tmp)).not.toThrow();
    const frameworks = detectFrameworks(tmp);
    expect(frameworks).toEqual([]);
  });

  it('handles mixed stack — TypeScript + Python — independently', async () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { express: '^4.0.0' } }));
    write(tmp, 'requirements.txt', 'fastapi==0.110.0\n');
    const { detectFrameworks } = await import('../detectors/framework.js');
    const frameworks = detectFrameworks(tmp);
    expect(frameworks.some(f => f.name === 'Express')).toBe(true);
    expect(frameworks.some(f => f.name === 'FastAPI')).toBe(true);
  });

  it('handles polyglot repo (JS + Python + Java) without crashing', async () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { react: '^18.0.0' } }));
    write(tmp, 'requirements.txt', 'django==4.2\n');
    write(tmp, 'pom.xml', '<project><dependencies><groupId>org.springframework.boot</groupId></dependencies></project>');
    const { detectFrameworks } = await import('../detectors/framework.js');
    expect(() => detectFrameworks(tmp)).not.toThrow();
    const frameworks = detectFrameworks(tmp);
    expect(frameworks.length).toBeGreaterThanOrEqual(3);
  });
});
