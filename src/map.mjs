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
 * Two entry shapes, matching git's own rule:
 *  - a bare name (`lib`) matches that name at any depth — `src/lib/` really is ignored;
 *  - an entry containing a slash (`src/generated`) is anchored to the repo root and matches
 *    only there. Testing those against path *segments* meant they could never match at all.
 *
 * Reads `.gitignore` and `.cortexignore`; entries from either exclude a path.
 */
function ignoreFilter(repoRoot) {
  const names = new Set();
  const paths = new Set();
  let unsupported = 0;
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
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('!') || line.includes('*')) {
        unsupported += 1;
        continue;
      }
      const entry = line.replace(/^\/+/, '').replace(/\/+$/, '');
      if (!entry) continue;
      if (entry.includes('/')) paths.add(entry);
      else names.add(entry);
    }
  }
  const match = (rel) => {
    if (rel.split('/').some((part) => names.has(part))) return true;
    for (const anchored of paths) {
      if (rel === anchored || rel.startsWith(`${anchored}/`)) return true;
    }
    return false;
  };
  match.unsupported = unsupported;
  return match;
}

/**
 * Walk the repo for source files.
 *
 * Ignored files are still *counted*, because `total` must mean everything found rather than
 * everything kept: counting after the filter let Coverage print "Scanned 2 of 2" while two
 * files had been dropped, and a map that overstates itself is worse than no map. The
 * always-skipped directories are excluded from both numbers — they are not project source.
 */
export function scanRepo(repoRoot, { maxFiles = MAX_FILES } = {}) {
  const isIgnored = ignoreFilter(repoRoot);
  const found = [];
  let ignored = 0;

  const walk = (dir, underIgnored) => {
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
      const skipped = underIgnored || isIgnored(rel);
      if (entry.isDirectory()) {
        walk(abs, skipped);
      } else {
        const dot = entry.name.lastIndexOf('.');
        if (dot > -1 && SOURCE_EXT.has(entry.name.slice(dot))) {
          if (skipped) ignored += 1;
          else found.push(rel);
        }
      }
    }
  };

  walk(repoRoot, false);
  found.sort();
  return {
    files: found.slice(0, maxFiles),
    total: found.length + ignored,
    ignored,
    unsupportedPatterns: isIgnored.unsupported,
    capped: found.length > maxFiles,
  };
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

/**
 * Find the end of a string literal opened at `i`, or -1 if it is not one after all.
 *
 * `'` and `"` cannot span a line, so an apostrophe in a trailing comment (`// don't`) opens
 * nothing — without that rule it would swallow the rest of the file and every later comment
 * with it. Template literals may span lines, so only EOF closes them.
 */
function literalEnd(source, i) {
  const quote = source[i];
  for (let j = i + 1; j < source.length; j++) {
    const c = source[j];
    if (c === '\\') {
      j += 1;
      continue;
    }
    if (c === quote) return j + 1;
    if (c === '\n' && quote !== '`') return -1;
  }
  return quote === '`' ? source.length : -1;
}

/**
 * Drop comments before matching, so a code example in a doc block is not reported as real
 * structure. Line comments are only stripped when they start the line: `//` also appears
 * inside URLs, and truncating there would lose genuine imports.
 *
 * Scanned rather than matched by regex, because a regex cannot tell a comment from its own
 * text inside a string. `const glob = "/*"` opened a block comment that ran to the next
 * `*` + `/` in the file, silently deleting every import in between while Coverage still
 * reported the file as parsed. Glob patterns and a following doc block are enough to trigger it.
 */
function stripComments(source) {
  let out = '';
  let atLineStart = true;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (c === '/' && next === '/' && atLineStart) {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end; // keep the newline; line numbers are not our concern
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const end = literalEnd(source, i);
      if (end !== -1) {
        out += source.slice(i, end);
        atLineStart = false;
        i = end;
        continue;
      }
    }

    if (c === '\n') atLineStart = true;
    else if (c !== ' ' && c !== '\t') atLineStart = false;
    out += c;
    i += 1;
  }
  return out;
}

export const EXTRACTORS = [
  {
    name: 'JavaScript/TypeScript',
    match: (rel) => JS_EXT.test(rel),
    extract(raw) {
      const source = stripComments(raw);
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
  const { files, total, ignored, unsupportedPatterns, capped } = scanRepo(repoRoot, { maxFiles });

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
  lines.push(`- Excluded by .gitignore/.cortexignore: ${ignored ? `${ignored} source files` : 'none'}`);
  if (unsupportedPatterns) {
    lines.push(
      `- ${unsupportedPatterns} ignore pattern(s) not supported (globs and \`!\` negations), so files they cover are still listed here.`,
    );
  }
  lines.push(`- Parsed: ${parsed.size ? [...parsed].join(', ') : 'nothing'}`);
  lines.push(
    `- Listed only (not parsed): ${listedOnly.size ? [...listedOnly].sort().join(', ') : 'none'}`,
  );
  lines.push('');

  return {
    markdown: lines.join('\n'),
    hash,
    stats: {
      scanned: files.length,
      total,
      ignored,
      unsupportedPatterns,
      capped,
      parsed: [...parsed],
      listedOnly: [...listedOnly],
    },
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
