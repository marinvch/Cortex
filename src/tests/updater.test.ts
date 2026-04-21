import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}));

describe('updater version resolution', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('prefers the latest published tag over an unreleased local tool version', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: [
        'abc123\trefs/tags/v0.8.0',
        'def456\trefs/tags/v0.9.0',
      ].join('\n'),
    });

    const { getLatestResolvableVersion } = await import('../updater.js');

    expect(getLatestResolvableVersion('1.0.0')).toBe('v0.9.0');
  });

  it('emits a shell-safe quoted update command in the banner', async () => {
    const { printUpdateBanner } = await import('../updater.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    printUpdateBanner({
      toolVersion: '1.0.0',
      latestVersion: '0.9.0',
      installedVersion: '0.8.0',
      updateAvailable: true,
      isFirstInstall: false,
    });

    const rendered = logSpy.mock.calls.map(call => String(call[0] ?? '')).join('\n');
    expect(rendered).toContain('npx -y "github:marinvch/ai-os#v0.9.0" --refresh-existing');

    logSpy.mockRestore();
  });
});
