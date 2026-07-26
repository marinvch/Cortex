import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { resolveInRepo, OutsideRepoError } from '../src/paths.mjs';

function tempRepo() {
  return mkdtempSync(join(tmpdir(), 'cortex-paths-'));
}

test('resolves a normal path inside the repo', () => {
  const repo = tempRepo();
  const out = resolveInRepo(repo, '.cortex/memory/gotchas.md');
  assert.ok(out.startsWith(resolve(repo)));
});

test('resolves a path that does not exist yet', () => {
  const repo = tempRepo();
  assert.doesNotThrow(() => resolveInRepo(repo, 'a/b/c/not-created-yet.md'));
});

test('refuses a parent-directory escape', () => {
  const repo = tempRepo();
  assert.throws(() => resolveInRepo(repo, '../escaped.md'), OutsideRepoError);
  assert.throws(() => resolveInRepo(repo, 'a/../../escaped.md'), OutsideRepoError);
});

test('refuses an absolute path outside the repo', () => {
  const repo = tempRepo();
  const outside = join(tmpdir(), 'cortex-absolute-target.md');
  assert.throws(() => resolveInRepo(repo, outside), OutsideRepoError);
});

test('refuses a path that escapes through a symlink', { skip: process.platform === 'win32' && 'symlinks need elevation on Windows' }, () => {
  const repo = tempRepo();
  const elsewhere = tempRepo();
  mkdirSync(join(elsewhere, 'secrets'), { recursive: true });
  writeFileSync(join(elsewhere, 'secrets', 'keys.txt'), 'x');
  symlinkSync(join(elsewhere, 'secrets'), join(repo, 'link'), 'dir');

  assert.throws(() => resolveInRepo(repo, 'link/keys.txt'), OutsideRepoError);
});

test('allows the repo root itself', () => {
  const repo = tempRepo();
  assert.doesNotThrow(() => resolveInRepo(repo, '.'));
});
