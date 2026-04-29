import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// ── Verbose mode (H2) ────────────────────────────────────────────────────────

let _verbose = false;

/** Enable or disable verbose per-file logging for writeIfChanged. */
export function setVerboseMode(enabled: boolean): void {
  _verbose = enabled;
}

// ── Write-if-changed (#13) ────────────────────────────────────────────────────

export type WriteResult = 'written' | 'skipped';

/**
 * Write `content` to `filePath` atomically using a sibling temp-file + rename.
 * Ensures the parent directory exists before writing.
 * On POSIX the rename is atomic; on Windows it is best-effort (rename replaces
 * atomically on NTFS when source and target are on the same volume).
 */
export function writeFileAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
    throw err;
  }
}

/**
 * Write `content` to `filePath` only when the content differs from the existing
 * file. Returns 'written' when a write occurred, 'skipped' when the content was
 * already identical. Ensures the parent directory exists before writing.
 * When verbose mode is enabled, logs the write/skip decision to stdout.
 */
export function writeIfChanged(filePath: string, content: string): WriteResult {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8');
    if (existing === content) {
      if (_verbose) console.log(`  ⏭️  skip    ${filePath}  (unchanged)`);
      return 'skipped';
    }
  }

  writeFileAtomic(filePath, content);
  if (_verbose) console.log(`  ✏️  write   ${filePath}`);
  return 'written';
}

// ── Placeholder resolution (#9) ───────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{[^}]+\}\}/g;

/**
 * Detect unresolved `{{PLACEHOLDER}}` fragments in generated content.
 * Returns the unique set of placeholder names found.
 */
export function findUnresolvedPlaceholders(content: string): string[] {
  const matches = content.match(PLACEHOLDER_RE);
  if (!matches) return [];
  return [...new Set(matches)];
}

/**
 * Replace any remaining `{{PLACEHOLDER}}` fragments using the provided fallback
 * map. Unknown placeholders are removed (replaced with empty string) to prevent
 * raw template syntax leaking into generated files.
 */
export function applyFallbacks(content: string, fallbacks: Record<string, string> = {}): string {
  return content.replace(PLACEHOLDER_RE, (match) => {
    return fallbacks[match] ?? '';
  });
}

// ── Manifest (#8) ────────────────────────────────────────────────────────────

export interface AiOsManifest {
  version: string;
  generatedAt: string;
  /** Repo-relative paths of all files written by AI OS in this run */
  files: string[];
}

const MANIFEST_FILENAME = 'manifest.json';

export function getManifestPath(outputDir: string): string {
  return path.join(outputDir, '.github', 'ai-os', MANIFEST_FILENAME);
}

export function readManifest(outputDir: string): AiOsManifest | null {
  const manifestPath = getManifestPath(outputDir);
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as AiOsManifest;
  } catch {
    return null;
  }
}

/**
 * Write the manifest atomically: write to a temp file then rename.
 * `files` should be repo-relative paths (forward slashes).
 */
export function writeManifest(outputDir: string, version: string, files: string[]): void {
  const manifest: AiOsManifest = {
    version,
    generatedAt: new Date().toISOString(),
    files: [...files].sort(),
  };

  const manifestPath = getManifestPath(outputDir);
  writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2));
}

// ── Diff tracking (#11) ───────────────────────────────────────────────────────

export interface FileDiff {
  written: string[];   // new content differs from existing / file didn't exist
  skipped: string[];   // content identical — no write needed
  pruned: string[];    // existed in previous manifest, not generated this run
}

export function makeFileDiff(): FileDiff {
  return { written: [], skipped: [], pruned: [] };
}

/**
 * Merge a local WriteResult into a shared FileDiff tracker.
 */
export function recordResult(diff: FileDiff, repoRelPath: string, result: WriteResult): void {
  if (result === 'written') {
    diff.written.push(repoRelPath);
  } else {
    diff.skipped.push(repoRelPath);
  }
}

/**
 * Convert an absolute path to a repo-relative forward-slash path.
 */
export function toRepoRelative(absPath: string, outputDir: string): string {
  return path.relative(outputDir, absPath).replace(/\\/g, '/');
}

// ── Hash helper (used internally) ────────────────────────────────────────────
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

// ── Prompt-injection sanitizer (#107) ────────────────────────────────────────

/**
 * Sanitize an untrusted string (e.g. from package.json `name`, dependency names,
 * or filesystem paths) for safe inline interpolation into Copilot instruction
 * and agent files.
 *
 * Defenses applied:
 *  1. Strip C0/C1 control characters and Unicode invisible / zero-width chars.
 *  2. Collapse newlines, carriage returns, and tabs to a single space — inline
 *     fields must not span lines to prevent heading/block injection.
 *  3. Collapse consecutive spaces to one.
 *  4. Cap to `maxLength` characters (default 128) to prevent token-flooding.
 */
export function sanitizeForInstructions(value: string, maxLength = 128): string {
  return value
    // Strip C0 control chars (except 0x09 tab, 0x0A LF, 0x0D CR handled below),
    // C1 control chars, and Unicode invisible/zero-width characters.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F\u200B-\u200D\u2028\u2029\uFEFF]/g, '')
    // Collapse newlines / CR / tabs → single space (no line breaks in inline fields).
    .replace(/[\r\n\t]+/g, ' ')
    // Collapse consecutive spaces.
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
}

// ── Templates dir resolution ──────────────────────────────────────────────────

/**
 * Resolve the templates root directory for both source (`src/generators/*`)
 * and bundled (`bundle/generate.js`) runtime layouts.
 */
export function resolveTemplatesDir(runtimeDir: string): string {
  const candidates = [
    path.join(runtimeDir, '..', 'templates'),
    path.join(runtimeDir, '..', 'src', 'templates'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  // Return the primary candidate so callers can produce deterministic errors.
  return candidates[0];
}
