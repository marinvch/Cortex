/**
 * AI OS MCP Server — SDK-first implementation using @modelcontextprotocol/sdk.
 *
 * Replaces the manual JSON-RPC stdio parser with the official SDK's McpServer +
 * StdioServerTransport. Each tool is a self-contained registerTool() call with
 * a Zod input schema; prompts use registerPrompt(). The SDK auto-handles
 * initialize, tools/list, tools/call, prompts/list, prompts/get, and MCP
 * protocol negotiation.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import path from 'node:path';
import { createRequire } from 'node:module';
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
import { detectDrift, formatDriftReport } from '../detectors/drift.js';
import { readFile, listDirectory, runTests, runLint, runBuild } from './filesystem.js';
import { listWorkflows, loadWorkflow, validateWorkflow, buildWorkflowRunPlan, formatRunPlan } from '../workflow-runner.js';

/** Wraps a synchronous tool handler with watchdog tracking and error boundary. */
function wrap(
  toolName: string,
  fn: (args: Record<string, unknown>) => string,
) {
  return async (args: Record<string, unknown>) => {
    const watchdog = recordToolCallAndRunWatchdog(toolName);
    try {
      const result = fn(args);
      const text = watchdog ? `${result}\n\n[Watchdog] ${watchdog}` : result;
      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text }], isError: true as const };
    }
  };
}

export function createSdkServer(): McpServer {
  const req = createRequire(import.meta.url);
  const pkgVersion = (req('../../package.json') as { version: string }).version;

  const server = new McpServer({ name: 'ai-os', version: pkgVersion });

  // ── Tool 1: search_codebase ──────────────────────────────────────────────
  server.registerTool(
    'search_codebase',
    {
      description: 'Search for patterns, symbols, or text across the project codebase. Respects .gitignore. Returns matching file paths and snippets.',
      inputSchema: {
        query: z.string().describe('The pattern or text to search for'),
        filePattern: z.string().optional().describe('Optional glob pattern to limit search (e.g. "*.ts", "src/**/*.py")'),
        caseSensitive: z.boolean().optional().describe('Whether search is case-sensitive (default: false)'),
      },
    },
    wrap('search_codebase', ({ query, filePattern, caseSensitive }) =>
      searchFiles(query as string, filePattern as string | undefined, (caseSensitive as boolean | undefined) ?? false)),
  );

  // ── Tool 2: get_project_structure ─────────────────────────────────────────
  server.registerTool(
    'get_project_structure',
    {
      description: 'Returns an annotated file tree of the project (respects .gitignore, skips node_modules/build/dist). Useful for understanding project layout before making changes.',
      inputSchema: {
        depth: z.number().optional().describe('Max directory depth to show (default: 4)'),
        path: z.string().optional().describe('Subdirectory to start from (default: project root)'),
      },
    },
    wrap('get_project_structure', ({ path: subPath, depth }) => {
      const startDir = subPath
        ? path.join(getProjectRoot(), subPath as string)
        : getProjectRoot();
      return buildFileTree(startDir, 0, (depth as number | undefined) ?? 4).join('\n');
    }),
  );

  // ── Tool 3: get_conventions ───────────────────────────────────────────────
  server.registerTool(
    'get_conventions',
    {
      description: 'Returns the detected coding conventions for this project: naming rules, file structure, testing patterns, forbidden practices.',
      inputSchema: {},
    },
    wrap('get_conventions', () => readAiOsFile('context/conventions.md') || 'No conventions file found.'),
  );

  // ── Tool 4: get_stack_info ────────────────────────────────────────────────
  server.registerTool(
    'get_stack_info',
    {
      description: 'Returns the complete tech stack inventory: languages, frameworks, key dependencies, build tools, and test setup.',
      inputSchema: {},
    },
    wrap('get_stack_info', () => readAiOsFile('context/stack.md') || 'No stack file found.'),
  );

  // ── Tool 5: get_file_summary ──────────────────────────────────────────────
  server.registerTool(
    'get_file_summary',
    {
      description: 'Returns a structured summary of a specific file: key exports, types, functions, and brief description. Token-efficient alternative to reading the full file.',
      inputSchema: {
        filePath: z.string().describe('Path to the file relative to project root'),
      },
    },
    wrap('get_file_summary', ({ filePath }) => getFileSummary(filePath as string)),
  );

  // ── Tool 6: get_prisma_schema ─────────────────────────────────────────────
  server.registerTool(
    'get_prisma_schema',
    {
      description: 'Returns the full Prisma schema file contents. Use before making any database model changes.',
      inputSchema: {},
    },
    wrap('get_prisma_schema', () => getPrismaSchema()),
  );

  // ── Tool 7: get_trpc_procedures ───────────────────────────────────────────
  server.registerTool(
    'get_trpc_procedures',
    {
      description: 'Returns a summary of all tRPC procedures (name, input type, public/private). Avoids reading the entire router file.',
      inputSchema: {},
    },
    wrap('get_trpc_procedures', () => getTrpcProcedures()),
  );

  // ── Tool 8: get_api_routes ────────────────────────────────────────────────
  server.registerTool(
    'get_api_routes',
    {
      description: 'Returns a list of API routes with HTTP methods using stack-aware discovery for Node, Java/Spring, Python, Go, and Rust patterns.',
      inputSchema: {
        filter: z.string().optional().describe('Optional substring to filter routes (e.g. "auth", "webhook")'),
      },
    },
    wrap('get_api_routes', ({ filter }) => getApiRoutes(filter as string | undefined)),
  );

  // ── Tool 9: get_env_vars ──────────────────────────────────────────────────
  server.registerTool(
    'get_env_vars',
    {
      description: 'Returns all required environment variable names (from .env.example or code). Shows which are set vs. missing. Never returns values.',
      inputSchema: {},
    },
    wrap('get_env_vars', () => getEnvVars()),
  );

  // ── Tool 10: get_package_info ─────────────────────────────────────────────
  server.registerTool(
    'get_package_info',
    {
      description: 'Returns installed package versions and direct dependencies. Useful before suggesting library usage to avoid API mismatch.',
      inputSchema: {
        packageName: z.string().optional().describe('Optional: specific package to look up (e.g. "@trpc/server")'),
      },
    },
    wrap('get_package_info', ({ packageName }) => getPackageInfo(packageName as string | undefined)),
  );

  // ── Tool 11: get_impact_of_change ─────────────────────────────────────────
  server.registerTool(
    'get_impact_of_change',
    {
      description: 'Shows what files are affected when a given file changes. Returns direct importers and all transitively affected files.',
      inputSchema: {
        filePath: z.string().describe('File path relative to project root (e.g. "src/types.ts")'),
      },
    },
    wrap('get_impact_of_change', ({ filePath }) => getImpactOfChange(filePath as string)),
  );

  // ── Tool 12: get_dependency_chain ─────────────────────────────────────────
  server.registerTool(
    'get_dependency_chain',
    {
      description: 'Shows the full dependency chain for a file: what it imports and what imports it, with export names.',
      inputSchema: {
        filePath: z.string().describe('File path relative to project root (e.g. "src/utils/auth.ts")'),
      },
    },
    wrap('get_dependency_chain', ({ filePath }) => getDependencyChain(filePath as string)),
  );

  // ── Tool 13: check_for_updates ────────────────────────────────────────────
  server.registerTool(
    'check_for_updates',
    {
      description: 'Checks if the AI OS artifacts installed in this repo are out of date. Returns update instructions when a newer version of AI OS is available.',
      inputSchema: {},
    },
    wrap('check_for_updates', () => checkForUpdates()),
  );

  // ── Tool 14: get_memory_guidelines ───────────────────────────────────────
  server.registerTool(
    'get_memory_guidelines',
    {
      description: 'Returns repository memory rules and memory usage protocol from .github/ai-os/context/memory.md.',
      inputSchema: {},
    },
    wrap('get_memory_guidelines', () => getMemoryGuidelines()),
  );

  // ── Tool 15: get_repo_memory ──────────────────────────────────────────────
  server.registerTool(
    'get_repo_memory',
    {
      description: 'Retrieves persisted repository memory entries from .github/ai-os/memory/memory.jsonl, optionally filtered by query/category.',
      inputSchema: {
        query: z.string().optional().describe('Optional full-text query against title/content/tags'),
        category: z.string().optional().describe('Optional category filter (e.g. architecture, conventions, pitfalls)'),
        limit: z.number().optional().describe('Max entries to return (default: 10, max: 50)'),
      },
    },
    wrap('get_repo_memory', ({ query, category, limit }) =>
      getRepoMemory(query as string | undefined, category as string | undefined, limit as number | undefined)),
  );

  // ── Tool 16: remember_repo_fact ───────────────────────────────────────────
  server.registerTool(
    'remember_repo_fact',
    {
      description: 'Stores a durable repository memory entry in .github/ai-os/memory/memory.jsonl using dedupe/upsert rules (marks superseded conflicts and avoids duplicate facts).',
      inputSchema: {
        title: z.string().describe('Short memory title'),
        content: z.string().describe('Durable fact/decision/constraint'),
        category: z.string().optional().describe('Category (e.g. conventions, architecture, build, testing, security)'),
        tags: z.string().optional().describe('Optional comma-separated tags'),
      },
    },
    wrap('remember_repo_fact', ({ title, content, category, tags }) =>
      rememberRepoFact(title as string, content as string, category as string | undefined, tags as string | undefined)),
  );

  // ── Tool 17: get_active_plan ──────────────────────────────────────────────
  server.registerTool(
    'get_active_plan',
    {
      description: 'Returns the persisted active session plan from .github/ai-os/memory/session/active-plan.json. Use after context resets to restore goals and avoid drift.',
      inputSchema: {},
    },
    wrap('get_active_plan', () => getActivePlan()),
  );

  // ── Tool 18: upsert_active_plan ───────────────────────────────────────────
  server.registerTool(
    'upsert_active_plan',
    {
      description: 'Creates or updates the persisted active plan (objective, criteria, current/next step, blockers). This provides durable task state across context resets.',
      inputSchema: {
        objective: z.string().describe('Primary goal for the current task'),
        acceptanceCriteria: z.string().describe('Success criteria for task completion'),
        status: z.string().optional().describe('Plan status: active, paused, or completed'),
        currentStep: z.string().optional().describe('Current execution step'),
        nextStep: z.string().optional().describe('Next planned action'),
        blockers: z.string().optional().describe('Optional blockers, comma-separated or newline-separated'),
      },
    },
    wrap('upsert_active_plan', ({ objective, acceptanceCriteria, status, currentStep, nextStep, blockers }) =>
      upsertActivePlan(
        objective as string,
        acceptanceCriteria as string,
        status as string | undefined,
        currentStep as string | undefined,
        nextStep as string | undefined,
        blockers as string | undefined,
      )),
  );

  // ── Tool 19: append_checkpoint ────────────────────────────────────────────
  server.registerTool(
    'append_checkpoint',
    {
      description: 'Appends a progress checkpoint to .github/ai-os/memory/session/checkpoints.jsonl to preserve intent and execution state during long tool-call sequences.',
      inputSchema: {
        title: z.string().describe('Checkpoint title'),
        status: z.string().optional().describe('Checkpoint status: open or closed (default: open)'),
        notes: z.string().optional().describe('Optional checkpoint notes'),
        toolCallCount: z.number().optional().describe('Optional tool call count snapshot at checkpoint time'),
      },
    },
    wrap('append_checkpoint', ({ title, status, notes, toolCallCount }) =>
      appendCheckpoint(title as string, status as string | undefined, notes as string | undefined, toolCallCount as number | undefined)),
  );

  // ── Tool 20: close_checkpoint ─────────────────────────────────────────────
  server.registerTool(
    'close_checkpoint',
    {
      description: 'Closes an existing checkpoint by id in .github/ai-os/memory/session/checkpoints.jsonl.',
      inputSchema: {
        checkpointId: z.string().describe('Checkpoint id returned by append_checkpoint'),
        notes: z.string().optional().describe('Optional closing notes to append'),
      },
    },
    wrap('close_checkpoint', ({ checkpointId, notes }) =>
      closeCheckpoint(checkpointId as string, notes as string | undefined)),
  );

  // ── Tool 21: record_failure_pattern ──────────────────────────────────────
  server.registerTool(
    'record_failure_pattern',
    {
      description: 'Records or updates a failure pattern in .github/ai-os/memory/session/failure-ledger.jsonl to prevent repeating the same mistakes.',
      inputSchema: {
        tool: z.string().describe('Tool or subsystem where failure occurred'),
        errorSignature: z.string().describe('Short normalized error signature'),
        rootCause: z.string().describe('Suspected or confirmed root cause'),
        attemptedFix: z.string().describe('Fix that was attempted'),
        outcome: z.string().optional().describe('Result of the fix: unresolved, partial, or resolved'),
        confidence: z.number().optional().describe('Confidence in diagnosis from 0.0 to 1.0'),
      },
    },
    wrap('record_failure_pattern', ({ tool, errorSignature, rootCause, attemptedFix, outcome, confidence }) =>
      recordFailurePattern(
        tool as string,
        errorSignature as string,
        rootCause as string,
        attemptedFix as string,
        outcome as string | undefined,
        confidence as number | undefined,
      )),
  );

  // ── Tool 22: compact_session_context ─────────────────────────────────────
  server.registerTool(
    'compact_session_context',
    {
      description: 'Creates a compact session summary from active plan, open checkpoints, and recent failure patterns to reduce context stuffing and preserve continuity.',
      inputSchema: {},
    },
    wrap('compact_session_context', () => compactSessionContext()),
  );

  // ── Tool 23: get_session_context ──────────────────────────────────────────
  server.registerTool(
    'get_session_context',
    {
      description: 'Returns the compact session context card with MUST-ALWAYS rules, build/test commands, and key file locations. CALL THIS at the start of every new conversation to reload critical context after a session reset.',
      inputSchema: {},
    },
    wrap('get_session_context', () => getSessionContext()),
  );

  // ── Tool 24: get_recommendations ─────────────────────────────────────────
  server.registerTool(
    'get_recommendations',
    {
      description: 'Returns stack-appropriate recommendations: MCP servers, VS Code extensions, agent skills, and GitHub Copilot Extensions. Useful for setting up a new developer environment.',
      inputSchema: {},
    },
    wrap('get_recommendations', () => getRecommendations()),
  );

  // ── Tool 25: suggest_improvements ────────────────────────────────────────
  server.registerTool(
    'suggest_improvements',
    {
      description: 'Analyzes project structure and memory entries to return architectural and tooling optimization suggestions (e.g. missing env var documentation, undocumented key paths, skills gaps).',
      inputSchema: {},
    },
    wrap('suggest_improvements', () => suggestImprovements()),
  );

  // ── Tool 26: set_watchdog_threshold ──────────────────────────────────────
  server.registerTool(
    'set_watchdog_threshold',
    {
      description: 'Configures the automatic watchdog checkpoint interval for the current session (default: 8 tool calls). Increase for complex multi-step tasks; decrease for shorter focused work. Range: 1–100.',
      inputSchema: {
        threshold: z.number().min(1).max(100).describe('Number of tool calls between automatic watchdog checkpoints (1–100)'),
      },
    },
    wrap('set_watchdog_threshold', ({ threshold }) => setWatchdogThreshold(threshold as number)),
  );

  // ── Tool 27: reset_session_state ─────────────────────────────────────────
  server.registerTool(
    'reset_session_state',
    {
      description: 'Clears all session state files (active-plan.json, checkpoints.jsonl, failure-ledger.jsonl, runtime-state.json, compact-context.md) so a new branch or task starts from a clean slate. Durable repo memory (memory.jsonl) is never modified.',
      inputSchema: {},
    },
    wrap('reset_session_state', () => resetSessionState()),
  );

  // ── Tool 28: sync_hosted_memory ───────────────────────────────────────────
  server.registerTool(
    'sync_hosted_memory',
    {
      description: 'Returns guidance and a prompt template for mirroring durable facts from Copilot hosted/in-context memory into .github/ai-os/memory/memory.jsonl. Lists existing entries to prevent duplication.',
      inputSchema: {},
    },
    wrap('sync_hosted_memory', () => syncHostedMemory()),
  );

  // ── Tool 29: get_context_freshness ────────────────────────────────────────
  server.registerTool(
    'get_context_freshness',
    {
      description: 'Computes a freshness score (0–100) for AI OS context artifacts by comparing them against the stored context snapshot. Returns a list of stale artifacts, changed source files, and targeted sync recommendations. Run after structural code changes to detect context drift.',
      inputSchema: {},
    },
    wrap('get_context_freshness', () => getContextFreshness()),
  );

  // ── Tool 30: prune_memory ─────────────────────────────────────────────────
  server.registerTool(
    'prune_memory',
    {
      description: 'Compacts the repository memory file by running full hygiene (near-duplicate detection, TTL enforcement, superseded entry removal) and physically deleting all stale entries. Returns a maintenance summary with counts of removed vs. kept entries.',
      inputSchema: {},
    },
    wrap('prune_memory', () => pruneMemory()),
  );

  // ── Tool 31: detect_drift ─────────────────────────────────────────────────
  server.registerTool(
    'detect_drift',
    {
      description: 'Scans AI OS artifacts (skills, instructions, agents, MCP config, context snapshot) for drift. Reports missing files, unreplaced template placeholders, stale context snapshot (>7 days), broken MCP server paths, agent schema gaps, and skills not listed in instructions. Returns a formatted report; exits non-zero when errors exist.',
      inputSchema: {
        verbose: z.boolean().optional().describe('Include healthy files in output (default: false)'),
      },
    },
    wrap('detect_drift', ({ verbose }) => {
      const root = getProjectRoot();
      const report = detectDrift(root);
      return formatDriftReport(report, (verbose as boolean | undefined) ?? false);
    }),
  );

  // ── Tool 32: read_file ────────────────────────────────────────────────────
  server.registerTool(
    'read_file',
    {
      description: 'Read the content of a file within the project root. Path traversal outside the project root is blocked. Files larger than 32 KB are rejected with a helpful message.',
      inputSchema: {
        path: z.string().describe('Path to the file, relative to the project root (e.g. "src/utils.ts")'),
      },
    },
    wrap('read_file', ({ path: filePath }) => readFile(filePath as string)),
  );

  // ── Tool 33: list_directory ───────────────────────────────────────────────
  server.registerTool(
    'list_directory',
    {
      description: 'List the contents of a directory within the project root. Returns file names with sizes and directory names. Ignores node_modules, dist, .git, and other build artefacts.',
      inputSchema: {
        path: z.string().optional().describe('Directory path relative to project root (default: "." = project root)'),
      },
    },
    wrap('list_directory', ({ path: dirPath }) => listDirectory((dirPath as string | undefined) ?? '.')),
  );

  // ── Tool 34: run_tests ────────────────────────────────────────────────────
  server.registerTool(
    'run_tests',
    {
      description: 'Run the project test suite (`npm run test` or equivalent). Disabled by default — requires AI_OS_ALLOW_RUN_TOOLS=1 env var or "allowRunTools": true in .github/ai-os/config.json.',
      inputSchema: {},
    },
    wrap('run_tests', () => runTests()),
  );

  // ── Tool 35: run_lint ─────────────────────────────────────────────────────
  server.registerTool(
    'run_lint',
    {
      description: 'Run the project linter (`npm run lint` or equivalent). Disabled by default — requires AI_OS_ALLOW_RUN_TOOLS=1 env var or "allowRunTools": true in .github/ai-os/config.json.',
      inputSchema: {},
    },
    wrap('run_lint', () => runLint()),
  );

  // ── Tool 36: run_build ────────────────────────────────────────────────────
  server.registerTool(
    'run_build',
    {
      description: 'Run the project build (`npm run build` or equivalent). Disabled by default — requires AI_OS_ALLOW_RUN_TOOLS=1 env var or "allowRunTools": true in .github/ai-os/config.json.',
      inputSchema: {},
    },
    wrap('run_build', () => runBuild()),
  );

  // ── Tool 37: run_workflow ─────────────────────────────────────────────────
  server.registerTool(
    'run_workflow',
    {
      description: 'Load and display the execution plan for a named agent workflow from .github/ai-os/workflows/. Use dry_run: true to preview the chain without executing. Omit workflow_name to list all available workflows.',
      inputSchema: {
        workflow_name: z.string().optional().describe('Workflow filename (e.g. "feature-pipeline.yml"). Omit to list all workflows.'),
        dry_run: z.boolean().optional().describe('Show chain without executing (default: true)'),
      },
    },
    wrap('run_workflow', ({ workflow_name, dry_run }) => {
      const root = getProjectRoot();
      const dryRun = (dry_run as boolean | undefined) !== false;
      if (!workflow_name) {
        const workflows = listWorkflows(root);
        return workflows.length === 0
          ? 'No workflows found in .github/ai-os/workflows/. Create a .yml file to define an agent pipeline.'
          : `Available workflows:\n${workflows.map(w => `- ${w}`).join('\n')}`;
      }
      const wf = loadWorkflow(root, workflow_name as string);
      const errors = validateWorkflow(wf);
      if (errors.length > 0) {
        return `Workflow validation errors:\n${errors.map(e => `- Step ${e.step + 1} [${e.field}]: ${e.message}`).join('\n')}`;
      }
      const plan = buildWorkflowRunPlan(wf, dryRun);
      return formatRunPlan(plan);
    }),
  );

  // ── Prompts ────────────────────────────────────────────────────────────────

  server.registerPrompt(
    'session_start',
    {
      description: 'Bootstrap a new AI OS session — loads MUST-ALWAYS rules, repo memory, and conventions in the correct order.',
    },
    () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            'Start a new AI OS session by running these tools in order:',
            '1. Call `get_session_context` — reloads MUST-ALWAYS rules, build commands, and key file locations.',
            '2. Call `get_repo_memory` — reloads durable architectural decisions and constraints.',
            '3. Call `get_conventions` — reloads coding rules and naming conventions.',
            '',
            'After loading context, summarise what you found in 3–5 bullet points before responding to the user.',
          ].join('\n'),
        },
      }],
    }),
  );

  server.registerPrompt(
    'pre_commit_check',
    {
      description: 'Pre-commit code quality gate — validates conventions, flags security issues, and assesses blast radius for changed files.',
      argsSchema: {
        files: z.string().optional().describe('Comma-separated list of changed file paths (relative to repo root). Leave blank to check the current file.'),
      },
    },
    ({ files }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            'Run a pre-commit quality check:',
            files ? `Files changed: ${files}` : 'Files changed: (current file)',
            '',
            '1. For each file, call `get_impact_of_change` to assess blast radius.',
            '2. Call `get_conventions` to check for rule violations.',
            '3. Report any security, type safety, or convention issues.',
          ].join('\n'),
        },
      }],
    }),
  );

  server.registerPrompt(
    'architecture_review',
    {
      description: 'Load full architecture context for an informed architectural review or cross-cutting change.',
    },
    () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            'Load architecture context for review:',
            '1. Call `get_stack_info` to load the tech stack.',
            '2. Call `get_conventions` to review coding standards.',
            '3. Call `get_repo_memory` with category="architecture" for architectural decisions.',
            '',
            'Summarise the architecture and flag any concerns.',
          ].join('\n'),
        },
      }],
    }),
  );

  return server;
}

export async function runSdkMcp(): Promise<void> {
  // Ensure clean exit so process.on('exit') in utils.ts can release .memory.lock
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));

  const server = createSdkServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
