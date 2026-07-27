import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { install } from '../src/install.mjs';
import { detect } from '../src/detect.mjs';

function fixture({ pkg, files = {}, dirs = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cortex-install-'));
  if (pkg) writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
  for (const d of dirs) mkdirSync(join(root, d), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

const NEXT_PKG = {
  name: 'acme-storefront',
  description: 'Customer-facing storefront',
  scripts: { dev: 'next dev', build: 'next build', test: 'vitest', lint: 'eslint .' },
  dependencies: { next: '14.1.4', react: '18.2.0' },
  devDependencies: { vitest: '1.4.0', eslint: '8.57.0' },
};

test('detects the stack from real files rather than guessing', () => {
  const root = fixture({
    pkg: NEXT_PKG,
    files: { 'tsconfig.json': '{"compilerOptions":{"strict":true}}', 'pnpm-lock.yaml': '' },
    dirs: ['src', 'app', '.github/workflows'],
  });
  const f = detect(root);
  assert.equal(f.framework, 'Next.js');
  assert.equal(f.packageManager, 'pnpm');
  assert.equal(f.testRunner, 'Vitest');
  assert.equal(f.tsStrict, true);
  assert.equal(f.ci, 'GitHub Actions');
  assert.deepEqual(f.languages, ['TypeScript']);
  assert.deepEqual(f.directories, ['src', 'app']);
});

test('leaves fields null rather than inventing them', () => {
  const root = fixture();
  const f = detect(root);
  assert.equal(f.framework, null);
  assert.equal(f.testRunner, null);
  assert.equal(f.packageManager, null);
});

test('a fresh install writes the brain, the shims, memory and the vendored guard', () => {
  const root = fixture({ pkg: NEXT_PKG, dirs: ['src'] });
  install(root);

  for (const rel of [
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.github/copilot-instructions.md',
    '.cursor/rules/project.mdc',
    '.cortex/config.json',
    '.cortex/memory/gotchas.md',
    '.cortex/memory/decisions.md',
    '.cortex/lib/guard.mjs',
    '.cortex/lib/memory.mjs',
    '.cortex/lib/paths.mjs',
    '.claude/hooks/cortex-reflect.mjs',
    '.claude/settings.json',
  ]) {
    assert.ok(existsSync(join(root, rel)), `expected ${rel} to exist`);
  }
});

test('shims point at AGENTS.md and never carry their own copy of the content', () => {
  const root = fixture({ pkg: NEXT_PKG });
  install(root);
  const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
  assert.equal(claude.trim(), '@AGENTS.md');
  for (const rel of ['GEMINI.md', '.github/copilot-instructions.md']) {
    const body = readFileSync(join(root, rel), 'utf8');
    assert.match(body, /AGENTS\.md/);
    assert.ok(body.length < 200, `${rel} should be a pointer, not a copy`);
  }
});

test('dry run writes nothing at all', () => {
  const root = fixture({ pkg: NEXT_PKG });
  const { plan } = install(root, { dryRun: true });
  assert.ok(plan.length > 0);
  assert.equal(existsSync(join(root, 'AGENTS.md')), false);
  assert.equal(existsSync(join(root, '.cortex')), false);
});

test('refresh updates stack facts but preserves every human word', () => {
  const root = fixture({ pkg: NEXT_PKG, files: { 'pnpm-lock.yaml': '' } });
  install(root);

  const p = join(root, 'AGENTS.md');
  writeFileSync(
    p,
    readFileSync(p, 'utf8').replace(
      '- _Naming, file layout, import rules, component patterns._',
      '- HAND-WRITTEN: never call the payments API from a client component.',
    ),
  );

  // the project migrates pnpm -> yarn and vitest -> jest
  writeFileSync(join(root, 'yarn.lock'), '');
  writeFileSync(join(root, 'pnpm-lock.yaml'), '');
  const pkg = { ...NEXT_PKG, devDependencies: { jest: '29.7.0', eslint: '8.57.0' } };
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
  writeFileSync(join(root, 'pnpm-lock.yaml'), '');

  install(root, { refresh: true });
  const after = readFileSync(p, 'utf8');

  assert.match(after, /HAND-WRITTEN: never call the payments API/);
  assert.match(after, /\*\*Tests:\*\* Jest/);
});

test('refuses to overwrite an AGENTS.md that has no cortex markers', () => {
  const root = fixture({ pkg: NEXT_PKG });
  const mine = '# My own brain\n\nHand-maintained, no markers.\n';
  writeFileSync(join(root, 'AGENTS.md'), mine);

  const { plan } = install(root);
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), mine);
  assert.ok(plan.find((s) => s.rel === 'AGENTS.md' && s.skipped));
});

test('merges into an existing settings.json without clobbering other hooks', () => {
  const root = fixture({ pkg: NEXT_PKG });
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(
    join(root, '.claude/settings.json'),
    JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'mine.sh' }] }] } }),
  );

  install(root);
  const s = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.ok(s.hooks.PreToolUse, 'existing hook survived');
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, 'mine.sh');
  assert.ok(s.hooks.SessionEnd, 'cortex hook added');
});

test('is idempotent — a second run does not duplicate the hook registration', () => {
  const root = fixture({ pkg: NEXT_PKG });
  install(root);
  install(root);
  const s = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.equal(s.hooks.SessionEnd.length, 1);
});

test('install stamps the meta-skills so the repo can extend itself', () => {
  const root = fixture({ pkg: NEXT_PKG });
  install(root);
  for (const name of ['cortex-skill', 'cortex-agent', 'cortex-hook', 'cortex-mcp']) {
    assert.ok(existsSync(join(root, '.claude/skills', name, 'SKILL.md')), `missing ${name}`);
  }
});

test('writes a structural map and vendors the generator that maintains it', () => {
  const root = fixture({
    pkg: NEXT_PKG,
    files: { 'src/index.ts': "export function boot() {}\nimport './db';", 'src/db.ts': 'export const c = 1;' },
    dirs: ['src'],
  });
  install(root);
  assert.ok(existsSync(join(root, '.cortex/map.md')));
  assert.ok(existsSync(join(root, '.cortex/lib/map.mjs')), 'hook needs the generator after npx is gone');
  const map = readFileSync(join(root, '.cortex/map.md'), 'utf8');
  assert.match(map, /cortex:map hash=/);
  assert.match(map, /boot/);
});

test('--no-map opts out', () => {
  const root = fixture({ pkg: NEXT_PKG });
  install(root, { noMap: true });
  assert.equal(existsSync(join(root, '.cortex/map.md')), false);
});

test('a broken repo does not fail the install; the map degrades and says so', () => {
  const root = fixture({ pkg: NEXT_PKG });
  writeFileSync(join(root, 'package.json'), '{ this is not valid json');
  assert.doesNotThrow(() => install(root));
  assert.ok(existsSync(join(root, 'AGENTS.md')), 'install must still complete');
});
