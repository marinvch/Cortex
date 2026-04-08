import fs from 'node:fs';
import path from 'node:path';
import { detectLanguages } from './detectors/language.js';
import { detectFrameworks } from './detectors/framework.js';
import { detectPatterns } from './detectors/patterns.js';
import type { DetectedStack, PackageProfile, DetectedLanguage, DetectedFramework } from './types.js';

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

function discoverPackageRoots(rootDir: string): string[] {
  const packageRoots = new Set<string>([rootDir]);

  const rootPkgPath = path.join(rootDir, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8')) as {
      workspaces?: string[] | { packages?: string[] };
    };

    const workspaceGlobs = Array.isArray(pkg.workspaces)
      ? pkg.workspaces
      : Array.isArray(pkg.workspaces?.packages)
        ? pkg.workspaces.packages
        : [];

    for (const glob of workspaceGlobs) {
      const normalized = glob.replace(/\\/g, '/').replace(/\/*\*$/, '');
      const base = normalized.endsWith('/*') ? normalized.slice(0, -2) : normalized;
      const absBase = path.join(rootDir, base);
      if (!fs.existsSync(absBase) || !fs.statSync(absBase).isDirectory()) continue;

      for (const entry of fs.readdirSync(absBase, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const candidate = path.join(absBase, entry.name);
        if (hasManifest(candidate)) packageRoots.add(candidate);
      }
    }
  } catch {
    // Best-effort workspace detection.
  }

  const conventionalRoots = ['apps', 'packages', 'services'];
  for (const rel of conventionalRoots) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;

    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const candidate = path.join(abs, entry.name);
      if (hasManifest(candidate)) packageRoots.add(candidate);
    }
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
  };
}
