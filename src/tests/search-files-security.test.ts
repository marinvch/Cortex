import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock must be hoisted before any imports of the module under test
const mockSpawnSync = vi.fn();
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawnSync: mockSpawnSync,
}));

// ── searchFiles shell-injection regression tests (#105) ────────────────────────

describe('searchFiles – shell injection prevention', () => {
  beforeEach(() => {
    mockSpawnSync.mockReturnValue({
      pid: 1,
      output: [null, Buffer.from('mock result'), Buffer.from('')],
      stdout: 'mock result',
      stderr: '',
      status: 0,
      signal: null,
      error: undefined,
    });
  });

  it('passes query as a separate array arg, not interpolated into a shell string', async () => {
    const { searchFiles } = await import('../mcp-server/utils.js');
    const maliciousQuery = 'foo; rm -rf /';
    searchFiles(maliciousQuery);

    expect(mockSpawnSync).toHaveBeenCalled();
    const [cmd, args, opts] = mockSpawnSync.mock.calls[0] as [string, string[], Record<string, unknown>];

    // Must use npx directly (not sh/bash -c)
    expect(cmd).toBe('npx');
    expect(cmd).not.toBe('sh');
    expect(cmd).not.toBe('bash');
    // query must appear as a standalone array element
    expect(args).toContain(maliciousQuery);
    // must NOT be invoked with shell: true (which would allow metachar execution)
    expect(opts?.shell).toBeFalsy();
    // no -c flag that would imply shell interpretation
    expect(args).not.toContain('-c');
  });

  it('passes filePattern with shell metacharacters as a separate arg', async () => {
    const { searchFiles } = await import('../mcp-server/utils.js');
    const maliciousPattern = '*.ts; echo pwned';
    mockSpawnSync.mockClear();
    searchFiles('test', maliciousPattern);

    expect(mockSpawnSync).toHaveBeenCalled();
    const [, args] = mockSpawnSync.mock.calls[0] as [string, string[]];

    expect(args).toContain('-g');
    // filePattern passed as the next element after -g
    const gIdx = args.indexOf('-g');
    expect(args[gIdx + 1]).toBe(maliciousPattern);
  });

  it('passes backtick in query without executing it', async () => {
    const { searchFiles } = await import('../mcp-server/utils.js');
    const backtickQuery = '`whoami`';
    mockSpawnSync.mockClear();
    searchFiles(backtickQuery);

    expect(mockSpawnSync).toHaveBeenCalled();
    const [, args] = mockSpawnSync.mock.calls[0] as [string, string[]];
    expect(args).toContain(backtickQuery);
  });

  it('returns "No results found" when spawnSync reports an error', async () => {
    mockSpawnSync.mockReturnValue({
      pid: 0,
      output: [],
      stdout: '',
      stderr: '',
      status: 1,
      signal: null,
      error: new Error('command failed'),
    });

    const { searchFiles } = await import('../mcp-server/utils.js');
    const result = searchFiles('anything');
    expect(result).toBe('No results found');
  });
});

