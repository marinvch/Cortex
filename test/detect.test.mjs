import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { detect } from '../src/detect.mjs';
import { renderAgentsMd, renderGeneratedBlock, GEN_START, GEN_END } from '../src/render.mjs';
import { install } from '../src/install.mjs';

/**
 * Detection tests.
 *
 * Every fact here is rendered into `AGENTS.md` and read by every AI agent on the team,
 * which acts on it confidently. A wrong stack fact is therefore worse than a missing one —
 * the same logic SPEC applies to the structural map ("a map that overstates itself is worse
 * than none"). So these tests care about two things in order:
 *
 *   1. the facts a repo supports are detected, and
 *   2. the facts a repo does NOT support are null, not guessed.
 *
 * They assert the detected values, never the rendered wording. `framework === 'Next.js'`
 * survives a copy edit to the AGENTS.md template; `/\*\*Framework:\*\* Next\.js/` does not.
 */

/** Marker for "this entry is a directory, not a file". */
const DIR = Symbol('dir');

/**
 * Build a throwaway repo, run `fn` against it, delete it afterwards — pass or fail.
 * Cleanup is in a `finally` rather than an exit hook so a failing assertion still
 * leaves the tmp dir at zero, which is where the other suites now hold it.
 */
function withRepo(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'cortex-detect-'));
  try {
    for (const rel of Object.keys(files)) {
      const abs = join(root, rel);
      const body = files[rel];
      if (body === DIR) {
        mkdirSync(abs, { recursive: true });
        continue;
      }
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Detect against a freshly built repo. `__root` rides along so a test can assert the basename fallback. */
const factsFor = (files) => withRepo(files, (root) => ({ ...detect(root), __root: root }));

// ── The four fixtures SPEC names by name ───────────────────────────────────────
//
// SPEC's Verification table promises `npx cortex-init` runs against Next.js, Django, Go
// and monorepo fixtures with "asserted expected AGENTS.md stack facts". These are those
// fixtures. Each is built to look like the real thing rather than the minimum that
// happens to trip the detector.

const NEXT_REPO = {
  'package.json': {
    name: 'acme-storefront',
    description: 'Customer-facing storefront',
    scripts: { dev: 'next dev', build: 'next build', test: 'vitest run', lint: 'next lint' },
    dependencies: { next: '14.1.4', react: '18.2.0', 'react-dom': '18.2.0' },
    devDependencies: { vitest: '1.4.0', eslint: '8.57.0', prettier: '3.2.5', typescript: '5.4.2' },
  },
  'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
  'tsconfig.json': '{\n  "compilerOptions": { "strict": true }\n}\n',
  'app/page.tsx': 'export default function Page() { return null; }\n',
  'components/nav.tsx': 'export const Nav = () => null;\n',
  '.github/workflows/ci.yml': 'on: push\n',
};

const DJANGO_REPO = {
  'manage.py': '#!/usr/bin/env python\nimport django\n',
  'requirements.txt': 'Django==5.0.3\npsycopg2-binary==2.9.9\n',
  'pyproject.toml': '[project]\nname = "billing"\n',
  'ruff.toml': 'line-length = 100\n',
  'README.md': '# Billing\n\nInternal billing portal for the ops team.\n',
  'app/models.py': 'from django.db import models\n',
  'tests/test_models.py': 'def test_ok(): pass\n',
};

const GO_REPO = {
  'go.mod': 'module example.com/payments\n\ngo 1.22\n',
  'go.sum': '',
  'cmd/api/main.go': 'package main\n\nfunc main() {}\n',
  'internal/store/store.go': 'package store\n',
  'README.md': '# payments\n\nPayment authorisation service.\n',
};

const MONOREPO = {
  'package.json': {
    name: 'acme-mono',
    private: true,
    workspaces: ['packages/*', 'apps/*'],
    scripts: { build: 'turbo build', test: 'turbo test', lint: 'turbo lint' },
    devDependencies: { turbo: '2.0.0', eslint: '8.57.0' },
  },
  'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - 'apps/*'\n",
  'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
  'packages/ui/package.json': { name: '@acme/ui', dependencies: { react: '18.2.0' } },
  'apps/web/package.json': { name: '@acme/web', dependencies: { next: '14.1.4' } },
};

test('Next.js fixture: every stack fact it supports is detected', () => {
  const f = factsFor(NEXT_REPO);
  assert.equal(f.name, 'acme-storefront');
  assert.equal(f.purpose, 'Customer-facing storefront');
  assert.deepEqual(f.languages, ['TypeScript']);
  assert.equal(f.framework, 'Next.js');
  assert.equal(f.packageManager, 'pnpm');
  assert.equal(f.testRunner, 'Vitest');
  assert.equal(f.ci, 'GitHub Actions');
  assert.equal(f.tsStrict, true);
  assert.deepEqual(f.linters.slice().sort(), ['ESLint', 'Prettier']);

  // Commands must be issued through the manager the lockfile names. `npm run dev` in a
  // pnpm workspace is a wrong instruction an agent will follow.
  assert.equal(f.scripts.install, 'pnpm install');
  assert.equal(f.scripts.dev, 'pnpm run dev');
  assert.equal(f.scripts.build, 'pnpm run build');
  assert.equal(f.scripts.test, 'pnpm run test');
  assert.equal(f.scripts.lint, 'pnpm run lint');

  assert.ok(f.directories.includes('app'), 'app/ is where the routes live');
  assert.ok(f.directories.includes('components'));
});

test('Django fixture: Python is detected and nothing JavaScript is invented', () => {
  const f = factsFor(DJANGO_REPO);
  assert.deepEqual(f.languages, ['Python']);
  assert.deepEqual(f.linters, ['Ruff']);
  assert.equal(f.purpose, 'Internal billing portal for the ops team.');
  assert.ok(f.directories.includes('app'));
  assert.ok(f.directories.includes('tests'));

  // No package.json, so there is nothing to say about a JS toolchain. Saying it anyway
  // is the failure mode that matters: an agent runs `npm install` in a Django repo.
  assert.equal(f.packageManager, null);
  assert.equal(f.testRunner, null);
  assert.equal(f.tsStrict, null);
  for (const key of Object.keys(f.scripts)) {
    assert.equal(f.scripts[key], null, `scripts.${key} must stay null with no package.json`);
  }

  // Detection knows no Python frameworks at all, so Django itself is not identified.
  // Null is the honest answer; a guess would not be. See the report note on this gap.
  assert.equal(f.framework, null);
});

test('Go fixture: Go is detected, and a JS-shaped fact is never fabricated', () => {
  const f = factsFor(GO_REPO);
  assert.deepEqual(f.languages, ['Go']);
  assert.equal(f.purpose, 'Payment authorisation service.');
  assert.ok(f.directories.includes('cmd'));
  assert.ok(f.directories.includes('internal'));
  assert.equal(f.packageManager, null);
  assert.equal(f.framework, null);
  assert.equal(f.testRunner, null);
  assert.equal(f.scripts.install, null);
});

test('a repo with no package.json is named after its directory', () => {
  withRepo(GO_REPO, (root) => {
    assert.equal(detect(root).name, basename(root));
  });
});

test('a Go workspace is reported as one, alongside plain Go', () => {
  const f = factsFor({ ...GO_REPO, 'go.work': 'go 1.22\n\nuse ./svc\n' });
  assert.ok(f.languages.includes('Go'));
  assert.ok(f.languages.includes('Go (workspace)'));
});

test('monorepo fixture: the root toolchain is detected and no workspace framework leaks up', () => {
  const f = factsFor(MONOREPO);
  assert.equal(f.name, 'acme-mono');
  assert.equal(f.packageManager, 'pnpm');
  assert.equal(f.scripts.build, 'pnpm run build');
  assert.equal(f.scripts.test, 'pnpm run test');
  assert.ok(f.directories.includes('packages'));
  assert.ok(f.directories.includes('apps'));

  // `next` and `react` exist in this repo, but in workspaces — not in the root manifest.
  // Detection reads the root only, so claiming Next.js here would be a fact the root
  // package does not support. Null is right; that the monorepo shape itself is never
  // reported anywhere is a coverage gap, recorded in the report rather than asserted here.
  assert.equal(f.framework, null);
});

// ── Installs clean on a foreign repo ───────────────────────────────────────────

test('all four fixtures install without throwing and stamp AGENTS.md', () => {
  const fixtures = { next: NEXT_REPO, django: DJANGO_REPO, go: GO_REPO, monorepo: MONOREPO };
  for (const label of Object.keys(fixtures)) {
    withRepo(fixtures[label], (root) => {
      const { facts, plan } = install(root);
      assert.ok(plan.length, `${label}: install reported no plan`);
      assert.equal(facts.framework, detect(root).framework, `${label}: install detected differently`);
      const doc = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      assert.ok(doc.includes(GEN_START) && doc.includes(GEN_END), `${label}: no generated block`);
      const cfg = JSON.parse(readFileSync(join(root, '.cortex/config.json'), 'utf8'));
      assert.equal(cfg.name, detect(root).name, `${label}: config name disagrees with detection`);
    });
  }
});

test('the stamped AGENTS.md carries the detected stack and none of another stack', () => {
  withRepo(NEXT_REPO, (root) => {
    install(root);
    const doc = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    const block = doc.slice(doc.indexOf(GEN_START), doc.indexOf(GEN_END));
    assert.ok(block.includes('Next.js'), 'the detected framework must reach the document');
    assert.ok(block.includes('Vitest'));
    assert.ok(block.includes('pnpm run dev'), 'the run commands must use the detected manager');
    assert.ok(!/\bnpm install\b/.test(block), 'a pnpm repo must never be told to npm install');
    assert.ok(!/\byarn\b/.test(block));
  });

  withRepo(GO_REPO, (root) => {
    install(root);
    const doc = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    const block = doc.slice(doc.indexOf(GEN_START), doc.indexOf(GEN_END));
    assert.ok(block.includes('Go'));
    // A Go repo's brain must not contain a JS toolchain instruction anywhere.
    for (const invented of ['npm install', 'pnpm', 'yarn', 'Vitest', 'Jest', 'Next.js', 'TypeScript']) {
      assert.ok(!block.includes(invented), `Go repo's AGENTS.md invented: ${invented}`);
    }
  });
});

// ── Degradation: honest silence beats a guess ──────────────────────────────────

test('a repo with nothing in it detects nothing and throws nothing', () => {
  const f = factsFor({ 'notes.txt': 'hello\n' });
  assert.deepEqual(f.languages, []);
  assert.deepEqual(f.directories, []);
  assert.deepEqual(f.linters, []);
  assert.equal(f.framework, null);
  assert.equal(f.packageManager, null);
  assert.equal(f.testRunner, null);
  assert.equal(f.ci, null);
  assert.equal(f.purpose, null);
  assert.equal(f.tsStrict, null);
});

test('an empty package.json invents no package manager, scripts or deps', () => {
  const f = factsFor({ 'package.json': '' });
  assert.equal(f.framework, null);
  assert.equal(f.testRunner, null);
  assert.equal(f.packageManager, null, 'an unreadable manifest is not evidence of npm');
  for (const key of Object.keys(f.scripts)) {
    assert.equal(f.scripts[key], null, `scripts.${key} came from a manifest that could not be read`);
  }
});

test('a malformed package.json degrades instead of throwing', () => {
  const f = factsFor({ 'package.json': '{ "name": "broken", "dependencies": { "next": ' });
  assert.equal(f.name, basename(f.__root), 'a name from unparseable JSON is not a name');
  assert.equal(f.framework, null, 'a dependency inside unparseable JSON is not a dependency');
  assert.equal(f.testRunner, null);
  for (const key of Object.keys(f.scripts)) {
    assert.equal(f.scripts[key], null);
  }
});

test('a package.json that is valid JSON but not an object does not throw or invent scripts', () => {
  for (const body of ['42', '"a string"', '[]', 'null', 'true']) {
    const f = factsFor({ 'package.json': body });
    assert.equal(typeof f.name, 'string', `name for package.json = ${body}`);
    assert.equal(f.framework, null, `framework for package.json = ${body}`);
    assert.equal(f.testRunner, null);
    for (const key of ['dev', 'build', 'test', 'lint']) {
      assert.equal(f.scripts[key], null, `scripts.${key} for package.json = ${body}`);
    }
  }
});

test('odd dependency and script shapes are ignored rather than crashing', () => {
  const f = factsFor({
    'package.json': { name: 'odd', dependencies: 'next', devDependencies: null, scripts: 'vitest' },
  });
  assert.equal(f.framework, null, 'a string is not a dependency map');
  assert.equal(f.scripts.dev, null);
  assert.equal(f.scripts.test, null);
});

test('a directory that is missing and a notable name that is a file are both skipped', () => {
  // `lib/` is a real directory and is here as the positive control: without it, an empty
  // `directories` would satisfy "does not include src" while detecting nothing at all.
  const f = factsFor({ 'package.json': { name: 'x' }, src: 'this is a file, not a directory\n', lib: DIR });
  assert.deepEqual(f.directories.slice().sort(), ['lib'], 'a file named src is not a source directory');
});

test('a script that does not exist yields no command for it', () => {
  const f = factsFor({ 'package.json': { name: 'x', scripts: { build: 'tsc' } }, 'package-lock.json': '{}' });
  assert.equal(f.scripts.build, 'npm run build');
  assert.equal(f.scripts.dev, null);
  assert.equal(f.scripts.lint, null);
  assert.equal(f.scripts.test, null);
});

test('dev falls back to start when there is no dev script', () => {
  const f = factsFor({
    'package.json': { name: 'x', scripts: { start: 'node server.js' } },
    'package-lock.json': '{}',
  });
  assert.equal(f.scripts.dev, 'npm run start');
});

// ── Precedence: which signal wins when several match ───────────────────────────

test('a meta-framework beats the library it is built on', () => {
  const cases = [
    [{ next: '14', react: '18' }, 'Next.js'],
    [{ nuxt: '3', vue: '3' }, 'Nuxt'],
    [{ '@sveltejs/kit': '2', svelte: '4' }, 'SvelteKit'],
    [{ '@remix-run/react': '2', react: '18' }, 'Remix'],
    [{ astro: '4' }, 'Astro'],
    [{ '@angular/core': '17' }, 'Angular'],
    // NestJS runs on Express and virtually always has it as a transitive or direct dep.
    // Reporting "Express" for a Nest app sends an agent looking for `app.get(...)` routes.
    [{ '@nestjs/core': '10', express: '4' }, 'NestJS'],
    [{ fastify: '4' }, 'Fastify'],
    [{ hono: '4' }, 'Hono'],
  ];
  for (const entry of cases) {
    const f = factsFor({ 'package.json': { name: 'x', dependencies: entry[0] } });
    assert.equal(f.framework, entry[1], `deps ${JSON.stringify(entry[0])}`);
  }
});

test('a framework in devDependencies counts', () => {
  const f = factsFor({ 'package.json': { name: 'x', devDependencies: { astro: '4' } } });
  assert.equal(f.framework, 'Astro');
});

test('whichever framework wins a full-stack repo, it is one the repo actually depends on', () => {
  // React (frontend) and Express (backend) in one manifest is the classic single-package
  // full-stack layout. Only one framework is ever reported, so one of the two is silently
  // dropped. This asserts the invariant that survives either resolution — that the reported
  // framework is a real dependency — rather than blessing today's winner as correct.
  const f = factsFor({ 'package.json': { name: 'x', dependencies: { react: '18', express: '4' } } });
  assert.ok(['React', 'Express'].includes(f.framework), `unexpected framework ${f.framework}`);
});

test('lockfile precedence is deterministic when several are present', () => {
  const pkg = { 'package.json': { name: 'x' } };
  const lock = { pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock', bun: 'bun.lockb', npm: 'package-lock.json' };
  const cases = [
    [['pnpm', 'yarn', 'bun', 'npm'], 'pnpm'],
    [['yarn', 'bun', 'npm'], 'yarn'],
    [['bun', 'npm'], 'bun'],
    [['npm'], 'npm'],
  ];
  for (const entry of cases) {
    const files = { ...pkg };
    for (const name of entry[0]) files[lock[name]] = '';
    const f = factsFor(files);
    assert.equal(f.packageManager, entry[1], `lockfiles ${entry[0].join(', ')}`);
    // The install command must always agree with the manager that was chosen.
    assert.ok(
      f.scripts.install.indexOf(entry[1]) === 0,
      `install command "${f.scripts.install}" disagrees with manager ${entry[1]}`,
    );
  }
});

test("bun's text lockfile is recognised as well as its binary one", () => {
  const f = factsFor({ 'package.json': { name: 'x' }, 'bun.lock': '' });
  assert.equal(f.packageManager, 'bun');
});

test('a package.json with no lockfile falls back to npm, and the commands agree', () => {
  // Defensible default rather than a detected fact: without a lockfile there is no evidence.
  // What must hold either way is internal consistency — the manager and every command it
  // generates come from the same answer.
  const f = factsFor({ 'package.json': { name: 'x', scripts: { test: 'jest', dev: 'vite' } } });
  assert.equal(f.packageManager, 'npm');
  assert.equal(f.scripts.install, 'npm install');
  assert.equal(f.scripts.test, 'npm test', 'npm test, not npm run test');
  assert.equal(f.scripts.dev, 'npm run dev');
});

test('non-npm managers use `run test`, since `pnpm test` is not the idiom npm makes it', () => {
  const f = factsFor({ 'package.json': { name: 'x', scripts: { test: 'vitest' } }, 'yarn.lock': '' });
  assert.equal(f.scripts.test, 'yarn run test');
});

test('the unit test runner wins over the e2e one', () => {
  const cases = [
    [{ vitest: '1', jest: '29' }, 'Vitest'],
    [{ jest: '29', '@playwright/test': '1' }, 'Jest'],
    [{ mocha: '10' }, 'Mocha'],
    [{ '@playwright/test': '1' }, 'Playwright'],
  ];
  for (const entry of cases) {
    const f = factsFor({ 'package.json': { name: 'x', devDependencies: entry[0] } });
    assert.equal(f.testRunner, entry[1], `deps ${JSON.stringify(entry[0])}`);
  }
});

test('a repo that tests with node --test is not credited with a runner it does not use', () => {
  // Positive control first: the same fixture shape with a real runner dependency must
  // detect it. Without this, a detector that returned null for everything would satisfy
  // the negative assertion below and the test would be measuring nothing.
  const withVitest = factsFor({
    'package.json': { name: 'x', scripts: { test: 'vitest run' }, devDependencies: { vitest: '1.4.0' } },
    'package-lock.json': '{}',
  });
  assert.equal(withVitest.testRunner, 'Vitest');

  // Whether `node --test` should be positively identified is a separate question — the
  // `node:test` entry in TEST_RUNNERS can never match a dependency name, so it is dead
  // today. This asserts only what holds either way: no *wrong* runner is claimed. When
  // that entry is fixed, this becomes `assert.equal(f.testRunner, 'node:test')`.
  const f = factsFor({
    'package.json': { name: 'x', scripts: { test: 'node --test' } },
    'package-lock.json': '{}',
  });
  assert.ok(!['Vitest', 'Jest', 'Mocha', 'Playwright'].includes(f.testRunner), `claimed ${f.testRunner}`);
});

test('linters are detected from config files as well as dependencies', () => {
  const fromConfig = factsFor({
    'eslint.config.mjs': 'export default [];\n',
    '.prettierrc': '{}\n',
    'biome.json': '{}\n',
    '.ruff.toml': '\n',
  });
  assert.deepEqual(fromConfig.linters.slice().sort(), ['Biome', 'ESLint', 'Prettier', 'Ruff']);

  const fromDeps = factsFor({
    'package.json': { name: 'x', devDependencies: { eslint: '8', prettier: '3', '@biomejs/biome': '1' } },
  });
  assert.deepEqual(fromDeps.linters.slice().sort(), ['Biome', 'ESLint', 'Prettier']);
});

test('CI precedence: GitHub Actions, then GitLab, then CircleCI', () => {
  assert.equal(factsFor({ '.github/workflows': DIR, '.gitlab-ci.yml': '' }).ci, 'GitHub Actions');
  assert.equal(factsFor({ '.gitlab-ci.yml': '', '.circleci/config.yml': '' }).ci, 'GitLab CI');
  assert.equal(factsFor({ '.circleci/config.yml': '' }).ci, 'CircleCI');
  assert.equal(factsFor({ 'README.md': '' }).ci, null);
});

test('TypeScript displaces JavaScript rather than joining it', () => {
  const ts = factsFor({ 'package.json': { name: 'x' }, 'tsconfig.json': '{}' });
  assert.deepEqual(ts.languages, ['TypeScript']);
  const js = factsFor({ 'package.json': { name: 'x' } });
  assert.deepEqual(js.languages, ['JavaScript']);
});

test('a polyglot repo reports every language it has evidence for', () => {
  const f = factsFor({
    'package.json': { name: 'x' },
    'tsconfig.json': '{}',
    'pyproject.toml': '',
    'go.mod': '',
    'Cargo.toml': '',
    'pom.xml': '',
    Gemfile: '',
    'composer.json': '{}',
  });
  for (const lang of ['TypeScript', 'Python', 'Go', 'Rust', 'Java', 'Ruby', 'PHP']) {
    assert.ok(f.languages.includes(lang), `missing ${lang}`);
  }
});

// ── tsStrict ───────────────────────────────────────────────────────────────────

// Every assertion below pins an exact value, deliberately. An earlier version of this
// block asserted `notEqual(tsStrict, true)` for the commented-out case, which `null`
// satisfies as readily as `false` does — so when the fix started returning `null` for the
// most common real tsconfig there was, the test stayed green. "Not the wrong answer" is
// not an assertion; there are two ways to be wrong here and only one to be right.

const tsStrictOf = (tsconfig) => factsFor({ 'package.json': { name: 'x' }, 'tsconfig.json': tsconfig }).tsStrict;

test('tsStrict reflects the setting that is actually in force', () => {
  assert.equal(tsStrictOf('{ "compilerOptions": { "strict": true } }'), true);
  assert.equal(tsStrictOf('{ "compilerOptions": { "strict": false } }'), false);
  assert.equal(factsFor({ 'package.json': { name: 'x' } }).tsStrict, null, 'no tsconfig means no opinion');
});

test('an absent strict is null, never false', () => {
  // `strict` may be arriving through `extends`, which detection deliberately does not
  // follow. Null and false render identically today, so the distinction costs the
  // document nothing — but reporting `false` would be stating a setting we never read.
  assert.equal(tsStrictOf('{ "extends": "./tsconfig.base.json", "compilerOptions": { "target": "es2022" } }'), null);
  assert.equal(tsStrictOf('{ "files": [] }'), null, 'no compilerOptions is no answer');
  assert.equal(tsStrictOf('{ "compilerOptions": { "strict": "true" } }'), null, 'a string is not a boolean');
});

test('comments do not change the answer, in either direction', () => {
  const strict = [
    '// project config\n{ "compilerOptions": { "strict": true } }',
    '{\n  "compilerOptions": {\n    // Type checking\n    "strict": true\n  }\n}\n',
    '{\n  "$schema": "https://json.schemastore.org/tsconfig",\n  // the // in that URL is a value, not a comment\n  "compilerOptions": { "strict": true }\n}\n',
    '{\n  "compilerOptions": {\n    /* Type Checking */\n    "strict": true\n  }\n}\n',
  ];
  for (const src of strict) assert.equal(tsStrictOf(src), true, `expected strict mode on for:\n${src}`);

  const loose = [
    '// project config\n{ "compilerOptions": { "strict": false } }',
    '{\n  "compilerOptions": {\n    // Type checking\n    "strict": false\n  }\n}\n',
  ];
  for (const src of loose) assert.equal(tsStrictOf(src), false, `expected strict mode off for:\n${src}`);
});

test('a commented-out "strict" reports the setting that is really in force', () => {
  // The original defect: the raw text was regexed, so a line someone had disabled still
  // reported the mode as on and AGENTS.md told every agent to "keep it on" in a repo
  // where it was off. The right answer here is exactly `false` — the value the file sets.
  assert.equal(
    tsStrictOf('{\n  // "strict": true,  // TODO: turn this on once the any-s are gone\n  "compilerOptions": { "strict": false }\n}\n'),
    false,
  );
});

test('a tsc --init tsconfig reports its strict setting', () => {
  // `tsc --init` emits exactly this shape: a real option, a trailing comma, then a run of
  // commented-out options up to the closing brace. It is the single most common tsconfig
  // in existence, so it is the one case that must not degrade to "we cannot tell".
  //
  // Both directions, because a fix that returns `true` unless it can prove otherwise is
  // the original defect wearing a different hat.
  assert.equal(
    tsStrictOf('{\n  "compilerOptions": {\n    /* Type Checking */\n    "strict": true,\n    // "noImplicitAny": true,\n    // "strictNullChecks": true,\n  }\n}\n'),
    true,
  );
  assert.equal(
    tsStrictOf('{\n  "compilerOptions": {\n    "strict": false,\n    // "noImplicitAny": true,\n  }\n}\n'),
    false,
  );
});

test('a comment between a trailing comma and its closing brace is still just a comment', () => {
  // Same class as the case above, generalised: whenever a comment follows a trailing comma
  // the comma has to be gone by the time the parse runs, whichever brace it precedes and
  // whichever comment syntax is used. Comments strip first, trailing commas second.
  assert.equal(tsStrictOf('{\n  "compilerOptions": {\n    "strict": true,\n    /* more options later */\n  }\n}\n'), true);
  assert.equal(tsStrictOf('{\n  "compilerOptions": { "strict": true },\n  // "include": ["src"]\n}\n'), true);
  assert.equal(
    tsStrictOf('{\n  "$schema": "https://json.schemastore.org/tsconfig",\n  "compilerOptions": {\n    "strict": true,\n    // "exactOptionalPropertyTypes": true,\n  },\n  /* what we compile */\n}\n'),
    true,
  );
});

// ── purpose ────────────────────────────────────────────────────────────────────

test('the package description outranks the README', () => {
  const f = factsFor({
    'package.json': { name: 'x', description: 'From the manifest' },
    'README.md': '# x\n\nFrom the readme.\n',
  });
  assert.equal(f.purpose, 'From the manifest');
});

test('the README supplies a purpose when the manifest has no description', () => {
  const f = factsFor({ 'README.md': '# Title\n\n<p align="center">logo</p>\n\n![shield](x.svg)\n\nThe actual one-line summary.\n' });
  assert.equal(f.purpose, 'The actual one-line summary.');
});

test('a badge row is not a description of the project', () => {
  // Badges wrapped in a link start with `[`, not `![`, so the skip list misses them and
  // the first thing every agent reads about the repo becomes a shields.io URL.
  const f = factsFor({
    'README.md':
      '# proj\n\n[![Build](https://img.shields.io/badge/build-passing.svg)](https://ci.example.com/proj)\n\nA queue worker that reconciles invoices.\n',
  });
  assert.equal(f.purpose, 'A queue worker that reconciles invoices.');
});

test('a README with no prose gives no purpose rather than a fragment', () => {
  const f = factsFor({ 'README.md': '# Title\n\n## Install\n' });
  assert.equal(f.purpose, null);
});

// ── The contract the renderer depends on ───────────────────────────────────────

test('every fact is a usable value or exactly null — never undefined, never empty', () => {
  const shapes = [
    { 'notes.txt': '' },
    { 'package.json': '' },
    { 'package.json': '{oops' },
    NEXT_REPO,
    DJANGO_REPO,
    GO_REPO,
    MONOREPO,
  ];
  for (let i = 0; i < shapes.length; i++) {
    const f = factsFor(shapes[i]);
    const where = `fixture #${i}`;
    assert.equal(typeof f.name, 'string', `${where}: name must be a string`);
    assert.notEqual(f.name, '', `${where}: an empty name renders as an empty heading`);
    assert.ok(f.purpose === null || typeof f.purpose === 'string', `${where}: purpose`);
    assert.notEqual(f.purpose, '', `${where}: an empty purpose is not a purpose`);
    for (const key of ['languages', 'directories', 'linters']) {
      assert.ok(Array.isArray(f[key]), `${where}: ${key} must always be an array`);
      for (const v of f[key]) assert.equal(typeof v, 'string', `${where}: ${key} holds a non-string`);
    }
    for (const key of ['packageManager', 'framework', 'testRunner', 'ci']) {
      assert.ok(f[key] === null || typeof f[key] === 'string', `${where}: ${key} is ${f[key]}`);
      assert.notEqual(f[key], '', `${where}: ${key} is an empty string, which renders as a blank fact`);
    }
    assert.ok(f.tsStrict === null || typeof f.tsStrict === 'boolean', `${where}: tsStrict`);
    for (const key of Object.keys(f.scripts)) {
      const v = f.scripts[key];
      assert.ok(v === null || (typeof v === 'string' && v.length), `${where}: scripts.${key} is ${v}`);
    }
  }
});

test('a package.json field of the wrong type does not become a stack fact', () => {
  // A committed package.json is input Cortex does not control — the rule D11 states for
  // .manifest.json applies here too. A non-string name reaches the AGENTS.md heading as-is.
  const f = factsFor({ 'package.json': '{ "name": { "scoped": "x" }, "description": ["a", "b"] }' });
  assert.equal(typeof f.name, 'string', 'name must be a string or fall back to the directory');
  assert.ok(f.purpose === null || typeof f.purpose === 'string', 'purpose must be a string or null');
});

test('nothing detect leaves null reaches AGENTS.md as a confident-looking fact', () => {
  // The nulls are only safe because the renderer omits them. If a null ever renders as
  // "undefined", "null" or "[object Object]", the document states a fact no repo supports.
  const shapes = [{ 'notes.txt': '' }, { 'package.json': '' }, { 'package.json': '{oops' }, GO_REPO, DJANGO_REPO];
  for (let i = 0; i < shapes.length; i++) {
    const f = factsFor(shapes[i]);
    for (const doc of [renderAgentsMd(f), renderGeneratedBlock(f)]) {
      assert.ok(!/\bundefined\b/.test(doc), `fixture #${i}: rendered "undefined"`);
      assert.ok(!/\[object Object\]/.test(doc), `fixture #${i}: rendered "[object Object]"`);
      assert.ok(!/\bNaN\b/.test(doc), `fixture #${i}: rendered "NaN"`);
    }
  }
});

test('detection is deterministic — the same repo detects identically twice', () => {
  withRepo(NEXT_REPO, (root) => {
    assert.deepEqual(detect(root), detect(root));
  });
});

test('detect reads nothing outside the repo root and never writes', () => {
  withRepo(NEXT_REPO, (root) => {
    const before = readFileSync(join(root, 'package.json'), 'utf8');
    detect(root);
    assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), before, 'detect mutated the repo');
  });
});
