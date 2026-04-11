#!/usr/bin/env node
/**
 * AI OS MCP Server — powered by GitHub Copilot SDK
 *
 * This server runs as a subprocess when GitHub Copilot calls any registered tool.
 * It provides project-specific context tools to minimize token usage and hallucinations.
 *
 * Protocol: JSON-RPC over stdio (Copilot SDK protocol v3)
 * Requirements: Node.js >= 20, @github/copilot-sdk
 */
import { CopilotClient } from '@github/copilot-sdk';
import path from 'node:path';
import { getAllMcpTools, type McpToolDefinition } from './tool-definitions.js';
import {
  getProjectRoot,
  readAiOsFile,
  searchFiles,
  buildFileTree,
  getFileSummary,
  getPrismaSchema,
  getTrpcProcedures,
  getApiRoutes,
  getEnvVars,
  getPackageInfo,
  getImpactOfChange,
  getDependencyChain,
  checkForUpdates,
  getMemoryGuidelines,
  getRepoMemory,
  rememberRepoFact,
  getSessionContext,
  getRecommendations,
  suggestImprovements,
} from './utils.js';

interface ToolInput {
  query?: string;
  filePattern?: string;
  caseSensitive?: boolean;
  depth?: number;
  path?: string;
  filePath?: string;
  filter?: string;
  packageName?: string;
  category?: string;
  limit?: number;
  title?: string;
  content?: string;
  tags?: string;
}

function logDiagnostic(message: string): void {
  if (process.env['AI_OS_MCP_DEBUG'] === '1') {
    console.error(`[ai-os:mcp] ${message}`);
  }
}

function validateRuntimeEnvironment(): { ok: boolean; messages: string[] } {
  const messages: string[] = [];

  const root = getProjectRoot();
  if (!root) {
    messages.push('AI_OS_ROOT resolved to an empty path.');
  }

  const tools = getAllMcpTools();
  if (tools.length === 0) {
    messages.push('No MCP tools were registered at runtime.');
  }

  if (process.env['AI_OS_MCP_DEBUG'] === '1') {
    messages.push(`Resolved AI_OS_ROOT: ${root}`);
    messages.push(`Registered tools: ${tools.length}`);
  }

  return { ok: messages.filter((msg) => !msg.startsWith('Resolved ') && !msg.startsWith('Registered ')).length === 0, messages };
}

function executeTool(toolName: string, input: ToolInput): string {
  switch (toolName) {
    case 'search_codebase':
      return searchFiles(input.query ?? '', input.filePattern, input.caseSensitive ?? false);
    case 'get_project_structure': {
      const startDir = input.path
        ? path.join(getProjectRoot(), input.path)
        : getProjectRoot();
      return buildFileTree(startDir, 0, input.depth ?? 4).join('\n');
    }
    case 'get_conventions':
      return readAiOsFile('context/conventions.md') || 'No conventions file found.';
    case 'get_stack_info':
      return readAiOsFile('context/stack.md') || 'No stack file found.';
    case 'get_file_summary':
      return getFileSummary(input.filePath ?? '');
    case 'get_prisma_schema':
      return getPrismaSchema();
    case 'get_trpc_procedures':
      return getTrpcProcedures();
    case 'get_api_routes':
      return getApiRoutes(input.filter);
    case 'get_env_vars':
      return getEnvVars();
    case 'get_package_info':
      return getPackageInfo(input.packageName);
    case 'get_impact_of_change':
      return getImpactOfChange(input.filePath ?? '');
    case 'get_dependency_chain':
      return getDependencyChain(input.filePath ?? '');
    case 'check_for_updates':
      return checkForUpdates();
    case 'get_memory_guidelines':
      return getMemoryGuidelines();
    case 'get_repo_memory':
      return getRepoMemory(input.query, input.category, input.limit);
    case 'remember_repo_fact':
      return rememberRepoFact(input.title ?? '', input.content ?? '', input.category, input.tags);
    case 'get_session_context':
      return getSessionContext();
    case 'get_recommendations':
      return getRecommendations();
    case 'suggest_improvements':
      return suggestImprovements();
    default:
      return `Unknown tool: ${toolName}`;
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--healthcheck')) {
    const health = validateRuntimeEnvironment();
    if (!health.ok) {
      for (const message of health.messages) {
        console.error(`[ai-os:mcp:healthcheck] ${message}`);
      }
      process.exit(1);
    }

    console.error('[ai-os:mcp:healthcheck] OK');
    process.exit(0);
  }

  // Default mode: standalone JSON-RPC stdio (VS Code Copilot MCP integration).
  // Pass --copilot to use the Copilot SDK client integration instead.
  if (!process.argv.includes('--copilot')) {
    logDiagnostic('Starting in standalone JSON-RPC stdio mode');
    runStandaloneMcp();
    return;
  }

  const health = validateRuntimeEnvironment();
  for (const message of health.messages) {
    logDiagnostic(message);
  }

  if (!health.ok) {
    throw new Error(`MCP runtime validation failed: ${health.messages.join(' | ')}`);
  }

  const client = new CopilotClient();

  try {
    await client.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ai-os:mcp] Copilot SDK client failed to start: ${msg}`);
    console.error('[ai-os:mcp] Ensure the Copilot CLI is installed and authenticated, or omit --copilot to use standalone mode.');
    process.exit(1);
  }

  const session = await client.createSession({
    model: 'gpt-4.1',
    tools: getAllMcpTools().map((tool: McpToolDefinition) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as unknown as Record<string, unknown>,
      handler: async (input: ToolInput) => executeTool(tool.name, input),
    })),
    onPermissionRequest: (_req) => ({ kind: 'approved' as const }),
  });

  // Keep session alive until process is terminated
  process.on('SIGINT', async () => {
    await session.disconnect();
    await client.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await session.disconnect();
    await client.stop();
    process.exit(0);
  });
}

/**
 * Standalone MCP JSON-RPC over stdio mode (no Copilot CLI required).
 * Implements the MCP protocol subset needed for VS Code Copilot tool integration.
 */
function runStandaloneMcp(): void {
  // Ensure the process exits on SIGTERM/SIGINT so that the process.on('exit')
  // handler in utils.ts can release the .memory.lock file.  Without these
  // handlers Node.js would terminate via the default signal action which does
  // NOT emit the 'exit' event, leaving a stale lock on disk.
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));

  let buffer = '';

  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      handleJsonRpcMessage(trimmed);
    }
  });
}

function handleJsonRpcMessage(raw: string): void {
  let msg: { id?: string | number; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(raw) as typeof msg;
  } catch {
    return;
  }

  const { id, method, params } = msg;

  if (method === 'tools/list') {
    sendResponse(id, {
      tools: getAllMcpTools().map((tool: McpToolDefinition) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = (params?.name as string) ?? '';
    const input = (params?.arguments ?? {}) as ToolInput;

    const toolExists = getAllMcpTools().some((tool: McpToolDefinition) => tool.name === toolName);
    if (!toolExists) {
      sendError(id, -32601, `Unknown tool: ${toolName}`);
      return;
    }

    const result = executeTool(toolName, input);

    sendResponse(id, { content: [{ type: 'text', text: result }] });
    return;
  }

  if (method === 'initialize') {
    sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'ai-os', version: '0.1.0' },
    });
    return;
  }
}

function sendResponse(id: string | number | undefined, result: unknown): void {
  const msg = JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result });
  process.stdout.write(msg + '\n');
}

function sendError(id: string | number | undefined, code: number, message: string): void {
  const msg = JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  process.stdout.write(msg + '\n');
}

main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ai-os:mcp] Fatal error: ${msg}`);
  process.exit(1);
});
