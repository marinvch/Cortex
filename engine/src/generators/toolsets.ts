/**
 * toolsets.ts — generates .vscode/toolsets.json for VS Code v1.101+ Tool Sets.
 *
 * Tool sets group related AI OS MCP tools so developers can quickly reference
 * them in chat with `#ai-os-context`, `#ai-os-explore`, etc.
 *
 * @see https://code.visualstudio.com/updates/v1_101#_chat-tool-sets
 */
import path from 'node:path';
import type { DetectedStack } from '../types.js';
import { writeIfChanged } from './utils.js';

interface ToolSet {
  tools: string[];
  description: string;
}

type ToolSetsConfig = Record<string, ToolSet>;

// ── Tool group constants ───────────────────────────────────────────────────────

const CONTEXT_TOOLS = [
  'get_session_context',
  'get_conventions',
  'get_repo_memory',
  'remember_repo_fact',
  'get_memory_guidelines',
  'get_context_freshness',
];

const EXPLORE_TOOLS = [
  'search_codebase',
  'get_project_structure',
  'get_file_summary',
  'get_stack_info',
  'get_impact_of_change',
  'get_dependency_chain',
];

const PLAN_TOOLS = [
  'get_active_plan',
  'upsert_active_plan',
  'append_checkpoint',
  'close_checkpoint',
  'compact_session_context',
  'record_failure_pattern',
];

// ── Backend tool set (stack-conditional) ──────────────────────────────────────

function hasBackendTools(stack: DetectedStack): boolean {
  const deps = stack.allDependencies;
  const frameworks = stack.frameworks.map((f) => f.name.toLowerCase());
  const hasPrisma = deps.includes('prisma') || deps.includes('@prisma/client');
  const hasTrpc = deps.includes('@trpc/server') || frameworks.includes('trpc');
  const hasApiFramework = frameworks.some((f) =>
    f.includes('next') ||
    f.includes('express') ||
    f.includes('fastapi') ||
    f.includes('django') ||
    f.includes('flask') ||
    f.includes('spring') ||
    f.includes('gin') ||
    f.includes('actix') ||
    f.includes('axum') ||
    f.includes('fastify') ||
    f.includes('hono') ||
    f.includes('nest'),
  );
  return hasPrisma || hasTrpc || hasApiFramework;
}

function buildBackendTools(stack: DetectedStack): string[] {
  const deps = stack.allDependencies;
  const frameworks = stack.frameworks.map((f) => f.name.toLowerCase());
  const tools: string[] = [];

  if (deps.includes('prisma') || deps.includes('@prisma/client')) {
    tools.push('get_prisma_schema');
  }
  if (deps.includes('@trpc/server') || frameworks.includes('trpc')) {
    tools.push('get_trpc_procedures');
  }
  tools.push('get_api_routes', 'get_env_vars', 'get_package_info');
  return tools;
}

// ── Main generator ─────────────────────────────────────────────────────────────

export function generateToolsets(stack: DetectedStack, outputDir: string): string[] {
  const managed: string[] = [];

  const config: ToolSetsConfig = {
    'ai-os-context': {
      tools: CONTEXT_TOOLS,
      description: 'AI OS context & memory tools — conventions, repo memory, freshness',
    },
    'ai-os-explore': {
      tools: EXPLORE_TOOLS,
      description: 'AI OS codebase navigation — search, structure, impact analysis',
    },
    'ai-os-plan': {
      tools: PLAN_TOOLS,
      description: 'AI OS session planning — active plan, checkpoints, failure tracking',
    },
  };

  if (hasBackendTools(stack)) {
    config['ai-os-backend'] = {
      tools: buildBackendTools(stack),
      description: 'AI OS backend tools — API routes, schema, env vars, packages',
    };
  }

  const toolsetsPath = path.join(outputDir, '.vscode', 'toolsets.json');
  writeIfChanged(toolsetsPath, JSON.stringify(config, null, 2) + '\n');
  managed.push(toolsetsPath);

  return managed;
}
