import path from 'node:path';
import type { DetectedStack } from '../types.js';
import { getMcpToolsForStack } from '../mcp-tools.js';
import { writeIfChanged } from './utils.js';

interface McpServerConfig {
  type: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Shape of the committed `.github/copilot/mcp.json` file.
 * The `servers` field is intentionally absent — machine-specific node paths
 * must not be committed to VCS (they break the Copilot cloud agent and differ
 * across developer machines / nvm-managed installs).
 * The local server entry is written to `mcp.local.json` by install.sh.
 */
interface CommittedMcpJson {
  version: number;
  servers?: Record<string, McpServerConfig>;
}

/**
 * Shape of the local-only `.github/copilot/mcp.local.json` file.
 * Written by install.sh (not by the generator) and gitignored.
 * Contains the actual stdio server entry with the absolute node path.
 */
interface LocalMcpJson {
  version: number;
  /** servers is intentionally omitted from the committed mcp.json — it lives only
   *  in the gitignored mcp.local.json so the Copilot cloud agent is never broken. */
  servers?: Record<string, McpServerConfig>;
}

interface GenerateMcpOptions {
  refreshExisting?: boolean;
}

/** Returns absolute paths of all managed files. */
export function generateMcpJson(stack: DetectedStack, outputDir: string, _options?: GenerateMcpOptions): string[] {
  const allTools = getMcpToolsForStack(stack);

  // Committed file — no servers block so VCS-hosted copies and the Copilot cloud agent
  // never try to spawn a stdio process that relies on local runtime artifacts.
  // The local server entry is written separately by install.sh into mcp.local.json.
  const committedConfig: CommittedMcpJson = { version: 1 };
  const mcpJsonPath = path.join(outputDir, '.github', 'copilot', 'mcp.json');
  writeIfChanged(mcpJsonPath, JSON.stringify(committedConfig, null, 2));

  // Also write tool definitions for reference
  const toolsJsonPath = path.join(outputDir, '.github', 'ai-os', 'tools.json');
  writeIfChanged(toolsJsonPath, JSON.stringify(allTools, null, 2));

  return [mcpJsonPath, mcpLocalJsonPath, toolsJsonPath];
}
