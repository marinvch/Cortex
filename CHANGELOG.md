# Changelog

All notable changes to AI OS are documented here.  
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
