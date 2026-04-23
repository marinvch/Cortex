import type { DetectedStack } from './types.js';

export interface McpToolSchema {
  type: 'object';
  properties: Record<string, { type: string; description: string }>;
  required?: string[];
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: McpToolSchema;
  condition?: (stack: DetectedStack) => boolean;
}

const always = (): boolean => true;

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'search_codebase',
    description: 'Search for patterns, symbols, or text across the project codebase. Respects .gitignore. Returns matching file paths and snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The pattern or text to search for' },
        filePattern: { type: 'string', description: 'Optional glob pattern to limit search (e.g. "*.ts", "src/**/*.py")' },
        caseSensitive: { type: 'boolean', description: 'Whether search is case-sensitive (default: false)' },
      },
      required: ['query'],
    },
    condition: always,
  },
  {
    name: 'get_project_structure',
    description: 'Returns an annotated file tree of the project (respects .gitignore, skips node_modules/build/dist). Useful for understanding project layout before making changes.',
    inputSchema: {
      type: 'object',
      properties: {
        depth: { type: 'number', description: 'Max directory depth to show (default: 4)' },
        path: { type: 'string', description: 'Subdirectory to start from (default: project root)' },
      },
    },
    condition: always,
  },
  {
    name: 'get_conventions',
    description: 'Returns the detected coding conventions for this project: naming rules, file structure, testing patterns, forbidden practices.',
    inputSchema: { type: 'object', properties: {} },
    condition: always,
  },
  {
    name: 'get_stack_info',
    description: 'Returns the complete tech stack inventory: languages, frameworks, key dependencies, build tools, and test setup.',
    inputSchema: { type: 'object', properties: {} },
    condition: always,
  },
  {
    name: 'get_file_summary',
    description: 'Returns a structured summary of a specific file: key exports, types, functions, and brief description. Token-efficient alternative to reading the full file.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to the file relative to project root' },
      },
      required: ['filePath'],
    },
    condition: always,
  },
  {
    name: 'get_prisma_schema',
    description: 'Returns the full Prisma schema file contents. Use before making any database model changes.',
    inputSchema: { type: 'object', properties: {} },
    condition: (stack) => stack.allDependencies.includes('prisma') || stack.allDependencies.includes('@prisma/client'),
  },
  {
    name: 'get_trpc_procedures',
    description: 'Returns a summary of all tRPC procedures (name, input type, public/private). Avoids reading the entire router file.',
    inputSchema: { type: 'object', properties: {} },
    condition: (stack) => {
      const frameworks = stack.frameworks.map((f) => f.name.toLowerCase());
      return stack.allDependencies.includes('@trpc/server') || frameworks.includes('trpc');
    },
  },
  {
    name: 'get_api_routes',
    description: 'Returns a list of API routes with HTTP methods using stack-aware discovery for Node, Java/Spring, Python, Go, and Rust patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional substring to filter routes (e.g. "auth", "webhook")' },
      },
    },
    condition: (stack) => {
      const frameworks = stack.frameworks.map((f) => f.name.toLowerCase());
      return frameworks.some((f) =>
        f.includes('next') ||
        f.includes('express') ||
        f.includes('fastapi') ||
        f.includes('django') ||
        f.includes('flask') ||
        f.includes('spring') ||
        f.includes('quarkus') ||
        f.includes('micronaut') ||
        f.includes('gin') ||
        f.includes('echo') ||
        f.includes('fiber') ||
        f.includes('chi') ||
        f.includes('actix') ||
        f.includes('axum') ||
        f.includes('rocket')
      );
    },
  },
  {
    name: 'get_env_vars',
    description: 'Returns all required environment variable names (from .env.example or code). Shows which are set vs. missing. Never returns values.',
    inputSchema: { type: 'object', properties: {} },
    condition: always,
  },
  {
    name: 'get_package_info',
    description: 'Returns installed package versions and direct dependencies. Useful before suggesting library usage to avoid API mismatch.',
    inputSchema: {
      type: 'object',
      properties: {
        packageName: { type: 'string', description: 'Optional: specific package to look up (e.g. "@trpc/server")' },
      },
    },
    condition: always,
  },
  {
    name: 'get_impact_of_change',
    description: 'Shows what files are affected when a given file changes. Returns direct importers and all transitively affected files.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'File path relative to project root (e.g. "src/types.ts")' },
      },
      required: ['filePath'],
    },
    condition: always,
  },
  {
    name: 'get_dependency_chain',
    description: 'Shows the full dependency chain for a file: what it imports and what imports it, with export names.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'File path relative to project root (e.g. "src/utils/auth.ts")' },
      },
      required: ['filePath'],
    },
    condition: always,
  },
  {
    name: 'check_for_updates',
    description: 'Checks if the AI OS artifacts installed in this repo are out of date. Returns update instructions when a newer version of AI OS is available.',
    inputSchema: { type: 'object', properties: {} },
    condition: always,
  },
  {
    name: 'get_memory_guidelines',
    description: 'Returns repository memory rules and memory usage protocol from .github/ai-os/context/memory.md.',
    inputSchema: { type: 'object', properties: {} },
    condition: always,
  },
  {
    name: 'get_repo_memory',
    description: 'Retrieves persisted repository memory entries from .github/ai-os/memory/memory.jsonl, optionally filtered by query/category.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional full-text query against title/content/tags' },
        category: { type: 'string', description: 'Optional category filter (e.g. architecture, conventions, pitfalls)' },
        limit: { type: 'number', description: 'Max entries to return (default: 10, max: 50)' },
      },
    },
    condition: always,
  },
  {
    name: 'remember_repo_fact',
    description: 'Stores a durable repository memory entry in .github/ai-os/memory/memory.jsonl using dedupe/upsert rules (marks superseded conflicts and avoids duplicate facts).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short memory title' },
        content: { type: 'string', description: 'Durable fact/decision/constraint' },
        category: { type: 'string', description: 'Category (e.g. conventions, architecture, build, testing, security)' },
        tags: { type: 'string', description: 'Optional comma-separated tags' },
      },
      required: ['title', 'content'],
    },
    condition: always,
  },
  {
    name: 'get_active_plan',
    description: 'Returns the persisted active session plan from .github/ai-os/memory/session/active-plan.json. Use after context resets to restore goals and avoid drift.',
    inputSchema: { type: 'object', properties: {} },
    condition: always,
  },
  {
    name: 'upsert_active_plan',
    description: 'Creates or updates the persisted active plan (objective, criteria, current/next step, blockers). This provides durable task state across context resets.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'Primary goal for the current task' },
        acceptanceCriteria: { type: 'string', description: 'Success criteria for task completion' },
        status: { type: 'string', description: 'Plan status: active, paused, or completed' },
        currentStep: { type: 'string', description: 'Current execution step' },
        nextStep: { type: 'string', description: 'Next planned action' },
        blockers: { type: 'string', description: 'Optional blockers, comma-separated or newline-separated' },
      },
      required: ['objective', 'acceptanceCriteria'],
    },
    condition: always,
  },
  {
    name: 'append_checkpoint',
    description: 'Appends a progress checkpoint to .github/ai-os/memory/session/checkpoints.jsonl to preserve intent and execution state during long tool-call sequences.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Checkpoint title' },
        status: { type: 'string', description: 'Checkpoint status: open or closed (default: open)' },
        notes: { type: 'string', description: 'Optional checkpoint notes' },
        toolCallCount: { type: 'number', description: 'Optional tool call count snapshot at checkpoint time' },
      },
      required: ['title'],
    },
    condition: always,
  },
  {
    name: 'close_checkpoint',
    description: 'Closes an existing checkpoint by id in .github/ai-os/memory/session/checkpoints.jsonl.',
    inputSchema: {
      type: 'object',
      properties: {
        checkpointId: { type: 'string', description: 'Checkpoint id returned by append_checkpoint' },
        notes: { type: 'string', description: 'Optional closing notes to append' },
      },
      required: ['checkpointId'],
    },
    condition: always,
  },
  {
    name: 'record_failure_pattern',
    description: 'Records or updates a failure pattern in .github/ai-os/memory/session/failure-ledger.jsonl to prevent repeating the same mistakes.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Tool or subsystem where failure occurred' },
        errorSignature: { type: 'string', description: 'Short normalized error signature' },
        rootCause: { type: 'string', description: 'Suspected or confirmed root cause' },
        attemptedFix: { type: 'string', description: 'Fix that was attempted' },
        outcome: { type: 'string', description: 'Result of the fix: unresolved, partial, or resolved' },
        confidence: { type: 'number', description: 'Confidence in diagnosis from 0.0 to 1.0' },
      },
      required: ['tool', 'errorSignature', 'rootCause', 'attemptedFix'],
    },
    condition: always,
  },
  {
    name: 'compact_session_context',
    description: 'Creates a compact session summary from active plan, open checkpoints, and recent failure patterns to reduce context stuffing and preserve continuity.',
    inputSchema: { type: 'object', properties: {} },
    condition: always,
  },
  // ── Tool #19: Session Continuity ─────────────────────────────────────────
  {
    name: 'get_session_context',
    description: 'Returns the compact session context card with MUST-ALWAYS rules, build/test commands, and key file locations. CALL THIS at the start of every new conversation to reload critical context after a session reset.',
    inputSchema: { type: 'object', properties: {} },
    condition: always,
  },
  // ── Tool #20: Recommendation Engine ──────────────────────────────────────
  {
    name: 'get_recommendations',
    description: 'Returns stack-appropriate recommendations: MCP servers, VS Code extensions, agent skills, and GitHub Copilot Extensions. Useful for setting up a new developer environment.',
    inputSchema: { type: 'object', properties: {} },
    condition: always,
  },
  // ── Tool #21: Improvement Suggestions ────────────────────────────────────
  {
    name: 'suggest_improvements',
    description: 'Analyzes project structure and memory entries to return architectural and tooling optimization suggestions (e.g. missing env var documentation, undocumented key paths, skills gaps).',
    inputSchema: { type: 'object', properties: {} },
    condition: always,
  },
  // ── Tool #22: Watchdog Configuration ─────────────────────────────────────
  {
    name: 'set_watchdog_threshold',
    description: 'Configures the automatic watchdog checkpoint interval for the current session (default: 8 tool calls). Increase for complex multi-step tasks; decrease for shorter focused work. Range: 1–100.',
    inputSchema: {
      type: 'object',
      properties: {
        threshold: { type: 'number', description: 'Number of tool calls between automatic watchdog checkpoints (1–100)' },
      },
      required: ['threshold'],
    },
    condition: always,
  },
  // ── Tool #23: Session State Reset ─────────────────────────────────────────
  {
    name: 'reset_session_state',
    description: 'Clears all session state files (active-plan.json, checkpoints.jsonl, failure-ledger.jsonl, runtime-state.json, compact-context.md) so a new branch or task starts from a clean slate. Durable repo memory (memory.jsonl) is never modified.',
    inputSchema: { type: 'object', properties: {} },
    condition: always,
  },
  // ── Tool #24: Sync Hosted Memory ──────────────────────────────────────────
  {
    name: 'sync_hosted_memory',
    description: 'Returns guidance and a prompt template for mirroring durable facts from Copilot hosted/in-context memory into .github/ai-os/memory/memory.jsonl. Lists existing entries to prevent duplication.',
    inputSchema: { type: 'object', properties: {} },
    condition: always,
  },
  // ── Tool #25: Context Freshness ───────────────────────────────────────────
  {
    name: 'get_context_freshness',
    description: 'Computes a freshness score (0–100) for AI OS context artifacts by comparing them against the stored context snapshot. Returns a list of stale artifacts, changed source files, and targeted sync recommendations. Run after structural code changes to detect context drift.',
    inputSchema: { type: 'object', properties: {} },
    condition: always,
  },
];

export function getMcpToolsForStack(stack: DetectedStack): Array<Omit<McpToolDefinition, 'condition'>> {
  return MCP_TOOL_DEFINITIONS
    .filter((tool) => (tool.condition ? tool.condition(stack) : true))
    .map(({ condition: _condition, ...tool }) => tool);
}

export function getAllMcpTools(): Array<Omit<McpToolDefinition, 'condition'>> {
  return MCP_TOOL_DEFINITIONS.map(({ condition: _condition, ...tool }) => tool);
}

export interface StackSplitTools {
  /** Tools whose conditions are met for the detected stack. */
  activeTools: Array<Omit<McpToolDefinition, 'condition'>>;
  /** Tools that exist but whose conditions are not met for the detected stack. */
  availableButInactive: Array<Omit<McpToolDefinition, 'condition'>>;
}

/**
 * Splits MCP tool definitions into active (stack-eligible) and inactive
 * (conditions not met for the detected stack). Used for strict stack filtering.
 */
export function getToolsWithStackSplit(stack: DetectedStack): StackSplitTools {
  const activeTools: Array<Omit<McpToolDefinition, 'condition'>> = [];
  const availableButInactive: Array<Omit<McpToolDefinition, 'condition'>> = [];

  for (const { condition, ...tool } of MCP_TOOL_DEFINITIONS) {
    if (!condition || condition(stack)) {
      activeTools.push(tool);
    } else {
      availableButInactive.push(tool);
    }
  }

  return { activeTools, availableButInactive };
}
