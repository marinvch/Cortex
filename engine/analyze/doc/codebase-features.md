# AI OS — Codebase Features Analysis

> Analysis Date: June 2025 | Version: ~v0.13.0 | Repo: marinvch/ai-os

---

## Overview

**AI OS** is a TypeScript-based CLI tool that installs AI context infrastructure into any GitHub repository to maximize GitHub Copilot effectiveness. It functions as an "operating system" layer for Copilot — providing structured context, memory, MCP tools, agents, and prompt files that Copilot can use to produce higher-quality output.

**Codebase Stats:**
- Primary languages: TypeScript (39%), Markdown (44%), Shell (9%)
- ~104 source files, ~15 test files
- Package manager: npm | Test framework: Vitest
- Single runtime dependency: `@github/copilot-sdk`

---

## 1. Core Architecture

### Execution Pipeline

```
CLI args (src/cli/args.ts)
    ↓
Stack detection (src/analyze.ts + src/detectors/)
    ↓
Onboarding plan (src/planner.ts)
    ↓
Action dispatch (src/cli/dispatch.ts)
    ↓
Generators (src/generators/*)
    ↓
MCP installation + freshness snapshot
```

### Key Configuration Files (in target repos)

| File | Purpose |
|------|---------|
| `.github/ai-os/config.json` | User-editable feature toggles, thresholds, rules |
| `.github/ai-os/manifest.json` | Tracks all generated files for uninstall/refresh |
| `.github/ai-os/protect.json` | File protection: whole-protected or hybrid block-level |
| `.github/ai-os/context-snapshot.json` | Freshness baseline for drift detection |
| `.github/ai-os/tools.json` | MCP tool catalog: `{ activeTools, availableButInactive }` |

### Type System ([src/types.ts](src/types.ts))

Key types:
- `DetectedStack` — full project profile (language, frameworks, patterns, deps)
- `AiOsConfig` — user configuration (profile, feature flags, thresholds)
- `OnboardingPlan` — per-artifact decisions (create/update/merge/skip)
- `InstallProfile` — `minimal | standard | full`
- `CollectedRecommendations` — MCP servers, extensions, skills, with `source?`
- `McpToolDefinition` — tool name, description, condition for activation

---

## 2. CLI Features

### Actions

| Action | Flag | Purpose |
|--------|------|---------|
| `apply` | default | Generate all artifacts and write to disk |
| `plan` | `--plan` | Dry-run: show what would change |
| `preview` | `--preview` | Show onboarding plan before applying |
| `bootstrap` | `--bootstrap` | Full setup + auto-install stack skills |
| `doctor` | `--doctor` | Post-install health validation (11 checks) |
| `check-freshness` | `--check-freshness` | Context drift detection; CI-safe (non-zero exit if stale) |
| `check-hygiene` | `--check-hygiene` | Scan orphaned files, stale artifacts, manifest drift |
| `compact-memory` | `--compact-memory` | Prune stale/duplicate memory entries |
| `uninstall` | `--uninstall` | Remove all AI OS artifacts (safe for user blocks) |

### Generation Modes

| Mode | Flag | Behavior |
|------|------|----------|
| `safe` | default | Create new files; preserve existing (first install) |
| `refresh-existing` | `--refresh-existing` | Update generated artifacts; preserve curated content |
| `update` | `--update` | Apply latest version changes |

### Install Profiles

| Profile | Agents | Path Instructions | Recommendations | Session Card | Update Workflow | Skills |
|---------|--------|------------------|-----------------|--------------|-----------------|--------|
| `minimal` | ✗ | ✗ | ✗ | ✗ | ✗ | creator-only |
| `standard` | ✗ | ✓ | ✓ | ✓ | ✓ | creator-only |
| `full` | ✓ | ✓ | ✓ | ✓ | ✓ | predefined+creator |

### Other Flags

- `--cwd <path>` — target repo directory
- `--dry-run` — simulate without writing
- `--verbose / -v` — detailed logging
- `--json` — machine-readable output
- `--prune` — remove custom artifacts during refresh
- `--regenerate-context` — rewrite curated context files in safe mode
- `--clean-update` — destructive full rebuild

---

## 3. Stack Detection Engine

### Language Detection ([src/detectors/language.ts](src/detectors/language.ts))

**Function:** `detectLanguages(rootDir): DetectedLanguage[]`

**Detected languages:** TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, Scala, Kotlin, Swift, C++, Bash/Shell

Returns: name, percentage of codebase, file count, extensions

### Framework Detection ([src/detectors/framework.ts](src/detectors/framework.ts))

**Function:** `detectFrameworks(rootDir): DetectedFramework[]`

**Detection method:** Parses `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `pom.xml`; reads config files; scans import patterns

**Frontend frameworks:** React, Next.js, Vue, Nuxt, Angular, Svelte, SvelteKit, Astro, Remix, Solid.js, Qwik

**Backend frameworks:** Express, Fastify, Hono, Koa, Nest.js, FastAPI, Django, Flask, Spring Boot, Laravel, Rails

**Data layer:** tRPC, Prisma, Drizzle ORM, Supabase

**Other:** WordPress, React Native, NativeScript, Gatsby, Hugo, Eleventy

### Pattern Detection ([src/detectors/patterns.ts](src/detectors/patterns.ts))

**Function:** `detectPatterns(rootDir): DetectedPatterns`

Detects: naming conventions, test framework, linter, formatter, bundler, package manager, TypeScript presence, Dockerfile, CI/CD provider, monorepo structure, src directory layout, test directory path

### Build Command Detection

Parses `package.json` scripts, Makefiles, `pyproject.toml`, `build.gradle` etc.

Returns `BuildCommands` object with: `build`, `test`, `dev`, `lint`, `start`, + custom commands

### Dependency Graph ([src/detectors/graph.ts](src/detectors/graph.ts))

**Function:** `buildDependencyGraph(rootDir): DependencyGraph`

- Maps all file imports/exports
- `getTransitiveDependents(nodeId)` — blast radius for a file change
- Saved to `.github/ai-os/context/dependency-graph.json`

### Freshness Detection ([src/detectors/freshness.ts](src/detectors/freshness.ts))

- `captureContextSnapshot(rootDir, version)` — hash of languages, frameworks, build commands
- `computeFreshnessReport(rootDir)` — compares current state to snapshot
- Returns freshness score (0–100%) and list of changes

### Monorepo Support

- Discovers multiple package roots
- Parses `pnpm-workspace.yaml` glob patterns
- `DetectedStack.packageProfiles[]` for per-workspace profiles

---

## 4. Generator Capabilities

### Instructions Generator ([src/generators/instructions.ts](src/generators/instructions.ts))

**Main file:** `.github/copilot-instructions.md`
- Persona directive (e.g., "Senior Next.js developer")
- Tech stack summary
- Naming conventions
- Build/test commands
- Key file locations
- General guardrails
- Framework-specific overlay
- **Size cap enforced: 8 KB** (Copilot budget limit)

**Path-specific instruction files** (if `pathSpecificInstructions: true`):
- `frontend.instructions.md` — `applyTo:` `src/app/`, `components/`, etc.
- `backend.instructions.md` — `applyTo:` `src/api/`, `server/`, etc.
- `tests.instructions.md` — `applyTo:` `**/*.test.ts`, `**/*.spec.ts`

### Context Docs Generator ([src/generators/context-docs.ts](src/generators/context-docs.ts))

Generates `.github/ai-os/context/`:

| File | Contents |
|------|---------|
| `stack.md` | Language breakdown, frameworks, versions, package manager, tools |
| `architecture.md` | Module overview, entry points, data flow (Mermaid diagrams), integrations |
| `conventions.md` | Naming rules, directory structure, imports, testing patterns, security practices |
| `memory.md` | Repo memory safety protocol, TTL policies, dedup rules, citation requirements |
| `dependency-graph.json` | Full file import/export map |
| `existing-ai-context.md` | Scans for legacy AI guidance (CLAUDE.md, AGENTS.md, .cursor/rules, etc.) |

### Agents Generator ([src/generators/agents.ts](src/generators/agents.ts))

**Always generated:**
1. `{ProjectName} Initializer` — AI framework artifacts maintenance
2. `Expert {Framework} Developer` — framework-specific coding
3. `Codebase Explorer` — read-only "how does X work?" navigation

**Conditionally generated:**
- `Database Expert` — if Prisma/ORM detected
- `Authentication Expert` — if auth package detected (NextAuth, Passport, Django Auth, etc.)
- `Payment Expert` — if Stripe detected
- `Search/Recommendations Expert` — if vector DB or LLM library detected

**Template system:** `src/templates/agents/` → placeholder replacement → `.github/agents/*.agent.md`

### Prompts Generator ([src/generators/prompts.ts](src/generators/prompts.ts))

**Lifecycle prompts:**
- `/define` — structure feature intent and scope
- `/plan` — break feature into ordered tasks
- `/build` — execute one task with minimal changes
- `/verify` — check against success criteria
- `/review` — severity-tagged code review
- `/ship` — pre-ship checklist

**Framework-specific prompts:**
- Next.js: `/new-page`, `/new-api-route`
- Backend: endpoint creation prompts
- Database: migration and schema design prompts

**Output:** `.github/copilot/prompts.json`

### Skills Generator ([src/generators/skills.ts](src/generators/skills.ts))

**Predefined skill templates** (`src/templates/skills/`):

| Category | Skills |
|----------|--------|
| Frontend | nextjs, react, remix, astro, vue, nuxt, angular, solid, bun, deno |
| Backend | express, java-spring, python-fastapi, go |
| Data | prisma, trpc, drizzle, rag-pgvector |
| Services | auth-nextauth, stripe, supabase |
| CMS | wordpress |

**Strategy options:**
- `creator-only` — only skill-creator deployed (default)
- `predefined+creator` — also generate stack-based skills

### Workflows Generator ([src/generators/workflows.ts](src/generators/workflows.ts))

**Update check workflow:** `.github/workflows/update-ai-context.yml`
- Runs weekly on schedule or manual dispatch
- Calls `--check-freshness`; posts comment to PR if stale
- Optional: controlled by `config.updateCheckEnabled`

### MCP Config Generator ([src/generators/mcp.ts](src/generators/mcp.ts))

Manages both:
- `.mcp.json` — `{ mcpServers: { "ai-os": {...} } }` (Copilot CLI format)
- `.vscode/mcp.json` — `{ servers: { "ai-os": {...} } }` (VS Code format)

**Preserves non-ai-os entries** in both files on refresh
**Writes `tools.json`** with `{ activeTools, availableButInactive }` based on `strictStackFiltering`

---

## 5. MCP Server — Tool Catalog

**Implementation:** JSON-RPC over stdio (Copilot SDK v3)
**Runtime:** `src/mcp-server/index.ts`
**Total tools:** ~32

### Core Context Tools (Always Active)

| Tool | Purpose |
|------|---------|
| `get_session_context` | MUST-ALWAYS rules, build commands, key files — call at session start |
| `get_project_structure` | Annotated file tree (skips node_modules/build/dist) |
| `get_conventions` | Coding conventions document |
| `get_stack_info` | Full tech stack inventory |
| `get_file_summary` | Token-efficient file summary (exports, types, functions) |
| `get_impact_of_change` | Files affected when given file changes (transitive graph traversal) |
| `get_dependency_chain` | Full import/export chain for a file |
| `get_env_vars` | Environment variable names (never values) |
| `get_package_info` | Package versions + direct dependencies |
| `check_for_updates` | AI OS version check + update command |
| `search_codebase` | Grep-style search across codebase |

### Memory & Planning Tools

| Tool | Purpose |
|------|---------|
| `get_memory_guidelines` | Repository memory rules |
| `get_repo_memory` | Retrieve memory entries (query, category, limit) |
| `remember_repo_fact` | Store durable facts with deduplication |
| `get_active_plan` | Retrieve persisted session plan |
| `upsert_active_plan` | Create/update plan with objective/criteria/step/blockers |
| `append_checkpoint` | Add progress checkpoint |
| `close_checkpoint` | Mark checkpoint as done |
| `record_failure_pattern` | Log failure + root cause |
| `compact_session_context` | Create compact summary from plan/checkpoints |
| `set_watchdog_threshold` | Configure auto-checkpoint interval (1–100 tool calls) |

### Stack-Conditional Tools

| Tool | Activation Condition |
|------|---------------------|
| `get_prisma_schema` | `prisma` or `@prisma/client` detected |
| `get_trpc_procedures` | `@trpc/server` or `trpc` detected |
| `get_api_routes` | Node/Java/Python/Go/Rust framework detected |

### System Tools

| Tool | Purpose |
|------|---------|
| `get_recommendations` | Stack-appropriate MCP servers, extensions, skills |
| `suggest_improvements` | Architectural & tooling suggestions |
| `get_context_freshness` | Context drift score (0–100%), changes since last run |
| `prune_memory` | Deduplicate and mark stale memory entries |

### Tool Filtering

- `getMcpToolsPartitioned(stack)` in `src/mcp-tools.ts`
- `getActiveToolsForProject(stack)` in `src/mcp-server/tool-definitions.ts`
- `strictStackFiltering` config flag controls whether inactive tools are hidden

---

## 6. Memory System

### Repository Memory ([src/mcp-server/memory.ts](src/mcp-server/memory.ts))

**Store:** `.github/ai-os/memory/memory.jsonl`

**Entry schema:**
```json
{
  "id": "uuid",
  "createdAt": "ISO-8601",
  "title": "Short fact title",
  "content": "Durable fact or decision",
  "category": "architecture|conventions|pitfalls|build|testing|security",
  "tags": ["tag1"],
  "fingerprint": "content-hash",
  "status": "active|stale",
  "supersedesId": "replaced-entry-id"
}
```

**Hygiene engine (v0.10.1+):**
- **TTL pruning:** Entries older than `memoryTtlDays` (default: 180) marked stale
- **Near-duplicate detection:** Jaccard similarity ≥ `memoryNearDuplicateThreshold` (default: 0.85) → superseded
- Implemented: `jaccardSimilarity()` + `markNearDuplicates()` in `src/mcp-server/utils.ts`
- **Compact command:** `--compact-memory` CLI flag or `prune_memory` MCP tool

### Session Memory ([src/mcp-server/session.ts](src/mcp-server/session.ts))

**Files in `.github/ai-os/memory/session/`:**

| File | Contents | MCP Tools |
|------|---------|-----------|
| `active-plan.json` | objective, criteria, status, step, blockers | `get_active_plan`, `upsert_active_plan` |
| `checkpoints.jsonl` | progress markers with tool call count | `append_checkpoint`, `close_checkpoint` |
| `failure-ledger.jsonl` | failure + root cause + fix attempts | `record_failure_pattern` |

**Watchdog system:** Auto-checkpoints after N tool calls (configurable `set_watchdog_threshold`)

### User Block Preservation ([src/user-blocks.ts](src/user-blocks.ts))

**Markers in generated files:**
```html
<!-- AI-OS:USER_BLOCK:START id="block-name" -->
... user content ...
<!-- AI-OS:USER_BLOCK:END id="block-name" -->
```

**Merge strategies:**
1. **ID-match** — preserve block when same ID found in new content
2. **Anchor** — re-insert at same anchor line if found
3. **Conflict** — append in `<!-- AI-OS:CONFLICT -->` wrapper with report

**Config in protect.json:**
```json
{
  "protected": ["never-touch.md"],
  "hybrid": ["file-with-user-blocks.md"]
}
```

**Functions:** `extractUserBlocks(content)`, `mergeUserBlocks(newContent, oldContent, protectedIds)`

---

## 7. Recommendations System

### Registry ([src/recommendations/registry.ts](src/recommendations/registry.ts))

**Four recommendation maps:**

| Map | Key | Examples |
|-----|-----|---------|
| `DEPENDENCY_RECOMMENDATIONS` | npm/package name | Prisma, Stripe, @trpc/server |
| `FRAMEWORK_RECOMMENDATIONS` | Framework name | Next.js, FastAPI, Spring Boot |
| `LANGUAGE_RECOMMENDATIONS` | Language name | Python, Go, Rust |
| `UNIVERSAL_RECOMMENDATIONS` | — | Context7, find-skills |

**Recommendation types:** MCP server, VS Code extensions, Agent Skills (with source URL), Copilot Extension

### Skills CLI Integration ([src/recommendations/cli-compat.ts](src/recommendations/cli-compat.ts))

**Modes:** `detectSkillsCliMode()` → `legacy | source-based | unavailable`

**Command builder:** `buildSkillsInstallCommand(skillName, source?)`
- Output: `npx -y skills add <source>@<skill> -g -a github-copilot`

**Known skill sources:**
- `vercel-labs/agent-skills` → Vercel/Next.js best practices
- `intellectronica/agent-skills` → Context7 library docs

---

## 8. Bootstrap System ([src/bootstrap.ts](src/bootstrap.ts))

**CLI:** `--bootstrap [--dry-run]`

**Process:**
1. Collect recommendations from detected stack
2. Build installation plan
3. For each skill: run `npx -y skills add <source>@<skill> -g -a github-copilot`
4. Track status: `pending | applied | skipped | failed`
5. Return `BootstrapReport` with counts

**Exports:** `runBootstrap(stack, {dryRun})`, `formatBootstrapReport(report)`

---

## 9. Doctor Command ([src/doctor.ts](src/doctor.ts))

**CLI:** `--doctor` or `npm run doctor`

**11 health checks:**

| # | Check | Severity |
|---|-------|----------|
| 1 | MCP runtime binary present | Critical |
| 2 | MCP runtime responds to healthcheck | Critical |
| 3 | `.mcp.json` exists | Critical |
| 4 | `ai-os` entry in `.mcp.json` | Critical |
| 5 | CLI MCP command resolves | Critical |
| 6 | `.vscode/mcp.json` exists | Critical |
| 7 | `ai-os` entry in `.vscode/mcp.json` | Critical |
| 8 | VS Code MCP command resolves | Critical |
| 9 | `config.json` present | Warning |
| 10 | `tools.json` present | Warning |
| 11 | Skills deployed | Warning |

**Exit codes:** 1 if any critical check fails; 0 if only warnings

---

## 10. Protected Block System

**Markers in any generated file:**
```text
// @ai-os:protect reason="<why>"
... protected code ...
// @ai-os:protect-end
```

**Behavior:** Content between markers never modified, deleted, or simplified during refresh

**Context:** `.github/instructions/*.instructions.md` files support these markers

---

## 11. Template System

**Template directories:**
```
src/templates/
├── base-instructions.md
├── agents/          (6+ templates)
├── frameworks/      (10+ framework overlays)
└── skills/          (15+ skill templates)
```

**Placeholder tokens:** `{{PROJECT_NAME}}`, `{{PRIMARY_LANGUAGE}}`, `{{FRAMEWORKS}}`, `{{PACKAGE_MANAGER}}`, `{{NAMING_CONVENTION}}`, `{{TEST_FRAMEWORK}}`, `{{BUILD_COMMANDS}}`, `{{KEY_FILES}}`, `{{PERSONA_DIRECTIVE}}`, `{{FRAMEWORK_OVERLAY}}`

**Utility functions** (`src/generators/utils.ts`):
- `applyFallbacks(content, fallbacks)` — replace unresolved placeholders
- `findUnresolvedPlaceholders(content)` — validation
- `resolveTemplatesDir(runtimeDir)` — runtime template location

---

## 12. Validation & Testing

**Test framework:** Vitest

**Test files:** ~15 test files covering:
- `agent-contract.test.ts` — agent file validation
- `analyze.test.ts` — stack detection
- `bootstrap.test.ts` — bootstrap flow
- `cli-args.test.ts` — CLI arg parsing
- `detectors.test.ts` — language/framework/pattern detection
- `doctor.test.ts` — health checks
- `examples.test.ts` — example repo detection
- `freshness.test.ts` — context freshness
- `user-blocks.test.ts` — block preservation

**Coverage gap (per issue #114):** ~14% file coverage; critical paths in `src/analyze.ts`, `src/generate.ts`, `src/generators/context-docs.ts`, most MCP server utils are not unit-tested

**Validation pipeline:** `npm run validate` — smoke tests + scorecard checks

---

## 13. Bundle & Distribution

**How AI OS ships:**
- Bundle: `bundle/generate.js` + `bundle/server.js` (committed)
- Distribution: `npx github:marinvch/ai-os` runs directly from GitHub
- No npm registry publish; consumed as GitHub npx invocation

**Bundle process:** `scripts/bundle.mjs` (esbuild-based)

**Docker support:** `Dockerfile` for containerized runs

---

## 14. Known Limitations & Gaps

Based on open GitHub issues (as of June 2025):

| Area | Gap |
|------|-----|
| **Security** | Shell injection in `searchFiles` MCP tool (issue #105) |
| **Security** | Prompt injection via stack-derived inputs in generated instructions (issue #107) |
| **Security** | String-form `execSync` in multiple callsites (issue #106) |
| **Reliability** | Non-atomic file writes — interrupted refresh can corrupt manifests (issue #110) |
| **Validation** | No JSON schema validation on artifacts — silent failures (issue #109) |
| **Tests** | ~14% file coverage; critical generators untested (issue #114) |
| **Refactoring** | `src/generate.ts` is 45 KB — needs splitting (issue #113) |
| **Refactoring** | `src/mcp-server/utils.ts` is 72 KB — needs splitting (issue #112) |
| **Stack coverage** | No PHP/WordPress detection — falls back to "Unknown" (issue #104) |
| **CI** | No supply-chain audit (`npm audit`) gate (issue #119) |
| **UX** | `--dry-run` shows planned actions but not actual content diff (issue #116) |
