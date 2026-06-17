/**
 * Install profile unit tests
 *
 * Tests the profile parsing, application, and description utilities.
 */
import { describe, it, expect } from 'vitest';
import { applyProfile, describeProfile, parseProfile, PROFILE_PRESETS } from '../profile.js';
import type { AiOsConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseConfig(overrides: Partial<AiOsConfig> = {}): AiOsConfig {
  return {
    version: '0.10.0',
    installedAt: '2026-01-01T00:00:00.000Z',
    projectName: 'test-project',
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
    persistentRules: [],
    exclude: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseProfile
// ---------------------------------------------------------------------------

describe('parseProfile', () => {
  it('returns "minimal" for valid input', () => {
    expect(parseProfile('minimal')).toBe('minimal');
  });

  it('returns "standard" for valid input', () => {
    expect(parseProfile('standard')).toBe('standard');
  });

  it('returns "full" for valid input', () => {
    expect(parseProfile('full')).toBe('full');
  });

  it('returns null for unknown profile strings', () => {
    expect(parseProfile('unknown')).toBeNull();
    expect(parseProfile('MINIMAL')).toBeNull();
    expect(parseProfile('')).toBeNull();
    expect(parseProfile('all')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PROFILE_PRESETS — contract guarantees
// ---------------------------------------------------------------------------

describe('PROFILE_PRESETS contracts', () => {
  it('minimal disables agents, recommendations, sessionContextCard, and update-check', () => {
    const p = PROFILE_PRESETS.minimal;
    expect(p.agentsMd).toBe(false);
    expect(p.recommendations).toBe(false);
    expect(p.sessionContextCard).toBe(false);
    expect(p.updateCheckEnabled).toBe(false);
    expect(p.agentFlowMode).toBe('skip');
  });

  it('standard enables core features but keeps skills strategy as creator-only', () => {
    const p = PROFILE_PRESETS.standard;
    expect(p.recommendations).toBe(true);
    expect(p.sessionContextCard).toBe(true);
    expect(p.updateCheckEnabled).toBe(true);
    expect(p.skillsStrategy).toBe('creator-only');
    expect(p.agentFlowMode).toBe('create');
  });

  it('full enables agentsMd and uses predefined+creator skills strategy', () => {
    const p = PROFILE_PRESETS.full;
    expect(p.agentsMd).toBe(true);
    expect(p.skillsStrategy).toBe('predefined+creator');
    expect(p.recommendations).toBe(true);
    expect(p.agentFlowMode).toBe('create');
  });
});

// ---------------------------------------------------------------------------
// applyProfile
// ---------------------------------------------------------------------------

describe('applyProfile', () => {
  it('sets all profile flags and records the profile name in config', () => {
    const config = makeBaseConfig();
    const updated = applyProfile(config, 'minimal');

    expect(updated.profile).toBe('minimal');
    expect(updated.agentsMd).toBe(false);
    expect(updated.recommendations).toBe(false);
    expect(updated.sessionContextCard).toBe(false);
    expect(updated.updateCheckEnabled).toBe(false);
    expect(updated.agentFlowMode).toBe('skip');
  });

  it('preserves non-profile fields when applying a profile', () => {
    const config = makeBaseConfig({ projectName: 'my-app', persistentRules: ['rule1'] });
    const updated = applyProfile(config, 'standard');

    expect(updated.projectName).toBe('my-app');
    expect(updated.persistentRules).toEqual(['rule1']);
    expect(updated.profile).toBe('standard');
  });

  it('does not mutate the original config object', () => {
    const config = makeBaseConfig({ recommendations: true });
    applyProfile(config, 'minimal');

    expect(config.recommendations).toBe(true);
  });

  it('applies full profile correctly', () => {
    const config = makeBaseConfig();
    const updated = applyProfile(config, 'full');

    expect(updated.profile).toBe('full');
    expect(updated.agentsMd).toBe(true);
    expect(updated.skillsStrategy).toBe('predefined+creator');
    expect(updated.pathSpecificInstructions).toBe(true);
  });

  it('can overwrite a previously persisted profile', () => {
    const config = makeBaseConfig({ profile: 'minimal' });
    const updated = applyProfile(config, 'full');

    expect(updated.profile).toBe('full');
    expect(updated.agentsMd).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describeProfile
// ---------------------------------------------------------------------------

describe('describeProfile', () => {
  it('returns a non-empty string mentioning the profile name', () => {
    for (const p of ['minimal', 'standard', 'full'] as const) {
      const output = describeProfile(p);
      expect(output).toContain(p);
      expect(output.length).toBeGreaterThan(10);
    }
  });

  it('mentions key component states in the description', () => {
    const minDesc = describeProfile('minimal');
    expect(minDesc).toContain('disabled');

    const fullDesc = describeProfile('full');
    expect(fullDesc).toContain('enabled');
    expect(fullDesc).toContain('predefined+creator');
  });
});
