import { describe, it, expect, afterEach } from 'vitest';

afterEach(() => { delete process.env['AI_OS_PERSONAL_ROOT']; });

describe('getPersonalBrainPath', () => {
  it('uses AI_OS_PERSONAL_ROOT when set', async () => {
    process.env['AI_OS_PERSONAL_ROOT'] = '/tmp/my-brain';
    const { getPersonalBrainPath } = await import('../mcp-server/shared.js');
    expect(getPersonalBrainPath()).toBe('/tmp/my-brain');
  });

  it('returns empty string when unset (caller must resolve from config)', async () => {
    delete process.env['AI_OS_PERSONAL_ROOT'];
    const { getPersonalBrainPath } = await import('../mcp-server/shared.js');
    expect(getPersonalBrainPath()).toBe('');
  });
});
