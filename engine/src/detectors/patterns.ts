import fs from 'node:fs';
import path from 'node:path';
import type { DetectedPatterns } from '../types.js';

function exists(p: string): boolean {
  return fs.existsSync(p);
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function detectPackageManager(rootDir: string): DetectedPatterns['packageManager'] {
  if (exists(path.join(rootDir, 'bun.lockb'))) return 'bun';
  if (exists(path.join(rootDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(rootDir, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(rootDir, 'package-lock.json'))) return 'npm';
  if (exists(path.join(rootDir, 'Cargo.lock')) || exists(path.join(rootDir, 'Cargo.toml'))) return 'cargo';
  if (exists(path.join(rootDir, 'go.sum')) || exists(path.join(rootDir, 'go.mod'))) return 'go';
  if (exists(path.join(rootDir, 'Pipfile.lock'))) return 'pip';
  if (exists(path.join(rootDir, 'poetry.lock'))) return 'poetry';
  if (exists(path.join(rootDir, 'pom.xml'))) return 'maven';
  if (exists(path.join(rootDir, 'build.gradle')) || exists(path.join(rootDir, 'build.gradle.kts'))) return 'gradle';
  if (exists(path.join(rootDir, 'composer.lock'))) return 'composer';
  if (exists(path.join(rootDir, 'Gemfile.lock'))) return 'bundler';
  return 'unknown';
}

function detectTestFramework(rootDir: string): string | undefined {
  const pkg = readJson<{ devDependencies?: Record<string, string>; dependencies?: Record<string, string> }>(
    path.join(rootDir, 'package.json')
  );
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps['vitest']) return 'Vitest';
    if (deps['jest']) return 'Jest';
    if (deps['mocha']) return 'Mocha';
    if (deps['jasmine']) return 'Jasmine';
    if (deps['@playwright/test']) return 'Playwright';
    if (deps['cypress']) return 'Cypress';
  }

  if (exists(path.join(rootDir, 'pytest.ini')) || exists(path.join(rootDir, 'conftest.py'))) return 'pytest';
  if (exists(path.join(rootDir, 'phpunit.xml')) || exists(path.join(rootDir, 'phpunit.xml.dist'))) return 'PHPUnit';
  if (exists(path.join(rootDir, 'RSpec'))) return 'RSpec';

  return undefined;
}

function detectLinter(rootDir: string): string | undefined {
  if (exists(path.join(rootDir, '.eslintrc.json')) || exists(path.join(rootDir, '.eslintrc.js')) ||
      exists(path.join(rootDir, '.eslintrc.cjs')) || exists(path.join(rootDir, 'eslint.config.js')) ||
      exists(path.join(rootDir, 'eslint.config.mjs'))) return 'ESLint';
  if (exists(path.join(rootDir, '.biome.json')) || exists(path.join(rootDir, 'biome.json'))) return 'Biome';
  if (exists(path.join(rootDir, '.oxlintrc.json'))) return 'oxlint';
  if (exists(path.join(rootDir, 'pylintrc')) || exists(path.join(rootDir, '.pylintrc'))) return 'Pylint';
  if (exists(path.join(rootDir, '.flake8')) || exists(path.join(rootDir, 'setup.cfg'))) return 'Flake8';
  if (exists(path.join(rootDir, 'clippy.toml')) || exists(path.join(rootDir, '.clippy.toml'))) return 'Clippy';
  if (exists(path.join(rootDir, '.golangci.yml')) || exists(path.join(rootDir, '.golangci.yaml'))) return 'golangci-lint';
  return undefined;
}

function detectFormatter(rootDir: string): string | undefined {
  if (exists(path.join(rootDir, '.prettierrc')) || exists(path.join(rootDir, '.prettierrc.json')) ||
      exists(path.join(rootDir, '.prettierrc.js')) || exists(path.join(rootDir, 'prettier.config.js'))) return 'Prettier';
  if (exists(path.join(rootDir, '.biome.json')) || exists(path.join(rootDir, 'biome.json'))) return 'Biome';
  if (exists(path.join(rootDir, '.editorconfig'))) return 'EditorConfig';
  if (exists(path.join(rootDir, '.rustfmt.toml'))) return 'rustfmt';
  if (exists(path.join(rootDir, '.gofmt'))) return 'gofmt';
  return undefined;
}

function detectBundler(rootDir: string): string | undefined {
  const pkg = readJson<{ devDependencies?: Record<string, string> }>(path.join(rootDir, 'package.json'));
  if (pkg?.devDependencies) {
    const deps = pkg.devDependencies;
    if (deps['vite']) return 'Vite';
    if (deps['turbopack'] || deps['@next/swc-darwin-x64']) return 'Turbopack';
    if (deps['webpack'] || deps['webpack-cli']) return 'Webpack';
    if (deps['esbuild']) return 'esbuild';
    if (deps['rollup']) return 'Rollup';
    if (deps['parcel']) return 'Parcel';
    if (deps['@swc/core']) return 'SWC';
  }
  if (exists(path.join(rootDir, 'vite.config.ts')) || exists(path.join(rootDir, 'vite.config.js'))) return 'Vite';
  if (exists(path.join(rootDir, 'webpack.config.js')) || exists(path.join(rootDir, 'webpack.config.ts'))) return 'Webpack';
  return undefined;
}

function detectCiCd(rootDir: string): { hasCiCd: boolean; provider?: string } {
  if (exists(path.join(rootDir, '.github', 'workflows'))) return { hasCiCd: true, provider: 'GitHub Actions' };
  if (exists(path.join(rootDir, '.gitlab-ci.yml'))) return { hasCiCd: true, provider: 'GitLab CI' };
  if (exists(path.join(rootDir, '.circleci', 'config.yml'))) return { hasCiCd: true, provider: 'CircleCI' };
  if (exists(path.join(rootDir, 'Jenkinsfile'))) return { hasCiCd: true, provider: 'Jenkins' };
  if (exists(path.join(rootDir, '.travis.yml'))) return { hasCiCd: true, provider: 'Travis CI' };
  if (exists(path.join(rootDir, 'azure-pipelines.yml'))) return { hasCiCd: true, provider: 'Azure Pipelines' };
  if (exists(path.join(rootDir, 'bitbucket-pipelines.yml'))) return { hasCiCd: true, provider: 'Bitbucket Pipelines' };
  return { hasCiCd: false };
}

function detectNamingConvention(rootDir: string): DetectedPatterns['namingConvention'] {
  const srcDir = exists(path.join(rootDir, 'src')) ? path.join(rootDir, 'src') : rootDir;
  try {
    const entries = fs.readdirSync(srcDir);
    const tsxFiles = entries.filter(e => e.endsWith('.tsx') || e.endsWith('.jsx'));
    const pyFiles = entries.filter(e => e.endsWith('.py'));

    if (tsxFiles.some(f => /^[A-Z]/.test(f))) return 'PascalCase';
    if (pyFiles.some(f => /_/.test(f))) return 'snake_case';
    if (entries.some(f => /-/.test(f) && !f.startsWith('.'))) return 'kebab-case';
    if (entries.some(f => /[A-Z]/.test(f.replace(/\.[^.]+$/, '')))) return 'camelCase';
  } catch {
    // ignore
  }
  return 'mixed';
}

export function detectPatterns(rootDir: string): DetectedPatterns {
  const { hasCiCd, provider: ciCdProvider } = detectCiCd(rootDir);

  const pkg = readJson<{ devDependencies?: Record<string, string> }>(path.join(rootDir, 'package.json'));
  const hasTypeScript = exists(path.join(rootDir, 'tsconfig.json')) ||
    Object.keys(pkg?.devDependencies ?? {}).includes('typescript');

  const testDirs = ['__tests__', 'tests', 'test', 'spec', '__spec__'];
  const testDirectory = testDirs.find(d => exists(path.join(rootDir, d)));

  return {
    namingConvention: detectNamingConvention(rootDir),
    testFramework: detectTestFramework(rootDir),
    linter: detectLinter(rootDir),
    formatter: detectFormatter(rootDir),
    bundler: detectBundler(rootDir),
    packageManager: detectPackageManager(rootDir),
    hasTypeScript,
    hasDockerfile: exists(path.join(rootDir, 'Dockerfile')) || exists(path.join(rootDir, 'docker-compose.yml')),
    hasCiCd,
    ciCdProvider,
    monorepo: exists(path.join(rootDir, 'pnpm-workspace.yaml')) ||
      exists(path.join(rootDir, 'lerna.json')) ||
      exists(path.join(rootDir, 'nx.json')) ||
      exists(path.join(rootDir, 'turbo.json')),
    srcDirectory: exists(path.join(rootDir, 'src')),
    testDirectory,
  };
}
