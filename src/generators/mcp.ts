import fs from 'node:fs';
import path from 'node:path';
import type { DetectedStack, AiOsConfig } from '../types.js';
import { getMcpToolsForStack, getToolsWithStackSplit } from '../mcp-tools.js';
import { writeIfChanged } from './utils.js';

interface McpServerConfig {
  type: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface WriteMcpServerConfigOptions {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface GenerateMcpOptions {
  refreshExisting?: boolean;
  config?: AiOsConfig;
}

type JsonObject = Record<string, unknown>;

function readJsonObject(filePath: string): JsonObject {
  if (!fs.existsSync(filePath)) return {};

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    // Ignore parse errors and overwrite with a fresh object.
  }

  return {};
}

function writeJsonObject(filePath: string, data: JsonObject): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  return filePath;
}

function getServerMap(value: unknown): Record<string, McpServerConfig> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, McpServerConfig>;
  }

  return {};
}

function getServerEntry(
  defaultArgs: string[],
  defaultEnv: Record<string, string>,
  options?: WriteMcpServerConfigOptions,
): McpServerConfig {
  return {
    type: 'stdio',
    command: options?.command ?? 'node',
    args: options?.args ?? defaultArgs,
    env: options?.env ?? defaultEnv,
  };
}

/**
 * Merge-write an ai-os server entry into `.mcp.json`.
 * Preserves any other CLI MCP servers under the `mcpServers` top-level key.
 */
export function writeCopilotCliMcpConfig(outputDir: string, options?: WriteMcpServerConfigOptions): string {
  const mcpJsonPath = path.join(outputDir, '.mcp.json');
  const existing = readJsonObject(mcpJsonPath);
  const mcpServers = getServerMap(existing.mcpServers);

  mcpServers['ai-os'] = getServerEntry(
    ['.ai-os/mcp-server/index.js'],
    { AI_OS_ROOT: '.' },
    options,
  );

  existing.mcpServers = mcpServers;
  return writeJsonObject(mcpJsonPath, existing);
}

/**
 * Merge-write an ai-os server entry into `.vscode/mcp.json`.
 * Preserves any other servers the user may have configured.
 * Uses the VS Code MCP config format: `"servers"` top-level key.
 */
export function writeVsCodeMcpConfig(outputDir: string, options?: WriteMcpServerConfigOptions): string {
  const mcpJsonPath = path.join(outputDir, '.vscode', 'mcp.json');
  const existing = readJsonObject(mcpJsonPath);
  const servers = getServerMap(existing.servers);

  servers['ai-os'] = getServerEntry(
    ['${workspaceFolder}/.ai-os/mcp-server/index.js'],
    { AI_OS_ROOT: '${workspaceFolder}' },
    options,
  );

  existing.servers = servers;
  return writeJsonObject(mcpJsonPath, existing);
}

/**
 * AI OS emits both `.mcp.json` for Copilot CLI and `.vscode/mcp.json`
 * for VS Code / Copilot Chat so upgrades keep both surfaces working.
 */
export function writeMcpServerConfigs(outputDir: string, options?: WriteMcpServerConfigOptions): string[] {
  return [
    writeCopilotCliMcpConfig(outputDir, options),
    writeVsCodeMcpConfig(outputDir, options),
  ];
}

/** Returns absolute paths of all managed files (manifest-tracked). */
export function generateMcpJson(stack: DetectedStack, outputDir: string, options?: GenerateMcpOptions): string[] {
  // Default: strict stack filtering is ON unless explicitly disabled in config
  const strictFiltering = options?.config?.strictStackFiltering !== false;

  // Write both MCP config variants so AI OS works in Copilot CLI and VS Code.
  // installLocalMcpRuntime() rewrites the ai-os entry with the resolved local
  // Node executable path for reliable startup, especially on Windows.
  writeMcpServerConfigs(outputDir);

  // Write tool definitions for reference
  const toolsJsonPath = path.join(outputDir, '.github', 'ai-os', 'tools.json');

  if (strictFiltering) {
    // Strict mode: split tools into activeTools (stack-eligible) and availableButInactive
    const split = getToolsWithStackSplit(stack);
    writeIfChanged(toolsJsonPath, JSON.stringify(split, null, 2));
  } else {
    // Legacy flat array: all tools without filtering
    const allTools = getMcpToolsForStack(stack);
    writeIfChanged(toolsJsonPath, JSON.stringify(allTools, null, 2));
  }

  // `.mcp.json` and `.vscode/mcp.json` are intentionally NOT tracked in the AI
  // OS manifest because they are shared config files that may contain user-
  // added servers.
  return [toolsJsonPath];
}
