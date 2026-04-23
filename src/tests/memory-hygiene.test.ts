import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Shared test helpers ────────────────────────────────────────────────────────

function createTempMemoryRoot(entries: object[]): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-os-hygiene-test-'));
  const memoryDir = path.join(tempRoot, '.github', 'ai-os', 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(
    path.join(memoryDir, 'memory.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : ''),
    'utf-8',
  );
  return tempRoot;
}

function readMemoryFile(tempRoot: string): object[] {
  const memFile = path.join(tempRoot, '.github', 'ai-os', 'memory', 'memory.jsonl');
  return fs
    .readFileSync(memFile, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as object);
}

// ── Near-duplicate deduplication ──────────────────────────────────────────────

describe('memory hygiene — near-duplicate detection', () => {
  let tempRoot = '';
  const originalRoot = process.env['AI_OS_ROOT'];

  beforeEach(() => {
    // Use dates from 30 days ago — well within the default 180-day TTL
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const base = {
      id: 'a1',
      createdAt: thirtyDaysAgo,
      updatedAt: thirtyDaysAgo,
      title: 'Build command',
    // Jaccard similarity: 13 shared words / 15 union words ≈ 0.867, above default 0.85 threshold
      content: 'Use npm run build to compile TypeScript sources and generate the distribution bundle output',
      category: 'build',
      tags: [],
      status: 'active',
    };

    // Near-duplicate: same title+category, content similarity 0.867 > 0.85 threshold
    const nearDupe = {
      id: 'a2',
      createdAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(), // newer
      updatedAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
      title: 'Build command',
      content: 'Use npm run build to compile TypeScript sources and generate the distribution bundle outputs',
      category: 'build',
      tags: [],
      status: 'active',
    };

    tempRoot = createTempMemoryRoot([base, nearDupe]);
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

  it('marks the older near-duplicate as stale on read', async () => {
    const { getRepoMemory } = await import('../mcp-server/utils.js');
    const output = getRepoMemory('Build command', 'build', 10);
    // The stale count should be 1, active count should be 1
    expect(output).toContain('Active: 1');
    expect(output).toContain('Stale: 1');
  });

  it('pruneMemory removes near-duplicate stale entries from the file', async () => {
    const { pruneMemory } = await import('../mcp-server/utils.js');
    const result = pruneMemory();

    expect(result).toContain('Memory Prune Complete');
    expect(result).toContain('Near-duplicates removed: 1');

    const remaining = readMemoryFile(tempRoot);
    expect(remaining).toHaveLength(1);
    // Newer entry (a2) survives
    expect((remaining[0] as { id: string }).id).toBe('a2');
  });
});

// ── Configurable TTL ──────────────────────────────────────────────────────────

describe('memory hygiene — configurable TTL', () => {
  let tempRoot = '';
  const originalRoot = process.env['AI_OS_ROOT'];

  beforeEach(() => {
    // Entry that is 30 days old
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const oldEntry = {
      id: 'old1',
      createdAt: thirtyDaysAgo,
      updatedAt: thirtyDaysAgo,
      title: 'Thirty-day-old fact',
      content: 'This fact is 30 days old and should be stale under a 20-day TTL',
      category: 'testing',
      tags: [],
      status: 'active',
    };

    tempRoot = createTempMemoryRoot([oldEntry]);

    // Write a config that sets TTL to 20 days (shorter than 30 days of entry age)
    const configDir = path.join(tempRoot, '.github', 'ai-os');
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({ memoryTtlDays: 20 }),
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

  it('respects custom TTL from config.json — marks entry stale under shorter TTL', async () => {
    const { getRepoMemory } = await import('../mcp-server/utils.js');
    const output = getRepoMemory('Thirty-day-old fact', 'testing', 10);
    // Entry should be listed but as stale
    expect(output).toContain('stale');
  });

  it('pruneMemory removes TTL-expired entries under custom TTL', async () => {
    const { pruneMemory } = await import('../mcp-server/utils.js');
    const result = pruneMemory();

    expect(result).toContain('Memory Prune Complete');
    expect(result).toContain('Stale entries removed: 1');

    const remaining = readMemoryFile(tempRoot);
    expect(remaining).toHaveLength(0);
  });
});

// ── pruneMemory (compact/prune command) ───────────────────────────────────────

describe('memory hygiene — pruneMemory', () => {
  let tempRoot = '';
  const originalRoot = process.env['AI_OS_ROOT'];

  const staleDate = '2020-01-01T00:00:00.000Z'; // far in the past → auto-stale
  const freshDate = new Date().toISOString();

  beforeEach(() => {
    const activeEntry = {
      id: 'active1',
      createdAt: freshDate,
      updatedAt: freshDate,
      title: 'Active fact',
      content: 'This entry is recent and should be kept after prune',
      category: 'conventions',
      tags: [],
      status: 'active',
    };

    const staleEntry = {
      id: 'stale1',
      createdAt: staleDate,
      updatedAt: staleDate,
      title: 'Stale fact',
      content: 'This entry is very old and should be pruned',
      category: 'conventions',
      tags: [],
      status: 'active',
    };

    const explicitlyStale = {
      id: 'stale2',
      createdAt: freshDate,
      updatedAt: freshDate,
      title: 'Already stale fact',
      content: 'Marked stale explicitly',
      category: 'conventions',
      tags: [],
      status: 'stale',
      staleReason: 'superseded-by-newer-entry',
    };

    tempRoot = createTempMemoryRoot([activeEntry, staleEntry, explicitlyStale]);
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

  it('removes stale and TTL-expired entries, keeps active entries', async () => {
    const { pruneMemory } = await import('../mcp-server/utils.js');
    const result = pruneMemory();

    expect(result).toContain('Memory Prune Complete');

    const remaining = readMemoryFile(tempRoot);
    const ids = remaining.map((e) => (e as { id: string }).id);
    expect(ids).toContain('active1');
    expect(ids).not.toContain('stale1');
    expect(ids).not.toContain('stale2');
  });

  it('returns a summary with correct counts', async () => {
    const { pruneMemory } = await import('../mcp-server/utils.js');
    const result = pruneMemory();

    expect(result).toContain('Active entries kept:  1');
    expect(result).toContain('Stale entries removed:');
  });

  it('is idempotent — running twice produces the same result', async () => {
    const { pruneMemory } = await import('../mcp-server/utils.js');

    pruneMemory(); // First run
    const secondResult = pruneMemory(); // Second run on already-pruned file

    expect(secondResult).toContain('Active entries kept:  1');
    expect(secondResult).toContain('Stale entries removed: 0');
  });

  it('handles empty memory file without errors', async () => {
    // Overwrite with empty file
    const memFile = path.join(tempRoot, '.github', 'ai-os', 'memory', 'memory.jsonl');
    fs.writeFileSync(memFile, '', 'utf-8');

    const { pruneMemory } = await import('../mcp-server/utils.js');
    const result = pruneMemory();

    expect(result).toContain('Memory Prune Complete');
    expect(result).toContain('Active entries kept:  0');
  });
});

// ── runMemoryMaintenance (non-destructive summary) ────────────────────────────

describe('memory hygiene — runMemoryMaintenance', () => {
  let tempRoot = '';
  const originalRoot = process.env['AI_OS_ROOT'];

  const staleDate = '2020-01-01T00:00:00.000Z';
  const freshDate = new Date().toISOString();

  beforeEach(() => {
    const active = {
      id: 'act1',
      createdAt: freshDate,
      updatedAt: freshDate,
      title: 'Active entry',
      content: 'Recent active entry',
      category: 'build',
      tags: [],
      status: 'active',
    };
    const aged = {
      id: 'old1',
      createdAt: staleDate,
      updatedAt: staleDate,
      title: 'Aged entry',
      content: 'Old entry that should be stale',
      category: 'build',
      tags: [],
      status: 'active',
    };

    tempRoot = createTempMemoryRoot([active, aged]);
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

  it('returns correct counts without modifying the file', async () => {
    const { runMemoryMaintenance } = await import('../mcp-server/utils.js');
    const summary = runMemoryMaintenance();

    expect(summary.totalBefore).toBe(2);
    expect(summary.staleMarked).toBeGreaterThanOrEqual(1);
    expect(summary.activeAfter).toBe(1);
    expect(summary.pruned).toBe(0); // non-destructive

    // File should be unchanged
    const remaining = readMemoryFile(tempRoot);
    expect(remaining).toHaveLength(2);
  });
});

// ── MCP tool count ────────────────────────────────────────────────────────────

describe('memory hygiene — prune_memory MCP tool is registered', () => {
  it('includes prune_memory in MCP tool definitions', async () => {
    const { MCP_TOOL_DEFINITIONS } = await import('../mcp-tools.js');
    const tool = MCP_TOOL_DEFINITIONS.find((t) => t.name === 'prune_memory');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('Compact');
  });
});
