import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('session continuity memory tools', () => {
  let tempRoot = '';
  const originalRoot = process.env['AI_OS_ROOT'];

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-os-session-test-'));
    const memoryDir = path.join(tempRoot, '.github', 'ai-os', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, 'memory.jsonl'), '', 'utf-8');
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

  it('upserts and reads active plan', async () => {
    const { upsertActivePlan, getActivePlan } = await import('../mcp-server/utils.js');

    const upsert = upsertActivePlan(
      'Implement memory continuity',
      'All new tools are wired and tested',
      'active',
      'Editing mcp tools',
      'Write tests',
      'none',
    );

    expect(upsert).toContain('Active plan upserted');

    const plan = getActivePlan();
    expect(plan).toContain('Implement memory continuity');
    expect(plan).toContain('All new tools are wired and tested');
    expect(plan).toContain('Editing mcp tools');
    expect(plan).toContain('Write tests');
  });

  it('appends and closes checkpoints', async () => {
    const { appendCheckpoint, closeCheckpoint } = await import('../mcp-server/utils.js');

    const append = appendCheckpoint('Patch MCP handlers', 'open', 'in progress', 12);
    expect(append).toContain('Checkpoint appended:');

    const checkpointId = append.split(':').pop()?.trim() ?? '';
    expect(checkpointId.length).toBeGreaterThan(0);

    const closed = closeCheckpoint(checkpointId, 'done');
    expect(closed).toContain(`Checkpoint closed: ${checkpointId}`);

    const checkpointsPath = path.join(tempRoot, '.github', 'ai-os', 'memory', 'session', 'checkpoints.jsonl');
    const rows = fs.readFileSync(checkpointsPath, 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { id: string; status: string; notes?: string; closedAt?: string });
    const row = rows.find((item) => item.id === checkpointId);

    expect(row?.status).toBe('closed');
    expect(row?.notes).toContain('done');
    expect(Boolean(row?.closedAt)).toBe(true);
  });

  it('records and deduplicates failure patterns', async () => {
    const { recordFailurePattern } = await import('../mcp-server/utils.js');

    const first = recordFailurePattern(
      'run_task',
      'validate timeout',
      'long running task',
      'increase timeout',
      'partial',
      0.7,
    );
    expect(first).toContain('Failure pattern recorded:');

    const second = recordFailurePattern(
      'run_task',
      'validate timeout',
      'long running task',
      'increase timeout',
      'resolved',
      0.9,
    );
    expect(second).toContain('Failure pattern updated:');

    const failurePath = path.join(tempRoot, '.github', 'ai-os', 'memory', 'session', 'failure-ledger.jsonl');
    const rows = fs.readFileSync(failurePath, 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { occurrences: number; outcome: string });

    expect(rows.length).toBe(1);
    expect(rows[0].occurrences).toBe(2);
    expect(rows[0].outcome).toBe('resolved');
  });

  it('compacts session context into a single recovery artifact', async () => {
    const {
      upsertActivePlan,
      appendCheckpoint,
      recordFailurePattern,
      compactSessionContext,
    } = await import('../mcp-server/utils.js');

    upsertActivePlan(
      'Keep goals stable',
      'No goal drift after many calls',
      'active',
      'checkpointing',
      'compact context',
      'none',
    );
    appendCheckpoint('Checkpoint session state', 'open', 'captured', 5);
    recordFailurePattern('search_codebase', 'no matches', 'query too narrow', 'broaden query', 'partial', 0.6);

    const output = compactSessionContext();
    expect(output).toContain('Compact context written to .github/ai-os/memory/session/compact-context.md');
    expect(output).toContain('Keep goals stable');
    expect(output).toContain('Recent Failure Patterns');

    const compactPath = path.join(tempRoot, '.github', 'ai-os', 'memory', 'session', 'compact-context.md');
    expect(fs.existsSync(compactPath)).toBe(true);
  });

  it('creates automatic watchdog checkpoint when tool-call threshold is reached', async () => {
    const { recordToolCallAndRunWatchdog } = await import('../mcp-server/utils.js');

    let watchdogMessage: string | null = null;
    for (let i = 0; i < 8; i++) {
      watchdogMessage = recordToolCallAndRunWatchdog('search_codebase');
    }

    expect(watchdogMessage).toContain('Watchdog checkpoint created');

    const checkpointsPath = path.join(tempRoot, '.github', 'ai-os', 'memory', 'session', 'checkpoints.jsonl');
    const rows = fs.readFileSync(checkpointsPath, 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { title: string; notes?: string; toolCallCount?: number });
    const watchdog = rows.find((row) => row.title.includes('Goal watchdog checkpoint'));

    expect(Boolean(watchdog)).toBe(true);
    expect(watchdog?.toolCallCount).toBe(8);
    expect(watchdog?.notes).toContain('Auto-checkpoint after 8 tool calls');
  });

  it('set_watchdog_threshold changes checkpoint interval', async () => {
    const { setWatchdogThreshold, recordToolCallAndRunWatchdog } = await import('../mcp-server/utils.js');

    const result = setWatchdogThreshold(3);
    expect(result).toContain('Watchdog threshold updated to 3');

    let watchdogMessage: string | null = null;
    for (let i = 0; i < 3; i++) {
      watchdogMessage = recordToolCallAndRunWatchdog('search_codebase');
    }
    expect(watchdogMessage).toContain('Watchdog checkpoint created');
  });

  it('trims checkpoints.jsonl when entries exceed SESSION_CHECKPOINTS_CAP', async () => {
    const { appendCheckpoint } = await import('../mcp-server/utils.js');

    // Write 105 checkpoints — should be trimmed to the cap (100)
    for (let i = 0; i < 105; i++) {
      appendCheckpoint(`checkpoint-${i}`, 'open');
    }

    const checkpointsPath = path.join(tempRoot, '.github', 'ai-os', 'memory', 'session', 'checkpoints.jsonl');
    const lines = fs.readFileSync(checkpointsPath, 'utf-8').split('\n').filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(100);
  });
});
