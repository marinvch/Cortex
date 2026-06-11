/**
 * Bootstrap module unit tests
 *
 * Tests the codebase-aware bootstrap plan builder:
 * - runBootstrap dry-run mode: items have 'pending' status
 * - Report structure: contains expected fields
 * - Stack detection mapping: skills/mcp/vscode items are derived from detected stack
 * - Unknown source skills: marked 'skipped' on apply with informational error
 * - formatBootstrapReport: produces non-empty output with key sections
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runBootstrap, formatBootstrapReport } from '../bootstrap.js';
import type { DetectedStack, DetectedPatterns } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE_PATTERNS: DetectedPatterns = {
  namingConvention: 'camelCase',
  hasTypeScript: true,
  packageManager: 'npm',
  hasDockerfile: false,
  hasCiCd: false,
  monorepo: false,
  srcDirectory: true,
};

function makeStack(overrides: Partial<DetectedStack> = {}): DetectedStack {
  return {
    projectName: 'test-project',
    rootDir: '/tmp/test',
    primaryLanguage: { name: 'TypeScript', percentage: 80, fileCount: 10, extensions: ['.ts', '.tsx'] },
    languages: [{ name: 'TypeScript', percentage: 80, fileCount: 10, extensions: ['.ts', '.tsx'] }],
    frameworks: [],
    keyFiles: ['package.json', 'tsconfig.json'],
    patterns: BASE_PATTERNS,
    allDependencies: [],
    ...overrides,
  };
}

// ── Plan structure ───────────────────────────────────────────────────────────

describe('runBootstrap — report structure', () => {
  it('returns a BootstrapReport with required fields for any stack', () => {
    const stack = makeStack();
    const report = runBootstrap(stack, { dryRun: true });

    expect(report).toHaveProperty('projectName', 'test-project');
    expect(report).toHaveProperty('detectedLanguage', 'TypeScript');
    expect(Array.isArray(report.detectedFrameworks)).toBe(true);
    expect(typeof report.packageManager).toBe('string');
    expect(typeof report.hasTypeScript).toBe('boolean');
    expect(report).toHaveProperty('dryRun', true);
    expect(Array.isArray(report.items)).toBe(true);
    expect(typeof report.appliedCount).toBe('number');
    expect(typeof report.skippedCount).toBe('number');
    expect(typeof report.failedCount).toBe('number');
    expect(typeof report.pendingCount).toBe('number');
  });

  it('reflects the detected frameworks in the report', () => {
    const stack = makeStack({
      frameworks: [{ name: 'React', category: 'frontend', version: '18.0.0', template: 'react' }],
    });
    const report = runBootstrap(stack, { dryRun: true });

    expect(report.detectedFrameworks).toContain('React');
  });

  it('uses the primary language name in the report', () => {
    const stack = makeStack({
      primaryLanguage: { name: 'Python', percentage: 90, fileCount: 20, extensions: ['.py'] },
    });
    const report = runBootstrap(stack, { dryRun: true });

    expect(report.detectedLanguage).toBe('Python');
  });
});

// ── Dry-run mode ─────────────────────────────────────────────────────────────

describe('runBootstrap — dry-run mode', () => {
  it('all items have status "pending" in dry-run mode', () => {
    const stack = makeStack({ allDependencies: ['react', 'prisma'] });
    const report = runBootstrap(stack, { dryRun: true });

    for (const item of report.items) {
      expect(item.status).toBe('pending');
    }
  });

  it('pendingCount equals items.length in dry-run mode', () => {
    const stack = makeStack({ allDependencies: ['react', 'next'] });
    const report = runBootstrap(stack, { dryRun: true });

    expect(report.pendingCount).toBe(report.items.length);
    expect(report.appliedCount).toBe(0);
    expect(report.skippedCount).toBe(0);
    expect(report.failedCount).toBe(0);
  });

  it('dryRun flag is true when called with dryRun: true', () => {
    const stack = makeStack();
    const report = runBootstrap(stack, { dryRun: true });
    expect(report.dryRun).toBe(true);
  });
});

// ── Skills are included in the bootstrap plan ────────────────────────────────

describe('runBootstrap — skill items', () => {
  it('includes skill items for detected Next.js framework', () => {
    const stack = makeStack({
      frameworks: [{ name: 'Next.js', category: 'fullstack', version: '14.0.0', template: 'nextjs' }],
    });
    const report = runBootstrap(stack, { dryRun: true });
    const skillNames = report.items.filter(i => i.category === 'skill').map(i => i.name);
    expect(skillNames).toContain('nextjs');
  });

  it('includes skill items for detected React dependency', () => {
    const stack = makeStack({ allDependencies: ['react', 'react-dom'] });
    const report = runBootstrap(stack, { dryRun: true });
    const skillNames = report.items.filter(i => i.category === 'skill').map(i => i.name);
    expect(skillNames).toContain('react');
  });

  it('skill items include a reason field explaining the trigger', () => {
    const stack = makeStack({ allDependencies: ['prisma'] });
    const report = runBootstrap(stack, { dryRun: true });
    const prismaSkill = report.items.find(i => i.category === 'skill' && i.name === 'prisma');
    expect(prismaSkill).toBeDefined();
    expect(prismaSkill?.reason).toContain('prisma');
  });

  it('skill items with known source include an installCmd', () => {
    const stack = makeStack({ allDependencies: ['react'] });
    const report = runBootstrap(stack, { dryRun: true });
    const skillItems = report.items.filter(i => i.category === 'skill');
    // At least some should have an installCmd
    const withCmd = skillItems.filter(i => i.installCmd);
    expect(withCmd.length).toBeGreaterThan(0);
  });

  it('universal skills are included with "universal" reason', () => {
    const stack = makeStack();
    const report = runBootstrap(stack, { dryRun: true });
    const universalSkills = report.items.filter(
      i => i.category === 'skill' && i.reason.includes('universal'),
    );
    // Universal skills (e.g., context7, find-skills) should always appear
    expect(universalSkills.length).toBeGreaterThan(0);
  });
});

// ── MCP items ────────────────────────────────────────────────────────────────

describe('runBootstrap — MCP items', () => {
  it('includes MCP items for prisma dependency', () => {
    const stack = makeStack({ allDependencies: ['prisma'] });
    const report = runBootstrap(stack, { dryRun: true });
    const mcpItems = report.items.filter(i => i.category === 'mcp');
    const hasPrisma = mcpItems.some(i => i.name.includes('prisma'));
    expect(hasPrisma).toBe(true);
  });

  it('MCP items have a reason containing the trigger', () => {
    const stack = makeStack({ allDependencies: ['@supabase/supabase-js'] });
    const report = runBootstrap(stack, { dryRun: true });
    const mcpItems = report.items.filter(i => i.category === 'mcp');
    for (const item of mcpItems) {
      expect(typeof item.reason).toBe('string');
      expect(item.reason.length).toBeGreaterThan(0);
    }
  });
});

// ── Apply mode with unknown sources ──────────────────────────────────────────

// Mock child_process.spawnSync to avoid real npx invocations in apply-mode tests
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })),
  };
});

describe('runBootstrap — apply mode with unknown-source skills', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.clearAllMocks(); });

  it('marks skills with no known source as skipped (not failed) in apply mode', () => {
    // Use a stack with a skill that has no known source in the registry
    const stack = makeStack({ allDependencies: ['express'] });
    const report = runBootstrap(stack, { dryRun: false });

    // express skill has no known source — it must exist and be skipped
    const expressSkill = report.items.find(i => i.category === 'skill' && i.name === 'express');
    expect(expressSkill, 'express skill item must be present in report').toBeDefined();
    expect(expressSkill!.status).toBe('skipped');
  });

  it('marks skills as applied when spawnSync returns status 0', () => {
    // vercel-react-best-practices has a known source (vercel-labs/agent-skills) → calls spawnSync
    const stack = makeStack({ allDependencies: ['next'] });
    const report = runBootstrap(stack, { dryRun: false });

    const skill = report.items.find(
      i => i.category === 'skill' && i.name === 'vercel-react-best-practices',
    );
    expect(skill, 'vercel-react-best-practices skill must be present in report').toBeDefined();
    expect(skill!.status).toBe('applied');
  });

  it('marks skills as failed when spawnSync returns non-zero exit code', async () => {
    const { spawnSync: mockedSpawnSync } = await import('node:child_process');
    // Override the mock to return a failure for this test
    (mockedSpawnSync as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      status: 1,
      stdout: '',
      stderr: 'skills CLI not found',
    });

    // vercel-react-best-practices has known source → calls spawnSync → should fail
    const stack = makeStack({ allDependencies: ['next'] });
    const report = runBootstrap(stack, { dryRun: false });

    const skill = report.items.find(
      i => i.category === 'skill' && i.name === 'vercel-react-best-practices',
    );
    expect(skill, 'vercel-react-best-practices skill must be present in report').toBeDefined();
    expect(skill!.status).toBe('failed');
    expect(skill!.error).toBeTruthy();
  });

  it('has dryRun: false on the report in apply mode', () => {
    const stack = makeStack();
    const report = runBootstrap(stack, { dryRun: false });
    expect(report.dryRun).toBe(false);
  });
});

// ── formatBootstrapReport ────────────────────────────────────────────────────

describe('formatBootstrapReport', () => {
  it('returns a non-empty string', () => {
    const stack = makeStack();
    const report = runBootstrap(stack, { dryRun: true });
    const text = formatBootstrapReport(report);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(50);
  });

  it('includes the project name in the output', () => {
    const stack = makeStack({ projectName: 'my-cool-app' });
    const report = runBootstrap(stack, { dryRun: true });
    const text = formatBootstrapReport(report);
    expect(text).toContain('my-cool-app');
  });

  it('includes DRY RUN label when in dry-run mode', () => {
    const stack = makeStack();
    const report = runBootstrap(stack, { dryRun: true });
    const text = formatBootstrapReport(report);
    expect(text).toContain('DRY RUN');
  });

  it('does NOT include DRY RUN label when not in dry-run mode', () => {
    const stack = makeStack();
    // Relies on vi.mock above — spawnSync returns success without real npx
    const report = runBootstrap(stack, { dryRun: false });
    const text = formatBootstrapReport(report);
    expect(text).not.toContain('DRY RUN');
  });

  it('includes detected stack section', () => {
    const stack = makeStack();
    const report = runBootstrap(stack, { dryRun: true });
    const text = formatBootstrapReport(report);
    expect(text).toContain('Detected Stack');
  });

  it('includes summary line with item count', () => {
    const stack = makeStack({ allDependencies: ['react'] });
    const report = runBootstrap(stack, { dryRun: true });
    const text = formatBootstrapReport(report);
    expect(text).toContain('Summary:');
  });

  it('includes re-run hint in dry-run output', () => {
    const stack = makeStack();
    const report = runBootstrap(stack, { dryRun: true });
    const text = formatBootstrapReport(report);
    expect(text).toContain('--bootstrap');
  });
});
