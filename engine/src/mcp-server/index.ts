/**
 * AI OS MCP Server — SDK-first entry point.
 *
 * Default mode: @modelcontextprotocol/sdk McpServer over StdioServerTransport.
 * Each tool is registered via server.registerTool() with a Zod input schema
 * (see sdk-server.ts). The SDK auto-handles initialize, tools/list, tools/call,
 * prompts/list, prompts/get, and MCP protocol negotiation.
 *
 * Pass --healthcheck to validate the runtime environment and exit.
 *
 * Protocol: MCP 2025-11-25 (JSON-RPC over stdio via @modelcontextprotocol/sdk)
 * Requirements: Node.js >= 20
 */
import { getProjectRoot } from './utils.js';
import { getActiveToolsForProject } from './tool-definitions.js';
import { runSdkMcp } from './sdk-server.js';
import { ENV } from '../brand.js';

function logDiagnostic(message: string): void {
  if (process.env[ENV.MCP_DEBUG] === '1') {
    console.error(`[cortex:mcp] ${message}`);
  }
}

function validateRuntimeEnvironment(): { ok: boolean; messages: string[] } {
  const messages: string[] = [];

  const root = getProjectRoot();
  if (!root) {
    messages.push('CORTEX_ROOT resolved to an empty path.');
  }

  const tools = getActiveToolsForProject(root);
  if (tools.length === 0) {
    messages.push('No MCP tools were registered at runtime.');
  }

  if (process.env[ENV.MCP_DEBUG] === '1') {
    messages.push(`Resolved CORTEX_ROOT: ${root}`);
    messages.push(`Registered tools: ${tools.length}`);
  }

  return { ok: messages.filter((msg) => !msg.startsWith('Resolved ') && !msg.startsWith('Registered ')).length === 0, messages };
}

async function main(): Promise<void> {
  if (process.argv.includes('--healthcheck')) {
    const health = validateRuntimeEnvironment();
    if (!health.ok) {
      for (const message of health.messages) {
        console.error(`[cortex:mcp:healthcheck] ${message}`);
      }
      process.exit(1);
    }

    console.error('[cortex:mcp:healthcheck] OK');
    process.exit(0);
  }

  // Default mode: MCP SDK server over stdio
  logDiagnostic('Starting in MCP SDK stdio mode');
  await runSdkMcp();
}

main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[cortex:mcp] Fatal error: ${msg}`);
  process.exit(1);
});
