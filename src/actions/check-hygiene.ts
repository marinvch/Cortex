import fs from 'node:fs';
import path from 'node:path';
import { readManifest } from '../generators/utils.js';

function findFilesRecursive(dir: string, predicate: (name: string) => boolean): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFilesRecursive(full, predicate));
      } else if (entry.isFile() && predicate(entry.name)) {
        results.push(full);
      }
    }
  } catch {
    // ignore permission errors
  }
  return results;
}

export function runCheckHygieneAction(cwd: string): void {
  console.log(`  🧹 Hygiene check: ${cwd}`);
  console.log('');
  const issues: string[] = [];

  // Check for legacy .ai-os/context/ artifacts (pre-v0.3.0 paths)
  const legacyContextDir = path.join(cwd, '.ai-os', 'context');
  if (fs.existsSync(legacyContextDir)) {
    const legacyFiles = fs.readdirSync(legacyContextDir);
    if (legacyFiles.length > 0) {
      issues.push(`  ⚠  Legacy .ai-os/context/ found with ${legacyFiles.length} file(s) — run --refresh-existing to migrate and prune`);
    }
  }

  // Check for leftover .memory.lock files (crash artifact)
  const lockPaths = [
    path.join(cwd, '.github', 'ai-os', 'memory', '.memory.lock'),
    path.join(cwd, '.ai-os', 'memory', '.memory.lock'),
  ];
  for (const lockPath of lockPaths) {
    if (fs.existsSync(lockPath)) {
      issues.push(`  ⚠  Stale lock file found: ${path.relative(cwd, lockPath)} — safe to delete`);
    }
  }

  // Check for node_modules inside .ai-os/mcp-server/ (Phase F not yet applied)
  const mcpNodeModules = path.join(cwd, '.ai-os', 'mcp-server', 'node_modules');
  if (fs.existsSync(mcpNodeModules)) {
    issues.push(`  ⚠  node_modules present in .ai-os/mcp-server/ — Phase F (bundle deploy) will eliminate this`);
  }

  // Check for *.tmp files in ai-os dirs
  const aiOsDirs = [
    path.join(cwd, '.github', 'ai-os'),
    path.join(cwd, '.ai-os'),
  ];
  for (const dir of aiOsDirs) {
    if (!fs.existsSync(dir)) continue;
    const tmpFiles = findFilesRecursive(dir, f => f.endsWith('.tmp'));
    for (const f of tmpFiles) {
      issues.push(`  ⚠  Orphaned temp file: ${path.relative(cwd, f)}`);
    }
  }

  // Check manifest consistency
  const manifest = readManifest(cwd);
  if (manifest) {
    const missingFiles = manifest.files.filter(f => !fs.existsSync(path.join(cwd, f)));
    if (missingFiles.length > 0) {
      issues.push(`  ⚠  ${missingFiles.length} manifest entries point to missing files — run --refresh-existing`);
    }
  } else {
    issues.push(`  ⚠  No manifest.json found — run AI OS generation to create one`);
  }

  if (issues.length === 0) {
    console.log('  ✅ Hygiene check passed — no orphaned files or dump artifacts found.');
  } else {
    console.log('  Issues found:');
    for (const issue of issues) console.log(issue);
    console.log('');
    console.log(`  Total issues: ${issues.length}`);
    process.exit(1);
  }
  console.log('');
}
