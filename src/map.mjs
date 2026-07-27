import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Structural map generator.
 *
 * Zero-dependency heuristic extraction. Serena answers "where is this symbol?" live, by
 * querying an LSP. Cortex answers it durably: a file committed to the repo, reviewed in PRs,
 * inherited on clone, and readable by an agent that can only read files.
 */

export const MAX_FILES = 2000;

const ALWAYS_SKIP = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  'vendor', 'target', '__pycache__', '.venv', 'venv', '.cortex',
]);

const SOURCE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs',
  '.java', '.kt', '.rb', '.php', '.cs', '.swift', '.prisma', '.sql',
]);

/**
 * Minimal ignore-file support: directory and exact-name entries. Globs are skipped rather
 * than half-supported, because a glob we parse wrongly excludes files the reader expects
 * to see, and the map has no way to signal that it happened.
 *
 * Reads `.gitignore` and `.cortexignore`; entries from either exclude a path.
 */
function ignoreFilter(repoRoot) {
  const names = new Set();
  for (const file of ['.gitignore', '.cortexignore']) {
    const path = join(repoRoot, file);
    if (!existsSync(path)) continue;
    let lines = [];
    try {
      lines = readFileSync(path, 'utf8').split('\n');
    } catch {
      continue;
    }
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('!') || line.includes('*')) continue;
      names.add(line.replace(/^\/+/, '').replace(/\/+$/, ''));
    }
  }
  return (rel) => rel.split('/').some((part) => names.has(part));
}

export function scanRepo(repoRoot, { maxFiles = MAX_FILES } = {}) {
  const ignored = ignoreFilter(repoRoot);
  const found = [];

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ALWAYS_SKIP.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      const rel = relative(repoRoot, abs).split(sep).join('/');
      if (ignored(rel)) continue;
      if (entry.isDirectory()) {
        walk(abs);
      } else {
        const dot = entry.name.lastIndexOf('.');
        if (dot > -1 && SOURCE_EXT.has(entry.name.slice(dot))) found.push(rel);
      }
    }
  };

  walk(repoRoot);
  found.sort();
  return { files: found.slice(0, maxFiles), total: found.length, capped: found.length > maxFiles };
}

/** Line count, used for the size signal in the map. */
export function countLines(repoRoot, rel) {
  try {
    return readFileSync(join(repoRoot, rel), 'utf8').split('\n').length;
  } catch {
    return 0;
  }
}

// ── Extractors ───────────────────────────────────────────────────────────────
// Shaped as a registry so a second language is additive rather than a rewrite. Only
// JS/TS ships until its fidelity is measured; everything else is listed, not parsed,
// and the map says which is which.

const JS_EXT = /\.(?:m|c)?[jt]sx?$/;

const IMPORT_FROM = /(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]/g;
const IMPORT_BARE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const REQUIRE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

const EXPORT_DECL = /(?:^|\n)\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_DEFAULT = /(?:^|\n)\s*export\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST = /(?:^|\n)\s*export\s*\{([^}]*)\}/g;

const all = (re, source, out) => {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(source)) !== null) if (m[1]) out.push(m[1]);
};

export const EXTRACTORS = [
  {
    name: 'JavaScript/TypeScript',
    match: (rel) => JS_EXT.test(rel),
    extract(source) {
      const imports = [];
      all(IMPORT_FROM, source, imports);
      all(IMPORT_BARE, source, imports);
      all(REQUIRE, source, imports);

      const exports = [];
      all(EXPORT_DECL, source, exports);
      all(EXPORT_DEFAULT, source, exports);

      EXPORT_LIST.lastIndex = 0;
      let m;
      while ((m = EXPORT_LIST.exec(source)) !== null) {
        for (const part of m[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop().trim();
          if (name && /^[A-Za-z_$][\w$]*$/.test(name)) exports.push(name);
        }
      }

      return { imports: [...new Set(imports)], exports: [...new Set(exports)] };
    },
  },
];

export function extractorFor(rel) {
  return EXTRACTORS.find((e) => e.match(rel)) ?? null;
}
