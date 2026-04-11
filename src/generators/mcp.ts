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
  servers: Record<string, McpServerConfig>;
}

interface GenerateMcpOptions {
  refreshExisting?: boolean;
}

/** Returns absolute paths of all managed files. */
export function generateMcpJson(stack: DetectedStack, outputDir: string, _options?: GenerateMcpOptions): string[] {
  const mcpServerPath = path.join('.ai-os', 'mcp-server', 'index.js').replace(/\\/g, '/');

  const allTools = getMcpToolsForStack(stack);

  // Use the absolute node path detected at install time (env var set by install.sh) so
  // the MCP server can be spawned by VS Code even when node is managed by nvm/fnm/asdf.
  const nodeCommand = process.env['AI_OS_NODE_PATH'] ?? 'node';

  const config: McpJson = {
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

  const mcpJsonPath = path.join(outputDir, '.github', 'copilot', 'mcp.json');
  writeIfChanged(mcpJsonPath, JSON.stringify(config, null, 2));

  // Also write tool definitions for reference
  const toolsJsonPath = path.join(outputDir, '.github', 'ai-os', 'tools.json');
  writeIfChanged(toolsJsonPath, JSON.stringify(allTools, null, 2));

  return [mcpJsonPath, toolsJsonPath];
}
