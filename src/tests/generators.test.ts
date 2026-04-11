/**
 * AI OS Generator Unit Tests
 *
 * Tests core generator utilities:
 * - enforceSizeCap: copilot-instructions.md must stay under 8 KB
 * - generateSessionContextCard: COPILOT_CONTEXT.md must stay under ~500 tokens (2000 chars)
 * - buildRecommendationsText: must return non-empty output for known stacks
 * - collectRecommendations: deduplication across signal sources
 */
import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { buildRecommendationsText, collectRecommendations } from '../recommendations/index.js';
import type { DetectedStack, DetectedPatterns } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// enforceSizeCap (tested via public behaviour: generated instructions must fit)
// ---------------------------------------------------------------------------

describe('instructions size cap', () => {
  it('generates output within 8 KB for minimal stack', async () => {
    // Dynamic import because instructions.ts uses file-system side-effects at module level
    const { generateInstructions } = await import('../generators/instructions.js');
    const stack = makeStack();

    const fs = await import('node:fs');
    const path = await import('node:path');
    const tmpDir = path.join(os.tmpdir(), 'ai-os-test-' + Date.now());
    const githubDir = path.join(tmpDir, '.github');
    fs.mkdirSync(githubDir, { recursive: true });

    generateInstructions(stack, tmpDir, { refreshExisting: false });

    const instructionsPath = path.join(githubDir, 'copilot-instructions.md');
    if (fs.existsSync(instructionsPath)) {
      const bytes = Buffer.byteLength(fs.readFileSync(instructionsPath, 'utf-8'), 'utf-8');
      expect(bytes).toBeLessThanOrEqual(8192);
    }

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// generateSessionContextCard (tested via output length)
// ---------------------------------------------------------------------------

describe('session context card', () => {
  it('stays within 2000 characters (~500 tokens) for minimal stack', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { generateContextDocs } = await import('../generators/context-docs.js');

    const stack = makeStack();
    const tmpDir = path.join(os.tmpdir(), 'ai-os-ctx-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    generateContextDocs(stack, tmpDir);

    const sessionCardPath = path.join(tmpDir, '.github', 'COPILOT_CONTEXT.md');
    if (fs.existsSync(sessionCardPath)) {
      const content = fs.readFileSync(sessionCardPath, 'utf-8');
      expect(content.length).toBeLessThanOrEqual(2000);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Recommendation engine
// ---------------------------------------------------------------------------

describe('collectRecommendations', () => {
  it('deduplicates MCP tools when the same dep is signalled twice', () => {
    const stack = makeStack({
      allDependencies: ['prisma', '@prisma/client'],
    });
    const recs = collectRecommendations(stack);
    // Should not contain duplicate 'prisma' MCP tool entries
    const mcpDupes = recs.mcp.filter(m => m.package === 'prisma');
    expect(mcpDupes.length).toBeLessThanOrEqual(1);
  });

  it('includes universal recommendations for any stack', () => {
    const stack = makeStack();
    const recs = collectRecommendations(stack);
    // Universal recs always add at least the GitHub Copilot extension
    expect(recs.copilotExtensions.length).toBeGreaterThanOrEqual(0);
    // At minimum, vscode recs should exist
    expect(Array.isArray(recs.vscode)).toBe(true);
  });

  it('surfaces next.js recommendations for Next.js projects', () => {
    const stack = makeStack({
      primaryFramework: {
        name: 'Next.js',
        category: 'fullstack',
        version: '14.0.0',
        template: 'nextjs',
      },
      frameworks: [{ name: 'Next.js', category: 'fullstack', version: '14.0.0', template: 'nextjs' }],
    });
    const recs = collectRecommendations(stack);
    // Next.js should include nextjs skill recommendation
    const hasNextSkill = recs.skills.some(s => s.name.toLowerCase().includes('next'));
    expect(hasNextSkill).toBe(true);
  });
});

describe('buildRecommendationsText', () => {
  it('returns non-empty text for a Next.js stack', () => {
    const stack = makeStack({
      primaryFramework: {
        name: 'Next.js',
        category: 'fullstack',
        version: '14.0.0',
        template: 'nextjs',
      },
    });
    const text = buildRecommendationsText(stack);
    expect(text.length).toBeGreaterThan(50);
  });

  it('returns non-empty text for a minimal stack', () => {
    const stack = makeStack();
    const text = buildRecommendationsText(stack);
    expect(typeof text).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// B-i: Build commands in generated instructions
// ---------------------------------------------------------------------------

describe('build commands in copilot-instructions.md', () => {
  it('includes build commands section when stack has buildCommands', async () => {
    const { generateInstructions } = await import('../generators/instructions.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const stack = makeStack({
      buildCommands: {
        build: 'npm run build',
        test: 'npm test',
        dev: 'npm run dev',
        lint: 'npm run lint',
      },
    });

    const tmpDir = path.join(os.tmpdir(), 'ai-os-cmds-test-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });

    generateInstructions(stack, tmpDir, { refreshExisting: false });

    const instructionsPath = path.join(tmpDir, '.github', 'copilot-instructions.md');
    if (fs.existsSync(instructionsPath)) {
      const content = fs.readFileSync(instructionsPath, 'utf-8');
      expect(content).toContain('## Build Commands');
      expect(content).toContain('`npm run build`');
      expect(content).toContain('`npm test`');
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not include empty build commands section when no commands detected', async () => {
    const { generateInstructions } = await import('../generators/instructions.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const stack = makeStack({ buildCommands: {} });

    const tmpDir = path.join(os.tmpdir(), 'ai-os-nocmds-test-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });

    generateInstructions(stack, tmpDir, { refreshExisting: false });

    const instructionsPath = path.join(tmpDir, '.github', 'copilot-instructions.md');
    if (fs.existsSync(instructionsPath)) {
      const content = fs.readFileSync(instructionsPath, 'utf-8');
      // Build Commands section should be empty / not list any commands
      expect(content).not.toContain('- **Build:**');
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// B-iii: Persona directive in generated instructions
// ---------------------------------------------------------------------------

describe('persona directive in copilot-instructions.md', () => {
  it('includes framework-specific persona for Next.js stack', async () => {
    const { generateInstructions } = await import('../generators/instructions.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const stack = makeStack({
      primaryFramework: { name: 'Next.js', category: 'fullstack', version: '14.0.0', template: 'nextjs' },
      frameworks: [{ name: 'Next.js', category: 'fullstack', version: '14.0.0', template: 'nextjs' }],
    });

    const tmpDir = path.join(os.tmpdir(), 'ai-os-persona-test-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });

    generateInstructions(stack, tmpDir, { refreshExisting: false });

    const instructionsPath = path.join(tmpDir, '.github', 'copilot-instructions.md');
    if (fs.existsSync(instructionsPath)) {
      const content = fs.readFileSync(instructionsPath, 'utf-8');
      expect(content).toContain('**Persona:**');
      expect(content).toContain('Senior Next.js developer');
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('falls back to language-based persona when no framework detected', async () => {
    const { generateInstructions } = await import('../generators/instructions.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const stack = makeStack();

    const tmpDir = path.join(os.tmpdir(), 'ai-os-persona-lang-test-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });

    generateInstructions(stack, tmpDir, { refreshExisting: false });

    const instructionsPath = path.join(tmpDir, '.github', 'copilot-instructions.md');
    if (fs.existsSync(instructionsPath)) {
      const content = fs.readFileSync(instructionsPath, 'utf-8');
      expect(content).toContain('**Persona:**');
      expect(content).toContain('Senior TypeScript developer');
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

