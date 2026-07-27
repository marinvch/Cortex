import { createHash } from 'node:crypto';
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

/**
 * `.cortex` and `.claude` are skipped for the same reason: they hold the agent scaffolding
 * Cortex installs, not the project's own architecture. Mapping them would both mislead a
 * reader and make every fresh install ship a map that is already stale, because the hook
 * is written after the map is built.
 */
const ALWAYS_SKIP = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  'vendor', 'target', '__pycache__', '.venv', 'venv', '.cortex', '.claude',
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

// A statement starts at the beginning of a line or after a `;`. Anchoring to line start alone
// silently drops `import './x'; export const y = 1;` — and a map that omits an export without
// saying so is the exact failure the Coverage section exists to prevent.
const STMT = '(?:^|\\n|;)\\s*';

const IMPORT_FROM = new RegExp(`${STMT}(?:import|export)\\s[^;'"]*?from\\s*['"]([^'"]+)['"]`, 'g');
const IMPORT_BARE = new RegExp(`${STMT}import\\s*['"]([^'"]+)['"]`, 'g');
const REQUIRE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

const EXPORT_DECL = new RegExp(
  `${STMT}export\\s+(?:async\\s+)?(?:function|class|const|let|var)\\s+([A-Za-z_$][\\w$]*)`,
  'g',
);
const EXPORT_DEFAULT = new RegExp(
  `${STMT}export\\s+default\\s+(?:async\\s+)?(?:function|class)\\s+([A-Za-z_$][\\w$]*)`,
  'g',
);
const EXPORT_LIST = new RegExp(`${STMT}export\\s*\\{([^}]*)\\}`, 'g');

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

// ── Rendering ────────────────────────────────────────────────────────────────

export const MAP_REL = '.cortex/map.md';

const ROUTE_HINTS = [/^app\/.*\/route\.[jt]sx?$/, /^pages\/api\//, /^routes\//, /^src\/routes\//];
const DATA_HINTS = [/schema\.prisma$/, /^migrations\//, /^models\//, /\.sql$/, /^db\//, /^src\/db\//];

const HASH_LEN = 12;

function entryPoints(repoRoot, files) {
  const out = [];
  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  } catch {
    pkg = null;
  }
  if (pkg?.main) out.push([pkg.main, 'package main']);
  if (pkg?.bin) {
    for (const [name, path] of Object.entries(typeof pkg.bin === 'string' ? { [pkg.name ?? 'cli']: pkg.bin } : pkg.bin)) {
      out.push([path, `bin: ${name}`]);
    }
  }
  for (const candidate of ['src/index.ts', 'src/index.js', 'src/main.ts', 'app/page.tsx', 'main.go']) {
    if (files.includes(candidate) && !out.some(([p]) => p === candidate)) out.push([candidate, 'conventional entry']);
  }
  return out;
}

/**
 * Build the map. `hash` covers only structural facts — file list, imports, exports — so a
 * comment or a renamed local does not invalidate it and the committed map stays quiet in diffs.
 */
export function buildMap(repoRoot, { maxFiles = MAX_FILES } = {}) {
  const { files, total, capped } = scanRepo(repoRoot, { maxFiles });

  const parsed = new Set();
  const listedOnly = new Set();
  const perFile = [];

  for (const rel of files) {
    const ex = extractorFor(rel);
    if (!ex) {
      const dot = rel.lastIndexOf('.');
      listedOnly.add(dot > -1 ? rel.slice(dot) : rel);
      perFile.push({ rel, imports: [], exports: [], parsed: false });
      continue;
    }
    parsed.add(ex.name);
    let source = '';
    try {
      source = readFileSync(join(repoRoot, rel), 'utf8');
    } catch {
      source = '';
    }
    const { imports, exports } = ex.extract(source);
    perFile.push({ rel, imports, exports, parsed: true });
  }

  const routes = files.filter((f) => ROUTE_HINTS.some((re) => re.test(f)));
  const data = files.filter((f) => DATA_HINTS.some((re) => re.test(f)));
  const entries = entryPoints(repoRoot, files);

  const structural = JSON.stringify(perFile.map((f) => [f.rel, f.imports, f.exports]));
  const hash = createHash('sha256').update(structural).digest('hex').slice(0, HASH_LEN);

  const largest = perFile
    .map((f) => ({ rel: f.rel, lines: countLines(repoRoot, f.rel) }))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 5);

  const lines = [];
  lines.push(`<!-- cortex:map hash=${hash} -->`);
  lines.push(`# Structural map`);
  lines.push('');
  lines.push('Generated by cortex-init and regenerated when the structure changes. Committed on');
  lines.push('purpose: every agent and every teammate reads the same map.');
  lines.push('');

  lines.push('## Entry points');
  lines.push('');
  if (entries.length) for (const [p, why] of entries) lines.push(`- \`${p}\` — ${why}`);
  else lines.push('_None detected._');
  lines.push('');

  if (routes.length) {
    lines.push('## Routes');
    lines.push('');
    for (const r of routes) lines.push(`- \`${r}\``);
    lines.push('');
  }

  if (data.length) {
    lines.push('## Data layer');
    lines.push('');
    for (const d of data) lines.push(`- \`${d}\``);
    lines.push('');
  }

  lines.push('## Modules');
  lines.push('');
  for (const f of perFile) {
    if (!f.parsed) continue;
    const ex = f.exports.length ? ` — exports: ${f.exports.slice(0, 8).join(', ')}` : '';
    const im = f.imports.length ? ` — imports: ${f.imports.slice(0, 8).join(', ')}` : '';
    lines.push(`- \`${f.rel}\`${ex}${im}`);
  }
  lines.push('');

  if (largest.length) {
    lines.push('## Largest files');
    lines.push('');
    for (const l of largest) lines.push(`- \`${l.rel}\` (${l.lines} lines)`);
    lines.push('');
  }

  lines.push('## Coverage');
  lines.push('');
  lines.push(`- Scanned ${files.length} of ${total} source files.${capped ? ' **Capped — this list is partial.**' : ''}`);
  lines.push(`- Parsed: ${parsed.size ? [...parsed].join(', ') : 'nothing'}`);
  lines.push(
    `- Listed only (not parsed): ${listedOnly.size ? [...listedOnly].sort().join(', ') : 'none'}`,
  );
  lines.push('');

  return {
    markdown: lines.join('\n'),
    hash,
    stats: { scanned: files.length, total, capped, parsed: [...parsed], listedOnly: [...listedOnly] },
  };
}

export function readMapHash(repoRoot) {
  try {
    const head = readFileSync(join(repoRoot, MAP_REL), 'utf8').slice(0, 200);
    return head.match(/cortex:map hash=([0-9a-f]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function isStale(repoRoot) {
  const current = readMapHash(repoRoot);
  if (!current) return true;
  return current !== buildMap(repoRoot).hash;
}
