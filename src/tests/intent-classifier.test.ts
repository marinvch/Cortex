import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../mcp-server/search.js';
import type { IntentType } from '../types.js';

const INTENT_CASES: Array<{ prompt: string; expected: IntentType }> = [
  { prompt: 'add a new feature for user notifications', expected: 'new-feature' },
  { prompt: 'fix the login crash when password is empty', expected: 'bug-fix' },
  { prompt: 'refactor the auth module to extract a service', expected: 'refactor' },
  { prompt: 'create a migration for the payments table schema', expected: 'db-change' },
  { prompt: 'write unit tests for the cart checkout function', expected: 'test-addition' },
  { prompt: 'upgrade typescript to version 5', expected: 'dependency-update' },
  { prompt: 'document the API endpoints in the readme', expected: 'docs-update' },
  { prompt: 'configure the ci cd workflow environment settings', expected: 'config-change' },
];

describe('classifyIntent — intent type routing', () => {
  for (const { prompt, expected } of INTENT_CASES) {
    it(`classifies "${prompt.slice(0, 50)}" as ${expected}`, () => {
      const result = classifyIntent(prompt);
      expect(result.intentType).toBe(expected);
    });
  }
});

describe('classifyIntent — output shape', () => {
  it('always returns a valid IntentResult', () => {
    const result = classifyIntent('do something');
    expect(typeof result.intentType).toBe('string');
    expect(['high', 'medium', 'low']).toContain(result.confidence);
    expect(Array.isArray(result.affectedDomain)).toBe(true);
    expect(typeof result.reasoning).toBe('string');
  });

  it('falls back to quick-edit for unrecognised prompts', () => {
    const result = classifyIntent('xyzzy blorp flibbertigibbet');
    expect(result.intentType).toBe('quick-edit');
    expect(result.confidence).toBe('low');
  });

  it('detects domain keywords in the prompt', () => {
    const result = classifyIntent('fix the authentication bug in the login api');
    expect(result.affectedDomain.length).toBeGreaterThan(0);
  });

  it('returns high confidence for 3+ matched keywords', () => {
    const result = classifyIntent('fix the broken error crash in the auth service');
    expect(result.intentType).toBe('bug-fix');
    expect(result.confidence).toBe('high');
  });

  it('suggests a skill for new-feature intent', () => {
    const result = classifyIntent('build a new payment feature');
    expect(result.intentType).toBe('new-feature');
    expect(result.suggestedSkill).toBe('brainstorming');
  });

  it('suggests systematic-debugging for bug-fix intent', () => {
    const result = classifyIntent('fix the error crash in prod');
    expect(result.suggestedSkill).toBe('systematic-debugging');
  });

  it('surfaces WORKFLOW-FORK question for new-feature', () => {
    const result = classifyIntent('add a new feature');
    expect(result.clarifyingQuestion).toBeTruthy();
  });

  it('does not surface WORKFLOW-FORK question for docs-update', () => {
    const result = classifyIntent('document the readme');
    expect(result.clarifyingQuestion).toBeNull();
  });
});
