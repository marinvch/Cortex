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

/** Runtime type guard for a single MCP tool definition entry in tools.json. */
export function isMcpToolDefinition(obj: unknown): obj is McpToolDefinition {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o['name'] === 'string' && o['name'].length > 0 &&
    typeof o['description'] === 'string' &&
    typeof o['inputSchema'] === 'object' && o['inputSchema'] !== null &&
    (o['inputSchema'] as Record<string, unknown>)['type'] === 'object'
  );
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
      const valid = (obj['activeTools'] as unknown[]).filter((t): t is McpToolDefinition => {
        if (isMcpToolDefinition(t)) return true;
        console.warn(`⚠️  tools.json: skipping invalid tool entry — missing required fields (name/description/inputSchema.type).`);
        return false;
      });
      return valid.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    }
  }

  // Legacy flat array format
  if (Array.isArray(parsed)) {
    const valid = (parsed as unknown[]).filter((t): t is McpToolDefinition => {
      if (isMcpToolDefinition(t)) return true;
      console.warn(`⚠️  tools.json: skipping invalid tool entry — missing required fields (name/description/inputSchema.type).`);
      return false;
    });
    return valid.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  return getAllMcpTools();
}
