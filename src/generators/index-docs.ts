/**
 * index-docs.ts — Regenerates architecture.md and stack.md context documents
 * from the RII repo-index.jsonl file.
 *
 * Triggered by `--regen-context` flag in the `--index` CLI command.
 * Preserves manually-curated `<!-- protected -->` sections.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RepoIndexEntry, MetaIndexEntry, FileIndexEntry } from '../types.js';

const ARCHITECTURE_PATH = '.github/ai-os/context/architecture.md';
const STACK_PATH = '.github/ai-os/context/stack.md';

// Anything between these markers is preserved verbatim
const PROTECTED_RE = /<!-- protected -->([\s\S]*?)<!-- \/protected -->/g;

function extractProtectedSections(content: string): Map<number, string> {
  const sections = new Map<number, string>();
  let idx = 0;
  let m: RegExpExecArray | null;
  PROTECTED_RE.lastIndex = 0;
  while ((m = PROTECTED_RE.exec(content)) !== null) {
    sections.set(idx++, m[0]);
  }
  return sections;
}

function loadIndex(indexPath: string): RepoIndexEntry[] {
  if (!fs.existsSync(indexPath)) return [];
  try {
    return fs.readFileSync(indexPath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as RepoIndexEntry);
  } catch {
    return [];
  }
}

function groupByModule(files: FileIndexEntry[]): Map<string, FileIndexEntry[]> {
  const groups = new Map<string, FileIndexEntry[]>();
  for (const f of files) {
    const parts = f.path.split('/');
    const key = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : (parts[0] ?? 'root');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  return groups;
}

function topTags(files: FileIndexEntry[], n = 8): string[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    for (const tag of f.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

/** Build a fresh architecture.md body from index data. */
function buildArchitectureMd(meta: MetaIndexEntry, files: FileIndexEntry[]): string {
  const groups = groupByModule(files);
  const modules: string[] = [];

  for (const [dir, dirFiles] of [...groups.entries()].sort()) {
    const tags = topTags(dirFiles, 5);
    const tagStr = tags.length > 0 ? ` _(${tags.join(', ')})_` : '';
    const purposes = dirFiles
      .filter(f => f.purpose)
      .slice(0, 3)
      .map(f => `  - \`${f.path}\` — ${f.purpose}`)
      .join('\n');
    modules.push(`### \`${dir}/\`${tagStr}\n${purposes || `  - ${dirFiles.length} file(s)`}`);
  }

  const lines = [
    `# Architecture Overview`,
    ``,
    `> Auto-generated from \`repo-index.jsonl\` on ${meta.generatedAt.slice(0, 10)}. `,
    `> Edit sections between \`<!-- protected -->\` markers — those are preserved on regeneration.`,
    ``,
    `## Stack`,
    ``,
    `- **Primary language:** ${meta.primaryLanguage}`,
    meta.primaryFramework ? `- **Primary framework:** ${meta.primaryFramework}` : '',
    meta.frameworks.length > 1 ? `- **Frameworks:** ${meta.frameworks.join(', ')}` : '',
    `- **Indexed:** ${meta.fileCount} files, ${meta.symbolCount} symbols`,
    ``,
    `## Module Map`,
    ``,
    ...modules,
    ``,
    `## Architecture decisions`,
    ``,
    `<!-- protected -->`,
    `_Add your architecture decisions here. This section is preserved on regeneration._`,
    `<!-- /protected -->`,
    ``,
  ].filter(l => l !== null && l !== undefined);

  return lines.join('\n');
}

/** Build a fresh stack.md body from index data. */
function buildStackMd(meta: MetaIndexEntry, files: FileIndexEntry[]): string {
  const langCounts = new Map<string, number>();
  for (const f of files) {
    langCounts.set(f.language, (langCounts.get(f.language) ?? 0) + 1);
  }
  const langRows = [...langCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang, count]) => `| ${lang} | ${count} files |`)
    .join('\n');

  return [
    `# Tech Stack`,
    ``,
    `> Auto-generated from \`repo-index.jsonl\` on ${meta.generatedAt.slice(0, 10)}.`,
    ``,
    `## Languages`,
    ``,
    `| Language | Files |`,
    `|---|---|`,
    langRows,
    ``,
    `## Frameworks`,
    ``,
    meta.frameworks.length > 0
      ? meta.frameworks.map(f => `- ${f}`).join('\n')
      : '_None detected_',
    ``,
    `## Notes`,
    ``,
    `<!-- protected -->`,
    `_Add stack notes here. This section is preserved on regeneration._`,
    `<!-- /protected -->`,
    ``,
  ].join('\n');
}

function regenerateFile(fullPath: string, newContent: string): void {
  const existing = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : '';
  const protectedSections = extractProtectedSections(existing);

  let merged = newContent;
  if (protectedSections.size > 0) {
    let idx = 0;
    merged = newContent.replace(PROTECTED_RE, () => {
      const preserved = protectedSections.get(idx);
      idx++;
      return preserved ?? '';
    });
  }

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, merged, 'utf-8');
}

export function regenerateContextFromIndex(cwd: string, indexPath: string): void {
  const entries = loadIndex(indexPath);
  const meta = entries.find((e): e is MetaIndexEntry => e.type === 'meta');
  const files = entries.filter((e): e is FileIndexEntry => e.type === 'file');

  if (!meta) {
    console.warn('  ⚠️  No meta entry in index — skipping context regeneration');
    return;
  }

  regenerateFile(
    path.join(cwd, ARCHITECTURE_PATH),
    buildArchitectureMd(meta, files),
  );

  regenerateFile(
    path.join(cwd, STACK_PATH),
    buildStackMd(meta, files),
  );
}
