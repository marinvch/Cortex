/**
 * toolsets-and-chatmodes.test.ts
 *
 * Tests for the VS Code v1.101+ generators:
 * - generateToolsets  → .vscode/toolsets.json
 * - generateChatModes → .vscode/*.chatprompt.md
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { DetectedStack, DetectedPatterns } from '../types.js';

// ---------------------------------------------------------------------------
// Shared helpers
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

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `ai-os-toolsets-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// generateToolsets
// ---------------------------------------------------------------------------

describe('generateToolsets', () => {
  it('creates .vscode/toolsets.json for a minimal stack', async () => {
    const { generateToolsets } = await import('../generators/toolsets.js');
    const stack = makeStack();
    const files = generateToolsets(stack, tmpDir);

    const toolsetsPath = path.join(tmpDir, '.vscode', 'toolsets.json');
    expect(files).toContain(toolsetsPath);
    expect(fs.existsSync(toolsetsPath)).toBe(true);
  });

  it('always generates the three core tool sets', async () => {
    const { generateToolsets } = await import('../generators/toolsets.js');
    const stack = makeStack();
    generateToolsets(stack, tmpDir);

    const toolsetsPath = path.join(tmpDir, '.vscode', 'toolsets.json');
    const config = JSON.parse(fs.readFileSync(toolsetsPath, 'utf-8')) as Record<string, { tools: string[]; description: string }>;

    expect(config).toHaveProperty('ai-os-context');
    expect(config).toHaveProperty('ai-os-explore');
    expect(config).toHaveProperty('ai-os-plan');
  });

  it('core context toolset includes get_session_context and get_repo_memory', async () => {
    const { generateToolsets } = await import('../generators/toolsets.js');
    const stack = makeStack();
    generateToolsets(stack, tmpDir);

    const config = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.vscode', 'toolsets.json'), 'utf-8'),
    ) as Record<string, { tools: string[] }>;

    expect(config['ai-os-context'].tools).toContain('get_session_context');
    expect(config['ai-os-context'].tools).toContain('get_repo_memory');
  });

  it('does NOT include ai-os-backend for a pure frontend stack', async () => {
    const { generateToolsets } = await import('../generators/toolsets.js');
    const stack = makeStack({ allDependencies: ['react', 'vite'] });
    generateToolsets(stack, tmpDir);

    const config = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.vscode', 'toolsets.json'), 'utf-8'),
    ) as Record<string, unknown>;

    expect(config).not.toHaveProperty('ai-os-backend');
  });

  it('includes ai-os-backend with get_prisma_schema when Prisma is detected', async () => {
    const { generateToolsets } = await import('../generators/toolsets.js');
    const stack = makeStack({ allDependencies: ['@prisma/client', 'next'] });
    generateToolsets(stack, tmpDir);

    const config = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.vscode', 'toolsets.json'), 'utf-8'),
    ) as Record<string, { tools: string[] }>;

    expect(config).toHaveProperty('ai-os-backend');
    expect(config['ai-os-backend'].tools).toContain('get_prisma_schema');
    expect(config['ai-os-backend'].tools).toContain('get_api_routes');
  });

  it('includes ai-os-backend with get_trpc_procedures when tRPC is detected', async () => {
    const { generateToolsets } = await import('../generators/toolsets.js');
    const stack = makeStack({ allDependencies: ['@trpc/server'] });
    generateToolsets(stack, tmpDir);

    const config = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.vscode', 'toolsets.json'), 'utf-8'),
    ) as Record<string, { tools: string[] }>;

    expect(config).toHaveProperty('ai-os-backend');
    expect(config['ai-os-backend'].tools).toContain('get_trpc_procedures');
  });

  it('includes ai-os-backend for a Next.js stack without Prisma', async () => {
    const { generateToolsets } = await import('../generators/toolsets.js');
    const stack = makeStack({
      frameworks: [{ name: 'Next.js', category: 'fullstack', template: 'nextjs' }],
      allDependencies: ['next'],
    });
    generateToolsets(stack, tmpDir);

    const config = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.vscode', 'toolsets.json'), 'utf-8'),
    ) as Record<string, unknown>;

    expect(config).toHaveProperty('ai-os-backend');
  });

  it('produces valid JSON output (no trailing commas, no syntax errors)', async () => {
    const { generateToolsets } = await import('../generators/toolsets.js');
    generateToolsets(makeStack(), tmpDir);

    const raw = fs.readFileSync(path.join(tmpDir, '.vscode', 'toolsets.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('is idempotent — calling twice does not change file contents', async () => {
    const { generateToolsets } = await import('../generators/toolsets.js');
    const stack = makeStack();
    generateToolsets(stack, tmpDir);

    const before = fs.readFileSync(path.join(tmpDir, '.vscode', 'toolsets.json'), 'utf-8');
    generateToolsets(stack, tmpDir);
    const after = fs.readFileSync(path.join(tmpDir, '.vscode', 'toolsets.json'), 'utf-8');

    expect(before).toBe(after);
  });
});

// ---------------------------------------------------------------------------
// generateChatModes
// ---------------------------------------------------------------------------

describe('generateChatModes', () => {
  it('creates three .chatprompt.md files in .vscode/', async () => {
    const { generateChatModes } = await import('../generators/chatmodes.js');
    const stack = makeStack();
    const files = generateChatModes(stack, tmpDir);

    expect(files).toHaveLength(3);
    for (const f of files) {
      expect(f).toMatch(/\.chatprompt\.md$/);
      expect(fs.existsSync(f)).toBe(true);
    }
  });

  it('generates ai-os-plan, ai-os-review, and ai-os-explore modes', async () => {
    const { generateChatModes } = await import('../generators/chatmodes.js');
    generateChatModes(makeStack(), tmpDir);

    const vscodePath = path.join(tmpDir, '.vscode');
    expect(fs.existsSync(path.join(vscodePath, 'ai-os-plan.chatprompt.md'))).toBe(true);
    expect(fs.existsSync(path.join(vscodePath, 'ai-os-review.chatprompt.md'))).toBe(true);
    expect(fs.existsSync(path.join(vscodePath, 'ai-os-explore.chatprompt.md'))).toBe(true);
  });

  it('each chat mode file has valid YAML frontmatter with description and tools', async () => {
    const { generateChatModes } = await import('../generators/chatmodes.js');
    const files = generateChatModes(makeStack(), tmpDir);

    for (const f of files) {
      const content = fs.readFileSync(f, 'utf-8');
      expect(content.startsWith('---\n'), `${path.basename(f)} should start with frontmatter`).toBe(true);
      // description must be double-quoted to handle framework names with colons
      expect(content).toMatch(/^description: "/m);
      expect(content).toMatch(/^tools: \[/m);
    }
  });

  it('plan mode contains get_session_context in tools list', async () => {
    const { generateChatModes } = await import('../generators/chatmodes.js');
    generateChatModes(makeStack(), tmpDir);

    const content = fs.readFileSync(
      path.join(tmpDir, '.vscode', 'ai-os-plan.chatprompt.md'),
      'utf-8',
    );
    expect(content).toContain('get_session_context');
  });

  it('plan and review modes do not include editFiles — they are read-only', async () => {
    const { generateChatModes } = await import('../generators/chatmodes.js');
    generateChatModes(makeStack(), tmpDir);

    const vscodePath = path.join(tmpDir, '.vscode');
    for (const filename of ['ai-os-plan.chatprompt.md', 'ai-os-review.chatprompt.md']) {
      const content = fs.readFileSync(path.join(vscodePath, filename), 'utf-8');
      expect(content).not.toContain('editFiles');
      expect(content).not.toContain('runCommands');
    }
  });

  it('uses sanitized project language in mode descriptions', async () => {
    const { generateChatModes } = await import('../generators/chatmodes.js');
    const stack = makeStack({
      primaryLanguage: { name: 'TypeScript', percentage: 80, fileCount: 10, extensions: ['.ts'] },
    });
    generateChatModes(stack, tmpDir);

    const reviewContent = fs.readFileSync(
      path.join(tmpDir, '.vscode', 'ai-os-review.chatprompt.md'),
      'utf-8',
    );
    expect(reviewContent).toContain('TypeScript');
  });

  it('is idempotent — calling twice does not change file contents', async () => {
    const { generateChatModes } = await import('../generators/chatmodes.js');
    const stack = makeStack();
    generateChatModes(stack, tmpDir);

    const before = fs.readFileSync(
      path.join(tmpDir, '.vscode', 'ai-os-plan.chatprompt.md'),
      'utf-8',
    );
    generateChatModes(stack, tmpDir);
    const after = fs.readFileSync(
      path.join(tmpDir, '.vscode', 'ai-os-plan.chatprompt.md'),
      'utf-8',
    );

    expect(before).toBe(after);
  });

  it('sanitizes zero-width characters in language name', async () => {
    const { generateChatModes } = await import('../generators/chatmodes.js');
    const stack = makeStack({
      primaryLanguage: {
        name: 'TypeScript\u200B',
        percentage: 80,
        fileCount: 10,
        extensions: ['.ts'],
      },
    });
    generateChatModes(stack, tmpDir);

    const reviewContent = fs.readFileSync(
      path.join(tmpDir, '.vscode', 'ai-os-review.chatprompt.md'),
      'utf-8',
    );
    // Zero-width space must be stripped by sanitizeForInstructions
    expect(reviewContent).not.toContain('\u200B');
    // The base language name should still appear
    expect(reviewContent).toContain('TypeScript');
  });

  it('quotes description to survive framework names containing colons', async () => {
    const { generateChatModes } = await import('../generators/chatmodes.js');
    const stack = makeStack({
      primaryFramework: { name: 'ASP.NET: Core', category: 'backend', template: 'aspnet' },
    });
    generateChatModes(stack, tmpDir);

    const planContent = fs.readFileSync(
      path.join(tmpDir, '.vscode', 'ai-os-plan.chatprompt.md'),
      'utf-8',
    );
    // Colon inside a quoted description is safe YAML
    expect(planContent).toMatch(/^description: "/m);
    expect(planContent).toContain('ASP.NET');
  });
});
