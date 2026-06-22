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
});
