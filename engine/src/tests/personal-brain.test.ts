import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

afterEach(() => {
  delete process.env['AI_OS_PERSONAL_ROOT'];
  delete process.env['AI_OS_ROOT'];
});

describe('getPersonalBrainPath', () => {
  it('uses AI_OS_PERSONAL_ROOT when set', async () => {
    process.env['AI_OS_PERSONAL_ROOT'] = '/tmp/my-brain';
    vi.resetModules();
    const { getPersonalBrainPath } = await import('../mcp-server/shared.js');
    expect(getPersonalBrainPath()).toBe('/tmp/my-brain');
  });

  it('returns empty string when unset (caller must resolve from config)', async () => {
    delete process.env['AI_OS_PERSONAL_ROOT'];
    vi.resetModules();
    const { getPersonalBrainPath } = await import('../mcp-server/shared.js');
    expect(getPersonalBrainPath()).toBe('');
  });

  it('falls back to config.personalBrainPath when env var is unset', async () => {
    delete process.env['AI_OS_PERSONAL_ROOT'];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-pbp-'));
    process.env['AI_OS_ROOT'] = tmp;
    fs.mkdirSync(path.join(tmp, '.github', 'ai-os'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.github', 'ai-os', 'config.json'),
      JSON.stringify({ personalBrainPath: '/tmp/from-config' }),
    );
    vi.resetModules();
    const { getPersonalBrainPath } = await import('../mcp-server/shared.js');
    expect(getPersonalBrainPath()).toBe('/tmp/from-config');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('prefers env var over config when both set', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-pbp-'));
    process.env['AI_OS_ROOT'] = tmp;
    fs.mkdirSync(path.join(tmp, '.github', 'ai-os'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.github', 'ai-os', 'config.json'),
      JSON.stringify({ personalBrainPath: '/tmp/from-config' }),
    );
    process.env['AI_OS_PERSONAL_ROOT'] = '/tmp/from-env';
    vi.resetModules();
    const { getPersonalBrainPath } = await import('../mcp-server/shared.js');
    expect(getPersonalBrainPath()).toBe('/tmp/from-env');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns empty string when config is malformed JSON', async () => {
    delete process.env['AI_OS_PERSONAL_ROOT'];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-pbp-'));
    process.env['AI_OS_ROOT'] = tmp;
    fs.mkdirSync(path.join(tmp, '.github', 'ai-os'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.github', 'ai-os', 'config.json'), '{ not valid json');
    vi.resetModules();
    const { getPersonalBrainPath } = await import('../mcp-server/shared.js');
    expect(getPersonalBrainPath()).toBe('');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
