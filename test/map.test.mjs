import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  scanRepo,
  MAX_FILES,
  extractorFor,
  EXTRACTORS,
  buildMap,
  isStale,
  readMapHash,
  MAP_REL,
} from '../src/map.mjs';

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

test('does not map the agent scaffolding, only the project', () => {
  const root = repoWith({
    'src/a.ts': '',
    '.claude/hooks/cortex-reflect.mjs': '',
    '.cortex/lib/map.mjs': '',
  });
  const res = scanRepo(root);
  assert.ok(res.files.includes('src/a.ts'));
  assert.ok(!res.files.includes('.claude/hooks/cortex-reflect.mjs'), 'Cortex plumbing is not architecture');
  assert.ok(!res.files.includes('.cortex/lib/map.mjs'));
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

test('extracts ES module imports', () => {
  const ex = extractorFor('src/a.ts');
  const { imports } = ex.extract(`
import { a } from './db';
import def from "stripe";
import './side-effect.css';
export { x } from './re-export';
const y = require('node:fs');
`);
  for (const want of ['./db', 'stripe', './side-effect.css', './re-export', 'node:fs']) {
    assert.ok(imports.includes(want), `expected import ${want}, got ${JSON.stringify(imports)}`);
  }
});

test('extracts named and default exports', () => {
  const ex = extractorFor('src/a.ts');
  const { exports } = ex.extract(`
export function createSession() {}
export const LIMIT = 5;
export class Cart {}
export default function handler() {}
export async function slow() {}
`);
  for (const want of ['createSession', 'LIMIT', 'Cart', 'handler', 'slow']) {
    assert.ok(exports.includes(want), `expected export ${want}, got ${JSON.stringify(exports)}`);
  }
});

test('does not treat a non-JS file as parseable', () => {
  assert.equal(extractorFor('main.go'), null);
  assert.equal(extractorFor('schema.prisma'), null);
});

test('every extractor declares a name used in the coverage report', () => {
  for (const ex of EXTRACTORS) {
    assert.ok(ex.name, 'extractor needs a name');
    assert.equal(typeof ex.match, 'function');
    assert.equal(typeof ex.extract, 'function');
  }
});

test('renders sections an agent can act on', () => {
  const root = repoWith({
    'package.json': JSON.stringify({ name: 'acme', main: 'src/index.ts' }),
    'src/index.ts': "export function boot() {}\nimport './db';",
    'src/db.ts': 'export const client = 1;',
    'prisma/schema.prisma': 'model User {}',
  });
  const { markdown } = buildMap(root);
  assert.match(markdown, /# Structural map/);
  assert.match(markdown, /## Entry points/);
  assert.match(markdown, /## Data layer/);
  assert.match(markdown, /## Coverage/);
  assert.match(markdown, /src\/index\.ts/);
  assert.match(markdown, /boot/);
});

test('states which languages were parsed and which were only listed', () => {
  const root = repoWith({ 'src/a.ts': 'export const x = 1;', 'main.go': 'package main' });
  const { markdown, stats } = buildMap(root);
  assert.ok(stats.parsed.includes('JavaScript/TypeScript'));
  assert.ok(stats.listedOnly.length > 0, 'go should be listed but not parsed');
  assert.match(markdown, /listed only/i);
});

test('records the cap in the map instead of pretending completeness', () => {
  const files = {};
  for (let i = 0; i < 12; i++) files[`src/f${i}.ts`] = 'export const x = 1;';
  const root = repoWith(files);
  const { markdown, stats } = buildMap(root, { maxFiles: 5 });
  assert.equal(stats.capped, true);
  assert.match(markdown, /5 of 12/);
});

test('the hash changes when structure changes but not on cosmetic edits', () => {
  const root = repoWith({ 'src/a.ts': 'export function one() {}' });
  const before = buildMap(root).hash;

  writeFileSync(join(root, 'src/a.ts'), 'export function one() {}\n// a comment that changes nothing structural');
  assert.equal(buildMap(root).hash, before, 'a comment must not invalidate the map');

  writeFileSync(join(root, 'src/a.ts'), 'export function one() {}\nexport function two() {}');
  assert.notEqual(buildMap(root).hash, before, 'a new export must invalidate the map');
});

test('isStale is true when no map exists and false right after writing one', () => {
  const root = repoWith({ 'src/a.ts': 'export const x = 1;' });
  assert.equal(isStale(root), true);

  const { markdown, hash } = buildMap(root);
  mkdirSync(join(root, '.cortex'), { recursive: true });
  writeFileSync(join(root, MAP_REL), markdown);

  assert.equal(readMapHash(root), hash);
  assert.equal(isStale(root), false);
});
