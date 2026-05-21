/**
 * Tests for the interactive --init wizard (#175)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { DetectedStack } from '../types.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-os-init-test-'));
}

function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function minimalStack(overrides: Partial<DetectedStack> = {}): DetectedStack {
  return {
    projectName: 'my-project',
    rootDir: '/tmp/my-project',
    primaryLanguage: { name: 'TypeScript', fileCount: 10, percentage: 100, extensions: ['ts'] },
    languages: [{ name: 'TypeScript', fileCount: 10, percentage: 100, extensions: ['ts'] }],
    frameworks: [{ name: 'Next.js', category: 'fullstack', version: '14.0.0', template: 'nextjs' }],
    primaryFramework: { name: 'Next.js', category: 'fullstack', version: '14.0.0', template: 'nextjs' },
    allDependencies: ['next', 'react'],
    keyFiles: [],
    patterns: {
      packageManager: 'npm',
      hasTypeScript: true,
      testFramework: 'Jest',
      linter: 'ESLint',
      formatter: undefined,
      hasDockerfile: false,
      hasCiCd: false,
      namingConvention: 'camelCase',
      monorepo: false,
      srcDirectory: true,
    },
    ...overrides,
  };
}

describe('formatStackSummary', () => {
  it('formats stack summary with framework and language', async () => {
    const { formatStackSummary } = await import('../actions/init.js');
    const summary = formatStackSummary(minimalStack());
    expect(summary).toContain('Next.js');
    expect(summary).toContain('TypeScript');
    expect(summary).toContain('npm');
  });

  it('shows "No frameworks detected" when stack has no frameworks', async () => {
    const { formatStackSummary } = await import('../actions/init.js');
    const summary = formatStackSummary(minimalStack({ frameworks: [], primaryFramework: undefined }));
    expect(summary).toContain('No frameworks detected');
  });
});

describe('formatProfileDescription', () => {
  it('describes minimal profile', async () => {
    const { formatProfileDescription } = await import('../actions/init.js');
    const desc = formatProfileDescription('minimal');
    expect(desc).toContain('minimal');
    expect(desc.toLowerCase()).toMatch(/instruction|fast|small/);
  });

  it('describes standard profile', async () => {
    const { formatProfileDescription } = await import('../actions/init.js');
    const desc = formatProfileDescription('standard');
    expect(desc).toContain('standard');
  });

  it('describes full profile', async () => {
    const { formatProfileDescription } = await import('../actions/init.js');
    const desc = formatProfileDescription('full');
    expect(desc).toContain('full');
  });
});

describe('runInitWizard', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => { rmTmp(tmp); vi.restoreAllMocks(); });

  it('returns chosen profile when user confirms', async () => {
    const { runWizardLogic } = await import('../actions/init.js');

    const answers = ['', 'standard', 'y'];
    let idx = 0;
    const ask = async (_prompt: string) => answers[idx++] ?? '';

    const result = await runWizardLogic(minimalStack({ rootDir: tmp }), ask);
    expect(result).toEqual({ proceed: true, profile: 'standard' });
  });

  it('returns proceed:false when user aborts', async () => {
    const { runWizardLogic } = await import('../actions/init.js');

    const answers = ['', 'minimal', 'n'];
    let idx = 0;
    const ask = async (_prompt: string) => answers[idx++] ?? '';

    const result = await runWizardLogic(minimalStack({ rootDir: tmp }), ask);
    expect(result.proceed).toBe(false);
  });
});
