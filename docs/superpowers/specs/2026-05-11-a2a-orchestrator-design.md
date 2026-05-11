# AI OS — A2A-Inspired Orchestrator Design

**Date:** 2026-05-11  
**Status:** Approved  
**Scope:** Single feature — multi-agent orchestration layer for AI OS

---

## Problem & Approach

AI OS currently generates isolated specialist agents (framework expert, DB expert, payments expert, etc.) for each repo. These agents have no awareness of each other. A developer must manually switch between them, choosing the right specialist for each task.

The goal is to add an **orchestration layer** that lets a developer describe a high-level task in plain language and have AI OS automatically route it to the right specialist(s) — inspired by the Agent-to-Agent (A2A) protocol's agent discovery and task delegation concepts, implemented over the existing MCP infrastructure.

**Chosen approach:** Smart Orchestrator Agent + MCP routing. Generate a master `orchestrator.agent.md` that knows all sub-agents, backed by two new MCP tools (`list_agents`, `delegate_to_agent`) and a machine-readable agent registry (`agents.json`). No new runtime, no second server — works within GitHub Copilot chat today.

---

## Architecture

```
Developer (chat)
      │  "implement a Stripe checkout page"
      ▼
orchestrator.agent.md          ← generated, knows all sub-agents
      │
      ├─ calls list_agents()           → reads agents.json
      │                                   returns: [{name, capabilities, triggers}]
      │
      ├─ selects: "stripe-agent", "nextjs-agent"
      │
      ├─ calls delegate_to_agent("expert-payments", task)
      │       └─ loads expert-payments.agent.md + repo context
      │          returns: implementation plan / code
      │
      └─ synthesizes results → responds to developer

MCP Server (extended)
  ├─ list_agents          ← new tool
  └─ delegate_to_agent    ← new tool

.github/ai-os/agents.json   ← new artifact (A2A-inspired AgentCard registry)
```

---

## New Generated Artifacts

### 1. `.github/ai-os/agents.json` — Agent Registry

Generated alongside existing agents. Provides machine-readable capability metadata the orchestrator and MCP tools consume.

```json
{
  "version": "1",
  "generatedAt": "2026-05-11T...",
  "agents": [
    {
      "name": "Expert Next.js Developer",
      "file": "expert-next-js-developer.agent.md",
      "capabilities": ["routing", "server components", "RSC", "API routes", "SSR", "SSG"],
      "triggers": ["page", "route", "component", "layout", "server component", "next"],
      "description": "Expert Next.js developer specializing in TypeScript patterns."
    },
    {
      "name": "Payments Expert",
      "file": "expert-payments.agent.md",
      "capabilities": ["stripe", "checkout", "subscriptions", "webhooks", "billing"],
      "triggers": ["stripe", "payment", "checkout", "subscription", "billing", "webhook"],
      "description": "Stripe billing expert — subscriptions, webhooks, plan enforcement."
    }
  ]
}
```

### 2. `.github/agents/orchestrator.agent.md` — Master Routing Agent

A new agent generated at the end of the agent generation phase. It:
- Lists all available sub-agents with their capabilities
- Instructs Copilot to call `list_agents()` for the up-to-date registry
- Instructs Copilot to call `delegate_to_agent(file, task)` to hand off work
- Synthesizes multi-agent results when a task spans multiple specialists

### 3. Updated `tools.json`

`list_agents` and `delegate_to_agent` are added to `activeTools` for all projects.

---

## New MCP Tools

### `list_agents`

Reads `.github/ai-os/agents.json` and returns the full agent registry as formatted text. Called by the orchestrator to discover available specialists.

**Input:** none  
**Output:** formatted list of agents with name, file, capabilities, triggers, description

### `delegate_to_agent`

Loads the specified agent's `.agent.md` instructions plus relevant repo context (stack, conventions, architecture) and formats them as a focused sub-task prompt. Returns the combined context so the orchestrator can reason about it or pass it to Copilot's next turn.

**Input:**
- `agentFile` (required, string) — filename of the agent to delegate to (e.g. `expert-payments.agent.md`)
- `task` (required, string) — the specific task to hand off
- `context` (optional, string) — additional context to include

**Output:** the agent's system instructions + repo context + task, formatted as a ready-to-use sub-task block

---

## Generator Changes

### `src/generators/agents.ts`

1. **Add `buildAgentRegistryEntry(spec: AgentSpec): AgentRegistryEntry`** — derives `capabilities` and `triggers` from each agent spec's description and name. Capabilities are extracted from the description; triggers are lowercased keywords from the agent name and description.

2. **Add `generateAgentRegistry(entries: AgentRegistryEntry[], cwd: string)`** — writes `.github/ai-os/agents.json` via `writeIfChanged`.

3. **In `generateAgentsWithOptions`** — after generating all agent files, collect registry entries from all specs and call `generateAgentRegistry`. The orchestrator agent is generated last, after the registry is written.

4. **Add orchestrator to `buildAgentSpecs`** as the final spec — uses a new `orchestrator.md` template. Receives the agent list as a replacement variable.

### `src/mcp-tools.ts`

Add two new entries to `MCP_TOOL_DEFINITIONS`:

```typescript
{
  name: 'list_agents',
  description: 'Returns all AI OS agents registered for this project with their capabilities and triggers. Call this before delegating a task to discover which specialist to use.',
  inputSchema: { type: 'object', properties: {} },
  condition: always,
},
{
  name: 'delegate_to_agent',
  description: 'Loads a specialist agent\'s instructions and repo context for a specific task. Returns a ready-to-use sub-task block. Use after list_agents() to identify the right agent.',
  inputSchema: {
    type: 'object',
    properties: {
      agentFile: { type: 'string', description: 'Agent filename (e.g. "expert-payments.agent.md")' },
      task: { type: 'string', description: 'The specific task to delegate' },
      context: { type: 'string', description: 'Optional additional context for the sub-task' },
    },
    required: ['agentFile', 'task'],
  },
  condition: always,
},
```

### `src/mcp-server/utils.ts`

Add two new utility functions:

**`listAgents(projectRoot: string): string`**  
Reads `.github/ai-os/agents.json`. If missing, returns a friendly message noting agents haven't been generated yet.

**`delegateToAgent(projectRoot: string, agentFile: string, task: string, context?: string): string`**  
1. Reads `.github/agents/<agentFile>`
2. Reads `.github/ai-os/context/stack.md`, `conventions.md`, `architecture.md`
3. Formats and returns: `[AGENT: <name>]\n[TASK: <task>]\n[STACK CONTEXT]\n<stack>\n[AGENT INSTRUCTIONS]\n<instructions>`
4. If agent file not found, returns a clear error naming the missing file.

### `src/mcp-server/index.ts`

Add to `ToolInput` interface: `agentFile?: string` and `task?: string`

Add to `executeTool` switch:
```typescript
case 'list_agents':
  result = listAgents(getProjectRoot());
  break;
case 'delegate_to_agent':
  result = delegateToAgent(getProjectRoot(), input.agentFile ?? '', input.task ?? '', input.context);
  break;
```

Import `listAgents` and `delegateToAgent` from `./utils.js`.

---

## Template: `orchestrator.md`

The orchestrator template uses these replacement variables:
- `{{PROJECT_NAME}}` — project name
- `{{AGENT_LIST}}` — formatted list of all sub-agents (name + description + file)
- `{{STACK_SUMMARY}}` — stack summary bullets

The template instructs the orchestrator to:
1. Call `list_agents()` to see the current agent roster
2. Identify the best specialist(s) for the task based on triggers
3. Call `delegate_to_agent(agentFile, task)` for each relevant specialist
4. Synthesize results and present a unified answer

---

## Manifest

`agents.json` is added to the manifest tracked files so `--refresh-existing` and `--uninstall` handle it cleanly.

---

## Error Handling

- `list_agents`: if `agents.json` missing → return `"No agent registry found. Run ai-os to generate agents first."`
- `delegate_to_agent`: if `agentFile` empty → return error. If file not found → return `"Agent file '<name>' not found in .github/agents/."`. If repo context files missing → omit gracefully and note in output.

---

## Testing

- Unit test for `buildAgentRegistryEntry` — verify capabilities/triggers extracted correctly from a sample spec
- Unit test for `listAgents` — mock `agents.json`, assert formatted output
- Unit test for `delegateToAgent` — mock agent file + context files, assert output shape
- Integration test: run `generateAgentsWithOptions` on a test stack → assert `agents.json` written and `orchestrator.agent.md` generated

---

## Files Touched

| File | Change |
|------|--------|
| `src/generators/agents.ts` | Add registry generation + orchestrator spec |
| `src/templates/agents/orchestrator.md` | New template |
| `src/mcp-tools.ts` | 2 new tool definitions |
| `src/mcp-server/utils.ts` | 2 new utility functions |
| `src/mcp-server/index.ts` | 2 new tool handlers + ToolInput field |
| `src/types.ts` | `AgentRegistryEntry` type |
