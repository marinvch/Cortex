/**
 * agents-canonical.test.ts
 *
 * TDD test for Task 4: AGENTS.md is always written as the canonical primary artifact.
 *
 * Real apply entry: runApply(args: ParsedArgs) from actions/apply.ts
 * We call it with dryRun: true so the MCP runtime installation (which needs a
 * real bundled binary + healthcheck) is bypassed, while all generator writes
 * are captured in-memory via setDryRunMode / getDryRunCaptures.
 *
 * Additionally we test generateCanonicalAgentsMd directly as a unit test of the
 * pure generator function.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `cortex-agents-canonical-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function minimalParsedArgs(cwd: string): import('../cli/args.js').ParsedArgs {
  return {
    cwd,
    dryRun: true,        // skip MCP runtime install; writes captured in-memory
    mode: 'safe',
    action: 'apply',
    prune: false,
    verbose: false,
    cleanUpdate: false,
    regenerateContext: false,
    pruneCustomArtifacts: false,
    profile: null,
    json: false,
    fullDiff: false,
    editorTargets: ['vscode'],
    model: 'copilot',    // concrete adapter — 'auto' must NOT reach generators
    incremental: false,
    specDir: undefined,
  };
}

// ── Unit: generateCanonicalAgentsMd ─────────────────────────────────────────

describe('generateCanonicalAgentsMd (unit)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    // Minimal .github dir so generators don't throw
    fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns non-empty Markdown string for a minimal project', async () => {
    const { generateCanonicalAgentsMd } = await import('../generators/instructions.js');
    const { analyze } = await import('../analyze.js');

    // Write a minimal package.json so analyze can detect the project
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-canonical', version: '0.0.1' }),
      'utf-8',
    );

    const stack = analyze(tmpDir);
    const content = generateCanonicalAgentsMd(stack, tmpDir);

    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
    // Must not contain unreplaced template placeholders
    expect(content).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it('does NOT enforce the 8 KB copilot size cap', async () => {
    const { generateCanonicalAgentsMd } = await import('../generators/instructions.js');
    const { analyze } = await import('../analyze.js');

    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-canonical', version: '0.0.1' }),
      'utf-8',
    );

    const stack = analyze(tmpDir);
    const content = generateCanonicalAgentsMd(stack, tmpDir);

    // AGENTS.md must NOT contain the Copilot truncation notice
    expect(content).not.toContain('[Cortex] content trimmed');
    expect(content).not.toContain('truncated to 8 KB Copilot budget');
  });
});

// ── Integration: runApply emits AGENTS.md ────────────────────────────────────

describe('AGENTS.md canonical (integration via runApply dry-run)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-agents-canonical', version: '0.0.1' }),
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runApply dry-run captures AGENTS.md as a planned write', async () => {
    // Use getDryRunCaptures to inspect planned writes without touching disk.
    const { runApply } = await import('../actions/apply.js');
    const { setDryRunMode, getDryRunCaptures } = await import('../generators/utils.js');

    // Reset capture buffer before the run
    setDryRunMode(false);

    await runApply(minimalParsedArgs(tmpDir));

    // In dry-run mode, runApply activates capture mode internally and returns early
    // after printing the diff. The captures include all planned writes.
    const captures = getDryRunCaptures();
    const agentsMdCapture = captures.find(c => c.filePath.endsWith('AGENTS.md'));

    expect(agentsMdCapture, 'AGENTS.md must appear in dry-run captures').toBeDefined();
    expect(agentsMdCapture?.newContent).toBeTruthy();
    expect(agentsMdCapture?.newContent).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it('AGENTS.md is always captured regardless of adapter selection (claude model)', async () => {
    const { runApply } = await import('../actions/apply.js');
    const { setDryRunMode, getDryRunCaptures } = await import('../generators/utils.js');

    setDryRunMode(false);

    const args = minimalParsedArgs(tmpDir);
    args.model = 'claude';   // non-copilot adapter — AGENTS.md must still be emitted

    await runApply(args);

    const captures = getDryRunCaptures();
    const agentsMdCapture = captures.find(c => c.filePath.endsWith('AGENTS.md'));
    expect(agentsMdCapture, 'AGENTS.md must be emitted regardless of adapter').toBeDefined();
  });
});
