import { getAllMcpTools as getSharedMcpTools } from '../mcp-tools.js';

export interface McpToolSchema {
  type: 'object';
  properties: Record<string, { type: string; description: string }>;
  required?: string[];
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: McpToolSchema;
}

/**
 * Runtime MCP server consumes the exact same tool catalog as generators.
 * This prevents metadata drift between generated tools.json and runtime tools/list.
 */
export function getAllMcpTools(): McpToolDefinition[] {
  return getSharedMcpTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}
