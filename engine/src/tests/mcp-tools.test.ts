import { describe, it, expect } from 'vitest';
import { MCP_TOOL_DEFINITIONS } from '../mcp-tools.js';

describe('promote_to_brain tool registration', () => {
  it('is present in MCP_TOOL_DEFINITIONS with required title/content/sanitized_confirmed', () => {
    const def = MCP_TOOL_DEFINITIONS.find((t) => t.name === 'promote_to_brain');
    expect(def).toBeTruthy();
    expect(def!.inputSchema.required).toEqual(
      expect.arrayContaining(['title', 'content', 'sanitized_confirmed']),
    );
  });
});

describe('suggest_profile_update tool registration', () => {
  it('is present with required text and domain', () => {
    const def = MCP_TOOL_DEFINITIONS.find((t) => t.name === 'suggest_profile_update');
    expect(def).toBeTruthy();
    expect(def!.inputSchema.required).toEqual(expect.arrayContaining(['text', 'domain']));
  });
});
