/**
 * Context Freshness Scoring and Drift Detection
 *
 * Captures snapshots of AI OS context artifacts and key source files,
 * then compares them to detect drift after structural code changes.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ── Interfaces ─────────────────────────────────────────────────────────────

/** Metadata captured at AI OS generation time. */
export interface ContextSnapshot {
  /** ISO timestamp when this snapshot was captured. */
  capturedAt: string;
  /** AI OS version that generated this snapshot. */
  aiOsVersion: string;
  /**
   * SHA-256 fingerprints of AI OS context artifact files.
   * Key = repo-relative path, value = hex hash (or 'MISSING').
   */
  artifactHashes: Record<string, string>;
  /**
   * SHA-256 fingerprints of key source/config files.
   * Key = repo-relative path, value = hex hash (or 'MISSING').
   */
  sourceHashes: Record<string, string>;
  /** Total number of tracked source files at generation time. */
  trackedFileCount: number;
}

/** Result of comparing the stored snapshot against the current repository state. */
export interface FreshnessReport {
  /**
   * Freshness score from 0.0 (fully stale) to 1.0 (fully fresh).
   * Computed as: (unchanged_sources + intact_artifacts) / (total_sources + total_artifacts).
   */
  score: number;
  /** Human-readable freshness tier. */
  status: 'fresh' | 'drifted' | 'stale' | 'unknown';
  /** Context artifact files whose hashes changed or are missing since last generation. */
  staleArtifacts: string[];
  /** Source/config files that changed since last generation. */
  changedSourceFiles: string[];
  /** Targeted sync recommendations based on detected drift. */
  recommendations: string[];
  /** When the baseline snapshot was captured (ISO string) or null if no snapshot exists. */
  snapshotCapturedAt: string | null;
  /** When AI OS was last run (ISO string from config.json) or null. */
  lastGeneratedAt: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** AI OS context artifact files that are tracked for freshness. */
const ARTIFACT_PATHS = [
  '.github/ai-os/context/conventions.md',
  '.github/ai-os/context/architecture.md',
  '.github/ai-os/context/stack.md',
  '.github/copilot-instructions.md',
  '.github/ai-os/config.json',
  '.github/ai-os/tools.json',
] as const;

/** Source/config files that indicate structural code changes when modified. */
const SOURCE_PROBE_PATHS = [
  'package.json',
  'package-lock.json',
  'pyproject.toml',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'go.mod',
  'tsconfig.json',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'vitest.config.ts',
  'jest.config.ts',
  'jest.config.js',
  'Dockerfile',
] as const;

const SNAPSHOT_PATH = '.github/ai-os/context-snapshot.json';

// ── Hash utilities ─────────────────────────────────────────────────────────

function hashFile(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return 'MISSING';
  }
}

function hashDirectory(dirPath: string): { count: number; hash: string } {
  const hashes: string[] = [];
  let count = 0;

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'coverage', '.ai-os'].includes(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        hashes.push(`${full}:${hashFile(full)}`);
        count++;
      }
    }
  }

  walk(dirPath);
  const combined = crypto.createHash('sha256').update(hashes.join('\n')).digest('hex');
  return { count, hash: combined };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Capture a context snapshot for the given repository root.
 * Records SHA-256 hashes of context artifacts and key source files.
 */
export function captureContextSnapshot(rootDir: string, aiOsVersion: string): ContextSnapshot {
  const artifactHashes: Record<string, string> = {};
  for (const rel of ARTIFACT_PATHS) {
    artifactHashes[rel] = hashFile(path.join(rootDir, rel));
  }

  const sourceHashes: Record<string, string> = {};
  for (const rel of SOURCE_PROBE_PATHS) {
    const abs = path.join(rootDir, rel);
    if (fs.existsSync(abs)) {
      sourceHashes[rel] = hashFile(abs);
    }
  }

  // Also capture a structural hash of the src/ directory if it exists
  let trackedFileCount = Object.keys(sourceHashes).length;
  const srcDir = path.join(rootDir, 'src');
  if (fs.existsSync(srcDir)) {
    const { count, hash } = hashDirectory(srcDir);
    sourceHashes['src/'] = hash;
    trackedFileCount = count;
  }

  return {
    capturedAt: new Date().toISOString(),
    aiOsVersion,
    artifactHashes,
    sourceHashes,
    trackedFileCount,
  };
}

/** Load the stored context snapshot from disk, or return null if not present. */
export function loadContextSnapshot(rootDir: string): ContextSnapshot | null {
  const snapshotPath = path.join(rootDir, SNAPSHOT_PATH);
  if (!fs.existsSync(snapshotPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as ContextSnapshot;
  } catch {
    return null;
  }
}

/** Write the context snapshot to `.github/ai-os/context-snapshot.json`. */
export function writeContextSnapshot(rootDir: string, snapshot: ContextSnapshot): void {
  const snapshotPath = path.join(rootDir, SNAPSHOT_PATH);
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
}

/**
 * Compare the current repository state against the stored context snapshot.
 * Returns a `FreshnessReport` with score, stale artifacts, and recommendations.
 */
export function computeFreshnessReport(rootDir: string): FreshnessReport {
  const snapshot = loadContextSnapshot(rootDir);

  // Determine lastGeneratedAt from config.json
  let lastGeneratedAt: string | null = null;
  try {
    const configPath = path.join(rootDir, '.github', 'ai-os', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { installedAt?: string };
      lastGeneratedAt = config.installedAt ?? null;
    }
  } catch { /* ignore */ }

  if (!snapshot) {
    return {
      score: 0,
      status: 'unknown',
      staleArtifacts: [],
      changedSourceFiles: [],
      recommendations: [
        'No context snapshot found. Run `npx -y github:marinvch/ai-os --refresh-existing` to generate a baseline snapshot.',
      ],
      snapshotCapturedAt: null,
      lastGeneratedAt,
    };
  }

  // Compare artifact hashes
  const staleArtifacts: string[] = [];
  let artifactTotal = 0;
  let artifactFresh = 0;

  for (const [rel, storedHash] of Object.entries(snapshot.artifactHashes)) {
    artifactTotal++;
    const currentHash = hashFile(path.join(rootDir, rel));
    if (currentHash === storedHash) {
      artifactFresh++;
    } else {
      staleArtifacts.push(rel);
    }
  }

  // Compare source hashes
  const changedSourceFiles: string[] = [];
  let sourceTotal = 0;
  let sourceFresh = 0;

  for (const [rel, storedHash] of Object.entries(snapshot.sourceHashes)) {
    sourceTotal++;
    const abs = rel === 'src/' ? path.join(rootDir, 'src') : path.join(rootDir, rel);
    let currentHash: string;
    if (rel === 'src/' && fs.existsSync(abs)) {
      currentHash = hashDirectory(abs).hash;
    } else {
      currentHash = hashFile(abs);
    }
    if (currentHash === storedHash) {
      sourceFresh++;
    } else {
      changedSourceFiles.push(rel);
    }
  }

  // Compute score
  const totalTracked = artifactTotal + sourceTotal;
  const totalFresh = artifactFresh + sourceFresh;
  const score = totalTracked > 0 ? totalFresh / totalTracked : 1.0;

  // Determine status tier
  let status: FreshnessReport['status'];
  if (score >= 0.9) {
    status = 'fresh';
  } else if (score >= 0.6) {
    status = 'drifted';
  } else {
    status = 'stale';
  }

  // Build targeted recommendations
  const recommendations: string[] = [];
  const refreshCmd = 'npx -y github:marinvch/ai-os --refresh-existing';

  if (staleArtifacts.length > 0 && changedSourceFiles.length > 0) {
    recommendations.push(
      `Source changes detected in: ${changedSourceFiles.join(', ')}. ` +
      `Re-run \`${refreshCmd}\` to rebuild context artifacts.`,
    );
  } else if (staleArtifacts.length > 0) {
    recommendations.push(
      `Context artifacts have drifted from the last generation snapshot. ` +
      `Run \`${refreshCmd}\` to synchronize them.`,
    );
  } else if (changedSourceFiles.length > 0) {
    recommendations.push(
      `Source files changed (${changedSourceFiles.join(', ')}) but context artifacts are intact. ` +
      `Verify that conventions and architecture docs still reflect the updated code, ` +
      `then run \`${refreshCmd} --regenerate-context\` if needed.`,
    );
  }

  if (staleArtifacts.some(a => a.includes('conventions'))) {
    recommendations.push('`conventions.md` is stale — run `get_conventions` and verify coding rules are still accurate.');
  }
  if (staleArtifacts.some(a => a.includes('architecture'))) {
    recommendations.push('`architecture.md` is stale — review system design docs and re-run generation.');
  }
  if (staleArtifacts.some(a => a.includes('copilot-instructions'))) {
    recommendations.push('`copilot-instructions.md` has changed — check persistent rules in `config.json` are still aligned.');
  }

  if (status === 'fresh' && recommendations.length === 0) {
    recommendations.push('Context is fresh. No action needed.');
  }

  return {
    score,
    status,
    staleArtifacts,
    changedSourceFiles,
    recommendations,
    snapshotCapturedAt: snapshot.capturedAt,
    lastGeneratedAt,
  };
}

/** Format a `FreshnessReport` as a human-readable Markdown string. */
export function formatFreshnessReport(report: FreshnessReport): string {
  const scorePercent = Math.round(report.score * 100);
  const statusEmoji = {
    fresh: '✅',
    drifted: '⚠️',
    stale: '❌',
    unknown: '❓',
  }[report.status];

  const lines: string[] = [
    `## Context Freshness Report`,
    ``,
    `${statusEmoji} **Status:** ${report.status.toUpperCase()}  |  **Score:** ${scorePercent}/100`,
    ``,
  ];

  if (report.snapshotCapturedAt) {
    lines.push(`- **Snapshot captured:** ${report.snapshotCapturedAt}`);
  }
  if (report.lastGeneratedAt) {
    lines.push(`- **Last AI OS run:** ${report.lastGeneratedAt}`);
  }
  lines.push('');

  if (report.staleArtifacts.length > 0) {
    lines.push('### Stale Context Artifacts');
    for (const a of report.staleArtifacts) {
      lines.push(`- \`${a}\``);
    }
    lines.push('');
  }

  if (report.changedSourceFiles.length > 0) {
    lines.push('### Changed Source / Config Files');
    for (const f of report.changedSourceFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
  }

  if (report.recommendations.length > 0) {
    lines.push('### Recommendations');
    for (const r of report.recommendations) {
      lines.push(`- ${r}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
