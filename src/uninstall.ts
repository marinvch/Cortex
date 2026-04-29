/**
 * AI OS Uninstall
 *
 * Removes all files that AI OS owns (per manifest.json) from the project.
 * Preserves any files listed in protect.json or that contain user-block markers.
 * Supports --dry-run mode.
 *
 * Managed directories (.ai-os/, .github/ai-os/) are removed when empty after
 * file deletion.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readManifest } from './generators/utils.js';
import { extractUserBlocks } from './user-blocks.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UninstallReport {
  cwd: string;
  dryRun: boolean;
  removed: string[];
  skipped: string[];
  notFound: string[];
  errors: Array<{ file: string; reason: string }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readProtectedPaths(cwd: string): Set<string> {
  const protectPath = path.join(cwd, '.github', 'ai-os', 'protect.json');
  if (!fs.existsSync(protectPath)) return new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(protectPath, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object') return new Set();
    const obj = raw as Record<string, unknown>;
    const files: string[] = [];
    if (Array.isArray(obj['never'])) {
      files.push(...(obj['never'] as string[]));
    }
    if (Array.isArray(obj['hybrid'])) {
      files.push(...(obj['hybrid'] as string[]));
    }
    // Resolve relative paths to absolute
    return new Set(files.map(f => path.resolve(cwd, f)));
  } catch {
    return new Set();
  }
}

function hasUserBlocks(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const blocks = extractUserBlocks(content);
    return blocks.size > 0;
  } catch {
    return false;
  }
}

function removeEmptyDirs(dirs: string[]): void {
  // Sort deepest first so inner dirs are tried before parents
  const sorted = [...dirs].sort((a, b) => b.length - a.length);
  for (const dir of sorted) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    } catch { /* best effort */ }
  }
}

// ── Core uninstall logic ──────────────────────────────────────────────────────

export function runUninstall(cwd: string, options: { dryRun?: boolean; verbose?: boolean } = {}): UninstallReport {
  const { dryRun = false, verbose = false } = options;

  const report: UninstallReport = {
    cwd,
    dryRun,
    removed: [],
    skipped: [],
    notFound: [],
    errors: [],
  };

  const manifest = readManifest(cwd);
  if (!manifest) {
    console.log('  ℹ️  No AI OS manifest found — nothing to uninstall.');
    return report;
  }

  const protected_ = readProtectedPaths(cwd);
  const affectedDirs = new Set<string>();

  for (const relPath of manifest.files) {
    const abs = path.resolve(cwd, relPath);

    if (!fs.existsSync(abs)) {
      report.notFound.push(relPath);
      if (verbose) console.log(`  ❓ not found  ${relPath}`);
      continue;
    }

    // Skip files protected by protect.json
    if (protected_.has(abs)) {
      report.skipped.push(relPath);
      if (verbose) console.log(`  🔒 skipped    ${relPath}  (protect.json)`);
      continue;
    }

    // Skip files that contain user-authored content blocks
    if (hasUserBlocks(abs)) {
      report.skipped.push(relPath);
      if (verbose) console.log(`  🔒 skipped    ${relPath}  (has user blocks)`);
      continue;
    }

    if (dryRun) {
      report.removed.push(relPath);
      console.log(`  🗑️  [dry-run]   ${relPath}`);
      continue;
    }

    try {
      fs.unlinkSync(abs);
      report.removed.push(relPath);
      affectedDirs.add(path.dirname(abs));
      if (verbose) console.log(`  🗑️  removed    ${relPath}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      report.errors.push({ file: relPath, reason });
      console.error(`  ✖ error       ${relPath}: ${reason}`);
    }
  }

  // Also remove AI OS runtime directory and manifest itself
  const managedDirs = [
    path.join(cwd, '.ai-os', 'mcp-server'),
    path.join(cwd, '.ai-os'),
  ];
  const manifestPath = path.join(cwd, '.github', 'ai-os', 'manifest.json');

  if (!dryRun) {
    for (const dir of managedDirs) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
          if (verbose) console.log(`  🗑️  removed    ${path.relative(cwd, dir)}/`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`  ✖ error       ${path.relative(cwd, dir)}: ${reason}`);
      }
    }

    // Remove the manifest last
    try {
      if (fs.existsSync(manifestPath)) {
        fs.unlinkSync(manifestPath);
        if (verbose) console.log(`  🗑️  removed    .github/ai-os/manifest.json`);
      }
    } catch { /* ignore */ }

    // Prune empty managed directories
    const dirsToCheck = [
      ...Array.from(affectedDirs),
      path.join(cwd, '.github', 'ai-os'),
      path.join(cwd, '.github', 'agents'),
      path.join(cwd, '.github', 'copilot', 'skills'),
      path.join(cwd, '.github', 'copilot'),
      path.join(cwd, '.github', 'instructions'),
    ];
    removeEmptyDirs(dirsToCheck);
  }

  return report;
}

export function formatUninstallReport(report: UninstallReport): string {
  const lines: string[] = [];
  const mode = report.dryRun ? ' [DRY RUN]' : '';

  lines.push(`\n  ✅ AI OS uninstall complete${mode}`);
  lines.push(`     Removed:   ${report.removed.length} file(s)`);
  if (report.skipped.length > 0) lines.push(`     Skipped:   ${report.skipped.length} file(s)  (user content preserved)`);
  if (report.notFound.length > 0) lines.push(`     Not found: ${report.notFound.length} file(s)`);
  if (report.errors.length > 0) lines.push(`     Errors:    ${report.errors.length} file(s)`);

  if (report.skipped.length > 0) {
    lines.push('\n  Files skipped (contain user content):');
    for (const f of report.skipped) lines.push(`    • ${f}`);
  }

  if (report.errors.length > 0) {
    lines.push('\n  Errors:');
    for (const e of report.errors) lines.push(`    • ${e.file}: ${e.reason}`);
  }

  return lines.join('\n');
}
