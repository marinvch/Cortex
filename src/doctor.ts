/**
 * AI OS Doctor
 *
 * Post-install health validation and repair-hint emitter.
 *
 * Checks:
 *  1. MCP runtime binary present  (.ai-os/mcp-server/index.js)
 *  2. MCP runtime healthcheck      (node index.js --healthcheck)
 *  3. Copilot CLI MCP config present           (.mcp.json)
 *  4. ai-os CLI server entry present           (.mcp.json → mcpServers.ai-os)
 *  5. Copilot CLI MCP command resolves         (command/args for mcpServers.ai-os)
 *  6. VS Code MCP config present               (.vscode/mcp.json)
 *  7. ai-os VS Code server entry present       (.vscode/mcp.json → servers.ai-os)
 *  8. VS Code MCP command resolves             (command/args for servers.ai-os)
 *  9. AI OS config present                     (.github/ai-os/config.json)
 * 10. Tools file present                       (.github/ai-os/tools.json)
 * 11. Skills deployed                          (.agents/skills/ai-os-skill-creator/ OR .github/copilot/skills/)
 *
 * Critical failures → exit code 1.
 * Warnings only     → exit code 0.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getToolVersion } from './updater.js';

export interface DoctorCheck {
  name: string;
  /** When true the overall doctor run exits non-zero if this check fails. */
  critical: boolean;
  passed: boolean;
  detail?: string;
  fixCommand?: string;
}

export interface DoctorResult {
  cwd: string;
  toolVersion: string;
  checks: DoctorCheck[];
  criticalFailures: number;
  warnings: number;
}

// ---------------------------------------------------------------------------
// Individual check helpers
// ---------------------------------------------------------------------------

function checkMcpRuntimeExists(cwd: string): DoctorCheck {
  const runtimePath = path.join(cwd, '.ai-os', 'mcp-server', 'index.js');
  const passed = fs.existsSync(runtimePath) && fs.statSync(runtimePath).isFile();
  return {
    name: 'MCP runtime binary present (.ai-os/mcp-server/index.js)',
    critical: true,
    passed,
    detail: passed
      ? runtimePath
      : `Expected runtime at ${runtimePath}`,
    fixCommand: passed
      ? undefined
      : `npx -y "github:marinvch/ai-os" --refresh-existing`,
  };
}

function checkMcpRuntimeHealthcheck(cwd: string): DoctorCheck {
  const runtimePath = path.join(cwd, '.ai-os', 'mcp-server', 'index.js');
  const nodePath = process.execPath;

  if (!fs.existsSync(runtimePath)) {
    return {
      name: 'MCP runtime healthcheck',
      critical: true,
      passed: false,
      detail: 'Runtime binary not found — skipping healthcheck.',
      fixCommand: `npx -y "github:marinvch/ai-os" --refresh-existing`,
    };
  }

  const result = spawnSync(nodePath, [runtimePath, '--healthcheck'], {
    cwd,
    env: { ...process.env, AI_OS_ROOT: cwd },
    encoding: 'utf-8',
    timeout: 10_000,
  });

  const passed = result.status === 0;
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();

  return {
    name: 'MCP runtime healthcheck',
    critical: true,
    passed,
    detail: passed
      ? 'Healthcheck passed'
      : `Exit code ${result.status ?? 'null'}${output ? `: ${output}` : ''}`,
    fixCommand: passed
      ? undefined
      : `npx -y "github:marinvch/ai-os" --refresh-existing`,
  };
}

type McpTopLevelKey = 'mcpServers' | 'servers';

interface McpCheckDefinition {
  configPath: string;
  displayName: string;
  topLevelKey: McpTopLevelKey;
  entryName: string;
  commandName: string;
}

interface McpConfig {
  mcpServers?: Record<string, { command?: string; args?: string[] }>;
  servers?: Record<string, { command?: string; args?: string[] }>;
}

function checkMcpConfigPresent(cwd: string, definition: McpCheckDefinition): DoctorCheck {
  const configPath = path.join(cwd, definition.configPath);
  const passed = fs.existsSync(configPath);
  return {
    name: definition.displayName,
    critical: true,
    passed,
    detail: passed ? configPath : `Expected at ${configPath}`,
    fixCommand: passed
      ? undefined
      : `npx -y "github:marinvch/ai-os" --refresh-existing`,
  };
}

function parseMcpConfig(cwd: string, configPath: string): McpConfig | null {
  const fullPath = path.join(cwd, configPath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as McpConfig;
  } catch {
    return null;
  }
}

function getServerEntry(config: McpConfig | null, topLevelKey: McpTopLevelKey): { command?: string; args?: string[] } | undefined {
  if (!config) return undefined;
  const servers = config[topLevelKey];
  return servers?.['ai-os'];
}

function checkMcpAiOsEntry(cwd: string, definition: McpCheckDefinition): DoctorCheck {
  const config = parseMcpConfig(cwd, definition.configPath);
  if (!config) {
    return {
      name: definition.entryName,
      critical: true,
      passed: false,
      detail: `${definition.configPath} missing or unparseable`,
      fixCommand: `npx -y "github:marinvch/ai-os" --refresh-existing`,
    };
  }
  const entry = getServerEntry(config, definition.topLevelKey);
  const passed = typeof entry === 'object';
  return {
    name: definition.entryName,
    critical: true,
    passed,
    detail: passed
      ? `${definition.topLevelKey}["ai-os"] entry found`
      : `No ${definition.topLevelKey}["ai-os"] entry in ${definition.configPath}`,
    fixCommand: passed
      ? undefined
      : `npx -y "github:marinvch/ai-os" --refresh-existing`,
  };
}

function checkMcpCommandResolves(cwd: string, definition: McpCheckDefinition): DoctorCheck {
  const config = parseMcpConfig(cwd, definition.configPath);
  const entry = getServerEntry(config, definition.topLevelKey);

  if (!entry) {
    return {
      name: definition.commandName,
      critical: true,
      passed: false,
      detail: `${definition.topLevelKey}["ai-os"] entry missing — cannot verify command path.`,
      fixCommand: `npx -y "github:marinvch/ai-os" --refresh-existing`,
    };
  }

  const command = entry.command ?? 'node';
  const args = entry.args ?? [];

  // Expand VS Code placeholder and then resolve relative CLI paths from repo root.
  const resolvedArgs = args.map(a =>
    a.replace(/\$\{workspaceFolder\}/g, cwd),
  );

  // The first arg (if any) is the script file; check it exists when command is 'node'
  const scriptArg = resolvedArgs[0];
  const resolvedScriptArg = scriptArg && !path.isAbsolute(scriptArg)
    ? path.resolve(cwd, scriptArg)
    : scriptArg;
  const normalizedCommand = path.basename(command).toLowerCase();
  if ((command === 'node' || command === process.execPath || normalizedCommand === 'node' || normalizedCommand === 'node.exe') && scriptArg) {
    const passed = resolvedScriptArg !== undefined && fs.existsSync(resolvedScriptArg) && fs.statSync(resolvedScriptArg).isFile();
    return {
      name: definition.commandName,
      critical: true,
      passed,
      detail: passed
        ? `Script exists: ${resolvedScriptArg}`
        : `Script not found: ${resolvedScriptArg}`,
      fixCommand: passed
        ? undefined
        : `npx -y "github:marinvch/ai-os" --refresh-existing`,
    };
  }

  // For non-node commands, just report the command string without filesystem check
  return {
    name: definition.commandName,
    critical: false,
    passed: true,
    detail: `Command: ${command} ${resolvedArgs.join(' ')} (non-node command, path not verified)`,
  };
}

function checkAiOsConfigPresent(cwd: string): DoctorCheck {
  const configPath = path.join(cwd, '.github', 'ai-os', 'config.json');
  if (!fs.existsSync(configPath)) {
    return {
      name: 'AI OS config present (.github/ai-os/config.json)',
      critical: false,
      passed: false,
      detail: `Expected at ${configPath}`,
      fixCommand: `npx -y "github:marinvch/ai-os"`,
    };
  }
  try {
    JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      name: 'AI OS config present (.github/ai-os/config.json)',
      critical: false,
      passed: true,
      detail: configPath,
    };
  } catch {
    return {
      name: 'AI OS config present (.github/ai-os/config.json)',
      critical: false,
      passed: false,
      detail: 'config.json exists but is not valid JSON',
      fixCommand: `npx -y "github:marinvch/ai-os" --refresh-existing`,
    };
  }
}

function checkToolsFilePresent(cwd: string): DoctorCheck {
  const toolsPath = path.join(cwd, '.github', 'ai-os', 'tools.json');
  if (!fs.existsSync(toolsPath)) {
    return {
      name: 'MCP tools catalog present (.github/ai-os/tools.json)',
      critical: false,
      passed: false,
      detail: `Expected at ${toolsPath}`,
      fixCommand: `npx -y "github:marinvch/ai-os" --refresh-existing`,
    };
  }
  try {
    JSON.parse(fs.readFileSync(toolsPath, 'utf-8'));
    return {
      name: 'MCP tools catalog present (.github/ai-os/tools.json)',
      critical: false,
      passed: true,
      detail: toolsPath,
    };
  } catch {
    return {
      name: 'MCP tools catalog present (.github/ai-os/tools.json)',
      critical: false,
      passed: false,
      detail: 'tools.json exists but is not valid JSON',
      fixCommand: `npx -y "github:marinvch/ai-os" --refresh-existing`,
    };
  }
}

function checkSkillsDeployed(cwd: string): DoctorCheck {
  // Accept skill-creator in either location (.agents/skills or .github/copilot/skills)
  const candidates = [
    path.join(cwd, '.agents', 'skills', 'ai-os-skill-creator'),
    path.join(cwd, '.github', 'copilot', 'skills'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return {
        name: 'AI OS skills deployed',
        critical: false,
        passed: true,
        detail: `Found: ${path.relative(cwd, candidate)}`,
      };
    }
  }

  return {
    name: 'AI OS skills deployed',
    critical: false,
    passed: false,
    detail: 'No ai-os skill directory found under .agents/skills/ or .github/copilot/skills/',
    fixCommand: `npx -y "github:marinvch/ai-os" --refresh-existing`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Run all doctor checks and return a structured result. */
export function runDoctor(cwd: string): DoctorResult {
  const cliConfig: McpCheckDefinition = {
    configPath: '.mcp.json',
    displayName: 'Copilot CLI MCP config present (.mcp.json)',
    topLevelKey: 'mcpServers',
    entryName: 'ai-os CLI server entry in MCP config',
    commandName: 'Copilot CLI MCP command resolves',
  };

  const vsCodeConfig: McpCheckDefinition = {
    configPath: path.join('.vscode', 'mcp.json'),
    displayName: 'VS Code MCP config present (.vscode/mcp.json)',
    topLevelKey: 'servers',
    entryName: 'ai-os VS Code server entry in MCP config',
    commandName: 'VS Code MCP command resolves',
  };

  const checks: DoctorCheck[] = [
    checkMcpRuntimeExists(cwd),
    checkMcpRuntimeHealthcheck(cwd),
    checkMcpConfigPresent(cwd, cliConfig),
    checkMcpAiOsEntry(cwd, cliConfig),
    checkMcpCommandResolves(cwd, cliConfig),
    checkMcpConfigPresent(cwd, vsCodeConfig),
    checkMcpAiOsEntry(cwd, vsCodeConfig),
    checkMcpCommandResolves(cwd, vsCodeConfig),
    checkAiOsConfigPresent(cwd),
    checkToolsFilePresent(cwd),
    checkSkillsDeployed(cwd),
  ];

  const criticalFailures = checks.filter(c => c.critical && !c.passed).length;
  const warnings = checks.filter(c => !c.critical && !c.passed).length;

  return {
    cwd,
    toolVersion: getToolVersion(),
    checks,
    criticalFailures,
    warnings,
  };
}

/** Print the doctor report to stdout and return the exit code. */
export function printDoctorReport(result: DoctorResult): number {
  const { checks, criticalFailures, warnings, toolVersion, cwd } = result;

  console.log(`  🩺 AI OS Doctor  v${toolVersion}`);
  console.log(`  📂 Target: ${cwd}`);
  console.log('');

  for (const check of checks) {
    const icon = check.passed ? '✅' : check.critical ? '❌' : '⚠️ ';
    const label = check.critical && !check.passed ? ' [CRITICAL]' : '';
    console.log(`  ${icon} ${check.name}${label}`);
    if (check.detail) {
      console.log(`       ${check.detail}`);
    }
    if (!check.passed && check.fixCommand) {
      console.log(`       Fix: ${check.fixCommand}`);
    }
  }

  console.log('');

  const total = checks.length;
  const passed = checks.filter(c => c.passed).length;

  if (criticalFailures === 0 && warnings === 0) {
    console.log(`  ✅ All ${total} checks passed — AI OS is healthy.`);
  } else if (criticalFailures > 0) {
    console.log(`  ❌ ${criticalFailures} critical failure(s), ${warnings} warning(s) — ${passed}/${total} checks passed.`);
    console.log('     Address critical failures before using AI OS tools.');
  } else {
    console.log(`  ⚠️  ${warnings} warning(s) — ${passed}/${total} checks passed.`);
    console.log('     Core MCP runtime is healthy; optional components may need attention.');
  }

  console.log('');

  return criticalFailures > 0 ? 1 : 0;
}
