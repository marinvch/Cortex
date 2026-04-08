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
    description: 'Returns repository memory rules and memory usage protocol from .ai-os/context/memory.md.',
    inputSchema: { type: 'object', properties: {} },
    condition: always,
  },
  {
    name: 'get_repo_memory',
    description: 'Retrieves persisted repository memory entries from .ai-os/memory/memory.jsonl, optionally filtered by query/category.',
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
    description: 'Stores a durable repository memory entry in .ai-os/memory/memory.jsonl using dedupe/upsert rules (marks superseded conflicts and avoids duplicate facts).',
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
];

export function getMcpToolsForStack(stack: DetectedStack): Array<Omit<McpToolDefinition, 'condition'>> {
  return MCP_TOOL_DEFINITIONS
    .filter((tool) => (tool.condition ? tool.condition(stack) : true))
    .map(({ condition: _condition, ...tool }) => tool);
}

export function getAllMcpTools(): Array<Omit<McpToolDefinition, 'condition'>> {
  return MCP_TOOL_DEFINITIONS.map(({ condition: _condition, ...tool }) => tool);
}
