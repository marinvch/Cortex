import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanRepo, MAX_FILES } from '../src/map.mjs';

function repoWith(files) {
  const root = mkdtempSync(join(tmpdir(), 'cortex-map-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

test('finds source files and reports the total', () => {
  const root = repoWith({ 'src/a.ts': '', 'src/b.ts': '', 'README.md': '' });
  const res = scanRepo(root);
  assert.equal(res.capped, false);
  assert.ok(res.files.includes('src/a.ts'));
  assert.ok(res.files.includes('src/b.ts'));
});

test('skips node_modules, .git and build output', () => {
  const root = repoWith({
    'src/a.ts': '',
    'node_modules/pkg/index.js': '',
    'dist/bundle.js': '',
    '.git/config': '',
  });
  const res = scanRepo(root);
  assert.ok(res.files.includes('src/a.ts'));
  for (const bad of ['node_modules/pkg/index.js', 'dist/bundle.js', '.git/config']) {
    assert.ok(!res.files.includes(bad), `should not scan ${bad}`);
  }
});

test('honours .gitignore', () => {
  const root = repoWith({ 'src/a.ts': '', 'generated/big.ts': '', '.gitignore': 'generated/\n' });
  const res = scanRepo(root);
  assert.ok(res.files.includes('src/a.ts'));
  assert.ok(!res.files.includes('generated/big.ts'));
});

test('honours .cortexignore, which wins over .gitignore', () => {
  const root = repoWith({
    'src/a.ts': '',
    'fixtures/huge.ts': '',
    '.cortexignore': '# not knowledge\nfixtures/\n',
  });
  const res = scanRepo(root);
  assert.ok(res.files.includes('src/a.ts'));
  assert.ok(!res.files.includes('fixtures/huge.ts'), '.cortexignore must exclude from the map');
});

test('caps the scan and says so, rather than truncating silently', () => {
  const files = {};
  for (let i = 0; i < 12; i++) files[`src/f${i}.ts`] = '';
  const root = repoWith(files);
  const res = scanRepo(root, { maxFiles: 5 });
  assert.equal(res.files.length, 5);
  assert.equal(res.capped, true);
  assert.equal(res.total, 12);
});

test('default cap matches the spec', () => {
  assert.equal(MAX_FILES, 2000);
});
