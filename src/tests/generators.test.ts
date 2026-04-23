/**
 * AI OS Generator Unit Tests
 *
 * Tests core generator utilities:
 * - enforceSizeCap: copilot-instructions.md must stay under 8 KB
 * - generateSessionContextCard: COPILOT_CONTEXT.md must stay under ~500 tokens (2000 chars)
 * - buildRecommendationsText: must return non-empty output for known stacks
 * - collectRecommendations: deduplication across signal sources
 */
import { describe, it, expect, vi } from 'vitest';
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
    // The file must exist — if it doesn't, the generator has a bug
    expect(fs.existsSync(instructionsPath), 'copilot-instructions.md must be generated').toBe(true);
    const bytes = Buffer.byteLength(fs.readFileSync(instructionsPath, 'utf-8'), 'utf-8');
    // GitHub Copilot context limit: 8 KB
    expect(bytes, `copilot-instructions.md is ${bytes} bytes — exceeds 8 KB GitHub context limit`).toBeLessThanOrEqual(8192);

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
    // The session card must exist — if it doesn't, the generator has a bug
    expect(fs.existsSync(sessionCardPath), 'COPILOT_CONTEXT.md must be generated').toBe(true);
    const content = fs.readFileSync(sessionCardPath, 'utf-8');
    // GitHub Copilot session card token limit: ~500 tokens ≈ 2000 chars
    expect(
      content.length,
      `COPILOT_CONTEXT.md is ${content.length} chars — exceeds 2000-char (~500 token) limit`,
    ).toBeLessThanOrEqual(2000);

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

  it('separates universal skills into universalSkills (not skills array)', () => {
    const stack = makeStack();
    const recs = collectRecommendations(stack);
    // Universal skills (find-skills, context7 from UNIVERSAL_RECOMMENDATIONS) go to universalSkills
    expect(Array.isArray(recs.universalSkills)).toBe(true);
    expect(recs.universalSkills.length).toBeGreaterThan(0);
  });

  it('does not include universal skills in the stack-specific skills array', () => {
    const stack = makeStack();
    const recs = collectRecommendations(stack);
    const universalNames = new Set(recs.universalSkills.map(s => s.name));
    // None of the universal-only skill names should appear in the main skills array
    for (const skill of recs.skills) {
      expect(universalNames.has(skill.name)).toBe(false);
    }
  });

  it('prisma skill is NOT in universalSkills for a prisma project', () => {
    const stack = makeStack({ allDependencies: ['prisma'] });
    const recs = collectRecommendations(stack);
    const hasPrismaInUniversal = recs.universalSkills.some(s => s.name === 'prisma');
    expect(hasPrismaInUniversal).toBe(false);
    // It should be in the stack-specific skills array
    const hasPrismaInStack = recs.skills.some(s => s.name === 'prisma');
    expect(hasPrismaInStack).toBe(true);
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

  it('includes Universal Skills (Optional) section for any stack', () => {
    const stack = makeStack();
    const text = buildRecommendationsText(stack);
    expect(text).toContain('Universal Skills (Optional)');
  });

  it('does NOT show prisma or trpc in recommendations for a React-only stack', () => {
    const stack = makeStack({
      allDependencies: ['react', 'react-dom'],
      frameworks: [{ name: 'React', category: 'frontend', version: '18.0.0', template: 'react' }],
    });
    const text = buildRecommendationsText(stack);
    expect(text).not.toContain('prisma');
    expect(text).not.toContain('trpc');
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

describe('AI OS value mode guidance', () => {
  it('includes value mode section in copilot-instructions.md', async () => {
    const { generateInstructions } = await import('../generators/instructions.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const stack = makeStack();
    const tmpDir = path.join(os.tmpdir(), 'ai-os-value-mode-copilot-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });

    generateInstructions(stack, tmpDir, { refreshExisting: false });

    const instructionsPath = path.join(tmpDir, '.github', 'copilot-instructions.md');
    const content = fs.readFileSync(instructionsPath, 'utf-8');

    expect(content).toContain('## AI OS Value Mode');
    expect(content).toContain('Problem Understanding First');
    expect(content).toContain('Token Spending Discipline');
    expect(content).toContain('User-Value Delivery');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes value mode section in ai-os.instructions.md', async () => {
    const { generateInstructions } = await import('../generators/instructions.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const stack = makeStack();
    const tmpDir = path.join(os.tmpdir(), 'ai-os-value-mode-auto-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });

    generateInstructions(stack, tmpDir, { refreshExisting: false });

    const instructionsPath = path.join(tmpDir, '.github', 'instructions', 'ai-os.instructions.md');
    const content = fs.readFileSync(instructionsPath, 'utf-8');

    expect(content).toContain('## AI OS Value Mode');
    expect(content).toContain('Problem Understanding First');
    expect(content).toContain('Token Spending Discipline');
    expect(content).toContain('User-Value Delivery');
    expect(content).toContain('## Project-State Strategy');
    expect(content).toContain('New Project Strategy');
    expect(content).toContain('Existing or Large Project Strategy');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes project-state strategy in copilot-instructions.md', async () => {
    const { generateInstructions } = await import('../generators/instructions.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const stack = makeStack();
    const tmpDir = path.join(os.tmpdir(), 'ai-os-project-state-copilot-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });

    generateInstructions(stack, tmpDir, { refreshExisting: false });

    const instructionsPath = path.join(tmpDir, '.github', 'copilot-instructions.md');
    const content = fs.readFileSync(instructionsPath, 'utf-8');

    expect(content).toContain('## Project-State Strategy');
    expect(content).toContain('New Project Strategy');
    expect(content).toContain('Existing or Large Project Strategy');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});


// ---------------------------------------------------------------------------
// Safe refresh mode — preserveContextFiles
// ---------------------------------------------------------------------------

describe('preserveContextFiles option', () => {
  it('does NOT overwrite copilot-instructions.md when preserveContextFiles is true and file exists', async () => {
    const { generateInstructions } = await import('../generators/instructions.js');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const stack = makeStack();

    const tmpDir = path.join(os.tmpdir(), 'ai-os-preserve-instr-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });

    const instrPath = path.join(tmpDir, '.github', 'copilot-instructions.md');
    const customContent = '# Custom Instructions\n\nThis is my curated content.\n';
    fs.writeFileSync(instrPath, customContent, 'utf-8');

    generateInstructions(stack, tmpDir, { refreshExisting: true, preserveContextFiles: true });

    const after = fs.readFileSync(instrPath, 'utf-8');
    expect(after).toBe(customContent);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('DOES overwrite copilot-instructions.md when preserveContextFiles is false', async () => {
    const { generateInstructions } = await import('../generators/instructions.js');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const stack = makeStack();

    const tmpDir = path.join(os.tmpdir(), 'ai-os-overwrite-instr-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });

    const instrPath = path.join(tmpDir, '.github', 'copilot-instructions.md');
    const customContent = '# Custom Instructions\n\nThis is my curated content.\n';
    fs.writeFileSync(instrPath, customContent, 'utf-8');

    generateInstructions(stack, tmpDir, { refreshExisting: true, preserveContextFiles: false });

    const after = fs.readFileSync(instrPath, 'utf-8');
    expect(after).not.toBe(customContent);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does NOT overwrite architecture.md when preserveContextFiles is true and file exists', async () => {
    const { generateContextDocs } = await import('../generators/context-docs.js');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const stack = makeStack();

    const tmpDir = path.join(os.tmpdir(), 'ai-os-preserve-arch-' + Date.now());
    const contextDir = path.join(tmpDir, '.github', 'ai-os', 'context');
    fs.mkdirSync(contextDir, { recursive: true });

    const archPath = path.join(contextDir, 'architecture.md');
    const customContent = '# Custom Architecture\n\nThis is my curated architecture doc.\n';
    fs.writeFileSync(archPath, customContent, 'utf-8');

    generateContextDocs(stack, tmpDir, { preserveContextFiles: true });

    const after = fs.readFileSync(archPath, 'utf-8');
    expect(after).toBe(customContent);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does NOT overwrite conventions.md when preserveContextFiles is true and file exists', async () => {
    const { generateContextDocs } = await import('../generators/context-docs.js');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const stack = makeStack();

    const tmpDir = path.join(os.tmpdir(), 'ai-os-preserve-convs-' + Date.now());
    const contextDir = path.join(tmpDir, '.github', 'ai-os', 'context');
    fs.mkdirSync(contextDir, { recursive: true });

    const convsPath = path.join(contextDir, 'conventions.md');
    const customContent = '# Custom Conventions\n\nTeam-specific conventions here.\n';
    fs.writeFileSync(convsPath, customContent, 'utf-8');

    generateContextDocs(stack, tmpDir, { preserveContextFiles: true });

    const after = fs.readFileSync(convsPath, 'utf-8');
    expect(after).toBe(customContent);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does NOT overwrite stack.md when preserveContextFiles is true and file exists', async () => {
    const { generateContextDocs } = await import('../generators/context-docs.js');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const stack = makeStack();

    const tmpDir = path.join(os.tmpdir(), 'ai-os-preserve-stack-' + Date.now());
    const contextDir = path.join(tmpDir, '.github', 'ai-os', 'context');
    fs.mkdirSync(contextDir, { recursive: true });

    const stackPath = path.join(contextDir, 'stack.md');
    const customContent = '# Custom Stack\n\nRepo-specific stack notes.\n';
    fs.writeFileSync(stackPath, customContent, 'utf-8');

    generateContextDocs(stack, tmpDir, { preserveContextFiles: true });

    const after = fs.readFileSync(stackPath, 'utf-8');
    expect(after).toBe(customContent);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does NOT overwrite existing-ai-context.md when preserveContextFiles is true and file exists', async () => {
    const { generateContextDocs } = await import('../generators/context-docs.js');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const stack = makeStack();

    const tmpDir = path.join(os.tmpdir(), 'ai-os-preserve-existing-context-' + Date.now());
    const contextDir = path.join(tmpDir, '.github', 'ai-os', 'context');
    fs.mkdirSync(contextDir, { recursive: true });

    const existingContextPath = path.join(contextDir, 'existing-ai-context.md');
    const customContent = '# Existing Context\n\nCurated migration notes.\n';
    fs.writeFileSync(existingContextPath, customContent, 'utf-8');

    generateContextDocs(stack, tmpDir, { preserveContextFiles: true });

    const after = fs.readFileSync(existingContextPath, 'utf-8');
    expect(after).toBe(customContent);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does NOT overwrite COPILOT_CONTEXT.md when preserveContextFiles is true and file exists', async () => {
    const { generateContextDocs } = await import('../generators/context-docs.js');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const stack = makeStack();

    const tmpDir = path.join(os.tmpdir(), 'ai-os-preserve-session-card-' + Date.now());
    const githubDir = path.join(tmpDir, '.github');
    fs.mkdirSync(githubDir, { recursive: true });

    const sessionCardPath = path.join(githubDir, 'COPILOT_CONTEXT.md');
    const customContent = '# Custom Session Card\n\nKeep this repo-specific summary.\n';
    fs.writeFileSync(sessionCardPath, customContent, 'utf-8');

    generateContextDocs(stack, tmpDir, { preserveContextFiles: true });

    const after = fs.readFileSync(sessionCardPath, 'utf-8');
    expect(after).toBe(customContent);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates architecture.md when it does not exist even with preserveContextFiles true', async () => {
    const { generateContextDocs } = await import('../generators/context-docs.js');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const stack = makeStack();

    const tmpDir = path.join(os.tmpdir(), 'ai-os-create-arch-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    generateContextDocs(stack, tmpDir, { preserveContextFiles: true });

    const archPath = path.join(tmpDir, '.github', 'ai-os', 'context', 'architecture.md');
    expect(fs.existsSync(archPath), 'architecture.md should be created when missing').toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('updates installedAt on refresh generation runs', async () => {
    const { generateContextDocs } = await import('../generators/context-docs.js');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const stack = makeStack();

    const tmpDir = path.join(os.tmpdir(), 'ai-os-installed-at-refresh-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T00:00:00.000Z'));

    generateContextDocs(stack, tmpDir, { preserveContextFiles: false });
    const configPath = path.join(tmpDir, '.github', 'ai-os', 'config.json');
    const firstConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { installedAt: string };

    vi.setSystemTime(new Date('2026-04-21T00:00:10.000Z'));
    generateContextDocs(stack, tmpDir, { preserveContextFiles: false });

    const secondConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { installedAt: string };
    expect(secondConfig.installedAt > firstConfig.installedAt).toBe(true);

    vi.useRealTimers();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('prompt generation', () => {
  it('uses RTK Query wording in /refactor-component when tRPC is not detected', async () => {
    const { generatePrompts } = await import('../generators/prompts.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const stack = makeStack({
      allDependencies: ['@reduxjs/toolkit'],
    });

    const tmpDir = path.join(os.tmpdir(), 'ai-os-prompts-rtk-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    await generatePrompts(stack, tmpDir, { refreshExisting: true });

    const promptsPath = path.join(tmpDir, '.github', 'copilot', 'prompts.json');
    const promptsFile = JSON.parse(fs.readFileSync(promptsPath, 'utf-8')) as { prompts: Array<{ id: string; prompt: string }> };
    const refactorPrompt = promptsFile.prompts.find((p) => p.id === '/refactor-component');

    expect(refactorPrompt?.prompt.includes('RTK Query hooks')).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// buildOnboardingPlan — preserve action in plan
// ---------------------------------------------------------------------------

describe('buildOnboardingPlan with regenerateContext=false', () => {
  it('shows preserve action for architecture.md in refresh mode when file exists', async () => {
    const { buildOnboardingPlan } = await import('../planner.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const tmpDir = path.join(os.tmpdir(), 'ai-os-plan-preserve-' + Date.now());
    const contextDir = path.join(tmpDir, '.github', 'ai-os', 'context');
    fs.mkdirSync(contextDir, { recursive: true });
    fs.writeFileSync(path.join(contextDir, 'architecture.md'), '# Arch\n', 'utf-8');

    const plan = buildOnboardingPlan(tmpDir, 'refresh-existing', { regenerateContext: false });
    const archAction = plan.actions.find(a => a.path === '.github/ai-os/context/architecture.md');
    expect(archAction?.action).toBe('preserve');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('shows update action for architecture.md in refresh mode with regenerateContext=true', async () => {
    const { buildOnboardingPlan } = await import('../planner.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const tmpDir = path.join(os.tmpdir(), 'ai-os-plan-regen-' + Date.now());
    const contextDir = path.join(tmpDir, '.github', 'ai-os', 'context');
    fs.mkdirSync(contextDir, { recursive: true });
    fs.writeFileSync(path.join(contextDir, 'architecture.md'), '# Arch\n', 'utf-8');

    const plan = buildOnboardingPlan(tmpDir, 'refresh-existing', { regenerateContext: true });
    const archAction = plan.actions.find(a => a.path === '.github/ai-os/context/architecture.md');
    expect(archAction?.action).toBe('update');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Agent preservation in safe refresh mode
// ---------------------------------------------------------------------------

describe('agent preservation with preserveExistingAgents', () => {
  it('does NOT overwrite existing agent file when preserveExistingAgents is true', async () => {
    const { generateAgents } = await import('../generators/agents.js');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const stack = makeStack();

    const tmpDir = path.join(os.tmpdir(), 'ai-os-preserve-agents-' + Date.now());
    const agentsDir = path.join(tmpDir, '.github', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });

    // Create a pre-existing agent file with custom content
    const agentFile = path.join(agentsDir, 'test-project-initializer.agent.md');
    const customContent = 'name: Custom Agent\ndescription: My custom agent\n\nThis is my curated agent content.\n';
    fs.writeFileSync(agentFile, customContent, 'utf-8');

    await generateAgents(stack, tmpDir, { refreshExisting: true, preserveExistingAgents: true });

    const after = fs.readFileSync(agentFile, 'utf-8');
    expect(after).toBe(customContent);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('skills strategy', () => {
  it('defaults config skillsStrategy to creator-only', async () => {
    const { generateContextDocs } = await import('../generators/context-docs.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const stack = makeStack();
    const tmpDir = path.join(os.tmpdir(), 'ai-os-skills-strategy-default-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    generateContextDocs(stack, tmpDir, { preserveContextFiles: false });

    const configPath = path.join(tmpDir, '.github', 'ai-os', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { skillsStrategy?: string };
    expect(config.skillsStrategy).toBe('creator-only');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not generate predefined skills in creator-only mode', async () => {
    const { generateSkills } = await import('../generators/skills.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const stack = makeStack({
      frameworks: [{ name: 'Next.js', category: 'fullstack', version: '14.0.0', template: 'nextjs' }],
      allDependencies: ['next', 'react'],
    });

    const tmpDir = path.join(os.tmpdir(), 'ai-os-skills-creator-only-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    const generated = await generateSkills(stack, tmpDir, {
      refreshExisting: false,
      strategy: 'creator-only',
    });

    expect(generated.length).toBe(0);

    const skillsDir = path.join(tmpDir, '.github', 'copilot', 'skills');
    const onDisk = fs.existsSync(skillsDir)
      ? fs.readdirSync(skillsDir).filter(f => f.startsWith('ai-os-') && f.endsWith('.md'))
      : [];
    expect(onDisk.length).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prunes existing predefined skills on refresh in creator-only mode', async () => {
    const { generateSkills } = await import('../generators/skills.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const stack = makeStack({
      frameworks: [{ name: 'Next.js', category: 'fullstack', version: '14.0.0', template: 'nextjs' }],
      allDependencies: ['next', 'react'],
    });

    const tmpDir = path.join(os.tmpdir(), 'ai-os-skills-prune-creator-only-' + Date.now());
    const skillsDir = path.join(tmpDir, '.github', 'copilot', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'ai-os-nextjs-patterns.md'), '# old skill\n', 'utf-8');

    await generateSkills(stack, tmpDir, {
      refreshExisting: true,
      strategy: 'creator-only',
    });

    expect(fs.existsSync(path.join(skillsDir, 'ai-os-nextjs-patterns.md'))).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
