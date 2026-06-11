import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let brain: string;
beforeEach(() => {
  brain = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-cand-'));
  process.env['AI_OS_PERSONAL_ROOT'] = brain;
});
afterEach(() => {
  delete process.env['AI_OS_PERSONAL_ROOT'];
  fs.rmSync(brain, { recursive: true, force: true });
});

describe('candidate queue', () => {
  it('appends a domain-tagged candidate to brain/candidates.jsonl', async () => {
    const { appendCandidate, readCandidates } = await import('../mcp-server/candidates.js');
    appendCandidate({ text: 'User switched to Bun', domain: 'personal', trigger: 'you mentioned Bun' });
    const all = readCandidates();
    expect(all).toHaveLength(1);
    expect(all[0].domain).toBe('personal');
    expect(all[0].text).toMatch(/Bun/);
  });

  it('marks project-domain candidates as needing sanitization', async () => {
    const { appendCandidate, readCandidates } = await import('../mcp-server/candidates.js');
    appendCandidate({ text: 'AcmeCorp uses X', domain: 'project', trigger: '...' });
    expect(readCandidates()[0].needsSanitization).toBe(true);
  });

  it('NEVER writes to context/ or brain/memory.jsonl — only candidates.jsonl', async () => {
    const { appendCandidate } = await import('../mcp-server/candidates.js');
    appendCandidate({ text: 'x', domain: 'personal', trigger: 't' });
    expect(fs.existsSync(path.join(brain, 'brain', 'memory.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(brain, 'context'))).toBe(false);
    expect(fs.existsSync(path.join(brain, 'brain', 'candidates.jsonl'))).toBe(true);
  });

  it('throws when no personal brain path is configured', async () => {
    delete process.env['AI_OS_PERSONAL_ROOT'];
    const { appendCandidate } = await import('../mcp-server/candidates.js');
    expect(() => appendCandidate({ text: 'x', domain: 'personal', trigger: 't' })).toThrow(/personal brain path/i);
  });

  it('appends a second candidate as a new line, preserving the first', async () => {
    const { appendCandidate, readCandidates } = await import('../mcp-server/candidates.js');
    appendCandidate({ text: 'first', domain: 'personal', trigger: 'a' });
    appendCandidate({ text: 'second', domain: 'project', trigger: 'b' });
    const all = readCandidates();
    expect(all).toHaveLength(2);
    expect(all[0].text).toBe('first');
    expect(all[1].text).toBe('second');
    expect(all[1].needsSanitization).toBe(true);
  });
});
