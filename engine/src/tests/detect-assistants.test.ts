import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectAssistants } from '../generators/detect-assistants.js';

function tmp() { return mkdtempSync(join(tmpdir(), 'cortex-det-')); }

describe('detectAssistants', () => {
  it('detects claude from CLAUDE.md, cursor from .cursorrules, copilot from .github/copilot-instructions.md', () => {
    const d = tmp();
    writeFileSync(join(d, 'CLAUDE.md'), '#');
    writeFileSync(join(d, '.cursorrules'), '#');
    mkdirSync(join(d, '.github'), { recursive: true });
    writeFileSync(join(d, '.github', 'copilot-instructions.md'), '#');
    const ids = detectAssistants(d).sort();
    expect(ids).toContain('claude');
    expect(ids).toContain('cursor');
    expect(ids).toContain('copilot');
  });
  it('returns [] when no markers present', () => {
    expect(detectAssistants(tmp())).toEqual([]);
  });
});
