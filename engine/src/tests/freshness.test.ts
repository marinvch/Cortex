import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  captureContextSnapshot,
  loadContextSnapshot,
  writeContextSnapshot,
  computeFreshnessReport,
  formatFreshnessReport,
} from '../detectors/freshness.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `ai-os-freshness-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function seedAiOsArtifacts(root: string): void {
  writeFile(root, '.github/ai-os/context/conventions.md', '# Conventions\n\nsome rules');
  writeFile(root, '.github/ai-os/context/architecture.md', '# Architecture\n\noverview');
  writeFile(root, '.github/ai-os/context/stack.md', '# Stack\n\nnodejs');
  writeFile(root, '.github/copilot-instructions.md', '# Instructions\n\nrules');
  writeFile(root, '.github/ai-os/config.json', JSON.stringify({ version: '0.10.0', installedAt: '2025-01-01T00:00:00Z' }));
  writeFile(root, '.github/ai-os/tools.json', JSON.stringify({ activeTools: [], availableButInactive: [] }));
  writeFile(root, 'package.json', JSON.stringify({ name: 'test', version: '1.0.0' }));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('captureContextSnapshot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    seedAiOsArtifacts(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('captures artifact hashes for tracked context files', () => {
    const snapshot = captureContextSnapshot(tmpDir, '0.10.0');

    expect(snapshot.aiOsVersion).toBe('0.10.0');
    expect(snapshot.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.artifactHashes['.github/ai-os/context/conventions.md']).toBeTruthy();
    expect(snapshot.artifactHashes['.github/copilot-instructions.md']).toBeTruthy();
    expect(snapshot.artifactHashes['.github/ai-os/config.json']).toBeTruthy();
  });

  it('records MISSING for non-existent artifact files', () => {
    // Remove one file
    fs.rmSync(path.join(tmpDir, '.github/ai-os/context/architecture.md'));
    const snapshot = captureContextSnapshot(tmpDir, '0.10.0');
    expect(snapshot.artifactHashes['.github/ai-os/context/architecture.md']).toBe('MISSING');
  });

  it('captures source hashes for existing config files', () => {
    const snapshot = captureContextSnapshot(tmpDir, '0.10.0');
    expect(snapshot.sourceHashes['package.json']).toBeTruthy();
    expect(snapshot.sourceHashes['package.json']).not.toBe('MISSING');
  });

  it('does not include non-existent source probe paths', () => {
    const snapshot = captureContextSnapshot(tmpDir, '0.10.0');
    // tsconfig.json was not seeded, so it should not appear
    expect(snapshot.sourceHashes['tsconfig.json']).toBeUndefined();
  });
});

describe('writeContextSnapshot / loadContextSnapshot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips snapshot through disk correctly', () => {
    const snapshot = {
      capturedAt: '2025-01-01T00:00:00.000Z',
      aiOsVersion: '0.10.0',
      artifactHashes: { '.github/ai-os/config.json': 'abc123' },
      sourceHashes: { 'package.json': 'def456' },
      trackedFileCount: 5,
    };

    writeContextSnapshot(tmpDir, snapshot);
    const loaded = loadContextSnapshot(tmpDir);

    expect(loaded).not.toBeNull();
    expect(loaded?.aiOsVersion).toBe('0.10.0');
    expect(loaded?.artifactHashes['.github/ai-os/config.json']).toBe('abc123');
    expect(loaded?.sourceHashes['package.json']).toBe('def456');
  });

  it('returns null when no snapshot file exists', () => {
    const loaded = loadContextSnapshot(tmpDir);
    expect(loaded).toBeNull();
  });

  it('returns null for corrupted snapshot file', () => {
    fs.mkdirSync(path.join(tmpDir, '.github', 'ai-os'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.github', 'ai-os', 'context-snapshot.json'), '{ invalid json', 'utf-8');
    const loaded = loadContextSnapshot(tmpDir);
    expect(loaded).toBeNull();
  });
});

describe('computeFreshnessReport', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    seedAiOsArtifacts(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns unknown status when no snapshot exists', () => {
    const report = computeFreshnessReport(tmpDir);
    expect(report.status).toBe('unknown');
    expect(report.score).toBe(0);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('returns fresh status when nothing changed', () => {
    const snapshot = captureContextSnapshot(tmpDir, '0.10.0');
    writeContextSnapshot(tmpDir, snapshot);

    const report = computeFreshnessReport(tmpDir);
    expect(report.status).toBe('fresh');
    expect(report.score).toBe(1);
    expect(report.staleArtifacts).toHaveLength(0);
    expect(report.changedSourceFiles).toHaveLength(0);
  });

  it('detects stale artifact when context file changes', () => {
    const snapshot = captureContextSnapshot(tmpDir, '0.10.0');
    writeContextSnapshot(tmpDir, snapshot);

    // Modify a context artifact
    writeFile(tmpDir, '.github/ai-os/context/conventions.md', '# Conventions\n\nupdated rules');

    const report = computeFreshnessReport(tmpDir);
    expect(report.status).not.toBe('fresh');
    expect(report.staleArtifacts).toContain('.github/ai-os/context/conventions.md');
  });

  it('detects changed source file when package.json is updated', () => {
    const snapshot = captureContextSnapshot(tmpDir, '0.10.0');
    writeContextSnapshot(tmpDir, snapshot);

    // Modify package.json
    writeFile(tmpDir, 'package.json', JSON.stringify({ name: 'test', version: '2.0.0', dependencies: { react: '^18' } }));

    const report = computeFreshnessReport(tmpDir);
    expect(report.changedSourceFiles).toContain('package.json');
  });

  it('score is between 0 and 1 inclusive', () => {
    const snapshot = captureContextSnapshot(tmpDir, '0.10.0');
    writeContextSnapshot(tmpDir, snapshot);
    // Corrupt several artifacts
    writeFile(tmpDir, '.github/ai-os/context/conventions.md', 'changed');
    writeFile(tmpDir, '.github/ai-os/context/architecture.md', 'changed');
    writeFile(tmpDir, 'package.json', '{ "changed": true }');

    const report = computeFreshnessReport(tmpDir);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(1);
  });

  it('includes lastGeneratedAt from config.json when present', () => {
    const snapshot = captureContextSnapshot(tmpDir, '0.10.0');
    writeContextSnapshot(tmpDir, snapshot);

    const report = computeFreshnessReport(tmpDir);
    expect(report.lastGeneratedAt).toBe('2025-01-01T00:00:00Z');
  });

  it('snapshotCapturedAt matches the stored snapshot', () => {
    const snapshot = captureContextSnapshot(tmpDir, '0.10.0');
    writeContextSnapshot(tmpDir, snapshot);

    const report = computeFreshnessReport(tmpDir);
    expect(report.snapshotCapturedAt).toBe(snapshot.capturedAt);
  });
});

describe('formatFreshnessReport', () => {
  it('includes score percentage in output', () => {
    const report = computeFreshnessReport(makeTempDir()); // unknown
    const formatted = formatFreshnessReport(report);
    expect(formatted).toContain('Context Freshness Report');
    expect(formatted).toContain('UNKNOWN');
  });

  it('includes stale artifacts section when artifacts are stale', () => {
    const tmpDir = makeTempDir();
    seedAiOsArtifacts(tmpDir);
    const snapshot = captureContextSnapshot(tmpDir, '0.10.0');
    writeContextSnapshot(tmpDir, snapshot);
    writeFile(tmpDir, '.github/ai-os/context/conventions.md', 'modified');

    const report = computeFreshnessReport(tmpDir);
    const formatted = formatFreshnessReport(report);
    expect(formatted).toContain('Stale Context Artifacts');
    expect(formatted).toContain('.github/ai-os/context/conventions.md');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
