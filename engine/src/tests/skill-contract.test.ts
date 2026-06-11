import { describe, expect, it } from 'vitest';
import { enforceSkillContract, validateSkillContract } from '../validation/skill-contract.js';

describe('validateSkillContract', () => {
  it('returns missing sections for incomplete skill content', () => {
    const content = '# Example Skill\n\n## Overview\n\nShort overview.';
    const result = validateSkillContract(content);

    expect(result.missingSections).toEqual([
      'When to Use',
      'Process',
      'Common Rationalizations',
      'Rationalization Rebuttals',
      'Red Flags',
      'Verification',
    ]);
  });

  it('returns valid true when all contract sections are present', () => {
    const content = [
      '# Example Skill',
      '',
      '## Overview',
      'text',
      '',
      '## When to Use',
      'text',
      '',
      '## Process',
      'text',
      '',
      '## Common Rationalizations',
      'text',
      '',
      '## Rationalization Rebuttals',
      'text',
      '',
      '## Red Flags',
      'text',
      '',
      '## Verification',
      'text',
    ].join('\n');
    const result = validateSkillContract(content);

    expect(result.valid).toBe(true);
  });
});

describe('enforceSkillContract', () => {
  it('produces content that satisfies the skill contract', () => {
    const content = '# Minimal Skill\n\nSome content.';
    const enforced = enforceSkillContract(content, { skillName: 'ai-os-nextjs-patterns.md' });
    const result = validateSkillContract(enforced);

    expect(result.valid).toBe(true);
  });

  it('does not modify content that already satisfies the skill contract', () => {
    const content = [
      '# Stable Skill',
      '',
      '## Overview',
      'text',
      '',
      '## When to Use',
      'text',
      '',
      '## Process',
      'text',
      '',
      '## Common Rationalizations',
      'text',
      '',
      '## Rationalization Rebuttals',
      'text',
      '',
      '## Red Flags',
      'text',
      '',
      '## Verification',
      'text',
    ].join('\n');
    const enforced = enforceSkillContract(content, { skillName: 'ai-os-stable.md' });

    expect(enforced).toBe(content);
  });
});
