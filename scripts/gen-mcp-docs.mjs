#!/usr/bin/env node
/**
 * gen-mcp-docs.mjs — generates docs/mcp-tools.md from MCP_TOOL_DEFINITIONS.
 *
 * Requires a prior `npm run build` so dist/mcp-tools.js exists.
 * CI step: run this and fail if the working tree is dirty.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Import from the compiled output
const distPath = resolve(__dirname, '../dist/mcp-tools.js');
const distUrl = new URL(`file:///${distPath.replace(/\\/g, '/')}`);
const { MCP_TOOL_DEFINITIONS } = await import(distUrl);

// Build the markdown table rows — include every tool (condition-gated tools
// are noted as "conditional" so users know they may not appear in all repos)
const rows = MCP_TOOL_DEFINITIONS.map((tool) => {
  const conditioned = tool.condition && tool.condition.toString() !== '() => true' && !tool.condition.toString().includes('always');
  const purpose = conditioned
    ? `${tool.description} _(conditional — appears when stack is detected)_`
    : tool.description;
  return `| \`${tool.name}\` | ${purpose} |`;
});

const table = [
  '| Tool | Purpose |',
  '| --- | --- |',
  ...rows,
].join('\n');

const output = `# AI OS — MCP Tools Reference

> This file is auto-generated from \`src/mcp-tools.ts\` by \`scripts/gen-mcp-docs.mjs\`.
> Run \`npm run gen-mcp-docs\` to refresh after adding or editing tool definitions.

## Available Tools

${table}

## Session Start Protocol

At the start of every new Copilot session in an AI OS repo:

1. Call \`get_session_context\` → reloads MUST-ALWAYS rules and key commands
2. Call \`get_repo_memory\` → recovers durable architectural decisions
3. Call \`get_conventions\` → enforces local coding style

## MCP Server Modes

| Mode | How to invoke | Use case |
| --- | --- | --- |
| Standalone JSON-RPC stdio | default (no flag) | VS Code Copilot MCP integration |
| Copilot SDK client | \`--copilot\` flag | Copilot CLI integration |
| Health check | \`--healthcheck\` flag | Post-install validation |

\`\`\`bash
# Health check the MCP server
AI_OS_ROOT=. node .ai-os/mcp-server/index.js --healthcheck

# Debug mode
AI_OS_MCP_DEBUG=1 node .ai-os/mcp-server/index.js --healthcheck
\`\`\`

## Bundle Architecture

\`npm run bundle\` uses esbuild to produce \`dist/server.js\` — a single self-contained bundle with zero npm dependencies for the default standalone mode. \`@github/copilot-sdk\` is dynamically imported only when \`--copilot\` is passed. This file is committed and deployed as-is — no \`npm install\` required in target repos.
`;

const outPath = resolve(__dirname, '../docs/mcp-tools.md');
writeFileSync(outPath, output, 'utf-8');
console.log(`✅ docs/mcp-tools.md updated (${MCP_TOOL_DEFINITIONS.length} tools)`);
