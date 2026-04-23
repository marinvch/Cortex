import fs from 'node:fs';
import path from 'node:path';
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

/**
 * Reads the project's tools.json and returns only the stack-eligible active tools.
 * When strictStackFiltering is enabled (default), tools.json contains
 * { activeTools: [...], availableButInactive: [...] }.
 * Falls back to the full tool catalog if tools.json is missing or uses the legacy flat format.
 */
export function getActiveToolsForProject(projectRoot: string): McpToolDefinition[] {
  const toolsJsonPath = path.join(projectRoot, '.github', 'ai-os', 'tools.json');
  if (!fs.existsSync(toolsJsonPath)) {
    return getAllMcpTools();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(toolsJsonPath, 'utf-8'));
  } catch {
    return getAllMcpTools();
  }

  // New format: { activeTools: McpToolDefinition[], availableButInactive: McpToolDefinition[] }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj['activeTools'])) {
      return (obj['activeTools'] as McpToolDefinition[]).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    }
  }

  // Legacy flat array format — return as-is
  if (Array.isArray(parsed)) {
    return (parsed as McpToolDefinition[]).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  return getAllMcpTools();
}
