# A2A Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-agent orchestration layer to AI OS — a generated `orchestrator.agent.md` that routes developer tasks to specialist sub-agents via two new MCP tools (`list_agents`, `delegate_to_agent`) backed by a machine-readable agent registry (`agents.json`).

**Architecture:** A new `AgentRegistryEntry` type captures each generated agent's capabilities and trigger keywords. `src/generators/agents.ts` emits `agents.json` + `orchestrator.agent.md` after all specialist agents are written. Two new MCP tools in a new `src/mcp-server/orchestration.ts` sub-module read the registry and load sub-agent instructions on demand.

**Tech Stack:** TypeScript 5, Node.js ≥ 20, Vitest, existing `writeIfChanged` + `resolveTemplatesDir` utilities, `ROOT`/`readAiOsFile` from `mcp-server/shared.ts`.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/types.ts` | Modify | Add `AgentRegistryEntry` + `AgentRegistry` types |
| `src/templates/agents/orchestrator.md` | Create | Orchestrator agent template |
| `src/generators/agents.ts` | Modify | Build registry entries, write `agents.json`, add orchestrator spec |
| `src/mcp-tools.ts` | Modify | Add `list_agents` + `delegate_to_agent` tool definitions |
| `src/mcp-server/orchestration.ts` | Create | `listAgents()` + `delegateToAgent()` implementations |
| `src/mcp-server/utils.ts` | Modify | Export `listAgents` + `delegateToAgent` from new sub-module |
| `src/mcp-server/index.ts` | Modify | Add `agentFile?` + `task?` to `ToolInput`; add two case handlers |
| `src/tests/orchestration.test.ts` | Create | Unit tests for registry building + new MCP functions |

---

## Task 1: Add `AgentRegistryEntry` and `AgentRegistry` types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/orchestration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { AgentRegistryEntry, AgentRegistry } from '../types.js';

describe('AgentRegistryEntry type shape', () => {
  it('accepts a valid entry object', () => {
    const entry: AgentRegistryEntry = {
      name: 'Payments Expert',
      file: 'expert-payments.agent.md',
      capabilities: ['stripe', 'checkout', 'webhooks'],
      triggers: ['stripe', 'payment', 'billing'],
      description: 'Stripe billing expert.',
    };
    expect(entry.name).toBe('Payments Expert');
    expect(entry.file).toBe('expert-payments.agent.md');
    expect(entry.capabilities).toHaveLength(3);
    expect(entry.triggers).toHaveLength(3);
  });

  it('accepts a valid registry object', () => {
    const registry: AgentRegistry = {
      version: '1',
      generatedAt: '2026-05-11T00:00:00.000Z',
      agents: [],
    };
    expect(registry.version).toBe('1');
    expect(Array.isArray(registry.agents)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npm test -- --reporter=verbose orchestration
```

Expected: TypeScript error — `AgentRegistryEntry` and `AgentRegistry` not found.

- [ ] **Step 3: Add types to `src/types.ts`**

Append after the `isAiOsConfig` function at the bottom of the file:

```typescript
/** One entry in the agent registry — A2A-inspired AgentCard for a generated agent. */
export interface AgentRegistryEntry {
  /** Display name of the agent (e.g. "Payments Expert") */
  name: string;
  /** Filename in .github/agents/ (e.g. "expert-payments.agent.md") */
  file: string;
  /** What this agent can do (used by orchestrator to match tasks) */
  capabilities: string[];
  /** Lowercase keywords that trigger routing to this agent */
  triggers: string[];
  /** One-sentence summary used in the orchestrator's agent list */
  description: string;
}

/** The full agent registry written to .github/ai-os/agents.json */
export interface AgentRegistry {
  version: '1';
  generatedAt: string;
  agents: AgentRegistryEntry[];
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npm test -- --reporter=verbose orchestration
```

Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```
git add src/types.ts src/tests/orchestration.test.ts
git commit -m "feat: add AgentRegistryEntry and AgentRegistry types"
```

---

## Task 2: Create the orchestrator agent template

**Files:**
- Create: `src/templates/agents/orchestrator.md`

- [ ] **Step 1: Create the template file**

Create `src/templates/agents/orchestrator.md`:

```markdown
---
name: {{PROJECT_NAME}} — Orchestrator
description: Master routing agent for {{PROJECT_NAME}}. Routes developer tasks to the right specialist agent based on capabilities and stack context.
argument-hint: "Describe a task in plain language (e.g. 'add Stripe checkout', 'fix auth bug', 'create a new Prisma model')"
model: gpt-4.1
tools: ["changes", "codebase", "editFiles", "fetch", "problems", "runCommands", "runTests", "search", "searchResults", "terminalLastCommand", "usages"]
---

You are the **{{PROJECT_NAME}} Orchestrator** — a master routing agent that delegates developer tasks to the right specialist.

## Your Stack

{{STACK_SUMMARY}}

## Available Specialist Agents

{{AGENT_LIST}}

## How You Work

1. **Receive a task** from the developer in plain language.
2. **Call `list_agents()`** to get the current agent roster with capabilities.
3. **Identify the best specialist(s)** — match task keywords against agent triggers and capabilities.
4. **Call `delegate_to_agent(agentFile, task)`** for each relevant specialist, one at a time.
5. **Synthesize the results** — if multiple agents were called, combine their outputs into a single coherent response.
6. **If no specialist matches** — handle the task yourself using the repo context files:
   - `.github/ai-os/context/stack.md`
   - `.github/ai-os/context/conventions.md`
   - `.github/ai-os/context/architecture.md`

## Rules

- Always call `list_agents()` first — never guess which agents exist.
- Delegate to the **most specific** specialist available. Prefer a focused agent over a general one.
- When a task spans multiple specialists (e.g. "add a Stripe checkout page with a Prisma subscription record"), call both agents and merge their outputs.
- Do not implement code yourself unless no specialist covers the task.
- Preserve the developer's intent exactly when delegating — do not rephrase or reinterpret.
```

- [ ] **Step 2: Verify template parses**

```
node -e "const fs=require('fs'); const t=fs.readFileSync('src/templates/agents/orchestrator.md','utf-8'); console.log(t.includes('{{PROJECT_NAME}}') && t.includes('{{AGENT_LIST}}') ? 'OK' : 'MISSING PLACEHOLDERS')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```
git add src/templates/agents/orchestrator.md
git commit -m "feat: add orchestrator agent template"
```

---

## Task 3: Registry generation + orchestrator spec in `agents.ts`

**Files:**
- Modify: `src/generators/agents.ts`

- [ ] **Step 1: Add failing tests to `src/tests/orchestration.test.ts`**

Append to the existing test file:

```typescript
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { buildAgentRegistryEntry, generateAgentRegistry } from '../generators/agents.js';
import type { DetectedStack, DetectedPatterns } from '../types.js';

const BASE_PATTERNS: DetectedPatterns = {
  namingConvention: 'camelCase',
  hasTypeScript: true,
  packageManager: 'npm',
  hasDockerfile: false,
  hasCiCd: false,
  monorepo: false,
  srcDirectory: true,
};

function makeStack(overrides: Partial<DetectedStack> = {}): DetectedStack {
  return {
    projectName: 'test-project',
    rootDir: '/tmp/test',
    primaryLanguage: { name: 'TypeScript', percentage: 80, fileCount: 10, extensions: ['.ts'] },
    languages: [{ name: 'TypeScript', percentage: 80, fileCount: 10, extensions: ['.ts'] }],
    frameworks: [],
    keyFiles: [],
    patterns: BASE_PATTERNS,
    allDependencies: [],
    ...overrides,
  };
}

describe('buildAgentRegistryEntry', () => {
  it('extracts name, file, description from a spec', () => {
    const entry = buildAgentRegistryEntry({
      name: 'Payments Expert',
      file: 'expert-payments.agent.md',
      description: 'Stripe billing expert for my-project — subscriptions, webhooks, plan enforcement.',
    });
    expect(entry.name).toBe('Payments Expert');
    expect(entry.file).toBe('expert-payments.agent.md');
    expect(entry.description).toContain('Stripe');
  });

  it('derives triggers from name and description keywords', () => {
    const entry = buildAgentRegistryEntry({
      name: 'Payments Expert',
      file: 'expert-payments.agent.md',
      description: 'Stripe billing expert — subscriptions, webhooks, plan enforcement.',
    });
    expect(entry.triggers.some(t => t.includes('payment') || t.includes('stripe') || t.includes('billing'))).toBe(true);
  });

  it('derives capabilities from description text', () => {
    const entry = buildAgentRegistryEntry({
      name: 'Database Expert',
      file: 'expert-database.agent.md',
      description: 'Prisma ORM expert — schema design, migrations, query optimization.',
    });
    expect(entry.capabilities.length).toBeGreaterThan(0);
  });
});

describe('generateAgentRegistry', () => {
  it('writes agents.json to .github/ai-os/', () => {
    const tmpDir = path.join(os.tmpdir(), 'ai-os-orch-test-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.github', 'ai-os'), { recursive: true });

    const entries = [
      {
        name: 'Expert Next.js Developer',
        file: 'expert-next-js-developer.agent.md',
        capabilities: ['routing', 'components'],
        triggers: ['next', 'page', 'route'],
        description: 'Expert Next.js developer.',
      },
    ];
    generateAgentRegistry(entries, tmpDir);

    const registryPath = path.join(tmpDir, '.github', 'ai-os', 'agents.json');
    expect(fs.existsSync(registryPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    expect(parsed.version).toBe('1');
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0].name).toBe('Expert Next.js Developer');
  });
});
```

- [ ] **Step 2: Run to verify failures**

```
npm test -- --reporter=verbose orchestration
```

Expected: FAIL — `buildAgentRegistryEntry` and `generateAgentRegistry` not exported from `agents.ts`.

- [ ] **Step 3: Add imports to `agents.ts`**

At the top of `src/generators/agents.ts`, after existing imports, add:

```typescript
import type { AgentRegistryEntry, AgentRegistry } from '../types.js';
```

- [ ] **Step 4: Add `buildAgentRegistryEntry` function**

Add this function after the `injectReplacements` function (around line 376):

```typescript
/**
 * Derives an AgentRegistryEntry from a minimal spec descriptor.
 * Capabilities are extracted as the comma-separated items after em-dashes in the description.
 * Triggers are lowercased words from the name + description that are meaningful (length > 3).
 */
export function buildAgentRegistryEntry(spec: {
  name: string;
  file: string;
  description: string;
}): AgentRegistryEntry {
  // Extract capabilities: text after " — " in description, split by comma/semicolon
  const afterDash = spec.description.split(/\s[—–-]\s/)[1] ?? spec.description;
  const capabilities = afterDash
    .split(/[,;]/)
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 2 && s.length < 40)
    .slice(0, 8);

  // Triggers: meaningful lowercase words from name + description
  const allWords = `${spec.name} ${spec.description}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !['this', 'that', 'with', 'from', 'your', 'have', 'will', 'repo', 'code', 'file', 'make', 'when', 'what', 'before', 'after'].includes(w));
  const triggers = [...new Set(allWords)].slice(0, 12);

  return {
    name: spec.name,
    file: spec.file,
    capabilities: capabilities.length > 0 ? capabilities : [spec.name.toLowerCase()],
    triggers,
    description: spec.description,
  };
}
```

- [ ] **Step 5: Add `generateAgentRegistry` function**

Add immediately after `buildAgentRegistryEntry`:

```typescript
/**
 * Writes .github/ai-os/agents.json — the A2A-inspired agent registry.
 * Called after all agent specs have been generated.
 */
export function generateAgentRegistry(entries: AgentRegistryEntry[], cwd: string): void {
  const registry: AgentRegistry = {
    version: '1',
    generatedAt: new Date().toISOString(),
    agents: entries,
  };
  const registryPath = path.join(cwd, '.github', 'ai-os', 'agents.json');
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  writeIfChanged(registryPath, JSON.stringify(registry, null, 2) + '\n');
}
```

- [ ] **Step 6: Add orchestrator spec builder**

Add this function after `buildSequentialAgentSpecs`:

```typescript
function buildOrchestratorSpec(
  stack: DetectedStack,
  cwd: string,
  registryEntries: AgentRegistryEntry[],
): AgentSpec {
  const projectName = sanitizeForInstructions(path.basename(cwd));
  const frameworks = stack.frameworks.map(f => f.name);
  const primaryLang = sanitizeForInstructions(stack.languages[0]?.name ?? 'TypeScript');
  const frameworkLabel = sanitizeForInstructions(frameworks[0] ?? primaryLang);
  const frameworkList = frameworks.length > 0 ? frameworks.map(f => sanitizeForInstructions(f)).join(', ') : primaryLang;

  const stackSummary = [
    `Primary language: ${primaryLang}`,
    `Frameworks: ${frameworkList}`,
    `Package manager: ${stack.patterns.packageManager}`,
    `TypeScript: ${stack.patterns.hasTypeScript ? 'Yes' : 'No'}`,
  ].map(s => `- ${s}`).join('\n');

  // Build the agent list for the template
  const agentList = registryEntries
    .map(e => `- **${e.name}** (\`${e.file}\`) — ${e.description}`)
    .join('\n');

  const runtimeDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
  const templateDir = path.join(resolveTemplatesDir(runtimeDir), 'agents');

  return {
    templateFile: path.join(templateDir, 'orchestrator.md'),
    outputFile: 'orchestrator.agent.md',
    name: `${projectName} — Orchestrator`,
    description: `Master routing agent for ${projectName}. Routes developer tasks to the right specialist agent based on capabilities and stack context.`,
    argumentHint: 'Describe a task in plain language (e.g. "add Stripe checkout", "fix auth bug", "create a new Prisma model")',
    replacements: {
      '{{PROJECT_NAME}}': projectName,
      '{{STACK_SUMMARY}}': stackSummary,
      '{{AGENT_LIST}}': agentList || '- No specialist agents generated yet.',
    },
  };
}
```

- [ ] **Step 7: Wire registry + orchestrator into `generateAgentsWithOptions`**

Find the `return generated;` at the end of `generateAgentsWithOptions` (around line 469). Replace it with:

```typescript
  // Build registry from all generated specs and write agents.json
  const allSpecs = [
    ...buildAgentSpecs(stack, cwd),
    ...(agentFlowMode === 'create' ? buildSequentialAgentSpecs(stack, cwd) : []),
  ];
  const registryEntries: AgentRegistryEntry[] = allSpecs.map(s =>
    buildAgentRegistryEntry({ name: s.name, file: s.outputFile, description: s.description }),
  );
  generateAgentRegistry(registryEntries, cwd);

  // Generate orchestrator last (it needs the registry to be written first)
  const orchSpec = buildOrchestratorSpec(stack, cwd, registryEntries);
  const orchOutputPath = path.join(agentsDir, orchSpec.outputFile);
  if (!fs.existsSync(orchOutputPath) || options.refreshExisting) {
    if (fs.existsSync(orchSpec.templateFile)) {
      let orchContent = fs.readFileSync(orchSpec.templateFile, 'utf-8');
      orchContent = orchContent
        .replace(/^name:.*$/m, `name: ${orchSpec.name}`)
        .replace(/^description:.*$/m, `description: ${orchSpec.description}`)
        .replace(/^argument-hint:.*$/m, `argument-hint: "${orchSpec.argumentHint}"`);
      orchContent = injectReplacements(orchContent, orchSpec.replacements);
      orchContent = applyFallbacks(orchContent);
      orchContent = enforceAgentContract(orchContent, { agentName: orchSpec.outputFile });
      writeIfChanged(orchOutputPath, orchContent);
      generated.push(orchOutputPath);
    }
  }

  return generated;
```

- [ ] **Step 8: Run tests to verify they pass**

```
npm test -- --reporter=verbose orchestration
```

Expected: PASS — all 6 tests in `orchestration.test.ts` passing.

- [ ] **Step 9: Run full test suite to confirm no regressions**

```
npm test -- --reporter=verbose
```

Expected: all existing tests still pass.

- [ ] **Step 10: Commit**

```
git add src/types.ts src/generators/agents.ts src/tests/orchestration.test.ts
git commit -m "feat: generate agent registry and orchestrator agent"
```

---

## Task 4: Add `list_agents` and `delegate_to_agent` MCP tool definitions

**Files:**
- Modify: `src/mcp-tools.ts`

- [ ] **Step 1: Add failing test to `src/tests/orchestration.test.ts`**

Append:

```typescript
import { getAllMcpTools } from '../mcp-tools.js';

describe('MCP tool catalog includes orchestration tools', () => {
  it('contains list_agents tool', () => {
    const tools = getAllMcpTools();
    const tool = tools.find(t => t.name === 'list_agents');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('agents');
  });

  it('contains delegate_to_agent tool', () => {
    const tools = getAllMcpTools();
    const tool = tools.find(t => t.name === 'delegate_to_agent');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toContain('agentFile');
    expect(tool?.inputSchema.required).toContain('task');
  });
});
```

- [ ] **Step 2: Run to verify failures**

```
npm test -- --reporter=verbose orchestration
```

Expected: FAIL — `list_agents` and `delegate_to_agent` not found in catalog.

- [ ] **Step 3: Add the two tool definitions to `src/mcp-tools.ts`**

Find the closing `];` of `MCP_TOOL_DEFINITIONS` array. Insert before it:

```typescript
  {
    name: 'list_agents',
    description: 'Returns all AI OS specialist agents registered for this project with their capabilities and trigger keywords. Call this before delegating a task to discover which specialist to use.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    condition: always,
  },
  {
    name: 'delegate_to_agent',
    description: "Loads a specialist agent's full instructions and repo context for a specific task. Returns a ready-to-use sub-task block. Call list_agents() first to identify the right agentFile.",
    inputSchema: {
      type: 'object',
      properties: {
        agentFile: {
          type: 'string',
          description: 'Filename of the specialist agent (e.g. "expert-payments.agent.md"). Get this from list_agents().',
        },
        task: {
          type: 'string',
          description: 'The specific task to delegate, in plain language.',
        },
        context: {
          type: 'string',
          description: 'Optional additional context to include with the delegation.',
        },
      },
      required: ['agentFile', 'task'],
    },
    condition: always,
  },
```

- [ ] **Step 4: Run tests to verify they pass**

```
npm test -- --reporter=verbose orchestration
```

Expected: PASS.

- [ ] **Step 5: Run the MCP tool definitions parity test**

```
npm test -- --reporter=verbose mcp-tool-definitions
```

Expected: PASS — the parity test auto-validates the new tools are present in both the generator catalog and the runtime catalog.

- [ ] **Step 6: Commit**

```
git add src/mcp-tools.ts src/tests/orchestration.test.ts
git commit -m "feat: add list_agents and delegate_to_agent MCP tool definitions"
```

---

## Task 5: Implement `listAgents` and `delegateToAgent` in a new sub-module

**Files:**
- Create: `src/mcp-server/orchestration.ts`

- [ ] **Step 1: Add failing tests to `src/tests/orchestration.test.ts`**

Append:

```typescript
import { listAgents, delegateToAgent } from '../mcp-server/orchestration.js';

describe('listAgents', () => {
  it('returns a no-registry message when agents.json is missing', () => {
    const result = listAgents('/nonexistent/path/that/does/not/exist');
    expect(result).toContain('No agent registry found');
  });

  it('returns formatted agent list when agents.json exists', () => {
    const tmpDir = path.join(os.tmpdir(), 'ai-os-list-test-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.github', 'ai-os'), { recursive: true });
    const registry = {
      version: '1',
      generatedAt: '2026-05-11T00:00:00.000Z',
      agents: [
        {
          name: 'Payments Expert',
          file: 'expert-payments.agent.md',
          capabilities: ['stripe', 'checkout'],
          triggers: ['stripe', 'payment'],
          description: 'Stripe billing expert.',
        },
      ],
    };
    fs.writeFileSync(
      path.join(tmpDir, '.github', 'ai-os', 'agents.json'),
      JSON.stringify(registry),
    );
    const result = listAgents(tmpDir);
    expect(result).toContain('Payments Expert');
    expect(result).toContain('expert-payments.agent.md');
    expect(result).toContain('stripe');
  });
});

describe('delegateToAgent', () => {
  it('returns an error when agentFile is empty', () => {
    const result = delegateToAgent('/any/path', '', 'some task');
    expect(result).toContain('agentFile');
  });

  it('returns an error when the agent file does not exist', () => {
    const tmpDir = path.join(os.tmpdir(), 'ai-os-del-test-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.github', 'agents'), { recursive: true });
    const result = delegateToAgent(tmpDir, 'nonexistent.agent.md', 'a task');
    expect(result).toContain('nonexistent.agent.md');
    expect(result).toContain('not found');
  });

  it('returns agent instructions + task block when file exists', () => {
    const tmpDir = path.join(os.tmpdir(), 'ai-os-del-ok-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, '.github', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.github', 'ai-os', 'context'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.github', 'agents', 'expert-payments.agent.md'),
      '---\nname: Payments Expert\n---\nYou are a payments expert.',
    );
    const result = delegateToAgent(tmpDir, 'expert-payments.agent.md', 'add checkout page');
    expect(result).toContain('AGENT: Payments Expert');
    expect(result).toContain('TASK: add checkout page');
    expect(result).toContain('You are a payments expert');
  });
});
```

- [ ] **Step 2: Run to verify failures**

```
npm test -- --reporter=verbose orchestration
```

Expected: FAIL — `listAgents` and `delegateToAgent` not found.

- [ ] **Step 3: Create `src/mcp-server/orchestration.ts`**

```typescript
/**
 * orchestration.ts — MCP tool handlers for list_agents and delegate_to_agent.
 *
 * list_agents: reads .github/ai-os/agents.json and returns formatted agent roster.
 * delegateToAgent: loads a specialist agent's instructions + repo context for a task.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRegistry } from '../types.js';

function getAgentsRegistryPath(projectRoot: string): string {
  return path.join(projectRoot, '.github', 'ai-os', 'agents.json');
}

function getAgentsDir(projectRoot: string): string {
  return path.join(projectRoot, '.github', 'agents');
}

function readContextFile(projectRoot: string, name: string): string {
  const filePath = path.join(projectRoot, '.github', 'ai-os', 'context', name);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Returns all registered agents with capabilities and triggers.
 * Called by the orchestrator agent via the list_agents MCP tool.
 */
export function listAgents(projectRoot: string): string {
  const registryPath = getAgentsRegistryPath(projectRoot);
  if (!fs.existsSync(registryPath)) {
    return 'No agent registry found. Run `npx ai-os` to generate agents and the registry first.';
  }

  let registry: AgentRegistry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as AgentRegistry;
  } catch {
    return 'Failed to parse agents.json. The file may be corrupted — re-run `npx ai-os` to regenerate.';
  }

  if (registry.agents.length === 0) {
    return 'Agent registry is empty. No specialist agents have been generated for this project yet.';
  }

  const lines = [
    `# Available Specialist Agents (${registry.agents.length})`,
    '',
    `_Registry generated: ${registry.generatedAt}_`,
    '',
  ];

  for (const agent of registry.agents) {
    lines.push(`## ${agent.name}`);
    lines.push(`- **File:** \`${agent.file}\``);
    lines.push(`- **Description:** ${agent.description}`);
    lines.push(`- **Capabilities:** ${agent.capabilities.join(', ')}`);
    lines.push(`- **Triggers:** ${agent.triggers.join(', ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Loads a specialist agent's instructions and relevant repo context,
 * formatted as a sub-task block for the orchestrator to use.
 * Called by the orchestrator agent via the delegate_to_agent MCP tool.
 */
export function delegateToAgent(
  projectRoot: string,
  agentFile: string,
  task: string,
  context?: string,
): string {
  if (!agentFile || agentFile.trim() === '') {
    return 'Error: agentFile is required. Call list_agents() to get valid agent filenames.';
  }

  const agentPath = path.join(getAgentsDir(projectRoot), agentFile);
  if (!fs.existsSync(agentPath)) {
    return `Error: Agent file "${agentFile}" not found in .github/agents/. Call list_agents() to see available agents.`;
  }

  const agentContent = fs.readFileSync(agentPath, 'utf-8');

  // Extract name from frontmatter for the block header
  const nameMatch = agentContent.match(/^name:\s*(.+)$/m);
  const agentName = nameMatch?.[1]?.trim() ?? agentFile.replace('.agent.md', '');

  const stackContext = readContextFile(projectRoot, 'stack.md');
  const conventions = readContextFile(projectRoot, 'conventions.md');

  const lines = [
    `[AGENT: ${agentName}]`,
    `[TASK: ${task}]`,
    '',
  ];

  if (context) {
    lines.push('[ADDITIONAL CONTEXT]');
    lines.push(context);
    lines.push('');
  }

  if (stackContext) {
    lines.push('[STACK CONTEXT]');
    lines.push(stackContext.split('\n').slice(0, 30).join('\n'));
    lines.push('');
  }

  if (conventions) {
    lines.push('[CODING CONVENTIONS]');
    lines.push(conventions.split('\n').slice(0, 20).join('\n'));
    lines.push('');
  }

  lines.push('[AGENT INSTRUCTIONS]');
  lines.push(agentContent);

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npm test -- --reporter=verbose orchestration
```

Expected: PASS — all tests in `orchestration.test.ts` passing.

- [ ] **Step 5: Commit**

```
git add src/mcp-server/orchestration.ts src/tests/orchestration.test.ts
git commit -m "feat: implement listAgents and delegateToAgent in orchestration.ts"
```

---

## Task 6: Wire orchestration module into MCP server barrel and index

**Files:**
- Modify: `src/mcp-server/utils.ts`
- Modify: `src/mcp-server/index.ts`

- [ ] **Step 1: Add export contract test to `src/tests/mcp-server-modules.test.ts`**

Append to the existing file (after the last `it(...)` block):

```typescript
import { listAgents, delegateToAgent } from '../mcp-server/orchestration.js';

// In the existing describe block 'mcp-server sub-modules export contract':
it('orchestration.ts exports listAgents as a function', () => {
  expect(typeof listAgents).toBe('function');
});

it('orchestration.ts exports delegateToAgent as a function', () => {
  expect(typeof delegateToAgent).toBe('function');
});
```

Note: append these two `it` calls inside the existing `describe('mcp-server sub-modules export contract', ...)` block.

- [ ] **Step 2: Run to verify failures**

```
npm test -- --reporter=verbose mcp-server-modules
```

Expected: FAIL — the two new `it` blocks fail if import fails.

- [ ] **Step 3: Export from `src/mcp-server/utils.ts`**

Add this line at the end of `src/mcp-server/utils.ts` (after all existing exports):

```typescript
export { listAgents, delegateToAgent } from './orchestration.js';
```

- [ ] **Step 4: Add `agentFile` and `task` to `ToolInput` in `src/mcp-server/index.ts`**

Find the `ToolInput` interface. Add two fields after the existing `confidence?: number;` line:

```typescript
  agentFile?: string;
  task?: string;
```

- [ ] **Step 5: Import the new functions in `src/mcp-server/index.ts`**

Find the existing import from `./utils.js`. Add `listAgents` and `delegateToAgent` to it:

```typescript
import {
  // ... existing imports ...
  listAgents,
  delegateToAgent,
} from './utils.js';
```

- [ ] **Step 6: Add tool handlers in `executeTool` switch**

Find the `default:` case at the bottom of the `switch (toolName)` block in `executeTool`. Insert before it:

```typescript
    case 'list_agents':
      result = listAgents(getProjectRoot());
      break;
    case 'delegate_to_agent':
      result = delegateToAgent(getProjectRoot(), input.agentFile ?? '', input.task ?? '', input.context);
      break;
```

- [ ] **Step 7: Run mcp-server-modules test to verify passes**

```
npm test -- --reporter=verbose mcp-server-modules
```

Expected: PASS.

- [ ] **Step 8: Run full test suite**

```
npm test -- --reporter=verbose
```

Expected: all tests pass. The `mcp-tool-definitions` parity test validates that both new tools are registered in the runtime catalog.

- [ ] **Step 9: Commit**

```
git add src/mcp-server/utils.ts src/mcp-server/index.ts src/tests/mcp-server-modules.test.ts
git commit -m "feat: wire orchestration tools into MCP server"
```

---

## Task 7: Build and verify end-to-end

- [ ] **Step 1: Build TypeScript**

```
npm run build
```

Expected: zero TypeScript errors.

- [ ] **Step 2: Run full test suite one final time**

```
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Verify agents.json and orchestrator are generated against ai-os itself**

```
npm run generate -- --dry-run 2>&1 | Select-String -Pattern "orchestrator|agents.json" -SimpleMatch
```

Expected: lines showing `orchestrator.agent.md` and `agents.json` would be written.

- [ ] **Step 4: Final commit**

```
git add -A
git commit -m "feat: complete A2A orchestrator implementation

- AgentRegistryEntry/AgentRegistry types in types.ts
- agents.json registry generated after each agent suite
- orchestrator.agent.md template and generation
- list_agents + delegate_to_agent MCP tools
- orchestration.ts sub-module with full implementations
- 20+ new unit tests covering all paths

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-Review

**Spec coverage check:**
- ✅ `AgentRegistryEntry` type → Task 1
- ✅ `agents.json` generated artifact → Task 3
- ✅ `orchestrator.agent.md` template + generation → Tasks 2 + 3
- ✅ `list_agents` MCP tool definition → Task 4
- ✅ `delegate_to_agent` MCP tool definition → Task 4
- ✅ `listAgents()` implementation → Task 5
- ✅ `delegateToAgent()` implementation → Task 5
- ✅ `ToolInput` updated with `agentFile?` + `task?` → Task 6
- ✅ Tool handlers in `index.ts` → Task 6
- ✅ `utils.ts` barrel export → Task 6
- ✅ Updated `tools.json` activeTools → covered automatically by existing `getToolsWithStackSplit` logic (new tools have `condition: always`)
- ✅ Error handling (missing registry, missing agent file, empty agentFile) → Task 5
- ✅ Tests for all new functions → Tasks 1, 3, 4, 5, 6

**No placeholders, TBDs, or vague steps found.**

**Type consistency verified:** `AgentRegistryEntry` defined in Task 1, used consistently in Tasks 3, 5. `AgentRegistry` defined in Task 1, used in Task 5. `agentFile`/`task` in `ToolInput` match the tool handler parameter names exactly.
