import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'node:crypto';
import { computeSkillVersions } from '../generators/context-docs.js';
import { detectDrift } from '../detectors/drift.js';

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

describe('computeSkillVersions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'skill-ver-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty object when skills directory does not exist', () => {
    const versions = computeSkillVersions(tmpDir);
    expect(versions).toEqual({});
  });

  it('returns sha256 hash prefix for each installed skill', () => {
    const skillsDir = join(tmpDir, '.github', 'copilot', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    const content = '# My Skill\nThis is skill content.';
    writeFileSync(join(skillsDir, 'my-skill.md'), content, 'utf-8');

    const versions = computeSkillVersions(tmpDir);
    expect(versions['my-skill']).toBe(hashContent(content));
  });

  it('handles multiple skills', () => {
    const skillsDir = join(tmpDir, '.github', 'copilot', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, 'skill-a.md'), 'Content A', 'utf-8');
    writeFileSync(join(skillsDir, 'skill-b.md'), 'Content B', 'utf-8');

    const versions = computeSkillVersions(tmpDir);
    expect(Object.keys(versions)).toHaveLength(2);
    expect(versions['skill-a']).toBe(hashContent('Content A'));
    expect(versions['skill-b']).toBe(hashContent('Content B'));
  });

  it('ignores non-.md files in skills directory', () => {
    const skillsDir = join(tmpDir, '.github', 'copilot', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, 'skill.md'), 'Content', 'utf-8');
    writeFileSync(join(skillsDir, 'README.txt'), 'Ignore me', 'utf-8');
    writeFileSync(join(skillsDir, 'config.json'), '{}', 'utf-8');

    const versions = computeSkillVersions(tmpDir);
    expect(Object.keys(versions)).toHaveLength(1);
    expect(versions['skill']).toBeDefined();
  });

  it('returns different hashes for different content', () => {
    const skillsDir = join(tmpDir, '.github', 'copilot', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, 'skill-x.md'), 'Version 1 content', 'utf-8');

    const v1 = computeSkillVersions(tmpDir);
    const hash1 = v1['skill-x'];

    // Overwrite with different content
    writeFileSync(join(skillsDir, 'skill-x.md'), 'Version 2 content', 'utf-8');
    const v2 = computeSkillVersions(tmpDir);
    const hash2 = v2['skill-x'];

    expect(hash1).not.toBe(hash2);
  });
});

describe('detectDrift — skill version checking', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'skill-drift-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports missing skill as warning when tracked in config', () => {
    const aiOsDir = join(tmpDir, '.github', 'ai-os');
    mkdirSync(aiOsDir, { recursive: true });
    writeFileSync(join(aiOsDir, 'config.json'), JSON.stringify({
      skillVersions: { 'my-skill': 'abc123def456' },
    }), 'utf-8');

    const report = detectDrift(tmpDir);
    expect(report.warnings.some(w =>
      w.message.includes('my-skill') && w.kind === 'missing'
    )).toBe(true);
  });

  it('reports hash mismatch as warning when skill content changed', () => {
    const aiOsDir = join(tmpDir, '.github', 'ai-os');
    mkdirSync(aiOsDir, { recursive: true });
    const skillsDir = join(tmpDir, '.github', 'copilot', 'skills');
    mkdirSync(skillsDir, { recursive: true });

    const originalContent = 'Original skill content';
    const originalHash = hashContent(originalContent);
    writeFileSync(join(aiOsDir, 'config.json'), JSON.stringify({
      skillVersions: { 'my-skill': originalHash },
    }), 'utf-8');

    // Write DIFFERENT content to simulate modification
    writeFileSync(join(skillsDir, 'my-skill.md'), 'Modified skill content', 'utf-8');

    const report = detectDrift(tmpDir);
    expect(report.warnings.some(w =>
      w.message.includes('my-skill') && w.kind === 'stale'
    )).toBe(true);
  });

  it('reports healthy when skill hash matches', () => {
    const aiOsDir = join(tmpDir, '.github', 'ai-os');
    mkdirSync(aiOsDir, { recursive: true });
    const skillsDir = join(tmpDir, '.github', 'copilot', 'skills');
    mkdirSync(skillsDir, { recursive: true });

    const content = 'Unchanged skill content';
    const hash = hashContent(content);
    writeFileSync(join(aiOsDir, 'config.json'), JSON.stringify({
      skillVersions: { 'my-skill': hash },
    }), 'utf-8');
    writeFileSync(join(skillsDir, 'my-skill.md'), content, 'utf-8');

    const report = detectDrift(tmpDir);
    // No warnings about this skill
    expect(report.warnings.some(w => w.message.includes('my-skill'))).toBe(false);
    expect(report.healthy.some(h => h.includes('my-skill'))).toBe(true);
  });

  it('no skill version issues when skillVersions is empty or absent', () => {
    const aiOsDir = join(tmpDir, '.github', 'ai-os');
    mkdirSync(aiOsDir, { recursive: true });
    writeFileSync(join(aiOsDir, 'config.json'), JSON.stringify({}), 'utf-8');

    const report = detectDrift(tmpDir);
    // Should not have skill-related warnings from versioning
    expect(report.warnings.some(w => w.kind === 'stale' && w.path.includes('skills'))).toBe(false);
  });
});
