import { describe, expect, it } from 'vitest';
import { enforceAgentContract, validateAgentContract } from '../validation/agent-contract.js';

describe('validateAgentContract', () => {
  it('returns missing sections for incomplete agent content', () => {
    const content = '# Example Agent\n\n## Workflow\n\nDo work.';
    const result = validateAgentContract(content);

    expect(result.missingSections).toEqual([
      'Common Rationalizations',
      'Rationalization Rebuttals',
    ]);
  });

  it('returns valid true when required sections are present', () => {
    const content = [
      '# Example Agent',
      '',
      '## Common Rationalizations',
      'text',
      '',
      '## Rationalization Rebuttals',
      'text',
    ].join('\n');
    const result = validateAgentContract(content);

    expect(result.valid).toBe(true);
  });
});

describe('enforceAgentContract', () => {
  it('produces content that satisfies the agent contract', () => {
    const content = '# Minimal Agent\n\nSome content.';
    const enforced = enforceAgentContract(content, { agentName: 'implementation-agent.agent.md' });
    const result = validateAgentContract(enforced);

    expect(result.valid).toBe(true);
  });

  it('does not modify content that already satisfies the agent contract', () => {
    const content = [
      '# Stable Agent',
      '',
      '## Common Rationalizations',
      'text',
      '',
      '## Rationalization Rebuttals',
      'text',
    ].join('\n');
    const enforced = enforceAgentContract(content, { agentName: 'stable.agent.md' });

    expect(enforced).toBe(content);
  });
});
