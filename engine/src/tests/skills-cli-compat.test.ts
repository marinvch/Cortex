/**
 * Skills CLI Compatibility Tests
 *
 * Validates that:
 * - buildSkillsInstallCommand() emits correct syntax for both CLI modes
 * - Source-based syntax is always used when a source is available
 * - Legacy `--skill` flag is only emitted in explicit legacy mode
 * - isLegacySkillCommand() correctly identifies old-style commands
 * - Universal and stack-specific skills in recommendations always use source-based syntax
 */
import { describe, it, expect } from 'vitest';
import {
  buildSkillsInstallCommand,
  isLegacySkillCommand,
  type SkillsCliMode,
} from '../recommendations/cli-compat.js';
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
    keyFiles: ['package.json'],
    patterns: BASE_PATTERNS,
    allDependencies: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildSkillsInstallCommand — source-based mode
// ---------------------------------------------------------------------------

describe('buildSkillsInstallCommand — source-based mode', () => {
  it('emits source@skill form when source is provided', () => {
    const cmd = buildSkillsInstallCommand({ name: 'context7', source: 'intellectronica/agent-skills' });
    expect(cmd).toBe('npx -y skills add intellectronica/agent-skills@context7 -g -a github-copilot');
  });

  it('emits <source>@skill placeholder when source is absent', () => {
    const cmd = buildSkillsInstallCommand({ name: 'my-skill' });
    expect(cmd).toBe('npx -y skills add <source>@my-skill -g -a github-copilot');
  });

  it('defaults to source-based mode when mode arg is omitted', () => {
    const cmd = buildSkillsInstallCommand({ name: 'find-skills', source: 'vercel-labs/skills' });
    expect(cmd).toBe('npx -y skills add vercel-labs/skills@find-skills -g -a github-copilot');
    expect(isLegacySkillCommand(cmd)).toBe(false);
  });

  it('does NOT emit --skill flag in source-based mode', () => {
    const cmd = buildSkillsInstallCommand(
      { name: 'vercel-react-best-practices', source: 'vercel-labs/agent-skills' },
      'source-based',
    );
    expect(isLegacySkillCommand(cmd)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildSkillsInstallCommand — legacy mode
// ---------------------------------------------------------------------------

describe('buildSkillsInstallCommand — legacy mode', () => {
  it('emits --skill flag in legacy mode', () => {
    const cmd = buildSkillsInstallCommand({ name: 'context7' }, 'legacy');
    expect(cmd).toBe('npx -y skills add --skill context7 -g -a github-copilot');
    expect(isLegacySkillCommand(cmd)).toBe(true);
  });

  it('ignores source field in legacy mode', () => {
    const cmd = buildSkillsInstallCommand(
      { name: 'context7', source: 'intellectronica/agent-skills' },
      'legacy',
    );
    expect(cmd).toBe('npx -y skills add --skill context7 -g -a github-copilot');
  });
});

// ---------------------------------------------------------------------------
// isLegacySkillCommand
// ---------------------------------------------------------------------------

describe('isLegacySkillCommand', () => {
  it('identifies legacy --skill flag commands', () => {
    expect(isLegacySkillCommand('npx -y skills add --skill foo -g -a github-copilot')).toBe(true);
  });

  it('does not flag source-based commands as legacy', () => {
    expect(isLegacySkillCommand('npx -y skills add vercel-labs/skills@find-skills -g -a github-copilot')).toBe(false);
  });

  it('does not flag placeholder source-based commands as legacy', () => {
    expect(isLegacySkillCommand('npx -y skills add <source>@my-skill -g -a github-copilot')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Recommendations doc — no legacy syntax emitted
// ---------------------------------------------------------------------------

describe('recommendations doc — source-based syntax only', () => {
  it('does not emit --skill flag in universal skills section for any stack', () => {
    const stack = makeStack();
    const text = buildRecommendationsText(stack);
    // Universal skills section must use source-based syntax
    expect(text).not.toContain('--skill find-skills');
    expect(text).not.toContain('--skill context7');
  });

  it('universal skills use source@skill form when source is known', () => {
    const stack = makeStack();
    const text = buildRecommendationsText(stack);
    // context7 and find-skills both have known sources in UNIVERSAL_RECOMMENDATIONS
    expect(text).toContain('intellectronica/agent-skills@context7');
    expect(text).toContain('vercel-labs/skills@find-skills');
  });

  it('does not emit --skill flag for Next.js stack-specific skills', () => {
    const stack = makeStack({
      frameworks: [{ name: 'Next.js', category: 'fullstack', version: '14.0.0', template: 'nextjs' }],
      allDependencies: ['next'],
    });
    const text = buildRecommendationsText(stack);
    // Stack skills with known sources should use source-based form
    expect(text).toContain('vercel-labs/agent-skills@vercel-react-best-practices');
    expect(isLegacySkillCommand(text)).toBe(false);
  });

  it('stack skills header describes source-based form', () => {
    const stack = makeStack({
      allDependencies: ['react'],
    });
    const text = buildRecommendationsText(stack);
    expect(text).toContain('source-based form');
  });
});

// ---------------------------------------------------------------------------
// collectRecommendations — universalSkills carry source
// ---------------------------------------------------------------------------

describe('collectRecommendations — universal skills source propagation', () => {
  it('universal skills include source from registry skillSources', () => {
    const stack = makeStack();
    const recs = collectRecommendations(stack);
    const context7 = recs.universalSkills.find(s => s.name === 'context7');
    expect(context7).toBeDefined();
    expect(context7?.source).toBe('intellectronica/agent-skills');
  });

  it('find-skills universal skill has source vercel-labs/skills', () => {
    const stack = makeStack();
    const recs = collectRecommendations(stack);
    const findSkills = recs.universalSkills.find(s => s.name === 'find-skills');
    expect(findSkills).toBeDefined();
    expect(findSkills?.source).toBe('vercel-labs/skills');
  });
});

// ---------------------------------------------------------------------------
// CLI mode type guard — SkillsCliMode values
// ---------------------------------------------------------------------------

describe('SkillsCliMode type', () => {
  it('accepts valid mode values', () => {
    const modes: SkillsCliMode[] = ['source-based', 'legacy'];
    for (const mode of modes) {
      const cmd = buildSkillsInstallCommand({ name: 'test-skill' }, mode);
      expect(typeof cmd).toBe('string');
      expect(cmd.length).toBeGreaterThan(0);
    }
  });
});
