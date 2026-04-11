import fs from 'node:fs';
import path from 'node:path';
import type { DependencyGraph, FileNode } from '../types.js';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '__pycache__', '.venv', 'venv', 'target', 'vendor', 'coverage',
  '.gradle', 'bin', 'obj', '.vs', 'packages', '.cache', '.ai-os',
]);

const SOURCE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'go', 'rs', 'java', 'cs', 'rb', 'php',
]);

function collectSourceFiles(dir: string, rootDir: string): string[] {
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectSourceFiles(full, rootDir));
      } else if (entry.isFile()) {
        const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
        if (SOURCE_EXTENSIONS.has(ext)) {
          files.push(path.relative(rootDir, full).replace(/\\/g, '/'));
        }
      }
    }
  } catch { /* ignore permission errors */ }
  return files;
}

function parseImports(content: string, filePath: string): string[] {
  const imports: string[] = [];
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';

  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    const importRe = /(?:import\s+(?:[\w\s{},*]+\s+from\s+|)|export\s+[\w\s{},*]+\s+from\s+|require\s*\()['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(content)) !== null) {
      const spec = m[1];
      if (!spec) continue;
      if (spec.startsWith('.')) {
        const dir = path.dirname(filePath);
        const resolved = path.posix.join(dir, spec);
        imports.push(resolved);
      }
    }
  }

  if (ext === 'py') {
    const pyRelRe = /^from\s+(\.[\w.]*)\s+import/gm;
    let m: RegExpExecArray | null;
    while ((m = pyRelRe.exec(content)) !== null) {
      imports.push(m[1]);
    }
  }

  if (ext === 'java') {
    const javaImportRe = /^import\s+(?:static\s+)?([\w.]+)\s*;/gm;
    let m: RegExpExecArray | null;
    while ((m = javaImportRe.exec(content)) !== null) {
      const fqn = m[1];
      if (!fqn) continue;
      // Convert fully-qualified class name to a relative file path candidate
      const relPath = fqn.replace(/\./g, '/') + '.java';
      imports.push(relPath);
    }
  }

  return [...new Set(imports)];
}

function parseExports(content: string, ext: string): string[] {
  const exports: string[] = [];

  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    const namedRe = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = namedRe.exec(content)) !== null) {
      exports.push(m[1]);
    }
    const groupedRe = /export\s*\{([^}]+)\}/g;
    while ((m = groupedRe.exec(content)) !== null) {
      const names = m[1]
        .split(',')
        .map(s => s.trim().split(/\s+as\s+/).pop()?.trim() ?? '')
        .filter(Boolean);
      exports.push(...names);
    }
  }

  return [...new Set(exports)];
}

function resolveImportPath(importSpec: string, allFiles: string[]): string | undefined {
  if (allFiles.includes(importSpec)) return importSpec;

  const exts = ['ts', 'tsx', 'js', 'jsx', 'mjs'];
  for (const ext of exts) {
    const candidate = `${importSpec}.${ext}`;
    if (allFiles.includes(candidate)) return candidate;
  }

  for (const ext of exts) {
    const candidate = `${importSpec}/index.${ext}`;
    if (allFiles.includes(candidate)) return candidate;
  }

  // Strip .js — TS commonly imports as .js but file is .ts
  if (importSpec.endsWith('.js')) {
    const base = importSpec.slice(0, -3);
    for (const ext of ['ts', 'tsx']) {
      const candidate = `${base}.${ext}`;
      if (allFiles.includes(candidate)) return candidate;
    }
  }

  // Java: try matching FQN path against source roots (src/main/java/, src/)
  if (importSpec.endsWith('.java')) {
    const javaSourceRoots = ['src/main/java/', 'src/'];
    for (const root of javaSourceRoots) {
      const candidate = root + importSpec;
      if (allFiles.includes(candidate)) return candidate;
    }
  }

  return undefined;
}

export function buildDependencyGraph(rootDir: string): DependencyGraph {
  const allFiles = collectSourceFiles(rootDir, rootDir);
  const nodes: Record<string, FileNode> = {};

  for (const file of allFiles) {
    nodes[file] = { path: file, imports: [], importedBy: [], exports: [] };
  }

  for (const file of allFiles) {
    try {
      const content = fs.readFileSync(path.join(rootDir, file), 'utf-8');
      const ext = file.split('.').pop()?.toLowerCase() ?? '';

      nodes[file]!.exports = parseExports(content, ext);

      const rawImports = parseImports(content, file);
      for (const raw of rawImports) {
        const resolved = resolveImportPath(raw, allFiles);
        if (!resolved || resolved === file) continue;
        if (!nodes[file]!.imports.includes(resolved)) {
          nodes[file]!.imports.push(resolved);
        }
        if (!nodes[resolved]) {
          nodes[resolved] = { path: resolved, imports: [], importedBy: [], exports: [] };
        }
        if (!nodes[resolved]!.importedBy.includes(file)) {
          nodes[resolved]!.importedBy.push(file);
        }
      }
    } catch { /* ignore unreadable files */ }
  }

  return {
    nodes,
    generatedAt: new Date().toISOString(),
    fileCount: allFiles.length,
  };
}

export function getTransitiveDependents(
  filePath: string,
  nodes: Record<string, FileNode>,
  maxDepth = 10,
): string[] {
  const visited = new Set<string>();
  const queue: Array<{ file: string; depth: number }> = [{ file: filePath, depth: 0 }];

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.depth >= maxDepth) continue;

    const node = nodes[item.file];
    if (!node) continue;

    for (const dep of node.importedBy) {
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push({ file: dep, depth: item.depth + 1 });
      }
    }
  }

  visited.delete(filePath);
  return [...visited];
}
