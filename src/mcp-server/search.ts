/**
 * search.ts — searchFiles and buildFileTree for AI OS MCP server.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './shared.js';

export function searchFiles(query: string, filePattern?: string, caseSensitive = false): string {
  try {
    const flags = caseSensitive ? '' : '--ignore-case';
    const globArg = filePattern ? `-g "${filePattern}"` : '';
    const cmd = `npx --yes ripgrep ${flags} ${globArg} --line-number --max-count=5 "${query}" "${ROOT}"`;
    const result = execSync(cmd, { maxBuffer: 512 * 1024, timeout: 10000 }).toString();
    return result.slice(0, 8000); // Cap output for token efficiency
  } catch (err) {
    if (err instanceof Error && 'stdout' in err) {
      return String((err as NodeJS.ErrnoException & { stdout: Buffer }).stdout ?? 'No results found');
    }
    return 'No results found';
  }
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '__pycache__', '.venv', 'venv', 'target', 'vendor', 'coverage',
  '.gradle', 'bin', 'obj', '.vs', 'packages', '.cache',
]);

export function buildFileTree(dir: string, depth = 0, maxDepth = 4): string[] {
  if (depth > maxDepth) return [];
  const prefix = '  '.repeat(depth);
  const lines: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') || e.name === '.github')
      .filter(e => !IGNORE_DIRS.has(e.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        lines.push(...buildFileTree(path.join(dir, entry.name), depth + 1, maxDepth));
      } else {
        lines.push(`${prefix}${entry.name}`);
      }
    }
  } catch { /* ignore permission errors */ }
  return lines;
}
