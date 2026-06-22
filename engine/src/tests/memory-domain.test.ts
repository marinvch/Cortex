import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-domain-'));
  process.env['CORTEX_ROOT'] = tmp;
  fs.mkdirSync(path.join(tmp, '.github', 'ai-os', 'memory'), { recursive: true });
});
afterEach(() => {
  delete process.env['CORTEX_ROOT'];
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('memory entry domain', () => {
  it('defaults stored facts to the project domain', async () => {
    const { rememberRepoFact } = await import('../mcp-server/memory.js');
    rememberRepoFact('Uses pnpm', 'The project uses pnpm as its package manager.');
    const file = path.join(tmp, '.github', 'ai-os', 'memory', 'memory.jsonl');
    const line = fs.readFileSync(file, 'utf-8').trim().split('\n')[0];
    const entry = JSON.parse(line);
    expect(entry.domain).toBe('project');
  });
});
