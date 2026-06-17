import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('getRepoMemory ordering', () => {
  let tempRoot = '';
  const originalRoot = process.env['AI_OS_ROOT'];

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-os-memory-test-'));
    const memoryDir = path.join(tempRoot, '.github', 'ai-os', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });

    const entries = [
      {
        id: 'oldest',
        createdAt: '2026-04-17T04:17:32.142Z',
        updatedAt: '2026-04-17T04:17:32.142Z',
        title: 'Oldest memory',
        content: 'oldest content',
        category: 'testing',
        tags: [],
        status: 'active',
      },
      {
        id: 'middle',
        createdAt: '2026-04-17T04:32:22.168Z',
        updatedAt: '2026-04-17T04:32:22.168Z',
        title: 'Middle memory',
        content: 'middle content',
        category: 'testing',
        tags: [],
        status: 'active',
      },
      {
        id: 'latest',
        createdAt: '2026-04-17T04:38:26.195Z',
        updatedAt: '2026-04-17T04:38:26.195Z',
        title: 'Latest memory',
        content: 'latest content',
        category: 'testing',
        tags: [],
        status: 'active',
      },
    ];

    fs.writeFileSync(
      path.join(memoryDir, 'memory.jsonl'),
      entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
      'utf-8',
    );

    process.env['AI_OS_ROOT'] = tempRoot;
  });

  afterEach(() => {
    if (originalRoot === undefined) {
      delete process.env['AI_OS_ROOT'];
    } else {
      process.env['AI_OS_ROOT'] = originalRoot;
    }
    vi.resetModules();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('returns newest entry for limit=1', async () => {
    const { getRepoMemory } = await import('../mcp-server/utils.js');
    const output = getRepoMemory(undefined, undefined, 1);

    expect(output).toContain('Latest memory');
    expect(output).not.toContain('Oldest memory');
  });

  it('returns newest entries first when limiting results', async () => {
    const { getRepoMemory } = await import('../mcp-server/utils.js');
    const output = getRepoMemory(undefined, undefined, 2);

    expect(output).toContain('Latest memory');
    expect(output).toContain('Middle memory');
    expect(output).not.toContain('Oldest memory');

    expect(output.indexOf('Latest memory')).toBeLessThan(output.indexOf('Middle memory'));
  });

  it('recovers stale lock file and stores memory entry', async () => {
    const lockFile = path.join(tempRoot, '.github', 'ai-os', 'memory', '.memory.lock');
    fs.writeFileSync(lockFile, 'stale-lock', 'utf-8');

    // Stale threshold in utils.ts is 15s; set lock timestamp far in the past.
    const staleTime = new Date(Date.now() - 60_000);
    fs.utimesSync(lockFile, staleTime, staleTime);

    const { rememberRepoFact } = await import('../mcp-server/utils.js');
    const result = rememberRepoFact('Lock recovery fact', 'stale lock should be recovered', 'testing');

    expect(result).toContain('Stored memory entry');
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it('handles duplicate facts without creating duplicate entries', async () => {
    const { rememberRepoFact } = await import('../mcp-server/utils.js');

    const first = rememberRepoFact('Duplicate fact', 'same content', 'testing', 'a,b');
    const second = rememberRepoFact('Duplicate fact', 'same content', 'testing', 'a,b,c');

    expect(first).toContain('Stored memory entry');
    expect(second.includes('Updated memory tags') || second.includes('Skipped duplicate memory fact')).toBe(true);

    const memFile = path.join(tempRoot, '.github', 'ai-os', 'memory', 'memory.jsonl');
    const lines = fs.readFileSync(memFile, 'utf-8').split('\n').filter(Boolean);
    const duplicateTitleEntries = lines.filter((line) => line.includes('"title":"Duplicate fact"'));
    expect(duplicateTitleEntries.length).toBe(1);
  });

  it('cleans malformed memory lines on next write', async () => {
    const memFile = path.join(tempRoot, '.github', 'ai-os', 'memory', 'memory.jsonl');
    const valid = JSON.stringify({
      id: 'valid-entry',
      createdAt: '2026-04-17T04:38:26.195Z',
      title: 'Valid entry',
      content: 'valid content',
      category: 'testing',
      tags: [],
      status: 'active',
    });
    fs.writeFileSync(memFile, `{broken\n${valid}\n`, 'utf-8');

    const { rememberRepoFact } = await import('../mcp-server/utils.js');
    const result = rememberRepoFact('Recovery trigger', 'forces rewrite', 'testing');

    expect(result).toContain('Stored memory entry');

    const rewritten = fs.readFileSync(memFile, 'utf-8');
    expect(rewritten).not.toContain('{broken');
  });
});
