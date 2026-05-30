import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = fs.readFileSync(
  path.join(__dirname, '..', 'templates', 'base-instructions.md'),
  'utf-8',
);

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
});
