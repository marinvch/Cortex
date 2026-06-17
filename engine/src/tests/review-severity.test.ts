import { describe, expect, it } from 'vitest';
import {
  formatSeverityBadge,
  getSeverityLevelsOrdered,
  isValidSeverityLevel,
  SEVERITY_LEVELS,
} from '../validation/review-severity.js';

describe('SEVERITY_LEVELS', () => {
  it('contains the four standard taxonomy labels in urgency order', () => {
    expect(SEVERITY_LEVELS).toEqual(['Critical', 'Required', 'Optional', 'FYI']);
  });
});

describe('isValidSeverityLevel', () => {
  it('returns true for each known severity level', () => {
    for (const level of SEVERITY_LEVELS) {
      expect(isValidSeverityLevel(level)).toBe(true);
    }
  });

  it('returns false for unknown strings', () => {
    expect(isValidSeverityLevel('Minor')).toBe(false);
    expect(isValidSeverityLevel('')).toBe(false);
    expect(isValidSeverityLevel('critical')).toBe(false); // case-sensitive
  });
});

describe('formatSeverityBadge', () => {
  it('wraps the level name in brackets', () => {
    expect(formatSeverityBadge('Critical')).toBe('[Critical]');
    expect(formatSeverityBadge('FYI')).toBe('[FYI]');
  });
});

describe('getSeverityLevelsOrdered', () => {
  it('returns levels with Critical first and FYI last', () => {
    const ordered = getSeverityLevelsOrdered();
    expect(ordered[0]).toBe('Critical');
    expect(ordered[ordered.length - 1]).toBe('FYI');
  });
});
