import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateInstructions } from '../generators/instructions.js';
import type { DetectedStack } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = fs.readFileSync(
  path.join(__dirname, '..', 'templates', 'base-instructions.md'),
  'utf-8',
);

function fakeStack(): DetectedStack {
  return {
    projectName: 'demo',
    rootDir: os.tmpdir(),
    primaryLanguage: { name: 'TypeScript', percentage: 100, fileCount: 1, extensions: ['.ts'] },
    languages: [{ name: 'TypeScript', percentage: 100, fileCount: 1, extensions: ['.ts'] }],
    frameworks: [],
    primaryFramework: null,
    keyFiles: ['package.json'],
    buildCommands: { build: 'npm run build', test: 'npm test' },
    allDependencies: [],
    patterns: {
      packageManager: 'npm', hasTypeScript: true, namingConvention: 'kebab-case',
      linter: 'ESLint', formatter: 'none detected', testFramework: 'Vitest', testDirectory: 'none detected',
    },
  } as unknown as DetectedStack;
}

describe('base-instructions.md token slimming', () => {
  it('does not embed the full 16-row MCP tool catalog', () => {
    // The full catalog lives only in context/mcp-tools.md now.
    // base-instructions keeps at most the 4 session-start tools.
    const toolRows = (TEMPLATE.match(/^\| `get_/gm) ?? []).length;
    expect(toolRows).toBeLessThanOrEqual(4);
  });

  it('keeps an offline fallback pointer', () => {
    expect(TEMPLATE).toContain('If MCP tools are unavailable');
  });

  it('does not restate the numbered Session Restart Protocol (canonical: COPILOT_CONTEXT.md)', () => {
    expect(TEMPLATE).not.toContain('reloads MUST-ALWAYS rules, build commands, and key file locations');
    expect(TEMPLATE).toMatch(/Session start.*get_session_context/i);
  });

  it('keeps only a compact Context Budget summary (canonical: context-budget.md)', () => {
    expect(TEMPLATE).not.toContain('get_file_summary` — before reading full files (token-efficient)');
    expect(TEMPLATE).toContain('context/context-budget.md');
  });

  it('keeps Value Mode as a single compact line for multi-editor parity', () => {
    expect(TEMPLATE).not.toContain('**Problem Understanding First:**');
    expect(TEMPLATE).toMatch(/Value Mode/);
  });
});

describe('ai-os.instructions.md is lean', () => {
  it('does not duplicate the MCP tool quick-reference list', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-instr-'));
    generateInstructions(fakeStack(), dir, {});
    const out = fs.readFileSync(
      path.join(dir, '.github', 'instructions', 'ai-os.instructions.md'), 'utf-8');
    expect(out).not.toContain('**Quick reference:**');
    expect(out).toContain('## Value Mode');
  });
});

describe('prompt-quality.instructions.md is lean', () => {
  it('does not duplicate MCP health/tool guidance', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-pqp-'));
    generateInstructions(fakeStack(), dir, {});
    const out = fs.readFileSync(
      path.join(dir, '.github', 'instructions', 'prompt-quality.instructions.md'), 'utf-8');
    expect(out).not.toContain('## 5. MCP Health Check');
    expect(out).toContain('## 5. Plan-Mode Trigger');
  });
});

