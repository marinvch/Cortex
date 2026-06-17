import fs from 'node:fs';
import path from 'node:path';
import type { DetectedLanguage } from '../types.js';

const EXTENSION_MAP: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', pyi: 'Python',
  go: 'Go',
  rs: 'Rust',
  java: 'Java', kt: 'Kotlin', kts: 'Kotlin',
  cs: 'C#', vb: 'Visual Basic',
  cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', h: 'C/C++', c: 'C',
  rb: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  scala: 'Scala',
  ex: 'Elixir', exs: 'Elixir',
  clj: 'Clojure', cljs: 'Clojure',
  hs: 'Haskell',
  ml: 'OCaml', mli: 'OCaml',
  dart: 'Dart',
  lua: 'Lua',
  r: 'R',
  jl: 'Julia',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell',
  ps1: 'PowerShell',
  sql: 'SQL',
  css: 'CSS', scss: 'SCSS', sass: 'SASS', less: 'LESS',
  html: 'HTML', htm: 'HTML',
  vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
  tf: 'Terraform', tfvars: 'Terraform',
  yaml: 'YAML', yml: 'YAML',
  json: 'JSON', jsonc: 'JSON',
  toml: 'TOML',
  md: 'Markdown', mdx: 'Markdown',
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '__pycache__', '.venv', 'venv', 'env', '.env',
  'target', 'vendor', '.gradle', '.mvn',
  'coverage', '.nyc_output', '.cache', '.parcel-cache',
  'bin', 'obj', '.vs', 'packages',
  '.github', // GitHub config/Actions/AI OS artifacts — not project source code
]);

function walkDir(dir: string, depth = 0, maxDepth = 6): string[] {
  if (depth > maxDepth) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath, depth + 1, maxDepth));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

export function detectLanguages(rootDir: string): DetectedLanguage[] {
  const files = walkDir(rootDir);
  const counts: Record<string, { count: number; extensions: Set<string> }> = {};

  for (const file of files) {
    const ext = path.extname(file).slice(1).toLowerCase();
    if (!ext) continue;
    const lang = EXTENSION_MAP[ext];
    if (!lang) continue;
    if (!counts[lang]) counts[lang] = { count: 0, extensions: new Set() };
    counts[lang].count++;
    counts[lang].extensions.add(ext);
  }

  const total = Object.values(counts).reduce((sum, v) => sum + v.count, 0) || 1;

  return Object.entries(counts)
    .map(([name, { count, extensions }]) => ({
      name,
      fileCount: count,
      percentage: Math.round((count / total) * 100),
      extensions: [...extensions],
    }))
    .sort((a, b) => b.fileCount - a.fileCount);
}
