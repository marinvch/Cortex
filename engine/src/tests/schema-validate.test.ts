import { describe, it, expect } from 'vitest';
import { isAiOsConfig } from '../types.js';
import { isAiOsManifest } from '../generators/utils.js';
import { isMcpToolDefinition } from '../mcp-server/tool-definitions.js';

describe('isAiOsManifest', () => {
  const valid = {
    version: '0.11.0',
    generatedAt: '2024-01-01T00:00:00.000Z',
    files: ['.github/copilot-instructions.md'],
  };

  it('accepts a valid manifest', () => {
    expect(isAiOsManifest(valid)).toBe(true);
  });

  it('accepts empty files array', () => {
    expect(isAiOsManifest({ ...valid, files: [] })).toBe(true);
  });

  it('rejects null', () => {
    expect(isAiOsManifest(null)).toBe(false);
  });

  it('rejects missing version', () => {
    const { version: _, ...rest } = valid;
    expect(isAiOsManifest(rest)).toBe(false);
  });

  it('rejects non-string in files array', () => {
    expect(isAiOsManifest({ ...valid, files: [42] })).toBe(false);
  });

  it('rejects a plain string', () => {
    expect(isAiOsManifest('not an object')).toBe(false);
  });
});

describe('isAiOsConfig', () => {
  const valid = {
    version: '0.11.0',
    installedAt: '2024-01-01T00:00:00.000Z',
    projectName: 'my-project',
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
    persistentRules: [],
    exclude: [],
  };

  it('accepts a valid config', () => {
    expect(isAiOsConfig(valid)).toBe(true);
  });

  it('rejects null', () => {
    expect(isAiOsConfig(null)).toBe(false);
  });

  it('rejects missing version', () => {
    const { version: _, ...rest } = valid;
    expect(isAiOsConfig(rest)).toBe(false);
  });

  it('rejects hasTypeScript as string', () => {
    expect(isAiOsConfig({ ...valid, hasTypeScript: 'true' })).toBe(false);
  });

  it('rejects persistentRules as string', () => {
    expect(isAiOsConfig({ ...valid, persistentRules: 'rule' })).toBe(false);
  });

  it('rejects missing exclude', () => {
    const { exclude: _, ...rest } = valid;
    expect(isAiOsConfig(rest)).toBe(false);
  });

  it('accepts optional fields being absent', () => {
    // skillsStrategy, profile, memoryTtlDays etc. are optional
    expect(isAiOsConfig(valid)).toBe(true);
  });

  it('rejects a plain array', () => {
    expect(isAiOsConfig([])).toBe(false);
  });
});

describe('isMcpToolDefinition', () => {
  const valid = {
    name: 'get_conventions',
    description: 'Returns coding conventions for the project.',
    inputSchema: { type: 'object', properties: {} },
  };

  it('accepts a valid tool definition', () => {
    expect(isMcpToolDefinition(valid)).toBe(true);
  });

  it('accepts a tool with required array in inputSchema', () => {
    expect(isMcpToolDefinition({
      ...valid,
      inputSchema: { type: 'object', properties: {}, required: ['query'] },
    })).toBe(true);
  });

  it('rejects null', () => {
    expect(isMcpToolDefinition(null)).toBe(false);
  });

  it('rejects missing name', () => {
    const { name: _, ...rest } = valid;
    expect(isMcpToolDefinition(rest)).toBe(false);
  });

  it('rejects empty name string', () => {
    expect(isMcpToolDefinition({ ...valid, name: '' })).toBe(false);
  });

  it('rejects missing description', () => {
    const { description: _, ...rest } = valid;
    expect(isMcpToolDefinition(rest)).toBe(false);
  });

  it('rejects missing inputSchema', () => {
    const { inputSchema: _, ...rest } = valid;
    expect(isMcpToolDefinition(rest)).toBe(false);
  });

  it('rejects inputSchema without type=object', () => {
    expect(isMcpToolDefinition({ ...valid, inputSchema: { type: 'array', properties: {} } })).toBe(false);
  });

  it('rejects a plain string', () => {
    expect(isMcpToolDefinition('get_conventions')).toBe(false);
  });
});
