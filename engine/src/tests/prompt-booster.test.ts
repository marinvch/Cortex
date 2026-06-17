import { describe, it, expect } from 'vitest';
import { scoreVagueness, buildClarifyingQuestions, boostPrompt } from '../mcp-server/search.js';

describe('scoreVagueness', () => {
  it('scores a very short vague prompt high', () => {
    expect(scoreVagueness('help me')).toBeGreaterThanOrEqual(3);
  });

  it('scores a specific prompt with action verb, component, and domain low', () => {
    const score = scoreVagueness('fix the authentication login function in the backend API');
    expect(score).toBeLessThan(3);
  });

  it('gives +2 for prompts under 10 words with no other clues', () => {
    const score = scoreVagueness('something is broken');
    expect(score).toBeGreaterThanOrEqual(2);
  });

  it('caps score at 5', () => {
    expect(scoreVagueness('x')).toBeLessThanOrEqual(5);
  });

  it('scores a long prompt with action verb and domain lower', () => {
    const score = scoreVagueness(
      'please update the user authentication database schema to add a refresh token column migration',
    );
    expect(score).toBeLessThan(3);
  });
});

describe('buildClarifyingQuestions', () => {
  it('returns up to 3 questions for a vague prompt', () => {
    const qs = buildClarifyingQuestions('improve it');
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.length).toBeLessThanOrEqual(3);
  });

  it('does not ask "where" when domain is already mentioned', () => {
    const qs = buildClarifyingQuestions('update the database schema');
    const whereQ = qs.find((q) => q.id === 'where');
    expect(whereQ).toBeUndefined();
  });

  it('question ids are one of what/where/how', () => {
    const qs = buildClarifyingQuestions('do something');
    for (const q of qs) {
      expect(['what', 'where', 'how']).toContain(q.id);
    }
  });

  it('questions with choices have at least 2 choices', () => {
    const qs = buildClarifyingQuestions('do something please');
    for (const q of qs) {
      if (q.choices) expect(q.choices.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('boostPrompt', () => {
  it('triggers for a vague short prompt', () => {
    const result = boostPrompt('something is wrong');
    expect(result.triggered).toBe(true);
    expect(result.vaguenessScore).toBeGreaterThanOrEqual(3);
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it('does not trigger when activeFile is provided', () => {
    const result = boostPrompt('fix it', 'src/auth/login.ts');
    expect(result.triggered).toBe(false);
  });

  it('does not trigger for a prompt starting with "just "', () => {
    const result = boostPrompt('just rename the variable');
    expect(result.triggered).toBe(false);
  });

  it('does not trigger for a specific prompt', () => {
    const result = boostPrompt('fix the authentication login bug in the user service API');
    expect(result.triggered).toBe(false);
  });

  it('returns confirmation message when triggered', () => {
    const result = boostPrompt('help me');
    if (result.triggered) {
      expect(result.confirmationMessage).toBeTruthy();
    }
  });

  it('returns empty questions array when not triggered', () => {
    const result = boostPrompt('just fix typo');
    expect(result.questions).toEqual([]);
  });
});
