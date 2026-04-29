# AI OS — Architecture

## Overview

AI OS is a portable GitHub Copilot context engine. It scans a repository, detects the tech stack, and generates an optimized AI context package. Detection is package-aware for monorepos and mixed stacks.

## Components

```
src/
  analyze.ts          — Entry point: scans repo, builds DetectedStack
  generate.ts         — CLI + orchestration: reads flags, runs generators
  bootstrap.ts        — --bootstrap action: generate + auto-install skills
  doctor.ts           — --doctor action: post-install health validation
  profile.ts          — Install profile presets (minimal/standard/full)
  mcp-tools.ts        — MCP tool catalog and stack filtering
  types.ts            — Shared TypeScript types
  updater.ts          — --update / --refresh-existing logic
  user-blocks.ts      — USER_BLOCK hybrid content preservation

  detectors/
    language.ts       — Language detection (30+ languages)
    framework.ts      — Framework detection (Next.js, Django, Spring, etc.)
    patterns.ts       — Package manager, linter, test framework
    graph.ts          — Dependency graph builder
    freshness.ts      — Context drift scoring

  generators/
    instructions.ts   — .github/copilot-instructions.md + instructions/
    agents.ts         — .github/agents/*.agent.md
    skills.ts         — .github/copilot/skills/ai-os-*.md
    mcp.ts            — .vscode/mcp.json + .mcp.json
    workflows.ts      — .github/workflows/ (update-check)
    context-docs.ts   — .github/ai-os/context/ docs
    prompts.ts        — .github/copilot/prompts.json
    utils.ts          — writeIfChanged, writeManifest, hashContent

  mcp-server/
    index.ts          — MCP JSON-RPC stdio server entry point
    tool-definitions.ts — Tool handlers (reads from .github/ai-os/)
    utils.ts          — Memory, session, freshness utilities

  recommendations/
    index.ts          — Stack-aware recommendation engine
    registry.ts       — Skill/tool registry with triggers
    cli-compat.ts     — Skills CLI mode detection + command builder
```

## Data Flow

```
CLI flags + cwd
      │
      ▼
  analyze(cwd)           ← detects stack, languages, frameworks, patterns
      │
      ▼
  DetectedStack          ← typed snapshot of the repo's tech profile
      │
      ├──► generateInstructions()    → .github/copilot-instructions.md
      ├──► generateContextDocs()     → .github/ai-os/context/
      ├──► generateAgents()          → .github/agents/
      ├──► generateSkills()          → .github/copilot/skills/
      ├──► generateMcpJson()         → .vscode/mcp.json + .mcp.json
      ├──► generateWorkflows()       → .github/workflows/
      ├──► generatePrompts()         → .github/copilot/prompts.json
      └──► writeManifest()           → .github/ai-os/manifest.json
```

## Manifest Contract

`.github/ai-os/manifest.json` tracks every file AI OS owns:

```json
{
  "version": "0.11.0",
  "generatedAt": "2025-01-01T00:00:00.000Z",
  "files": ["...relative paths..."],
  "hashes": {
    ".github/copilot-instructions.md": "<sha256>"
  }
}
```

- On `--refresh-existing`: files in the previous manifest that are no longer generated are pruned.
- On re-run: `writeIfChanged` compares content before writing — identical files are skipped.

## MCP Config Files

AI OS manages two MCP config files:

| File | Key | Purpose |
| --- | --- | --- |
| `.vscode/mcp.json` | `servers` | VS Code MCP integration (workspace-scoped) |
| `.mcp.json` | `mcpServers` | Project-level MCP config |

Non-AI OS entries in both files are preserved on refresh.

## tools.json Format

With `strictStackFiltering: true` (default):

```json
{
  "activeTools": [...],
  "availableButInactive": [...]
}
```

With `strictStackFiltering: false`:

```json
[...flat array of all tools...]
```

## Memory Architecture

Repository memory lives in `.github/ai-os/memory/memory.jsonl`. Each entry:

```json
{
  "id": "uuid",
  "title": "...",
  "category": "...",
  "content": "...",
  "createdAt": "ISO date",
  "tags": [],
  "stale": false
}
```

Session state lives in `.github/ai-os/memory/session/`:

| File | Purpose |
| --- | --- |
| `active-plan.json` | Current session objective and progress |
| `checkpoints.jsonl` | Progress log (capped at 100) |
| `failure-ledger.jsonl` | Known failure patterns (capped at 50) |
| `compact-context.md` | Latest recovery summary |
| `runtime-state.json` | Watchdog counter and threshold |

## Content Protection

`.github/ai-os/protect.json` controls refresh behavior:

- `protected` array: files never overwritten or pruned
- `hybrid` array: files refreshed but user `USER_BLOCK` sections preserved

User blocks use `<!-- AI-OS:USER_BLOCK:START id="..." -->` / `<!-- AI-OS:USER_BLOCK:END id="..." -->` markers.

## Supported Stacks

**Languages:** TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, Swift, Kotlin, 30+ more

**Frameworks:** Next.js, React, Vue, Angular, Svelte, Express, FastAPI, Django, Spring Boot, .NET, Laravel, Rails, Nuxt, Astro, Remix, tRPC, Prisma, and more

**Tools:** ESLint, Prettier, Vitest, Jest, Playwright, Docker, GitHub Actions, all major package managers
