import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// ── Verbose mode (H2) ────────────────────────────────────────────────────────

let _verbose = false;

// ── Content-hash gate (#115) ─────────────────────────────────────────────────
// Populated from the previous manifest at the start of each refresh run.
// writeIfChanged uses this to skip the disk read when the generated content
// hash already matches what was recorded in the previous manifest.

let _prevHashes: Record<string, string> = {};
let _newHashes: Record<string, string> = {};

/**
 * Load the previous run's content hashes from the manifest.
 * Call this once at the start of runApply() after readManifest().
 */
export function setPrevHashes(hashes: Record<string, string>): void {
  _prevHashes = hashes;
  _newHashes = {};
}

/** Reset all hash state — useful in tests to prevent cross-test contamination. */
export function resetHashes(): void {
  _prevHashes = {};
  _newHashes = {};
}

/**
 * Retrieve the content hashes collected during this generation run.
 * Pass these to writeManifest() to persist them for the next run.
 */
export function getNewHashes(): Record<string, string> {
  return { ..._newHashes };
}

/** Enable or disable verbose per-file logging for writeIfChanged. */
export function setVerboseMode(enabled: boolean): void {
  _verbose = enabled;
}

// ── Content hashing (#115) ────────────────────────────────────────────────────

/**
 * Compute a SHA-256 hex digest of `content`.
 * Used to populate manifest.hashes so refresh runs can detect unchanged files.
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Read a file from disk and compute its SHA-256 hex digest.
 * Returns `null` when the file does not exist.
 */
export function hashFile(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return hashContent(content);
  } catch {
    return null;
  }
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

  // #115 content-hash gate: compute hash of new content and record it.
  const contentHash = hashContent(content);
  _newHashes[filePath] = contentHash;

  // Fast-path: compare against previous manifest hash before reading disk.
  // Only skip if the file actually exists — a deleted file must always be recreated.
  if (_prevHashes[filePath] !== undefined && _prevHashes[filePath] === contentHash && fs.existsSync(filePath)) {
    if (_verbose) console.log(`  ⏭️  skip    ${filePath}  (hash-match)`);
    if (_dryRun) _dryRunCaptures.push({ filePath, newContent: content, existingContent: content });
    return 'skipped';
  }

  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8');
    if (existing === content) {
      if (_verbose) console.log(`  ⏭️  skip    ${filePath}  (unchanged)`);
      // In dry-run capture mode: still record unchanged entries
      if (_dryRun) _dryRunCaptures.push({ filePath, newContent: content, existingContent: existing });
      return 'skipped';
    }
  }

  if (_dryRun) {
    // Capture planned write without touching disk
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
    _dryRunCaptures.push({ filePath, newContent: content, existingContent: existing });
    return 'written';
  }

  writeFileAtomic(filePath, content);
  if (_verbose) console.log(`  ✏️  write   ${filePath}`);
  return 'written';
}

// ── Dry-run capture mode (#116) ───────────────────────────────────────────────

export interface DryRunCapture {
  filePath: string;
  newContent: string;
  existingContent: string | null;
}

let _dryRun = false;
let _dryRunCaptures: DryRunCapture[] = [];

/** Enable dry-run capture mode — writeIfChanged records planned writes but does not touch disk. */
export function setDryRunMode(enabled: boolean): void {
  _dryRun = enabled;
  if (enabled) _dryRunCaptures = [];
}

/** Returns all captured planned writes since dry-run mode was activated. */
export function getDryRunCaptures(): DryRunCapture[] {
  return _dryRunCaptures;
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
  /** SHA-256 content hashes keyed by repo-relative file path */
  hashes?: Record<string, string>;
}

const MANIFEST_FILENAME = 'manifest.json';

export function getManifestPath(outputDir: string): string {
  return path.join(outputDir, '.github', 'ai-os', MANIFEST_FILENAME);
}

/** Runtime type guard for AiOsManifest JSON artifacts. */
export function isAiOsManifest(obj: unknown): obj is AiOsManifest {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o['version'] === 'string' &&
    typeof o['generatedAt'] === 'string' &&
    Array.isArray(o['files']) &&
    (o['files'] as unknown[]).every((f) => typeof f === 'string')
  );
}

export function readManifest(outputDir: string): AiOsManifest | null {
  const manifestPath = getManifestPath(outputDir);
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (!isAiOsManifest(parsed)) {
      console.warn(`⚠️  manifest.json at ${manifestPath} failed schema validation — ignoring.`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write the manifest atomically: write to a temp file then rename.
 * `files` should be repo-relative paths (forward slashes).
 * `hashes` is an optional map of repo-relative path → SHA-256 hex content hash.
 */
export function writeManifest(
  outputDir: string,
  version: string,
  files: string[],
  hashes?: Record<string, string>,
): void {
  const manifest: AiOsManifest = {
    version,
    generatedAt: new Date().toISOString(),
    files: [...files].sort(),
    ...(hashes && Object.keys(hashes).length > 0 ? { hashes } : {}),
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
    path.join(runtimeDir, '..', 'templates'),              // bundle/generate.js → templates/  |  dist/generators/ → dist/templates/
    path.join(runtimeDir, '..', 'src', 'templates'),       // bundle/generate.js → src/templates/ ✓  |  src/generators/ → src/templates/ ✓
    path.join(runtimeDir, '..', '..', 'src', 'templates'), // dist/generators/ → src/templates/ ✓ (tsc compiled layout)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  // Return the primary candidate so callers can produce deterministic errors.
  return candidates[0];
}
