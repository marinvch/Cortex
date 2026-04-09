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

  const config: McpJson = {
    version: 1,
    servers: {
      'ai-os': {
        type: 'stdio',
        command: 'node',
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
