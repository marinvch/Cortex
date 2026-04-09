import fs from 'node:fs';
import path from 'node:path';
import type { DetectedStack } from '../types.js';
import { getMcpToolsForStack } from '../mcp-tools.js';

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

export function generateMcpJson(stack: DetectedStack, outputDir: string, _options?: GenerateMcpOptions): void {
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

  const copilotDir = path.join(outputDir, '.github', 'copilot');
  fs.mkdirSync(copilotDir, { recursive: true });
  fs.writeFileSync(
    path.join(copilotDir, 'mcp.json'),
    JSON.stringify(config, null, 2),
    'utf-8'
  );

  // Also write tool definitions for reference
  const aiOsDir = path.join(outputDir, '.github', 'ai-os');
  fs.mkdirSync(aiOsDir, { recursive: true });
  fs.writeFileSync(
    path.join(aiOsDir, 'tools.json'),
    JSON.stringify(allTools, null, 2),
    'utf-8'
  );
}
