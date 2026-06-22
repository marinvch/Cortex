/**
 * AI OS Doctor Unit Tests
 *
 * Tests the health-check functions in src/doctor.ts using a temporary
 * directory so that no real filesystem side-effects reach the repo.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG_DIR } from '../brand.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ai-os-doctor-${prefix}-`));
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function writeCliMcpConfig(tmpDir: string, server: Record<string, unknown>): void {
  writeFile(
    path.join(tmpDir, '.mcp.json'),
    JSON.stringify({ mcpServers: { 'cortex': server } }),
  );
}

function writeVsCodeMcpConfig(tmpDir: string, server: Record<string, unknown>): void {
  writeFile(
    path.join(tmpDir, '.vscode', 'mcp.json'),
    JSON.stringify({ servers: { 'cortex': server } }),
  );
}

// ---------------------------------------------------------------------------
// runDoctor — structural checks (no MCP runtime healthcheck)
// ---------------------------------------------------------------------------

describe('runDoctor', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir('run');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns a result with the expected check names', async () => {
    const { runDoctor } = await import('../doctor.js');
    const result = runDoctor(tmpDir);

    const names = result.checks.map(c => c.name);
    expect(names).toContain('MCP runtime binary present (.github/cortex/mcp-server/index.js)');
    expect(names).toContain('MCP runtime healthcheck');
    expect(names).toContain('Copilot CLI MCP config present (.mcp.json)');
    expect(names).toContain('cortex CLI server entry in MCP config');
    expect(names).toContain('Copilot CLI MCP command resolves');
    expect(names).toContain('VS Code MCP config present (.vscode/mcp.json)');
    expect(names).toContain('cortex VS Code server entry in MCP config');
    expect(names).toContain('VS Code MCP command resolves');
    expect(names).toContain('Cortex config present (.github/cortex/config.json)');
    expect(names).toContain('MCP tools catalog present (.github/cortex/tools.json)');
    expect(names).toContain('Cortex skills deployed');
  });

  it('has criticalFailures > 0 when no files are present', async () => {
    const { runDoctor } = await import('../doctor.js');
    const result = runDoctor(tmpDir);
    expect(result.criticalFailures).toBeGreaterThan(0);
  });

  it('includes toolVersion in the result', async () => {
    const { runDoctor } = await import('../doctor.js');
    const result = runDoctor(tmpDir);
    expect(typeof result.toolVersion).toBe('string');
    expect(result.toolVersion.length).toBeGreaterThan(0);
  });

  it('returns cwd in the result', async () => {
    const { runDoctor } = await import('../doctor.js');
    const result = runDoctor(tmpDir);
    expect(result.cwd).toBe(tmpDir);
  });

  it('passes MCP runtime check when the file exists', async () => {
    const { runDoctor } = await import('../doctor.js');
    const runtimePath = path.join(tmpDir, CONFIG_DIR, 'mcp-server', 'index.js');
    writeFile(runtimePath, '// stub');
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'MCP runtime binary present (.github/cortex/mcp-server/index.js)');
    expect(check?.passed).toBe(true);
  });

  it('fails MCP runtime check when the file is absent', async () => {
    const { runDoctor } = await import('../doctor.js');
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'MCP runtime binary present (.github/cortex/mcp-server/index.js)');
    expect(check?.passed).toBe(false);
    expect(check?.critical).toBe(true);
    expect(check?.fixCommand).toContain('--refresh-existing');
  });

  it('passes Copilot CLI MCP config check when .mcp.json exists', async () => {
    const { runDoctor } = await import('../doctor.js');
    writeCliMcpConfig(tmpDir, { type: 'stdio', command: 'node', args: [] });
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'Copilot CLI MCP config present (.mcp.json)');
    expect(check?.passed).toBe(true);
  });

  it('fails Copilot CLI MCP config check when .mcp.json is absent', async () => {
    const { runDoctor } = await import('../doctor.js');
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'Copilot CLI MCP config present (.mcp.json)');
    expect(check?.passed).toBe(false);
    expect(check?.critical).toBe(true);
  });

  it('detects the cortex CLI server entry when present', async () => {
    const { runDoctor } = await import('../doctor.js');
    writeCliMcpConfig(tmpDir, { type: 'stdio', command: 'node', args: ['stub.js'] });
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'cortex CLI server entry in MCP config');
    expect(check?.passed).toBe(true);
  });

  it('fails CLI cortex entry check when mcpServers object is empty', async () => {
    const { runDoctor } = await import('../doctor.js');
    writeFile(path.join(tmpDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'cortex CLI server entry in MCP config');
    expect(check?.passed).toBe(false);
    expect(check?.fixCommand).toBeDefined();
  });

  it('passes Copilot CLI command-resolves check when script file exists', async () => {
    const { runDoctor } = await import('../doctor.js');
    const scriptPath = path.join(tmpDir, CONFIG_DIR, 'mcp-server', 'index.js');
    writeFile(scriptPath, '// stub');
    writeCliMcpConfig(tmpDir, {
      type: 'stdio',
      command: 'node',
      args: ['.github/cortex/mcp-server/index.js'],
    });
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'Copilot CLI MCP command resolves');
    expect(check?.passed).toBe(true);
  });

  it('fails Copilot CLI command-resolves check when script path does not exist', async () => {
    const { runDoctor } = await import('../doctor.js');
    writeCliMcpConfig(tmpDir, {
      type: 'stdio',
      command: 'node',
      args: ['.github/cortex/mcp-server/index.js'],
    });
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'Copilot CLI MCP command resolves');
    expect(check?.passed).toBe(false);
  });

  it('passes VS Code MCP config check when .vscode/mcp.json exists', async () => {
    const { runDoctor } = await import('../doctor.js');
    writeVsCodeMcpConfig(tmpDir, { type: 'stdio', command: 'node', args: [] });
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'VS Code MCP config present (.vscode/mcp.json)');
    expect(check?.passed).toBe(true);
  });

  it('fails VS Code MCP config check when .vscode/mcp.json is absent', async () => {
    const { runDoctor } = await import('../doctor.js');
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'VS Code MCP config present (.vscode/mcp.json)');
    expect(check?.passed).toBe(false);
    expect(check?.critical).toBe(true);
  });

  it('detects the cortex VS Code server entry when present', async () => {
    const { runDoctor } = await import('../doctor.js');
    writeVsCodeMcpConfig(tmpDir, { type: 'stdio', command: 'node', args: ['stub.js'] });
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'cortex VS Code server entry in MCP config');
    expect(check?.passed).toBe(true);
  });

  it('fails VS Code cortex entry check when servers object is empty', async () => {
    const { runDoctor } = await import('../doctor.js');
    writeFile(path.join(tmpDir, '.vscode', 'mcp.json'), JSON.stringify({ servers: {} }));
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'cortex VS Code server entry in MCP config');
    expect(check?.passed).toBe(false);
    expect(check?.fixCommand).toBeDefined();
  });

  it('passes VS Code command-resolves check when script file exists', async () => {
    const { runDoctor } = await import('../doctor.js');
    const scriptPath = path.join(tmpDir, CONFIG_DIR, 'mcp-server', 'index.js');
    writeFile(scriptPath, '// stub');
    writeVsCodeMcpConfig(tmpDir, {
      type: 'stdio',
      command: 'node',
      args: ['${workspaceFolder}/.github/cortex/mcp-server/index.js'],
    });
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'VS Code MCP command resolves');
    expect(check?.passed).toBe(true);
  });

  it('fails VS Code command-resolves check when script path does not exist', async () => {
    const { runDoctor } = await import('../doctor.js');
    writeVsCodeMcpConfig(tmpDir, {
      type: 'stdio',
      command: 'node',
      args: ['${workspaceFolder}/.github/cortex/mcp-server/index.js'],
    });
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'VS Code MCP command resolves');
    expect(check?.passed).toBe(false);
  });

  it('passes Cortex config check when config.json is valid JSON', async () => {
    const { runDoctor } = await import('../doctor.js');
    const configPath = path.join(tmpDir, CONFIG_DIR, 'config.json');
    writeFile(configPath, JSON.stringify({ version: '0.10.0' }));
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'Cortex config present (.github/cortex/config.json)');
    expect(check?.passed).toBe(true);
  });

  it('fails Cortex config check when config.json is invalid JSON', async () => {
    const { runDoctor } = await import('../doctor.js');
    const configPath = path.join(tmpDir, CONFIG_DIR, 'config.json');
    writeFile(configPath, '{invalid json}');
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'Cortex config present (.github/cortex/config.json)');
    expect(check?.passed).toBe(false);
    expect(check?.critical).toBe(false);
  });

  it('passes tools file check when tools.json is valid JSON', async () => {
    const { runDoctor } = await import('../doctor.js');
    const toolsPath = path.join(tmpDir, CONFIG_DIR, 'tools.json');
    writeFile(toolsPath, JSON.stringify({ activeTools: [] }));
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'MCP tools catalog present (.github/cortex/tools.json)');
    expect(check?.passed).toBe(true);
  });

  it('passes skills check when cortex-skill-creator directory exists', async () => {
    const { runDoctor } = await import('../doctor.js');
    const skillDir = path.join(tmpDir, '.agents', 'skills', 'cortex-skill-creator');
    fs.mkdirSync(skillDir, { recursive: true });
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'Cortex skills deployed');
    expect(check?.passed).toBe(true);
  });

  it('passes skills check when .github/copilot/skills directory exists', async () => {
    const { runDoctor } = await import('../doctor.js');
    const skillDir = path.join(tmpDir, '.github', 'copilot', 'skills');
    fs.mkdirSync(skillDir, { recursive: true });
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'Cortex skills deployed');
    expect(check?.passed).toBe(true);
  });

  it('fails skills check when no skill directory exists', async () => {
    const { runDoctor } = await import('../doctor.js');
    const result = runDoctor(tmpDir);
    const check = result.checks.find(c => c.name === 'Cortex skills deployed');
    expect(check?.passed).toBe(false);
    expect(check?.critical).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// printDoctorReport
// ---------------------------------------------------------------------------

describe('printDoctorReport', () => {
  it('returns exit code 1 when there are critical failures', async () => {
    const { printDoctorReport } = await import('../doctor.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = {
      cwd: '/tmp/test',
      toolVersion: '0.10.0',
      checks: [
        {
          name: 'MCP runtime binary present (.github/cortex/mcp-server/index.js)',
          critical: true,
          passed: false,
          detail: 'Not found',
          fixCommand: 'npx -y "github:marinvch/ai-os" --refresh-existing',
        },
      ],
      criticalFailures: 1,
      warnings: 0,
    };

    const code = printDoctorReport(result);
    expect(code).toBe(1);
    logSpy.mockRestore();
  });

  it('returns exit code 0 when only warnings exist', async () => {
    const { printDoctorReport } = await import('../doctor.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = {
      cwd: '/tmp/test',
      toolVersion: '0.10.0',
      checks: [
        {
          name: 'Cortex skills deployed',
          critical: false,
          passed: false,
          detail: 'No skill directory found',
          fixCommand: 'npx -y "github:marinvch/ai-os" --refresh-existing',
        },
      ],
      criticalFailures: 0,
      warnings: 1,
    };

    const code = printDoctorReport(result);
    expect(code).toBe(0);
    logSpy.mockRestore();
  });

  it('returns exit code 0 when all checks pass', async () => {
    const { printDoctorReport } = await import('../doctor.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = {
      cwd: '/tmp/test',
      toolVersion: '0.10.0',
      checks: [
        { name: 'Some check', critical: true, passed: true },
      ],
      criticalFailures: 0,
      warnings: 0,
    };

    const code = printDoctorReport(result);
    expect(code).toBe(0);
    logSpy.mockRestore();
  });

  it('prints fix commands for failed checks', async () => {
    const { printDoctorReport } = await import('../doctor.js');
    const lines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
      lines.push(String(msg ?? ''));
    });

    const result = {
      cwd: '/tmp/test',
      toolVersion: '0.10.0',
      checks: [
        {
          name: 'MCP runtime binary present (.github/cortex/mcp-server/index.js)',
          critical: true,
          passed: false,
          detail: 'Not found',
          fixCommand: 'npx -y "github:marinvch/ai-os" --refresh-existing',
        },
      ],
      criticalFailures: 1,
      warnings: 0,
    };

    printDoctorReport(result);
    const output = lines.join('\n');
    expect(output).toContain('--refresh-existing');
    expect(output).toContain('[CRITICAL]');
    logSpy.mockRestore();
  });
});
