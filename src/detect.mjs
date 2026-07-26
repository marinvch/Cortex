import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Read the repo and report what it actually is. Nothing here guesses — every field
 * is either read from a file or left null, so `AGENTS.md` never states a stack fact
 * the repository does not support.
 */

const read = (root, rel) => {
  try {
    return readFileSync(join(root, rel), 'utf8');
  } catch {
    return null;
  }
};

const readJson = (root, rel) => {
  const raw = read(root, rel);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const has = (root, rel) => existsSync(join(root, rel));

const FRAMEWORKS = [
  ['Next.js', 'next'],
  ['Nuxt', 'nuxt'],
  ['Remix', '@remix-run/react'],
  ['Astro', 'astro'],
  ['SvelteKit', '@sveltejs/kit'],
  ['Angular', '@angular/core'],
  ['Vue', 'vue'],
  ['Svelte', 'svelte'],
  ['React', 'react'],
  ['NestJS', '@nestjs/core'],
  ['Express', 'express'],
  ['Fastify', 'fastify'],
  ['Hono', 'hono'],
];

const TEST_RUNNERS = [
  ['Vitest', 'vitest'],
  ['Jest', 'jest'],
  ['Playwright', '@playwright/test'],
  ['Mocha', 'mocha'],
  ['node:test', 'node:test'],
];

const NOTABLE_DIRS = [
  'src', 'app', 'pages', 'lib', 'components', 'server', 'api',
  'routes', 'services', 'packages', 'apps', 'cmd', 'internal', 'tests', 'test',
];

function detectPackageManager(root) {
  if (has(root, 'pnpm-lock.yaml')) return 'pnpm';
  if (has(root, 'yarn.lock')) return 'yarn';
  if (has(root, 'bun.lockb') || has(root, 'bun.lock')) return 'bun';
  if (has(root, 'package-lock.json')) return 'npm';
  return null;
}

function detectLanguages(root) {
  const langs = [];
  if (has(root, 'tsconfig.json')) langs.push('TypeScript');
  else if (has(root, 'package.json')) langs.push('JavaScript');
  if (has(root, 'pyproject.toml') || has(root, 'requirements.txt')) langs.push('Python');
  if (has(root, 'go.mod')) langs.push('Go');
  if (has(root, 'Cargo.toml')) langs.push('Rust');
  if (has(root, 'pom.xml') || has(root, 'build.gradle') || has(root, 'build.gradle.kts')) langs.push('Java');
  if (has(root, 'Gemfile')) langs.push('Ruby');
  if (has(root, 'composer.json')) langs.push('PHP');
  if (has(root, 'go.work')) langs.push('Go (workspace)');
  return langs;
}

function allDeps(pkg) {
  if (!pkg) return {};
  return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
}

function detectDirectories(root) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return NOTABLE_DIRS.filter((d) => {
    if (!entries.includes(d)) return false;
    try {
      return statSync(join(root, d)).isDirectory();
    } catch {
      return false;
    }
  });
}

function detectLinters(root, deps) {
  const found = [];
  if (
    has(root, 'eslint.config.js') || has(root, 'eslint.config.mjs') ||
    has(root, '.eslintrc') || has(root, '.eslintrc.json') || has(root, '.eslintrc.js') ||
    'eslint' in deps
  ) found.push('ESLint');
  if (
    has(root, '.prettierrc') || has(root, '.prettierrc.json') ||
    has(root, 'prettier.config.js') || 'prettier' in deps
  ) found.push('Prettier');
  if (has(root, 'biome.json') || '@biomejs/biome' in deps) found.push('Biome');
  if (has(root, 'ruff.toml') || has(root, '.ruff.toml')) found.push('Ruff');
  return found;
}

function detectCI(root) {
  if (has(root, '.github/workflows')) return 'GitHub Actions';
  if (has(root, '.gitlab-ci.yml')) return 'GitLab CI';
  if (has(root, '.circleci/config.yml')) return 'CircleCI';
  return null;
}

function firstProseLine(text) {
  if (!text) return null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('<') || line.startsWith('![')) continue;
    return line.replace(/^[>*\-\s]+/, '').trim() || null;
  }
  return null;
}

export function detect(repoRoot) {
  const pkg = readJson(repoRoot, 'package.json');
  const deps = allDeps(pkg);
  const scripts = pkg?.scripts ?? {};
  const pm = detectPackageManager(repoRoot) ?? (pkg ? 'npm' : null);

  const framework = FRAMEWORKS.find(([, dep]) => dep in deps)?.[0] ?? null;
  const testRunner = TEST_RUNNERS.find(([, dep]) => dep in deps)?.[0] ?? null;

  const run = (name) => {
    if (!scripts[name] || !pm) return null;
    return name === 'test' && pm === 'npm' ? 'npm test' : `${pm} run ${name}`;
  };

  const tsconfig = read(repoRoot, 'tsconfig.json');

  return {
    name: pkg?.name ?? basename(repoRoot),
    purpose: pkg?.description ?? firstProseLine(read(repoRoot, 'README.md')),
    languages: detectLanguages(repoRoot),
    packageManager: pm,
    framework,
    testRunner,
    scripts: {
      install: pm ? (pm === 'npm' ? 'npm install' : `${pm} install`) : null,
      dev: run('dev') ?? run('start'),
      build: run('build'),
      test: run('test'),
      lint: run('lint'),
    },
    directories: detectDirectories(repoRoot),
    linters: detectLinters(repoRoot, deps),
    ci: detectCI(repoRoot),
    tsStrict: tsconfig ? /"strict"\s*:\s*true/.test(tsconfig) : null,
  };
}
