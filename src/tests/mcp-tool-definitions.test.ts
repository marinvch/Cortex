import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAllMcpTools as getGeneratorTools, getToolsWithStackSplit } from '../mcp-tools.js';
import { getAllMcpTools as getRuntimeTools, getActiveToolsForProject } from '../mcp-server/tool-definitions.js';
import type { DetectedStack, DetectedPatterns } from '../types.js';

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

describe('MCP tool definition parity', () => {
  it('runtime MCP tools match shared generator tool catalog', () => {
    const generatorTools = getGeneratorTools();
    const runtimeTools = getRuntimeTools();

    expect(runtimeTools.length).toBe(generatorTools.length);

    for (let i = 0; i < generatorTools.length; i++) {
      expect(runtimeTools[i]).toEqual({
        name: generatorTools[i].name,
        description: generatorTools[i].description,
        inputSchema: generatorTools[i].inputSchema,
      });
    }
  });
});

describe('getToolsWithStackSplit', () => {
  it('puts all always-condition tools in activeTools', () => {
    const stack = makeStack();
    const { activeTools, availableButInactive } = getToolsWithStackSplit(stack);
    // Tools without conditions (always) should all be in activeTools
    const searchTool = activeTools.find(t => t.name === 'search_codebase');
    expect(searchTool).toBeDefined();
    // Total should equal all tools
    expect(activeTools.length + availableButInactive.length).toBe(getGeneratorTools().length);
  });

  it('puts prisma/trpc tools in availableButInactive for non-prisma/trpc stack', () => {
    const stack = makeStack({ allDependencies: [] });
    const { availableButInactive } = getToolsWithStackSplit(stack);
    const hasPrisma = availableButInactive.some(t => t.name === 'get_prisma_schema');
    const hasTrpc = availableButInactive.some(t => t.name === 'get_trpc_procedures');
    expect(hasPrisma).toBe(true);
    expect(hasTrpc).toBe(true);
  });

  it('puts prisma tool in activeTools when prisma is in dependencies', () => {
    const stack = makeStack({ allDependencies: ['prisma'] });
    const { activeTools, availableButInactive } = getToolsWithStackSplit(stack);
    const prismaTool = activeTools.find(t => t.name === 'get_prisma_schema');
    const prismaInactive = availableButInactive.find(t => t.name === 'get_prisma_schema');
    expect(prismaTool).toBeDefined();
    expect(prismaInactive).toBeUndefined();
  });

  it('activeTools and availableButInactive are disjoint and cover all tools', () => {
    const stack = makeStack({ allDependencies: ['@trpc/server'] });
    const { activeTools, availableButInactive } = getToolsWithStackSplit(stack);
    const activeNames = new Set(activeTools.map(t => t.name));
    const inactiveNames = new Set(availableButInactive.map(t => t.name));
    // No overlap
    for (const name of activeNames) {
      expect(inactiveNames.has(name)).toBe(false);
    }
    // Cover all
    expect(activeTools.length + availableButInactive.length).toBe(getGeneratorTools().length);
  });
});

describe('getActiveToolsForProject', () => {
  it('falls back to all tools when tools.json does not exist', () => {
    const tmpDir = path.join(os.tmpdir(), `mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const tools = getActiveToolsForProject(tmpDir);
    expect(tools.length).toBe(getRuntimeTools().length);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads activeTools from new-format tools.json', () => {
    const tmpDir = path.join(os.tmpdir(), `mcp-test-new-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const aiOsDir = path.join(tmpDir, '.github', 'ai-os');
    fs.mkdirSync(aiOsDir, { recursive: true });

    const split = {
      activeTools: [{ name: 'search_codebase', description: 'Search', inputSchema: { type: 'object', properties: {} } }],
      availableButInactive: [{ name: 'get_prisma_schema', description: 'Prisma', inputSchema: { type: 'object', properties: {} } }],
    };
    fs.writeFileSync(path.join(aiOsDir, 'tools.json'), JSON.stringify(split), 'utf-8');

    const tools = getActiveToolsForProject(tmpDir);
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('search_codebase');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads all tools from legacy flat-array tools.json', () => {
    const tmpDir = path.join(os.tmpdir(), `mcp-test-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const aiOsDir = path.join(tmpDir, '.github', 'ai-os');
    fs.mkdirSync(aiOsDir, { recursive: true });

    const legacyTools = [
      { name: 'search_codebase', description: 'Search', inputSchema: { type: 'object', properties: {} } },
      { name: 'get_stack_info', description: 'Stack', inputSchema: { type: 'object', properties: {} } },
    ];
    fs.writeFileSync(path.join(aiOsDir, 'tools.json'), JSON.stringify(legacyTools), 'utf-8');

    const tools = getActiveToolsForProject(tmpDir);
    expect(tools.length).toBe(2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
