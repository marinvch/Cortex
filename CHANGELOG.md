# Changelog

All notable changes to AI OS are documented here.  
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.21.0] — 2026-05-24

### Added
- **MCP SDK migration** (#176): Migrated MCP server from custom JSON-RPC stdio parser to `@modelcontextprotocol/sdk` v1.29.0. All 37 tools now registered via `McpServer.registerTool()` with Zod input schemas in `src/mcp-server/sdk-server.ts`. All 3 prompts registered via `registerPrompt()`. `StdioServerTransport` replaces manual stdin parsing.
- `src/mcp-server/sdk-server.ts`: New SDK-based server with `createSdkServer()` and `runSdkMcp()` exports. `wrap()` helper adds watchdog tracking and error boundary to all tool callbacks.
- Added `zod@^3.25.0` and `@modelcontextprotocol/sdk@^1.29.0` as runtime dependencies.

### Changed
- `src/mcp-server/index.ts`: Simplified to ~160 lines. Default mode now calls `runSdkMcp()` instead of `runStandaloneMcp()`. Removed manual JSON-RPC parser, `executeTool()` switch statement, `handleJsonRpcMessage()`, `sendResponse()`, and `sendError()`. Copilot SDK mode (`--copilot`) stub retained.
- MCP server `initialize` response version now read dynamically from `package.json` (was hardcoded `'0.11.0'`).

### Fixed
- README: Tool count corrected to 37 (was 27/29+).

### Tests
- 533 tests across 40 test files

### Resolved Issues
- #176 — Migrate MCP server to @modelcontextprotocol/sdk

---

## [0.20.0] — 2026-05-23

### Added
- **Filesystem MCP tools** (#177): `read_file`, `list_directory` (path-traversal protected), `run_tests`, `run_lint`, `run_build` (opt-in via `AI_OS_ALLOW_RUN_TOOLS=1` or `allowRunTools: true` in config). 11 security tests.
- **Interactive `--init` wizard** (#175): `runWizardLogic()` with dependency-injectable `AskFn` guides first-time setup through project type, language, framework, and test framework selection.
- **Monorepo/workspace support** (#173): npm workspaces field detection (`string[]` or `{ packages: string[] }`), normalized forward-slash paths on Windows, `buildMonorepoSection()` in generated instructions, `WorkspacePackage` type.
- **Skill version tracking** (#181): SHA-256 content hashes stored in `config.json.skillVersions`, checked by `--doctor` and `detect_drift` (check #7) to flag modified/missing skills.
- **User-overridable agent templates** (#183): agents first check `.github/ai-os/templates/agents/<template>.md` before falling back to built-in templates.
- **Multi-editor support** (#189): `generateCursorRules()` → `.cursorrules`, `generateJetBrainsContext()` → `.github/ai-os/jetbrains-ai-context.md`, `generateNeovimContext()` → `.github/ai-os/nvim-context.md`. Auto-detects `.idea/` and existing `.cursorrules`. `--editor` flag: `vscode|cursor|jetbrains|neovim|all`.
- **Multi-model output** (#190): `adaptForClaude()` (XML tags), `adaptForGemini()` (compact sections), `adaptForLocal()` (4K-8K token budget). `--model` flag: `copilot|claude|gemini|local`. Companion files in `.github/ai-os/`.
- **Agent workflow chaining** (#184): YAML workflow schema (`name`, `description`, `steps` with `agent`/`input`/`output`), `parseWorkflowYaml()`, `validateWorkflow()`, `buildWorkflowRunPlan()`, `formatRunPlan()`. `run_workflow` MCP tool lists/executes workflows with dry-run mode. Built-in `feature-pipeline.yml` ships with AI OS. Workflows deployed to `.github/ai-os/workflows/` on install.

### Changed
- `ParsedArgs` gains `editorTargets: EditorTarget[]` and `model: ModelTarget` fields
- `AiOsConfig` gains `model?`, `editorTargets?`, and `allowRunTools?` fields
- MCP tool count: 32 → 37 tools

### Tests
- 533 tests across 40 test files (up from 483 / 37)

### Resolved Issues
- #177 — Filesystem and process MCP tools
- #175 — Interactive `--init` wizard
- #173 — Monorepo/workspace support
- #181 — Skill version tracking and integrity checks
- #183 — User-overridable agent templates
- #189 — Multi-editor support (Cursor, JetBrains, Neovim)
- #190 — Multi-model output (Claude, Gemini, local LLMs)
- #184 — Agent workflow chaining with built-in feature pipeline

---

## [0.19.0] — 2026-05-22

### Added
- **Structured error reporting** (`src/errors.ts`, #186): `AiOsError` class with `AiOsErrorCode` union (8 codes), `formatError()` with actionable fix hints. Exit code 2 for user-fixable errors, exit code 1 for unexpected errors. `writeFileAtomic` wraps EACCES/EPERM as `AiOsError('WRITE_FAILED')`.
- **Generation summary output** (`src/actions/summary.ts`, #187): `buildGenerationSummary()` + `formatGenerationSummary()` produce a structured diff table after each run showing written/unchanged/preserved/pruned file counts and duration in seconds.
- **Semantic drift detection** (`src/detectors/drift.ts`, #174): check #7 in `detectDrift()` — verifies `config.json` `primaryFramework` matches `copilot-instructions.md` content, and `agents.json` agent count matches `.github/agents/*.agent.md` file count. Rendered in a `🔀 Semantic Drift` section in `formatDriftReport()`.
- **MCP prompts contract tests** (`src/tests/mcp-prompts.test.ts`): 6 tests verifying all 3 known prompts exist with non-empty descriptions and that `mcp-server/index.ts` declares the prompts capability.
- **Documentation updates** (#185): `docs/architecture.md` — error handling section with exit codes table and `AiOsErrorCode` values; drift detection section with 7 check classes and `DriftItem.kind` values. `docs/USER-GUIDE.md` — generation summary section, error codes table, extended `--check-drift` docs with semantic drift description. `docs/GETTING-STARTED.md` — semantic drift example output and expanded drift detection section.
- v0.19.0 design spec and TDD implementation plan in `docs/superpowers/`

### Resolved Issues
- #186 — Structured error reporting with exit code 2 for actionable errors
- #187 — Generation summary output with duration and diff counts
- #174 — Semantic drift detection for framework/agent count mismatches
- #185 — Architecture, user guide, and getting-started documentation updates

---

## [0.18.0] — 2026-05-21

### Added
- **Drift Detection Engine** (`src/detectors/drift.ts`): `detectDrift()` scans 6 artifact classes — required files, MCP config validity, unreplaced template placeholders, context snapshot age (>7 days), agent file schema, and skills/instructions sync
- **`detect_drift` MCP tool** (#27): Copilot-accessible drift scanner with optional verbose mode
- **`--check-drift` CLI flag**: CI-friendly drift check, exits 1 on errors
- **AI OS Drift Check CI workflow** (`.github/workflows/ai-os-drift-check.yml`): weekly schedule + on-artifact-change trigger; auto-opens GitHub issue when drift errors found
- **`docs/GETTING-STARTED.md`**: comprehensive 10-minute install guide covering any tech stack (Node, Python, Java, Go, Ruby)
- **`docs/USER-GUIDE.md`**: advanced reference for all CLI flags, agent/skill customization, MCP tools, USER_BLOCKs, memory management, and CI integration
- `detect_drift` added to MCP Tools table and Session Restart Protocol (step 5) in base-instructions template
- Drift check command added to prompt-quality Build & Test Commands table

### Changed
- `## AI OS Value Mode` moved earlier in `base-instructions.md` (higher priority under 8 KB cap)
- README hero section rewritten with install-first approach and documentation links

---

## [0.17.0] — 2026-05-21

### Added
- **Skill routing auto-registration**: `{{SKILL_ROUTING}}` placeholder in `base-instructions.md`; installed skills automatically appear as an **Available Skills** table in `copilot-instructions.md` on every `--refresh-existing` run (`buildSkillRoutingSection()` in `instructions.ts`)
- **Agent Critical Files discovery**: `discoverProjectKeyFiles()` in `agents.ts` replaces hardcoded Next.js/tRPC file list with a 4-tier smart scan: well-known framework paths → common TypeScript entry points → barrel exports → `stack.keyFiles` fallback
- **COPILOT_CONTEXT.md skill count**: `generateSessionContextCard()` now adds `.github/copilot/skills/ (N skills)` row to Key Files table when skills are installed; updated on every refresh
- **`AgentRegistry` and `AgentRegistryEntry` types** with `isAgentRegistry` runtime type guard
- **A2A orchestrator design spec** and implementation plan in `docs/superpowers/`

### Fixed
- **CRLF separator detection** in `enforceSizeCap()`: uses `/\r?\n---\r?\n/g` regex; `copilot-instructions.md` now trims at clean section boundaries instead of mid-sentence (Windows CRLF was not matched by `\n---\n`)
- **`writeIfChanged()` hash gate**: now calls `fs.existsSync()` before allowing hash-match skip — deleted files are re-created correctly on next run
- **CI workflow YAML bug**: `ai-os-update-check.yml` had a literal newline inside a JavaScript string (`].join('\nACTUAL_NEWLINE')`) causing `actions/github-script` parse failure; replaced with `\n`
- **Duplicate numbered list items** in `base-instructions.md` (`1. / 1.` → `1. / 2.`)
- **Redundant Stack/Language metadata** in `prompt-quality.instructions.md` (`Stack: TypeScript · Language: TypeScript` → single `Stack:` line)

### Changed
- `copilot-instructions.md` template section order: safety rules and guardrails now appear before Memory Workflow and AI OS Value Mode sections — preserved under the 8 KB token budget
- `generateSessionContextCard()` signature now accepts optional `outputDir` parameter for skill counting

### Resolved Issues
- #164 — Post-update context hygiene: auto-sync skills, agents, and instruction files on every refresh (all 5 sub-items implemented)
- #165 — Version memory supersession, 4-step protocol, MCP table, dedup, skill validation

---

## [0.16.0] — 2026-05-09

### Added
- **Superpowers skill suite**: 14 production-grade agent skills auto-installed on first setup via `obra/superpowers` integration: `dispatching-parallel-agents`, `executing-plans`, `writing-plans`, `subagent-driven-development`, `brainstorming`, `test-driven-development`, `systematic-debugging`, `receiving-code-review`, `requesting-code-review`, `verification-before-completion`, `finishing-a-development-branch`, `using-git-worktrees`, `using-superpowers`, `find-skills`
- **Version memory supersession**: newer memory entries replace older ones in `.github/ai-os/memory/memory.jsonl`
- **4-step session restart protocol** in `ai-os.instructions.md`
- **MCP tools table** in `ai-os.instructions.md`
- `ai-os.instructions.md` deduplication against `copilot-instructions.md`
- **Skill routing validation** in `prompt-quality.instructions.md`

### Fixed
- `dist/templates` resolution for installed (non-source) usage — `dist/generators` layout candidate added to `resolveTemplatesDir()`
- `getLatestResolvableVersion` returns `max(published, toolVersion)` to unblock releases

---

## [0.15.0] — 2026-05-08

### Added
- Content-hash gate in manifest (issue #115): skip writes when output is unchanged
- `--full-diff` flag: unified diff output for dry-run mode (issue #116)

---

## [0.14.0] — 2026-05-04

### Added
- Bootstrap mode (`--bootstrap`): full generation + auto-installs skills via CLI (`src/bootstrap.ts`)
- Context freshness scoring: `src/detectors/freshness.ts`, `get_context_freshness` MCP tool (#25), `--check-freshness` CLI flag
- Doctor command (`--doctor`): post-install health check for MCP runtime, config, tools, and skills (`src/doctor.ts`)
- Install profiles (`--profile minimal|standard|full`): preset configurations (`src/profile.ts`)
- User block preservation: `<!-- AI-OS:USER_BLOCK:START id="..." -->` markers and `protect.json` hybrid array (`src/user-blocks.ts`)
- Memory hygiene engine: Jaccard similarity dedup, configurable TTL via `config.json`, `prune_memory` MCP tool (#29), `--compact-memory` CLI flag, maintenance summary in `--refresh-existing`
- Senior developer checklist and VS Code Copilot updates documentation

### Fixed
- MCP config now manages both `.mcp.json` (mcpServers) and `.vscode/mcp.json` (servers), preserving non-ai-os entries

---

## [0.13.0] — 2026-04-28

### Added
- MCP server toolset foundation (25+ project intelligence tools)
- Context architecture documentation: `architecture.md`, `conventions.md`, `stack.md`
- Scorecard regression gate in CI

---

## [0.12.1] — 2026-04-24

### Fixed
- Minor stability fixes for MCP server

---

## [0.12.0] — 2026-04-22

### Added
- Agentic safety guardrails in `base-instructions.md`
- MCP spec 2025 compliance
- Sequential and parallel agent specs in `src/generators/agents.ts`
