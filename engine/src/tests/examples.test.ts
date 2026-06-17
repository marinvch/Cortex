/**
 * Examples fixture regression tests
 *
 * Runs AI OS stack detection and key generators against the three reference
 * fixture repos in examples/ and snapshot-tests the output. This doubles as
 * living documentation (the fixtures show what AI OS produces for common stacks)
 * and as a regression bedrock for stack detection + generation output.
 *
 * Fixtures:
 *  - examples/nextjs-trpc-prisma  → Next.js + tRPC + Prisma (TypeScript)
 *  - examples/python-fastapi      → Python + FastAPI
 *  - examples/go-service          → Go + Gin
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { analyze } from '../analyze.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = path.resolve(__dirname, '..', '..', 'examples');

// ---------------------------------------------------------------------------
// Helper: copy a fixture into a temp dir so generators can write safely
// ---------------------------------------------------------------------------
function copyFixture(fixtureName: string): string {
  const src = path.join(EXAMPLES_DIR, fixtureName);
  const dest = path.join(os.tmpdir(), `ai-os-fixture-${fixtureName}-${Date.now()}`);
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}

// ---------------------------------------------------------------------------
// Next.js + tRPC + Prisma
// ---------------------------------------------------------------------------
describe('examples/nextjs-trpc-prisma — stack detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = copyFixture('nextjs-trpc-prisma');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects TypeScript presence', () => {
    const stack = analyze(tmpDir);
    expect(stack.patterns.hasTypeScript).toBe(true);
    // Primary language may be JSON or TypeScript depending on file count, but TS must be present
    const langs = stack.languages.map(l => l.name);
    expect(langs).toContain('TypeScript');
  });

  it('detects Next.js framework', () => {
    const stack = analyze(tmpDir);
    const fw = stack.frameworks.map(f => f.name.toLowerCase());
    expect(fw.some(n => n.includes('next'))).toBe(true);
  });

  it('detects tRPC dependency', () => {
    const stack = analyze(tmpDir);
    const deps = stack.allDependencies.map(d => d.toLowerCase());
    expect(deps.some(d => d.includes('trpc'))).toBe(true);
  });

  it('detects Prisma dependency', () => {
    const stack = analyze(tmpDir);
    const deps = stack.allDependencies.map(d => d.toLowerCase());
    expect(deps.some(d => d.includes('prisma'))).toBe(true);
  });

  it('generates instructions file containing Next.js content', async () => {
    const { generateInstructions } = await import('../generators/instructions.js');
    const stack = analyze(tmpDir);
    const githubDir = path.join(tmpDir, '.github');
    fs.mkdirSync(githubDir, { recursive: true });

    generateInstructions(stack, tmpDir, { refreshExisting: false });

    const instructionsPath = path.join(githubDir, 'copilot-instructions.md');
    expect(fs.existsSync(instructionsPath)).toBe(true);
    const content = fs.readFileSync(instructionsPath, 'utf-8');
    expect(content.length).toBeGreaterThan(100);
    // Should contain Next.js-specific content
    expect(content.toLowerCase()).toMatch(/next/);
  });

  it('stack shape matches snapshot', () => {
    const stack = analyze(tmpDir);
    expect({
      primaryLanguage: stack.primaryLanguage.name,
      hasTypeScript: stack.patterns.hasTypeScript,
      packageManager: stack.patterns.packageManager,
      frameworks: stack.frameworks.map(f => f.name).sort(),
    }).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Python FastAPI
// ---------------------------------------------------------------------------
describe('examples/python-fastapi — stack detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = copyFixture('python-fastapi');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Python as primary language', () => {
    const stack = analyze(tmpDir);
    expect(stack.primaryLanguage.name).toBe('Python');
  });

  it('detects FastAPI dependency', () => {
    const stack = analyze(tmpDir);
    const deps = stack.allDependencies.map(d => d.toLowerCase());
    expect(deps.some(d => d.includes('fastapi'))).toBe(true);
  });

  it('generates instructions file', async () => {
    const { generateInstructions } = await import('../generators/instructions.js');
    const stack = analyze(tmpDir);
    const githubDir = path.join(tmpDir, '.github');
    fs.mkdirSync(githubDir, { recursive: true });

    generateInstructions(stack, tmpDir, { refreshExisting: false });

    const instructionsPath = path.join(githubDir, 'copilot-instructions.md');
    expect(fs.existsSync(instructionsPath)).toBe(true);
    const content = fs.readFileSync(instructionsPath, 'utf-8');
    expect(content.length).toBeGreaterThan(100);
  });

  it('stack shape matches snapshot', () => {
    const stack = analyze(tmpDir);
    expect({
      primaryLanguage: stack.primaryLanguage.name,
      packageManager: stack.patterns.packageManager,
      frameworks: stack.frameworks.map(f => f.name).sort(),
    }).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Go service
// ---------------------------------------------------------------------------
describe('examples/go-service — stack detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = copyFixture('go-service');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Go as primary language', () => {
    const stack = analyze(tmpDir);
    expect(stack.primaryLanguage.name).toBe('Go');
  });

  it('generates instructions file', async () => {
    const { generateInstructions } = await import('../generators/instructions.js');
    const stack = analyze(tmpDir);
    const githubDir = path.join(tmpDir, '.github');
    fs.mkdirSync(githubDir, { recursive: true });

    generateInstructions(stack, tmpDir, { refreshExisting: false });

    const instructionsPath = path.join(githubDir, 'copilot-instructions.md');
    expect(fs.existsSync(instructionsPath)).toBe(true);
    const content = fs.readFileSync(instructionsPath, 'utf-8');
    expect(content.length).toBeGreaterThan(100);
  });

  it('stack shape matches snapshot', () => {
    const stack = analyze(tmpDir);
    expect({
      primaryLanguage: stack.primaryLanguage.name,
      packageManager: stack.patterns.packageManager,
      frameworks: stack.frameworks.map(f => f.name).sort(),
    }).toMatchSnapshot();
  });
});
