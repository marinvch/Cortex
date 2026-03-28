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
}

async function main(): Promise<void> {
  const client = new CopilotClient();

  try {
    await client.start();
  } catch (err) {
    // If Copilot CLI is not available, fall back to standalone stdio MCP mode
    console.error('Copilot CLI not found — running in standalone mode');
    runStandaloneMcp();
    return;
  }

  const session = await client.createSession({
    model: 'gpt-4.1',
    tools: [
      {
        name: 'search_codebase',
        description: 'Search for patterns, symbols, or text across the project codebase. Returns matching file paths and snippets.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Pattern or text to search for' },
            filePattern: { type: 'string', description: 'Optional glob pattern (e.g. "*.ts")' },
            caseSensitive: { type: 'boolean', description: 'Case-sensitive search (default: false)' },
          },
          required: ['query'],
        },
        call: async (input: ToolInput) => {
          const result = searchFiles(
            input.query ?? '',
            input.filePattern,
            input.caseSensitive ?? false
          );
          return { content: [{ type: 'text', text: result }] };
        },
      },
      {
        name: 'get_project_structure',
        description: 'Returns an annotated file tree of the project. Skips node_modules/build/dist.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            depth: { type: 'number', description: 'Max depth (default: 4)' },
            path: { type: 'string', description: 'Subdirectory to start from' },
          },
        },
        call: async (input: ToolInput) => {
          const startDir = input.path
            ? path.join(getProjectRoot(), input.path)
            : getProjectRoot();
          const tree = buildFileTree(startDir, 0, input.depth ?? 4);
          return { content: [{ type: 'text', text: tree.join('\n') }] };
        },
      },
      {
        name: 'get_conventions',
        description: 'Returns the detected coding conventions for this project: naming rules, file structure, testing patterns.',
        inputSchema: { type: 'object' as const, properties: {} },
        call: async (_input: ToolInput) => {
          const conventions = readAiOsFile('context/conventions.md') || 'No conventions file found. Run ai-os install first.';
          return { content: [{ type: 'text', text: conventions }] };
        },
      },
      {
        name: 'get_stack_info',
        description: 'Returns the complete tech stack: languages, frameworks, key dependencies, build tools.',
        inputSchema: { type: 'object' as const, properties: {} },
        call: async (_input: ToolInput) => {
          const stack = readAiOsFile('context/stack.md') || 'No stack file found. Run ai-os install first.';
          return { content: [{ type: 'text', text: stack }] };
        },
      },
      {
        name: 'get_file_summary',
        description: 'Returns a token-efficient summary of a file: exports, imports, and first 30 lines.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            filePath: { type: 'string', description: 'File path relative to project root' },
          },
          required: ['filePath'],
        },
        call: async (input: ToolInput) => {
          const summary = getFileSummary(input.filePath ?? '');
          return { content: [{ type: 'text', text: summary }] };
        },
      },
      {
        name: 'get_prisma_schema',
        description: 'Returns the full Prisma schema. Read this before any DB model changes.',
        inputSchema: { type: 'object' as const, properties: {} },
        call: async (_input: ToolInput) => {
          const schema = getPrismaSchema();
          return { content: [{ type: 'text', text: schema }] };
        },
      },
      {
        name: 'get_trpc_procedures',
        description: 'Returns a summary of all tRPC procedures (name, type: public/private).',
        inputSchema: { type: 'object' as const, properties: {} },
        call: async (_input: ToolInput) => {
          const procedures = getTrpcProcedures();
          return { content: [{ type: 'text', text: procedures }] };
        },
      },
      {
        name: 'get_api_routes',
        description: 'Returns all API routes with HTTP methods and file paths.',
        inputSchema: {
          type: 'object' as const,
          properties: { filter: { type: 'string', description: 'Filter string (e.g. "auth")' } },
        },
        call: async (input: ToolInput) => {
          const routes = getApiRoutes(input.filter);
          return { content: [{ type: 'text', text: routes }] };
        },
      },
      {
        name: 'get_env_vars',
        description: 'Returns required environment variable names (never values). Shows which are set vs. missing.',
        inputSchema: { type: 'object' as const, properties: {} },
        call: async (_input: ToolInput) => {
          const vars = getEnvVars();
          return { content: [{ type: 'text', text: vars }] };
        },
      },
      {
        name: 'get_package_info',
        description: 'Returns installed package versions. Use before suggesting library usage to avoid API version mismatch.',
        inputSchema: {
          type: 'object' as const,
          properties: { packageName: { type: 'string', description: 'Specific package name (optional)' } },
        },
        call: async (input: ToolInput) => {
          const info = getPackageInfo(input.packageName);
          return { content: [{ type: 'text', text: info }] };
        },
      },
      {
        name: 'get_impact_of_change',
        description: 'Shows what files are affected when a given file changes. Returns direct importers and all transitively affected files. Use before editing any file to understand blast radius.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            filePath: { type: 'string', description: 'File path relative to project root (e.g. "src/types.ts")' },
          },
          required: ['filePath'],
        },
        call: async (input: ToolInput) => {
          const impact = getImpactOfChange(input.filePath ?? '');
          return { content: [{ type: 'text', text: impact }] };
        },
      },
      {
        name: 'get_dependency_chain',
        description: 'Shows the full dependency chain for a file: what it imports and what imports it, with export names. Use to understand how a module fits into the codebase.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            filePath: { type: 'string', description: 'File path relative to project root (e.g. "src/utils/auth.ts")' },
          },
          required: ['filePath'],
        },
        call: async (input: ToolInput) => {
          const chain = getDependencyChain(input.filePath ?? '');
          return { content: [{ type: 'text', text: chain }] };
        },
      },
      {
        name: 'check_for_updates',
        description: 'Checks if the AI OS artifacts installed in this repo are out of date. Returns update instructions when a newer version of AI OS is available.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
        call: async (_input: ToolInput) => {
          const status = checkForUpdates();
          return { content: [{ type: 'text', text: status }] };
        },
      },
    ],
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
      tools: [
        { name: 'search_codebase', description: 'Search codebase for patterns' },
        { name: 'get_project_structure', description: 'Get file tree' },
        { name: 'get_conventions', description: 'Get coding conventions' },
        { name: 'get_stack_info', description: 'Get tech stack' },
        { name: 'get_file_summary', description: 'Summarize a file' },
        { name: 'get_prisma_schema', description: 'Get Prisma schema' },
        { name: 'get_trpc_procedures', description: 'List tRPC procedures' },
        { name: 'get_api_routes', description: 'List all API routes' },
        { name: 'get_env_vars', description: 'List required env vars (no values)' },
        { name: 'get_package_info', description: 'Get package versions' },
        { name: 'get_impact_of_change', description: 'Show files affected when a file changes' },
        { name: 'get_dependency_chain', description: 'Show full import/export chain for a file' },
        { name: 'check_for_updates', description: 'Check if AI OS artifacts are out of date and need regenerating' },
      ],
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = (params?.name as string) ?? '';
    const input = (params?.arguments ?? {}) as ToolInput;

    let result = '';
    switch (toolName) {
      case 'search_codebase':
        result = searchFiles(input.query ?? '', input.filePattern, input.caseSensitive ?? false);
        break;
      case 'get_project_structure': {
        const startDir = input.path
          ? path.join(getProjectRoot(), input.path)
          : getProjectRoot();
        result = buildFileTree(startDir, 0, input.depth ?? 4).join('\n');
        break;
      }
      case 'get_conventions':
        result = readAiOsFile('context/conventions.md') || 'No conventions file found.';
        break;
      case 'get_stack_info':
        result = readAiOsFile('context/stack.md') || 'No stack file found.';
        break;
      case 'get_file_summary':
        result = getFileSummary(input.filePath ?? '');
        break;
      case 'get_prisma_schema':
        result = getPrismaSchema();
        break;
      case 'get_trpc_procedures':
        result = getTrpcProcedures();
        break;
      case 'get_api_routes':
        result = getApiRoutes(input.filter);
        break;
      case 'get_env_vars':
        result = getEnvVars();
        break;
      case 'get_package_info':
        result = getPackageInfo(input.packageName);
        break;
      case 'get_impact_of_change':
        result = getImpactOfChange(input.filePath ?? '');
        break;
      case 'get_dependency_chain':
        result = getDependencyChain(input.filePath ?? '');
        break;
      case 'check_for_updates':
        result = checkForUpdates();
        break;
      default:
        sendError(id, -32601, `Unknown tool: ${toolName}`);
        return;
    }

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
  console.error('MCP server error:', err);
  // Don't exit — fallback to standalone mode
  runStandaloneMcp();
});
