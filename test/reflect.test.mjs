import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { install } from '../src/install.mjs';
import { refreshMapIfStale, extractGotchas } from '../templates/cortex-reflect.mjs';
import { readMapHash } from '../src/map.mjs';

/** Every temp dir this file creates, removed at exit. */
const TEMP_DIRS = [];

process.on('exit', () => {
  for (const dir of TEMP_DIRS) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // a leftover temp dir is not worth failing a run over
    }
  }
});

function installedRepo() {
  const root = mkdtempSync(join(tmpdir(), 'cortex-reflect-'));
  TEMP_DIRS.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'acme' }));
  writeFileSync(join(root, 'src/a.ts'), 'export function one() {}');
  install(root);
  return root;
}

test('importing the hook does not run it', () => {
  // The module is both a script and a library. If the main path ran on import, this test
  // file would have exited during module load and none of these assertions would report.
  assert.equal(typeof refreshMapIfStale, 'function');
  assert.equal(typeof extractGotchas, 'function');
});

test('does nothing when the map is current', async () => {
  const root = installedRepo();
  const before = readMapHash(root);
  const res = await refreshMapIfStale(root);
  assert.equal(res.refreshed, false);
  assert.equal(readMapHash(root), before);
});

test('regenerates when the structure drifts', async () => {
  const root = installedRepo();
  const before = readMapHash(root);
  writeFileSync(join(root, 'src/b.ts'), 'export function two() {}');

  const res = await refreshMapIfStale(root);
  assert.equal(res.refreshed, true);
  assert.notEqual(readMapHash(root), before);
  assert.match(readFileSync(join(root, '.cortex/map.md'), 'utf8'), /two/);
});

test('a cosmetic edit does not churn the committed map', async () => {
  const root = installedRepo();
  const before = readMapHash(root);
  writeFileSync(join(root, 'src/a.ts'), 'export function one() {}\n// just a comment');
  const res = await refreshMapIfStale(root);
  assert.equal(res.refreshed, false);
  assert.equal(readMapHash(root), before);
});

test('a repo with no vendored generator degrades instead of throwing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cortex-bare-'));
  TEMP_DIRS.push(root);
  const res = await refreshMapIfStale(root);
  assert.equal(res.refreshed, false);
  assert.ok(res.reason, 'must say why it did nothing');
});
