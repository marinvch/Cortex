import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateCursorRules,
  generateJetBrainsContext,
  generateNeovimContext,
  detectEditorTargets,
  parseEditorTarget,
} from '../generators/multi-editor.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { DetectedStack } from '../types.js';

function mockStack(overrides: Partial<DetectedStack> = {}): DetectedStack {
  return {
    projectName: 'my-project',
    primaryLanguage: { name: 'TypeScript', percentage: 80, fileCount: 50, extensions: ['.ts'] },
    languages: [],
    primaryFramework: { name: 'Next.js', category: 'fullstack', template: 'nextjs' },
    frameworks: [],
    patterns: {
      namingConvention: 'camelCase',
      testFramework: 'vitest',
      linter: 'eslint',
      formatter: undefined,
      bundler: undefined,
      packageManager: 'npm',
      hasTypeScript: true,
      hasDockerfile: false,
      hasCiCd: false,
      monorepo: false,
      srcDirectory: true,
    },
    keyFiles: ['src/index.ts', 'package.json', 'tsconfig.json'],
    rootDir: '/project',
    allDependencies: [],
    buildCommands: { build: 'npm run build', test: 'npm run test' },
    ...overrides,
  };
}

describe('parseEditorTarget', () => {
  it('parses valid targets', () => {
    expect(parseEditorTarget('cursor')).toBe('cursor');
    expect(parseEditorTarget('jetbrains')).toBe('jetbrains');
    expect(parseEditorTarget('neovim')).toBe('neovim');
    expect(parseEditorTarget('vscode')).toBe('vscode');
    expect(parseEditorTarget('all')).toBe('all');
  });

  it('returns null for invalid targets', () => {
    expect(parseEditorTarget('atom')).toBeNull();
    expect(parseEditorTarget('')).toBeNull();
    expect(parseEditorTarget('CURSOR')).toBe('cursor'); // case-insensitive
  });
});

describe('generateCursorRules', () => {
  it('generates cursor rules with header', () => {
    const stack = mockStack();
    const instructions = '# My Instructions\n\nSome rules here.\n';
    const result = generateCursorRules(stack, instructions);
    expect(result).toContain('# Cursor AI Rules');
    expect(result).toContain('my-project');
    expect(result).toContain('Some rules here.');
  });

  it('strips YAML front-matter from copilot-instructions', () => {
    const stack = mockStack();
    const instructions = '---\napplyTo: "**"\n---\n# My Instructions\n\nRules.\n';
    const result = generateCursorRules(stack, instructions);
    expect(result).not.toContain('applyTo:');
    expect(result).toContain('# My Instructions');
  });
});

describe('generateJetBrainsContext', () => {
  it('generates JetBrains context with project info', () => {
    const stack = mockStack();
    const result = generateJetBrainsContext(stack);
    expect(result).toContain('JetBrains');
    expect(result).toContain('my-project');
    expect(result).toContain('TypeScript');
    expect(result).toContain('npm run build');
    expect(result).toContain('npm run test');
  });

  it('includes eslint lint command when linter is detected', () => {
    const stack = mockStack();
    const result = generateJetBrainsContext(stack);
    expect(result).toContain('lint');
  });

  it('skips lint line when no linter detected', () => {
    const stack = mockStack({ patterns: { ...mockStack().patterns, linter: undefined } });
    const result = generateJetBrainsContext(stack);
    // Lint line should not appear since linter is undefined
    const lintLines = result.split('\n').filter(l => l.startsWith('- Lint:'));
    expect(lintLines.length).toBe(0);
  });
});

describe('generateNeovimContext', () => {
  it('generates neovim context with stack info', () => {
    const stack = mockStack();
    const result = generateNeovimContext(stack);
    expect(result).toContain('my-project');
    expect(result).toContain('Next.js');
    expect(result).toContain('npm run build');
    expect(result).toContain('npm run test');
    expect(result).toContain('## Rules');
    expect(result).toContain('## Key Files');
  });

  it('includes key files', () => {
    const stack = mockStack();
    const result = generateNeovimContext(stack);
    expect(result).toContain('src/index.ts');
  });
});

describe('detectEditorTargets', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'editor-test-')); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('always includes vscode', () => {
    const targets = detectEditorTargets(tmpDir);
    expect(targets).toContain('vscode');
  });

  it('detects jetbrains when .idea/ exists', () => {
    mkdirSync(join(tmpDir, '.idea'));
    const targets = detectEditorTargets(tmpDir);
    expect(targets).toContain('jetbrains');
  });

  it('detects cursor when .cursorrules exists', () => {
    writeFileSync(join(tmpDir, '.cursorrules'), '# rules');
    const targets = detectEditorTargets(tmpDir);
    expect(targets).toContain('cursor');
  });

  it('does not include jetbrains without .idea/', () => {
    const targets = detectEditorTargets(tmpDir);
    expect(targets).not.toContain('jetbrains');
  });
});
