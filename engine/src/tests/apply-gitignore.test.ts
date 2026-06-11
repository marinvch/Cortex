import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensurePersonalRootGitignore } from '../actions/apply.js';

let cwd: string;
beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-apply-')); });
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

describe('ensurePersonalRootGitignore', () => {
  it('adds brain/ and context/ entries idempotently', () => {
    ensurePersonalRootGitignore(cwd);
    ensurePersonalRootGitignore(cwd);
    const gi = fs.readFileSync(path.join(cwd, '.gitignore'), 'utf-8');
    expect(gi.match(/^brain\/$/m)).toBeTruthy();
    expect(gi.match(/^context\/$/m)).toBeTruthy();
    // idempotent — only one occurrence each
    expect(gi.split('\n').filter((l) => l === 'brain/')).toHaveLength(1);
  });
});
