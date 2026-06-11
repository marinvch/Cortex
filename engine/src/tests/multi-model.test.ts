import { describe, it, expect } from 'vitest';
import {
  adaptForClaude,
  adaptForGemini,
  adaptForLocal,
  adaptInstructionsForModel,
  getModelOutputPath,
  parseModelTarget,
} from '../generators/multi-model.js';

const SAMPLE_INSTRUCTIONS = `# Project Instructions

> **Persona:** Act as a Senior TypeScript developer.

## Tech Stack

- TypeScript 5 with strict mode
- Next.js 14 App Router
- Package manager: npm

## Build Commands

| Action | Command |
|--------|---------|
| Build  | \`npm run build\` |
| Test   | \`npm run test\` |

## General Rules

- Prefer early returns (guard clauses) over deep nesting
- Validate all external inputs at the boundary
- Use async/await over .then() chains
- Never commit secrets or credentials

## Session Restart Protocol

1. Call get_session_context
2. Call get_repo_memory
3. Call get_conventions
4. Call get_active_plan

## Memory Workflow

- Always retrieve memory before implementation
- Persist verified facts at task end
`;

describe('parseModelTarget', () => {
  it('parses valid model targets', () => {
    expect(parseModelTarget('copilot')).toBe('copilot');
    expect(parseModelTarget('claude')).toBe('claude');
    expect(parseModelTarget('gemini')).toBe('gemini');
    expect(parseModelTarget('local')).toBe('local');
  });

  it('returns null for invalid targets', () => {
    expect(parseModelTarget('gpt4')).toBeNull();
    expect(parseModelTarget('')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(parseModelTarget('CLAUDE')).toBe('claude');
    expect(parseModelTarget('Gemini')).toBe('gemini');
  });
});

describe('adaptForClaude', () => {
  it('wraps content in <instructions> tag', () => {
    const result = adaptForClaude(SAMPLE_INSTRUCTIONS);
    expect(result).toContain('<instructions>');
    expect(result).toContain('</instructions>');
  });

  it('wraps individual sections in XML tags', () => {
    const result = adaptForClaude(SAMPLE_INSTRUCTIONS);
    expect(result).toContain('<tech-stack>');
    expect(result).toContain('</tech-stack>');
  });

  it('preserves original content within tags', () => {
    const result = adaptForClaude(SAMPLE_INSTRUCTIONS);
    expect(result).toContain('npm run build');
    expect(result).toContain('TypeScript 5');
  });
});

describe('adaptForGemini', () => {
  it('preserves headings', () => {
    const result = adaptForGemini(SAMPLE_INSTRUCTIONS);
    expect(result).toContain('## Tech Stack');
    expect(result).toContain('## Build Commands');
  });

  it('truncates very long prose lines', () => {
    const longLine = 'This is a very long line that exceeds the 100 character limit and should be truncated by the Gemini adapter to improve performance with retrieval-augmented generation systems.';
    const result = adaptForGemini(longLine);
    expect(result.length).toBeLessThan(longLine.length);
    expect(result).toContain('…');
  });

  it('preserves list items', () => {
    const result = adaptForGemini(SAMPLE_INSTRUCTIONS);
    expect(result).toContain('- TypeScript 5');
  });

  it('preserves table rows', () => {
    const result = adaptForGemini(SAMPLE_INSTRUCTIONS);
    expect(result).toContain('| Build  |');
  });
});

describe('adaptForLocal', () => {
  it('adds compact header comment', () => {
    const result = adaptForLocal(SAMPLE_INSTRUCTIONS);
    expect(result).toContain('<!-- Compact instructions for local LLM');
  });

  it('strips Session Restart Protocol section', () => {
    const result = adaptForLocal(SAMPLE_INSTRUCTIONS);
    // The section heading might appear but detailed steps should be excluded
    expect(result).not.toContain('Call get_session_context');
  });

  it('strips Memory Workflow section', () => {
    const result = adaptForLocal(SAMPLE_INSTRUCTIONS);
    expect(result).not.toContain('Always retrieve memory before implementation');
  });

  it('is shorter than original', () => {
    const result = adaptForLocal(SAMPLE_INSTRUCTIONS);
    expect(result.length).toBeLessThan(SAMPLE_INSTRUCTIONS.length);
  });
});

describe('adaptInstructionsForModel', () => {
  it('returns content unchanged for copilot model', () => {
    const result = adaptInstructionsForModel(SAMPLE_INSTRUCTIONS, 'copilot');
    expect(result).toBe(SAMPLE_INSTRUCTIONS);
  });

  it('returns XML-wrapped content for claude', () => {
    const result = adaptInstructionsForModel(SAMPLE_INSTRUCTIONS, 'claude');
    expect(result).toContain('<instructions>');
  });

  it('returns truncated content for local', () => {
    const result = adaptInstructionsForModel(SAMPLE_INSTRUCTIONS, 'local');
    expect(result.length).toBeLessThan(SAMPLE_INSTRUCTIONS.length);
  });
});

describe('getModelOutputPath', () => {
  const githubDir = '/project/.github';

  it('returns canonical path for copilot', () => {
    expect(getModelOutputPath('copilot', githubDir)).toBe('/project/.github/copilot-instructions.md');
  });

  it('returns ai-os subdir paths for other models', () => {
    expect(getModelOutputPath('claude', githubDir)).toBe('/project/.github/ai-os/claude-instructions.md');
    expect(getModelOutputPath('gemini', githubDir)).toBe('/project/.github/ai-os/gemini-instructions.md');
    expect(getModelOutputPath('local', githubDir)).toBe('/project/.github/ai-os/local-instructions.md');
  });
});
