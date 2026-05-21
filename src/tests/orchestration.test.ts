import { describe, it, expect } from 'vitest';
import type { AgentRegistryEntry, AgentRegistry } from '../types.js';
import { isAgentRegistry } from '../types.js';

describe('AgentRegistryEntry type shape', () => {
  it('accepts a valid entry object', () => {
    const entry: AgentRegistryEntry = {
      name: 'Payments Expert',
      file: 'expert-payments.agent.md',
      capabilities: ['stripe', 'checkout', 'webhooks'],
      triggers: ['stripe', 'payment', 'billing'],
      description: 'Stripe billing expert.',
    };
    expect(entry.name).toBe('Payments Expert');
    expect(entry.file).toBe('expert-payments.agent.md');
    expect(entry.capabilities).toHaveLength(3);
    expect(entry.triggers).toHaveLength(3);
  });

  it('accepts a valid registry object', () => {
    const registry: AgentRegistry = {
      version: '1',
      generatedAt: '2026-05-11T00:00:00.000Z',
      agents: [],
    };
    expect(registry.version).toBe('1');
    expect(Array.isArray(registry.agents)).toBe(true);
  });
});

describe('isAgentRegistry', () => {
  it('returns true for a valid registry', () => {
    expect(
      isAgentRegistry({
        version: '1',
        generatedAt: '2026-05-11T00:00:00.000Z',
        agents: [
          {
            name: 'Payments Expert',
            file: 'expert-payments.agent.md',
            capabilities: ['stripe'],
            triggers: ['payment'],
            description: 'Stripe expert.',
          },
        ],
      })
    ).toBe(true);
  });

  it('returns true for empty agents array', () => {
    expect(
      isAgentRegistry({ version: '1', generatedAt: '2026-05-11', agents: [] })
    ).toBe(true);
  });

  it('returns false for null', () => {
    expect(isAgentRegistry(null)).toBe(false);
  });

  it('returns false for wrong version', () => {
    expect(
      isAgentRegistry({ version: '2', generatedAt: '2026-05-11', agents: [] })
    ).toBe(false);
  });

  it('returns false when agents is not an array', () => {
    expect(
      isAgentRegistry({ version: '1', generatedAt: '2026-05-11', agents: {} })
    ).toBe(false);
  });

  it('returns false when an agent entry is missing fields', () => {
    expect(
      isAgentRegistry({
        version: '1',
        generatedAt: '2026-05-11',
        agents: [{ name: 'Incomplete' }],
      })
    ).toBe(false);
  });
});
