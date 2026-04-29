import { describe, it, expect } from 'vitest';
import { getRepoMemory, rememberRepoFact, getMemoryGuidelines, pruneMemory, syncHostedMemory } from '../mcp-server/memory.js';
import { getActivePlan, upsertActivePlan, appendCheckpoint, resetSessionState } from '../mcp-server/session.js';
import { getEnvVars, getFileSummary, getPrismaSchema } from '../mcp-server/project-introspection.js';
import { searchFiles, buildFileTree } from '../mcp-server/search.js';
import { getContextFreshness } from '../mcp-server/freshness-bridge.js';
import { getRecommendations, suggestImprovements } from '../mcp-server/recommendations-bridge.js';

describe('mcp-server sub-modules export contract', () => {
  it('memory.ts exports getRepoMemory as a function', () => {
    expect(typeof getRepoMemory).toBe('function');
  });

  it('memory.ts exports rememberRepoFact as a function', () => {
    expect(typeof rememberRepoFact).toBe('function');
  });

  it('memory.ts exports getMemoryGuidelines as a function', () => {
    expect(typeof getMemoryGuidelines).toBe('function');
  });

  it('memory.ts exports pruneMemory as a function', () => {
    expect(typeof pruneMemory).toBe('function');
  });

  it('memory.ts exports syncHostedMemory as a function', () => {
    expect(typeof syncHostedMemory).toBe('function');
  });

  it('session.ts exports getActivePlan as a function', () => {
    expect(typeof getActivePlan).toBe('function');
  });

  it('session.ts exports upsertActivePlan as a function', () => {
    expect(typeof upsertActivePlan).toBe('function');
  });

  it('session.ts exports appendCheckpoint as a function', () => {
    expect(typeof appendCheckpoint).toBe('function');
  });

  it('session.ts exports resetSessionState as a function', () => {
    expect(typeof resetSessionState).toBe('function');
  });

  it('project-introspection.ts exports getEnvVars as a function', () => {
    expect(typeof getEnvVars).toBe('function');
  });

  it('project-introspection.ts exports getFileSummary as a function', () => {
    expect(typeof getFileSummary).toBe('function');
  });

  it('project-introspection.ts exports getPrismaSchema as a function', () => {
    expect(typeof getPrismaSchema).toBe('function');
  });

  it('search.ts exports searchFiles as a function', () => {
    expect(typeof searchFiles).toBe('function');
  });

  it('search.ts exports buildFileTree as a function', () => {
    expect(typeof buildFileTree).toBe('function');
  });

  it('freshness-bridge.ts exports getContextFreshness as a function', () => {
    expect(typeof getContextFreshness).toBe('function');
  });

  it('recommendations-bridge.ts exports getRecommendations as a function', () => {
    expect(typeof getRecommendations).toBe('function');
  });

  it('recommendations-bridge.ts exports suggestImprovements as a function', () => {
    expect(typeof suggestImprovements).toBe('function');
  });
});

describe('mcp-server sub-module basic runtime behaviour', () => {
  it('getActivePlan returns a string when no plan exists', () => {
    const result = getActivePlan();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('getEnvVars returns a string', () => {
    const result = getEnvVars();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('buildFileTree returns an array of strings for the project root', () => {
    const tree = buildFileTree(process.cwd(), 0, 1);
    expect(Array.isArray(tree)).toBe(true);
    expect(tree.length).toBeGreaterThan(0);
  });

  it('getRecommendations returns a non-empty string', () => {
    const result = getRecommendations();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('suggestImprovements returns a non-empty string', () => {
    const result = suggestImprovements();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('getContextFreshness returns a non-empty string', () => {
    const result = getContextFreshness();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('getMemoryGuidelines returns a non-empty string', () => {
    const result = getMemoryGuidelines();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
