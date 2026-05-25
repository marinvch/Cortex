/**
 * index.ts — Repository Intelligence Index (RII) pipeline.
 *
 * Walks source files, extracts symbols + purpose + tags via per-language
 * extractor adapters, and writes a newline-delimited JSON file to
 * .github/ai-os/context/repo-index.jsonl.
 *
 * Usage:  npx ai-os --index [--incremental] [--regen-context] [--dry-run] [--quiet]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getExtractorForFile } from '../detectors/symbols.js';
import { getToolVersion } from '../updater.js';
import { analyze } from '../analyze.js';
import type {
  MetaIndexEntry,
  FileIndexEntry,
  SymbolIndexEntry,
  RepoIndexEntry,
} from '../types.js';

export interface IndexOptions {
  cwd: string;
  output?: string;
  incremental?: boolean;
  regenContext?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
}

export interface IndexResult {
  fileCount: number;
  symbolCount: number;
  skippedCount: number;
  outputPath: string;
  entries: RepoIndexEntry[];
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '__pycache__', '.venv', 'venv', 'env', 'target', 'vendor', 'coverage',
  '.gradle', 'bin', 'obj', '.vs', 'packages', '.cache', '.ai-os',
  '.turbo', '.parcel-cache', 'storybook-static',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.rb', '.php',
]);

function collectSourceFiles(dir: string, rootDir: string): string[] {
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectSourceFiles(full, rootDir));
      } else if (entry.isFile()) {
        const ext = `.${entry.name.split('.').pop()?.toLowerCase() ?? ''}`;
        if (SOURCE_EXTENSIONS.has(ext)) {
          files.push(path.relative(rootDir, full).replace(/\\/g, '/'));
        }
      }
    }
  } catch { /* ignore permission errors */ }
  return files;
}

function sha1(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex');
}

/** Load existing FileEntry hashes for incremental indexing. */
function loadExistingHashes(outputPath: string): Map<string, string> {
  const hashes = new Map<string, string>();
  if (!fs.existsSync(outputPath)) return hashes;
  try {
    const lines = fs.readFileSync(outputPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line) as RepoIndexEntry;
      if (entry.type === 'file') {
        hashes.set(entry.path, entry.hash);
      }
    }
  } catch { /* corrupted index — re-index everything */ }
  return hashes;
}

export async function indexRepo(opts: IndexOptions): Promise<IndexResult> {
  const {
    cwd,
    incremental = false,
    regenContext = false,
    dryRun = false,
    quiet = false,
  } = opts;

  const outputPath = opts.output ?? path.join(cwd, '.github', 'ai-os', 'context', 'repo-index.jsonl');
  const log = (msg: string): void => { if (!quiet) console.log(msg); };

  log(`  🔍 Indexing repository: ${cwd}`);

  const stack = analyze(cwd);
  const sourceFiles = collectSourceFiles(cwd, cwd);
  const existingHashes = incremental ? loadExistingHashes(outputPath) : new Map<string, string>();

  const fileEntries: FileIndexEntry[] = [];
  const symbolEntries: SymbolIndexEntry[] = [];
  let skippedCount = 0;

  for (const relPath of sourceFiles) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(cwd, relPath), 'utf-8');
    } catch {
      continue;
    }

    const hash = sha1(content);

    // Skip unchanged files in incremental mode
    if (incremental && existingHashes.get(relPath) === hash) {
      skippedCount++;
      continue;
    }

    const extractor = getExtractorForFile(relPath);
    const language = extractor?.language ?? inferLanguage(relPath);
    const purpose = extractor?.extractPurpose(content) ?? null;
    const tags = extractor?.extractTags(content, relPath) ?? [];
    const symbols = extractor?.extractSymbols(content, relPath) ?? [];
    const exports = symbols.map(s => s.name);

    fileEntries.push({
      type: 'file',
      path: relPath,
      language,
      size: Buffer.byteLength(content, 'utf-8'),
      hash,
      purpose,
      tags,
      exports,
    });

    for (const sym of symbols) {
      symbolEntries.push({
        type: 'symbol',
        name: sym.name,
        kind: sym.kind,
        file: relPath,
        line: sym.line,
        signature: sym.signature,
        tags,
        specIds: sym.specIds,
      });
    }
  }

  const meta: MetaIndexEntry = {
    type: 'meta',
    generatedAt: new Date().toISOString(),
    version: getToolVersion(),
    primaryLanguage: stack.primaryLanguage.name,
    primaryFramework: stack.primaryFramework?.name ?? null,
    frameworks: stack.frameworks.map(f => f.name),
    fileCount: fileEntries.length,
    symbolCount: symbolEntries.length,
  };

  const allEntries: RepoIndexEntry[] = [meta, ...fileEntries, ...symbolEntries];

  log(`  📊 ${fileEntries.length} files indexed, ${symbolEntries.length} symbols extracted, ${skippedCount} skipped (unchanged)`);

  if (!dryRun) {
    const dir = path.dirname(outputPath);
    fs.mkdirSync(dir, { recursive: true });

    // In incremental mode, merge with existing entries for unchanged files
    if (incremental && fs.existsSync(outputPath)) {
      const existing = loadExistingEntries(outputPath);
      const changedPaths = new Set(fileEntries.map(e => e.path));
      const keptEntries = existing.filter(e => {
        if (e.type === 'meta') return false; // always replace meta
        if (e.type === 'file') return !changedPaths.has(e.path);
        if (e.type === 'symbol') return !changedPaths.has(e.file);
        return true; // keep spec entries
      });
      const merged: RepoIndexEntry[] = [meta, ...fileEntries, ...symbolEntries, ...keptEntries];
      fs.writeFileSync(outputPath, merged.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
      log(`  ✅ Index updated: ${outputPath}`);
    } else {
      fs.writeFileSync(outputPath, allEntries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
      log(`  ✅ Index written: ${outputPath}`);
    }
  } else {
    log('\n--- Dry run output (not written) ---');
    for (const entry of allEntries.slice(0, 10)) {
      log(JSON.stringify(entry));
    }
    if (allEntries.length > 10) log(`... and ${allEntries.length - 10} more entries`);
  }

  if (regenContext && !dryRun) {
    try {
      const { regenerateContextFromIndex } = await import('../generators/index-docs.js');
      regenerateContextFromIndex(cwd, outputPath);
      log('  📝 Context documents regenerated from index');
    } catch (err) {
      log(`  ⚠️  Context regen skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    fileCount: fileEntries.length,
    symbolCount: symbolEntries.length,
    skippedCount,
    outputPath,
    entries: allEntries,
  };
}

function loadExistingEntries(outputPath: string): RepoIndexEntry[] {
  try {
    const lines = fs.readFileSync(outputPath, 'utf-8').split('\n').filter(Boolean);
    return lines.map(l => JSON.parse(l) as RepoIndexEntry);
  } catch {
    return [];
  }
}

function inferLanguage(filePath: string): string {
  const ext = `.${filePath.split('.').pop()?.toLowerCase() ?? ''}`;
  const map: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript',
    '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
    '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java',
    '.rb': 'Ruby', '.php': 'PHP',
  };
  return map[ext] ?? 'Unknown';
}
