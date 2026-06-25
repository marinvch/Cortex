import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('no @github/copilot-sdk usage', () => {
  // The dead --copilot SDK bridge and its import are gone from the code. The npm package
  // itself is intentionally retained as an unused dependency for now: removing it from
  // package.json/lockfile makes npm 10 (CI) drop the peer-marked build devDeps it had been
  // pulling in, breaking `npm run build`. To be properly dropped once the lockfile can be
  // regenerated under npm 10 (see docs follow-up). This guard enforces the real goal: no
  // import/usage of the SDK in source code.
  it('has no import/usage of @github/copilot-sdk in src', () => {
    const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const grep = spawnSync('git', ['grep', '-nI', '@github/copilot-sdk', '--', 'src', ':!src/tests/no-copilot-sdk.test.ts'], { cwd: engineRoot, encoding: 'utf8' });
    expect((grep.stdout || '').trim(), `found copilot-sdk refs:\n${grep.stdout}`).toBe('');
  });

  it('has no @github/copilot-sdk or --copilot references in scripts/ or docs/mcp-tools.md', () => {
    const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const sdkGrep = spawnSync('git', ['grep', '-nI', '@github/copilot-sdk', '--', 'scripts', 'docs/mcp-tools.md'], { cwd: engineRoot, encoding: 'utf8' });
    expect((sdkGrep.stdout || '').trim(), `found copilot-sdk refs in scripts/docs:\n${sdkGrep.stdout}`).toBe('');
    const flagGrep = spawnSync('git', ['grep', '-nI', '--copilot', '--', 'scripts', 'docs/mcp-tools.md', ':!src/tests/no-copilot-sdk.test.ts'], { cwd: engineRoot, encoding: 'utf8' });
    expect((flagGrep.stdout || '').trim(), `found --copilot refs in scripts/docs:\n${flagGrep.stdout}`).toBe('');
  });
});
