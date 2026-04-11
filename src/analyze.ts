import fs from 'node:fs';
import path from 'node:path';
import { detectLanguages } from './detectors/language.js';
import { detectFrameworks } from './detectors/framework.js';
import { detectPatterns } from './detectors/patterns.js';
import type { DetectedStack, PackageProfile, DetectedLanguage, DetectedFramework, BuildCommands } from './types.js';

function getProjectName(rootDir: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8')) as { name?: string };
    if (pkg.name) return pkg.name.replace(/^@[^/]+\//, '');
  } catch { /* ignore */ }

  try {
    const goMod = fs.readFileSync(path.join(rootDir, 'go.mod'), 'utf-8');
    const match = goMod.match(/^module\s+(\S+)/m);
    if (match) return match[1].split('/').pop() ?? path.basename(rootDir);
  } catch { /* ignore */ }

  try {
    const cargo = fs.readFileSync(path.join(rootDir, 'Cargo.toml'), 'utf-8');
    const match = cargo.match(/^name\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  } catch { /* ignore */ }

  return path.basename(rootDir);
}

function getKeyFiles(rootDir: string): string[] {
  const candidates = [
    'README.md', 'package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml',
    'requirements.txt', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile',
    'prisma/schema.prisma',
    'src/index.ts', 'src/main.ts', 'src/app.ts',
    'src/index.js', 'src/main.js', 'src/app.js',
    'main.go', 'main.py', 'main.rs', 'app.py', 'index.py',
    'docker-compose.yml', 'Dockerfile',
  ];

  return candidates
    .map(c => path.join(rootDir, c))
    .filter(p => fs.existsSync(p))
    .map(p => path.relative(rootDir, p));
}

function getAllDependencies(rootDir: string): string[] {
  const deps = new Set<string>();

  // Node.js package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    for (const key of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })) {
      deps.add(key.toLowerCase());
    }
  } catch { /* ignore */ }

  // Python pyproject.toml / requirements.txt
  try {
    const req = fs.readFileSync(path.join(rootDir, 'requirements.txt'), 'utf-8');
    req.split('\n').forEach(line => {
      const pkg = line.split(/[>=<!;\s]/)[0]?.trim().toLowerCase();
      if (pkg) deps.add(pkg);
    });
  } catch { /* ignore */ }

  // Cargo.toml
  try {
    const cargo = fs.readFileSync(path.join(rootDir, 'Cargo.toml'), 'utf-8');
    const depSection = cargo.match(/\[dependencies\]([\s\S]*?)(\[|\Z)/)?.[1] ?? '';
    depSection.split('\n').forEach(line => {
      const m = line.match(/^(\w[\w-]*)\s*=/);
      if (m) deps.add(m[1].toLowerCase());
    });
  } catch { /* ignore */ }

  return [...deps];
}

function hasManifest(dir: string): boolean {
  const manifests = [
    'package.json',
    'pyproject.toml',
    'requirements.txt',
    'go.mod',
    'Cargo.toml',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
  ];
  return manifests.some((manifest) => fs.existsSync(path.join(dir, manifest)));
}

/**
 * Parse the `packages:` list from a pnpm-workspace.yaml file.
 * Handles single-quoted, double-quoted, and bare glob patterns.
 */
function parsePnpmWorkspaceYaml(yaml: string): string[] {
  const globs: string[] = [];
  let inPackages = false;

  for (const line of yaml.split('\n')) {
    const trimmed = line.trim();
    // Detect top-level `packages:` key
    if (/^packages\s*:/.test(trimmed)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      // Another top-level key (no leading whitespace) — stop scanning packages list
      if (trimmed && !line.startsWith(' ') && !line.startsWith('\t')) {
        break;
      }
      if (trimmed.startsWith('-')) {
        let pattern = trimmed.slice(1).trim();
        // Strip surrounding quotes
        if ((pattern.startsWith("'") && pattern.endsWith("'")) ||
            (pattern.startsWith('"') && pattern.endsWith('"'))) {
          pattern = pattern.slice(1, -1);
        }
        if (pattern) globs.push(pattern);
      }
    }
  }

  return globs;
}

function addWorkspaceChildren(absBase: string, packageRoots: Set<string>): void {
  if (!fs.existsSync(absBase) || !fs.statSync(absBase).isDirectory()) return;

  for (const entry of fs.readdirSync(absBase, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const candidate = path.join(absBase, entry.name);
    if (hasManifest(candidate)) packageRoots.add(candidate);
  }
}

function discoverPackageRoots(rootDir: string): string[] {
  const packageRoots = new Set<string>();

  if (hasManifest(rootDir)) {
    packageRoots.add(rootDir);
  }

  // pnpm-workspace.yaml
  try {
    const pnpmWs = fs.readFileSync(path.join(rootDir, 'pnpm-workspace.yaml'), 'utf-8');
    for (const glob of parsePnpmWorkspaceYaml(pnpmWs)) {
      const normalized = glob.replace(/\\/g, '/').replace(/\/\*\*$/, '').replace(/\/\*$/, '');
      const absBase = path.join(rootDir, normalized);
      if (hasManifest(absBase)) packageRoots.add(absBase);
      addWorkspaceChildren(absBase, packageRoots);
    }
  } catch {
    // pnpm-workspace.yaml not present or unreadable.
  }

  // lerna.json
  try {
    const lerna = JSON.parse(fs.readFileSync(path.join(rootDir, 'lerna.json'), 'utf-8')) as {
      packages?: string[];
    };
    for (const glob of lerna.packages ?? []) {
      const normalized = glob.replace(/\\/g, '/').replace(/\/\*\*$/, '').replace(/\/\*$/, '');
      const absBase = path.join(rootDir, normalized);
      if (hasManifest(absBase)) packageRoots.add(absBase);
      addWorkspaceChildren(absBase, packageRoots);
    }
  } catch {
    // lerna.json not present or unreadable.
  }

  // nx.json — scan apps/ and libs/
  if (fs.existsSync(path.join(rootDir, 'nx.json'))) {
    for (const rel of ['apps', 'libs']) {
      addWorkspaceChildren(path.join(rootDir, rel), packageRoots);
    }
  }

  // turbo.json — use conventional dirs (apps/, packages/)
  if (fs.existsSync(path.join(rootDir, 'turbo.json'))) {
    for (const rel of ['apps', 'packages']) {
      addWorkspaceChildren(path.join(rootDir, rel), packageRoots);
    }
  }

  for (const rel of ['apps', 'packages', 'services']) {
    addWorkspaceChildren(path.join(rootDir, rel), packageRoots);
  }

  return [...packageRoots];
}

function mergeLanguages(profiles: PackageProfile[]): DetectedLanguage[] {
  const acc = new Map<string, { fileCount: number; extensions: Set<string> }>();

  for (const profile of profiles) {
    for (const lang of profile.languages) {
      const existing = acc.get(lang.name) ?? { fileCount: 0, extensions: new Set<string>() };
      existing.fileCount += lang.fileCount;
      for (const ext of lang.extensions) existing.extensions.add(ext);
      acc.set(lang.name, existing);
    }
  }

  const total = [...acc.values()].reduce((sum, val) => sum + val.fileCount, 0) || 1;
  return [...acc.entries()]
    .map(([name, value]) => ({
      name,
      fileCount: value.fileCount,
      percentage: Math.round((value.fileCount / total) * 100),
      extensions: [...value.extensions],
    }))
    .sort((a, b) => b.fileCount - a.fileCount);
}

function mergeFrameworks(profiles: PackageProfile[]): DetectedFramework[] {
  const seen = new Set<string>();
  const frameworks: DetectedFramework[] = [];

  for (const profile of profiles) {
    for (const framework of profile.frameworks) {
      const key = framework.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      frameworks.push(framework);
    }
  }

  return frameworks;
}

function mergeDependencies(profiles: PackageProfile[]): string[] {
  const deps = new Set<string>();
  for (const profile of profiles) {
    for (const dep of profile.allDependencies) deps.add(dep.toLowerCase());
  }
  return [...deps];
}

/** Extract meaningful build/test/dev commands from package.json, Makefile, and pyproject.toml */
function detectBuildCommands(rootDir: string): BuildCommands {
  const commands: BuildCommands = {};

  // ── Node.js package.json scripts ──────────────────────────────────────────
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};

    // Priority keys — pick the first available alias for each slot
    const buildAliases = ['build', 'compile', 'tsc'];
    const testAliases = ['test', 'test:run', 'jest', 'vitest'];
    const devAliases = ['dev', 'start:dev', 'develop'];
    const lintAliases = ['lint', 'lint:fix', 'eslint'];
    const startAliases = ['start', 'serve', 'preview'];

    for (const k of buildAliases) {
      if (scripts[k]) { commands.build = `npm run ${k}`; break; }
    }
    for (const k of testAliases) {
      if (scripts[k]) { commands.test = `npm run ${k}`; break; }
    }
    for (const k of devAliases) {
      if (scripts[k]) { commands.dev = `npm run ${k}`; break; }
    }
    for (const k of lintAliases) {
      if (scripts[k]) { commands.lint = `npm run ${k}`; break; }
    }
    for (const k of startAliases) {
      if (scripts[k]) { commands.start = `npm run ${k}`; break; }
    }
  } catch { /* ignore */ }

  // ── Python pyproject.toml ─────────────────────────────────────────────────
  if (!commands.test || !commands.build) {
    try {
      const toml = fs.readFileSync(path.join(rootDir, 'pyproject.toml'), 'utf-8');

      // tool.poetry.scripts section
      const scriptSection = toml.match(/\[tool\.poetry\.scripts\]([\s\S]*?)(\[|\s*$)/)?.[1] ?? '';
      const scriptEntries = [...scriptSection.matchAll(/^(\w[\w-]*)\s*=\s*"([^"]+)"/mg)];
      for (const [, name] of scriptEntries) {
        if (!commands.start && /^(start|serve|run)/.test(name)) commands.start = `poetry run ${name}`;
        if (!commands.test && /^(test|pytest)/.test(name)) commands.test = `poetry run ${name}`;
      }

      // Detect pytest / unittest
      if (!commands.test) {
        if (toml.includes('pytest')) commands.test = 'pytest';
        else if (toml.includes('unittest')) commands.test = 'python -m unittest';
      }
      // Detect uvicorn / fastapi dev server
      if (!commands.dev && (toml.includes('fastapi') || toml.includes('uvicorn'))) {
        commands.dev = 'uvicorn main:app --reload';
      }
      // Detect Django manage.py
      if (!commands.dev && toml.includes('django')) {
        commands.dev = 'python manage.py runserver';
      }
    } catch { /* ignore */ }
  }

  // ── Python requirements.txt fallback ────────────────────────────────────
  if (!commands.test) {
    try {
      const req = fs.readFileSync(path.join(rootDir, 'requirements.txt'), 'utf-8');
      if (req.includes('pytest')) commands.test = 'pytest';
      if (!commands.dev && req.includes('fastapi')) commands.dev = 'uvicorn main:app --reload';
      if (!commands.dev && req.includes('django')) commands.dev = 'python manage.py runserver';
    } catch { /* ignore */ }
  }

  // ── Makefile ─────────────────────────────────────────────────────────────
  try {
    const makefile = fs.readFileSync(path.join(rootDir, 'Makefile'), 'utf-8');
    const targets = [...makefile.matchAll(/^([a-zA-Z][\w-]*):/mg)].map(m => m[1]);

    if (!commands.build && targets.includes('build')) commands.build = 'make build';
    if (!commands.test && targets.includes('test')) commands.test = 'make test';
    if (!commands.dev && targets.includes('dev')) commands.dev = 'make dev';
    if (!commands.dev && targets.includes('run')) commands.dev = 'make run';
    if (!commands.lint && targets.includes('lint')) commands.lint = 'make lint';
  } catch { /* ignore */ }

  // ── Go ────────────────────────────────────────────────────────────────────
  if (!commands.build && fs.existsSync(path.join(rootDir, 'go.mod'))) {
    commands.build = 'go build ./...';
    if (!commands.test) commands.test = 'go test ./...';
  }

  // ── Rust / Cargo ─────────────────────────────────────────────────────────
  if (!commands.build && fs.existsSync(path.join(rootDir, 'Cargo.toml'))) {
    commands.build = 'cargo build';
    if (!commands.test) commands.test = 'cargo test';
  }

  // ── Java / Maven ─────────────────────────────────────────────────────────
  if (!commands.build && fs.existsSync(path.join(rootDir, 'pom.xml'))) {
    commands.build = 'mvn compile';
    if (!commands.test) commands.test = 'mvn test';
  }

  // ── Java / Gradle ─────────────────────────────────────────────────────────
  if (!commands.build && (
    fs.existsSync(path.join(rootDir, 'build.gradle')) ||
    fs.existsSync(path.join(rootDir, 'build.gradle.kts'))
  )) {
    commands.build = './gradlew build';
    if (!commands.test) commands.test = './gradlew test';
  }

  return commands;
}

export function analyze(rootDir: string): DetectedStack {
  const absRoot = path.resolve(rootDir);
  const packageRoots = discoverPackageRoots(absRoot);
  const packageProfiles: PackageProfile[] = packageRoots.map((pkgRoot) => ({
    name: getProjectName(pkgRoot),
    path: path.relative(absRoot, pkgRoot) || '.',
    languages: detectLanguages(pkgRoot),
    frameworks: detectFrameworks(pkgRoot),
    patterns: detectPatterns(pkgRoot),
    keyFiles: getKeyFiles(pkgRoot),
    allDependencies: getAllDependencies(pkgRoot),
  }));

  const languages = mergeLanguages(packageProfiles);
  const frameworks = mergeFrameworks(packageProfiles);
  const rootPatterns = detectPatterns(absRoot);
  const isMonorepo = packageProfiles.length > 1;

  return {
    projectName: getProjectName(absRoot),
    primaryLanguage: languages[0] ?? { name: 'Unknown', percentage: 0, fileCount: 0, extensions: [] },
    languages,
    primaryFramework: frameworks[0],
    frameworks,
    patterns: {
      ...rootPatterns,
      monorepo: rootPatterns.monorepo || isMonorepo,
    },
    keyFiles: getKeyFiles(absRoot),
    rootDir: absRoot,
    allDependencies: mergeDependencies(packageProfiles),
    packageProfiles,
    buildCommands: detectBuildCommands(absRoot),
  };
}
