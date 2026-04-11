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

interface McpJson {
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
  const mcpServerPath = path.join('.ai-os', 'mcp-server', 'index.js').replace(/\\/g, '/');

  const allTools = getMcpToolsForStack(stack);

  // ── Committed MCP config (.github/copilot/mcp.json) ──────────────────────
  // This file must NOT contain a `servers` block.  The Copilot cloud agent reads
  // it and will break if it sees a `servers` entry it cannot resolve.  Local VS
  // Code users get the `servers` block via the gitignored mcp.local.json below.
  const committedConfig: McpJson = {
    version: 1,
  };

  const mcpJsonPath = path.join(outputDir, '.github', 'copilot', 'mcp.json');
  writeIfChanged(mcpJsonPath, JSON.stringify(committedConfig, null, 2));

  // ── Local-only MCP config (.github/copilot/mcp.local.json) ───────────────
  // Gitignored — contains the `servers` block so local VS Code can spawn the
  // MCP server subprocess.  Users without Node.js simply ignore this file.
  // Use the absolute node path detected at install time (env var set by install.sh)
  // so the MCP server can be spawned by VS Code even when node is managed by nvm/fnm/asdf.
  const nodeCommand = process.env['AI_OS_NODE_PATH'] ?? 'node';

  const localConfig: McpJson = {
    version: 1,
    servers: {
      'ai-os': {
        type: 'stdio',
        command: nodeCommand,
        args: [mcpServerPath],
        env: {
          AI_OS_ROOT: '.',
        },
      },
    },
  };

  const mcpLocalJsonPath = path.join(outputDir, '.github', 'copilot', 'mcp.local.json');
  writeIfChanged(mcpLocalJsonPath, JSON.stringify(localConfig, null, 2));

  // Also write tool definitions for reference
  const toolsJsonPath = path.join(outputDir, '.github', 'ai-os', 'tools.json');
  writeIfChanged(toolsJsonPath, JSON.stringify(allTools, null, 2));

  return [mcpJsonPath, mcpLocalJsonPath, toolsJsonPath];
}
