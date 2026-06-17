import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectDrift, formatDriftReport } from '../detectors/drift.js';

describe('detectDrift', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'drift-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports missing copilot-instructions.md as error', () => {
    const report = detectDrift(tmpDir);
    expect(report.errors.some(e => e.path.includes('copilot-instructions.md') && e.kind === 'missing')).toBe(true);
  });

  it('reports missing mcp config as error', () => {
    const report = detectDrift(tmpDir);
    expect(report.errors.some(e => e.kind === 'missing' && e.message.includes('MCP'))).toBe(true);
  });

  it('reports unreplaced template placeholder as error', () => {
    mkdirSync(join(tmpDir, '.github'), { recursive: true });
    writeFileSync(join(tmpDir, '.github', 'copilot-instructions.md'), '# Instructions\n{{SKILL_ROUTING}}\n');
    const report = detectDrift(tmpDir);
    expect(report.errors.some(e => e.kind === 'schema-mismatch' && e.message.includes('SKILL_ROUTING'))).toBe(true);
  });

  it('reports stale context snapshot as warning when older than 7 days', () => {
    mkdirSync(join(tmpDir, '.github', 'ai-os'), { recursive: true });
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(tmpDir, '.github', 'ai-os', 'context-snapshot.json'),
      JSON.stringify({ generatedAt: old })
    );
    const report = detectDrift(tmpDir);
    expect(report.warnings.some(w => w.kind === 'stale' && w.path.includes('context-snapshot.json'))).toBe(true);
  });

  it('returns healthy list for copilot-instructions.md when present and valid', () => {
    mkdirSync(join(tmpDir, '.github'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.github', 'copilot-instructions.md'),
      '# Valid instructions\n\nNo placeholders here.'
    );
    const report = detectDrift(tmpDir);
    expect(report.healthy).toContain('.github/copilot-instructions.md');
  });

  it('totalIssues equals errors + warnings + infos count', () => {
    const report = detectDrift(tmpDir);
    const total = report.errors.length + report.warnings.length + report.infos.length;
    expect(report.totalIssues).toBe(total);
  });

  it('does NOT report snapshot warning when snapshot is fresh (within 7 days)', () => {
    mkdirSync(join(tmpDir, '.github', 'ai-os'), { recursive: true });
    const fresh = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(tmpDir, '.github', 'ai-os', 'context-snapshot.json'),
      JSON.stringify({ generatedAt: fresh })
    );
    const report = detectDrift(tmpDir);
    expect(report.warnings.some(w => w.path.includes('context-snapshot.json'))).toBe(false);
  });

  it('reports valid mcp config as healthy', () => {
    mkdirSync(join(tmpDir, '.vscode'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.vscode', 'mcp.json'),
      JSON.stringify({ servers: { 'ai-os': { type: 'stdio', command: 'node', args: [] } } })
    );
    const report = detectDrift(tmpDir);
    expect(report.healthy.some(h => h.includes('mcp.json'))).toBe(true);
  });

  it('formatDriftReport shows all-clear message when no issues', () => {
    const report = {
      scannedAt: new Date().toISOString(),
      totalIssues: 0,
      errors: [],
      warnings: [],
      infos: [],
      healthy: ['.github/copilot-instructions.md'],
    };
    const output = formatDriftReport(report);
    expect(output).toContain('healthy');
  });

  // ── Semantic drift tests ────────────────────────────────────────────────────

  it('reports semantic mismatch when config primaryFramework does not appear in instructions', () => {
    mkdirSync(join(tmpDir, '.github', 'ai-os'), { recursive: true });
    mkdirSync(join(tmpDir, '.github'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.github', 'ai-os', 'config.json'),
      JSON.stringify({ primaryFramework: 'React', primaryLanguage: 'TypeScript' })
    );
    writeFileSync(
      join(tmpDir, '.github', 'copilot-instructions.md'),
      '# Instructions\n\nThis project uses Vue.js.\n'
    );
    const report = detectDrift(tmpDir);
    expect(report.warnings.some(w => w.kind === 'semantic-mismatch' && w.message.toLowerCase().includes('react'))).toBe(true);
  });

  it('does NOT report semantic mismatch when primaryFramework appears in instructions', () => {
    mkdirSync(join(tmpDir, '.github', 'ai-os'), { recursive: true });
    mkdirSync(join(tmpDir, '.github'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.github', 'ai-os', 'config.json'),
      JSON.stringify({ primaryFramework: 'React', primaryLanguage: 'TypeScript' })
    );
    writeFileSync(
      join(tmpDir, '.github', 'copilot-instructions.md'),
      '# Instructions\n\nThis project uses React and TypeScript.\n'
    );
    const report = detectDrift(tmpDir);
    expect(report.warnings.some(w => w.kind === 'semantic-mismatch')).toBe(false);
  });

  it('reports semantic mismatch when existing-ai-context.md agent count differs from agent file count', () => {
    mkdirSync(join(tmpDir, '.github', 'ai-os', 'context'), { recursive: true });
    mkdirSync(join(tmpDir, '.github', 'agents'), { recursive: true });
    // existing-ai-context.md records 3 agents, but only 1 .agent.md file exists
    writeFileSync(
      join(tmpDir, '.github', 'ai-os', 'context', 'existing-ai-context.md'),
      '# Existing AI Context\n\n```\n  "agents" : 3\n```\n'
    );
    writeFileSync(join(tmpDir, '.github', 'agents', 'my-agent.agent.md'), '## Goal\nDo things\n## Constraints\nNone');
    const report = detectDrift(tmpDir);
    expect(report.warnings.some(w => w.kind === 'semantic-mismatch' && w.message.toLowerCase().includes('agent'))).toBe(true);
  });

  it('does NOT report agent count mismatch when counts match', () => {
    mkdirSync(join(tmpDir, '.github', 'ai-os', 'context'), { recursive: true });
    mkdirSync(join(tmpDir, '.github', 'agents'), { recursive: true });
    // existing-ai-context.md records 1 agent, and 1 .agent.md file exists
    writeFileSync(
      join(tmpDir, '.github', 'ai-os', 'context', 'existing-ai-context.md'),
      '# Existing AI Context\n\n```\n  "agents" : 1\n```\n'
    );
    writeFileSync(join(tmpDir, '.github', 'agents', 'my-agent.agent.md'), '## Goal\nDo things\n## Constraints\nNone');
    const report = detectDrift(tmpDir);
    expect(report.warnings.some(w => w.kind === 'semantic-mismatch' && w.message.toLowerCase().includes('agent'))).toBe(false);
  });
});
