/**
 * Unit tests for src/generators/workflows.ts and src/generators/mcp.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { DetectedStack } from '../types.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-os-generators-test-'));
}

function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function minimalStack(overrides: Partial<DetectedStack> = {}): DetectedStack {
  return {
    projectName: 'test-project',
    rootDir: '/tmp/test-project',
    primaryLanguage: { name: 'TypeScript', fileCount: 10, percentage: 100, extensions: ['ts'] },
    languages: [{ name: 'TypeScript', fileCount: 10, percentage: 100, extensions: ['ts'] }],
    frameworks: [],
    primaryFramework: undefined,
    allDependencies: [],
    keyFiles: [],
    patterns: {
      packageManager: 'npm',
      hasTypeScript: true,
      testFramework: 'Vitest',
      linter: undefined,
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

// ─── generateWorkflows ────────────────────────────────────────────────────────

describe('generateWorkflows', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => rmTmp(tmp));

  it('generates update-check workflow by default', async () => {
    const { generateWorkflows } = await import('../generators/workflows.js');
    const files = generateWorkflows(tmp);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('ai-os-update-check.yml');
    expect(fs.existsSync(files[0])).toBe(true);
  });

  it('skips workflow when updateCheckEnabled is false', async () => {
    const { generateWorkflows } = await import('../generators/workflows.js');
    const files = generateWorkflows(tmp, {
      config: {
        version: '0.11.0',
        installedAt: new Date().toISOString(),
        projectName: 'test',
        primaryLanguage: 'TypeScript',
        primaryFramework: null,
        frameworks: [],
        packageManager: 'npm',
        hasTypeScript: true,
        agentsMd: false,
        pathSpecificInstructions: true,
        recommendations: true,
        sessionContextCard: true,
        updateCheckEnabled: false,
        skillsStrategy: 'creator-only',
        agentFlowMode: 'create',
        strictStackFiltering: true,
        persistentRules: [],
        exclude: [],
      },
    });
    expect(files).toHaveLength(0);
  });

  it('creates the workflow directory recursively', async () => {
    const { generateWorkflows } = await import('../generators/workflows.js');
    generateWorkflows(tmp);
    expect(fs.existsSync(path.join(tmp, '.github', 'workflows'))).toBe(true);
  });

  it('workflow content includes correct schedule cron', async () => {
    const { generateWorkflows } = await import('../generators/workflows.js');
    const files = generateWorkflows(tmp);
    const content = fs.readFileSync(files[0], 'utf-8');
    expect(content).toContain('cron:');
    expect(content).toContain('workflow_dispatch');
  });
});

// ─── writeMcpServerConfig ─────────────────────────────────────────────────────

describe('writeMcpServerConfig', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => rmTmp(tmp));

  it('creates .vscode/mcp.json with ai-os server entry', async () => {
    const { writeMcpServerConfig } = await import('../generators/mcp.js');
    const outPath = writeMcpServerConfig(tmp);
    expect(outPath).toContain('mcp.json');
    const content = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    expect(content.servers['ai-os']).toBeDefined();
    expect(content.servers['ai-os'].type).toBe('stdio');
  });

  it('preserves existing servers when updating', async () => {
    const mcpDir = path.join(tmp, '.vscode');
    fs.mkdirSync(mcpDir, { recursive: true });
    fs.writeFileSync(
      path.join(mcpDir, 'mcp.json'),
      JSON.stringify({ servers: { 'my-server': { type: 'stdio', command: 'node', args: [] } } }),
    );
    const { writeMcpServerConfig } = await import('../generators/mcp.js');
    writeMcpServerConfig(tmp);
    const content = JSON.parse(fs.readFileSync(path.join(mcpDir, 'mcp.json'), 'utf-8'));
    expect(content.servers['my-server']).toBeDefined();
    expect(content.servers['ai-os']).toBeDefined();
  });

  it('uses custom command and args when provided', async () => {
    const { writeMcpServerConfig } = await import('../generators/mcp.js');
    writeMcpServerConfig(tmp, { command: '/usr/bin/node', args: ['/custom/path/server.js'] });
    const content = JSON.parse(fs.readFileSync(path.join(tmp, '.vscode', 'mcp.json'), 'utf-8'));
    expect(content.servers['ai-os'].command).toBe('/usr/bin/node');
    expect(content.servers['ai-os'].args).toContain('/custom/path/server.js');
  });
});

// ─── generateMcpJson ──────────────────────────────────────────────────────────

describe('generateMcpJson', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => rmTmp(tmp));

  it('returns tools.json in managed files list', async () => {
    const { generateMcpJson } = await import('../generators/mcp.js');
    const stack = minimalStack();
    const files = generateMcpJson(stack, tmp);
    expect(files.some(f => f.endsWith('tools.json'))).toBe(true);
  });

  it('creates tools.json with activeTools in strict mode (default)', async () => {
    const { generateMcpJson } = await import('../generators/mcp.js');
    const stack = minimalStack();
    generateMcpJson(stack, tmp);
    const toolsPath = path.join(tmp, '.github', 'ai-os', 'tools.json');
    const content = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'));
    // Strict mode (default) produces split object with activeTools
    expect(content.activeTools).toBeDefined();
    expect(Array.isArray(content.activeTools)).toBe(true);
  });

  it('creates tools.json as flat array in legacy mode', async () => {
    const { generateMcpJson } = await import('../generators/mcp.js');
    const stack = minimalStack();
    generateMcpJson(stack, tmp, {
      config: {
        version: '0.11.0',
        installedAt: new Date().toISOString(),
        projectName: 'test',
        primaryLanguage: 'TypeScript',
        primaryFramework: null,
        frameworks: [],
        packageManager: 'npm',
        hasTypeScript: true,
        agentsMd: false,
        pathSpecificInstructions: true,
        recommendations: true,
        sessionContextCard: true,
        updateCheckEnabled: true,
        skillsStrategy: 'creator-only',
        agentFlowMode: 'create',
        strictStackFiltering: false,
        persistentRules: [],
        exclude: [],
      },
    });
    const toolsPath = path.join(tmp, '.github', 'ai-os', 'tools.json');
    const content = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'));
    // Legacy mode produces a flat array
    expect(Array.isArray(content)).toBe(true);
  });
});
