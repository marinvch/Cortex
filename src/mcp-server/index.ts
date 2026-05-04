/**
 * AI OS MCP Server — powered by GitHub Copilot SDK
 *
 * This server runs as a subprocess when GitHub Copilot calls any registered tool.
 * It provides project-specific context tools to minimize token usage and hallucinations.
 *
 * Default mode: standalone JSON-RPC over stdio (no npm dependencies required).
 * Pass --copilot to use the Copilot SDK client integration (requires @github/copilot-sdk).
 *
 * Protocol: JSON-RPC over stdio (Copilot SDK protocol v3)
 * Requirements: Node.js >= 20
 * Note: @github/copilot-sdk is only required when passing --copilot flag
 */
import path from 'node:path';
import { getAllMcpTools, getActiveToolsForProject, type McpToolDefinition } from './tool-definitions.js';
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
  getActivePlan,
  upsertActivePlan,
  appendCheckpoint,
  closeCheckpoint,
  recordFailurePattern,
  compactSessionContext,
  recordToolCallAndRunWatchdog,
  setWatchdogThreshold,
  resetSessionState,
  syncHostedMemory,
  pruneMemory,
  getSessionContext,
  getRecommendations,
  suggestImprovements,
  getContextFreshness,
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
  objective?: string;
  acceptanceCriteria?: string;
  status?: string;
  currentStep?: string;
  nextStep?: string;
  blockers?: string;
  checkpointId?: string;
  notes?: string;
  tool?: string;
  errorSignature?: string;
  rootCause?: string;
  attemptedFix?: string;
  outcome?: string;
  confidence?: number;
  toolCallCount?: number;
  threshold?: number;
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

  const tools = getActiveToolsForProject(root);
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
  const watchdogMessage = recordToolCallAndRunWatchdog(toolName);

  let result: string;
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
    case 'get_memory_guidelines':
      result = getMemoryGuidelines();
      break;
    case 'get_repo_memory':
      result = getRepoMemory(input.query, input.category, input.limit);
      break;
    case 'remember_repo_fact':
      result = rememberRepoFact(input.title ?? '', input.content ?? '', input.category, input.tags);
      break;
    case 'get_active_plan':
      result = getActivePlan();
      break;
    case 'upsert_active_plan':
      result = upsertActivePlan(
        input.objective ?? '',
        input.acceptanceCriteria ?? '',
        input.status,
        input.currentStep,
        input.nextStep,
        input.blockers,
      );
      break;
    case 'append_checkpoint':
      result = appendCheckpoint(input.title ?? '', input.status, input.notes, input.toolCallCount);
      break;
    case 'close_checkpoint':
      result = closeCheckpoint(input.checkpointId ?? '', input.notes);
      break;
    case 'record_failure_pattern':
      result = recordFailurePattern(
        input.tool ?? '',
        input.errorSignature ?? '',
        input.rootCause ?? '',
        input.attemptedFix ?? '',
        input.outcome,
        input.confidence,
      );
      break;
    case 'compact_session_context':
      result = compactSessionContext();
      break;
    case 'set_watchdog_threshold':
      result = setWatchdogThreshold(typeof input.threshold === 'number' ? input.threshold : 8);
      break;
    case 'reset_session_state':
      result = resetSessionState();
      break;
    case 'sync_hosted_memory':
      result = syncHostedMemory();
      break;
    case 'prune_memory':
      result = pruneMemory();
      break;
    case 'get_session_context':
      result = getSessionContext();
      break;
    case 'get_recommendations':
      result = getRecommendations();
      break;
    case 'suggest_improvements':
      result = suggestImprovements();
      break;
    case 'get_context_freshness':
      result = getContextFreshness();
      break;
    default:
      result = `Unknown tool: ${toolName}`;
      break;
  }

  if (!watchdogMessage) {
    return result;
  }

  return `${result}\n\n[Watchdog] ${watchdogMessage}`;
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

  // ── Copilot SDK mode (--copilot flag) ─────────────────────────────────────
  const health = validateRuntimeEnvironment();
  for (const message of health.messages) {
    logDiagnostic(message);
  }

  if (!health.ok) {
    throw new Error(`MCP runtime validation failed: ${health.messages.join(' | ')}`);
  }

  let CopilotClient: new () => {
    start(): Promise<void>;
    stop(): Promise<unknown>;
    createSession(opts: {
      model: string;
      tools: Array<{ name: string; description: string; parameters: Record<string, unknown>; handler: (input: ToolInput) => Promise<string> }>;
      onPermissionRequest: (_req: unknown) => { kind: 'approved' };
    }): Promise<{ disconnect(): Promise<void> }>;
  };

  try {
    const sdk = await import('@github/copilot-sdk');
    CopilotClient = sdk.CopilotClient;
  } catch {
    console.error('[ai-os:mcp] @github/copilot-sdk is required for --copilot mode but was not found.');
    console.error('[ai-os:mcp] Install it or omit --copilot to use standalone JSON-RPC mode.');
    process.exit(1);
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
    tools: getActiveToolsForProject(getProjectRoot()).map((tool: McpToolDefinition) => ({
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
      tools: getActiveToolsForProject(getProjectRoot()).map((tool: McpToolDefinition) => ({
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

    const toolExists = getActiveToolsForProject(getProjectRoot()).some((tool: McpToolDefinition) => tool.name === toolName);
    if (!toolExists) {
      sendError(id, -32601, `Unknown tool: ${toolName}`);
      return;
    }

    try {
      const result = executeTool(toolName, input);
      sendResponse(id, { content: [{ type: 'text', text: result }] });
    } catch (err) {
      // Per MCP spec 2025-11-25: tool execution errors should be returned as
      // a successful JSON-RPC response with isError:true to enable model self-correction.
      const message = err instanceof Error ? err.message : String(err);
      sendResponse(id, { content: [{ type: 'text', text: message }], isError: true });
    }
    return;
  }

  if (method === 'initialize') {
    sendResponse(id, {
      protocolVersion: '2025-11-25',
      capabilities: { tools: {} },
      serverInfo: {
        name: 'ai-os',
        version: '0.11.0',
        description: 'AI OS — project-specific context, memory, and session continuity tools for GitHub Copilot',
      },
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
