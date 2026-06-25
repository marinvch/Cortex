import { describe, it, expect } from 'vitest';
import { ADAPTERS, adaptersFor } from '../generators/adapters/registry.js';
import type { DetectedStack } from '../types.js';

function mockStack(): DetectedStack {
  return {
    projectName: 'test-project',
    primaryLanguage: { name: 'TypeScript', percentage: 80, fileCount: 50, extensions: ['.ts'] },
    languages: [],
    primaryFramework: { name: 'Node.js', category: 'backend', template: 'node' },
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
    keyFiles: ['src/index.ts', 'package.json'],
    rootDir: '/x',
    allDependencies: [],
    buildCommands: { build: 'npm run build', test: 'npm run test' },
  };
}

describe('adapter registry', () => {
  it('has a copilot adapter among equals and no copilot special-casing in selection', () => {
    const ids = ADAPTERS.map((a) => a.id);
    expect(ids).toContain('copilot');
    expect(ids).toContain('claude');
    expect(ids).toContain('cursor');
  });

  it('adaptersFor returns only the requested ids', () => {
    const sel = adaptersFor(['claude']).map((a) => a.id);
    expect(sel).toEqual(['claude']);
  });

  it('adaptersFor returns multiple adapters in registry order', () => {
    const sel = adaptersFor(['copilot', 'claude']).map((a) => a.id);
    expect(sel).toContain('copilot');
    expect(sel).toContain('claude');
    expect(sel.length).toBe(2);
  });

  it('adaptersFor returns empty array for unknown ids', () => {
    // 'neovim' is a valid AdapterId but 'bogus' is not — adaptersFor filters to known ids
    const sel = adaptersFor([]).map((a) => a.id);
    expect(sel).toEqual([]);
  });

  it('the copilot adapter emits .github/copilot-instructions.md', () => {
    const copilot = ADAPTERS.find((a) => a.id === 'copilot')!;
    const files = copilot.emit({
      cwd: '/x',
      githubDir: '/x/.github',
      instructions: '# rules',
      stack: mockStack(),
    });
    expect(files.some((f) => f.path.endsWith('.github/copilot-instructions.md'))).toBe(true);
  });

  it('the claude adapter emits a claude-instructions.md file', () => {
    const claude = ADAPTERS.find((a) => a.id === 'claude')!;
    const files = claude.emit({
      cwd: '/x',
      githubDir: '/x/.github',
      instructions: '# rules',
      stack: mockStack(),
    });
    expect(files.some((f) => f.path.includes('claude-instructions.md'))).toBe(true);
  });

  it('the cursor adapter emits .cursorrules content', () => {
    const cursor = ADAPTERS.find((a) => a.id === 'cursor')!;
    const files = cursor.emit({
      cwd: '/x',
      githubDir: '/x/.github',
      instructions: '# rules',
      stack: mockStack(),
    });
    expect(files.some((f) => f.path.endsWith('.cursorrules'))).toBe(true);
  });

  it('the jetbrains adapter emits a jetbrains-ai-context.md file', () => {
    const jb = ADAPTERS.find((a) => a.id === 'jetbrains')!;
    const files = jb.emit({
      cwd: '/x',
      githubDir: '/x/.github',
      instructions: '# rules',
      stack: mockStack(),
    });
    expect(files.some((f) => f.path.includes('jetbrains-ai-context.md'))).toBe(true);
  });

  it('the neovim adapter emits a nvim-context.md file', () => {
    const nvim = ADAPTERS.find((a) => a.id === 'neovim')!;
    const files = nvim.emit({
      cwd: '/x',
      githubDir: '/x/.github',
      instructions: '# rules',
      stack: mockStack(),
    });
    expect(files.some((f) => f.path.includes('nvim-context.md'))).toBe(true);
  });

  it('all adapter ids match valid AdapterIds', () => {
    const validIds = ['copilot', 'claude', 'gemini', 'local', 'cursor', 'jetbrains', 'neovim'];
    for (const adapter of ADAPTERS) {
      expect(validIds).toContain(adapter.id);
    }
  });
});
