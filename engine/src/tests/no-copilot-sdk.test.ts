import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

describe('no @github/copilot-sdk usage', () => {
  it('has no import of @github/copilot-sdk in src and no dep entry', () => {
    const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const grep = spawnSync('git', ['grep', '-nI', '@github/copilot-sdk', '--', 'src', ':!src/tests/no-copilot-sdk.test.ts'], { cwd: engineRoot, encoding: 'utf8' });
    expect((grep.stdout || '').trim(), `found copilot-sdk refs:\n${grep.stdout}`).toBe('');
    const pkg = JSON.parse(readFileSync(resolve(engineRoot, 'package.json'), 'utf8'));
    expect(pkg.dependencies?.['@github/copilot-sdk']).toBeUndefined();
  });

  it('has no @github/copilot-sdk or --copilot references in scripts/ or docs/mcp-tools.md', () => {
    const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const sdkGrep = spawnSync('git', ['grep', '-nI', '@github/copilot-sdk', '--', 'scripts', 'docs/mcp-tools.md'], { cwd: engineRoot, encoding: 'utf8' });
    expect((sdkGrep.stdout || '').trim(), `found copilot-sdk refs in scripts/docs:\n${sdkGrep.stdout}`).toBe('');
    const flagGrep = spawnSync('git', ['grep', '-nI', '--copilot', '--', 'scripts', 'docs/mcp-tools.md', ':!src/tests/no-copilot-sdk.test.ts'], { cwd: engineRoot, encoding: 'utf8' });
    expect((flagGrep.stdout || '').trim(), `found --copilot refs in scripts/docs:\n${flagGrep.stdout}`).toBe('');
  });
});
