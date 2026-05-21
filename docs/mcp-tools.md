# AI OS — MCP Tools Reference

> This file is auto-generated from `src/mcp-tools.ts` by `scripts/gen-mcp-docs.mjs`.
> Run `npm run gen-mcp-docs` to refresh after adding or editing tool definitions.

## Available Tools

| Tool | Purpose |
| --- | --- |
| `search_codebase` | Search for patterns, symbols, or text across the project codebase. Respects .gitignore. Returns matching file paths and snippets. |
| `get_project_structure` | Returns an annotated file tree of the project (respects .gitignore, skips node_modules/build/dist). Useful for understanding project layout before making changes. |
| `get_conventions` | Returns the detected coding conventions for this project: naming rules, file structure, testing patterns, forbidden practices. |
| `get_stack_info` | Returns the complete tech stack inventory: languages, frameworks, key dependencies, build tools, and test setup. |
| `get_file_summary` | Returns a structured summary of a specific file: key exports, types, functions, and brief description. Token-efficient alternative to reading the full file. |
| `get_prisma_schema` | Returns the full Prisma schema file contents. Use before making any database model changes. _(conditional — appears when stack is detected)_ |
| `get_trpc_procedures` | Returns a summary of all tRPC procedures (name, input type, public/private). Avoids reading the entire router file. _(conditional — appears when stack is detected)_ |
| `get_api_routes` | Returns a list of API routes with HTTP methods using stack-aware discovery for Node, Java/Spring, Python, Go, and Rust patterns. _(conditional — appears when stack is detected)_ |
| `get_env_vars` | Returns all required environment variable names (from .env.example or code). Shows which are set vs. missing. Never returns values. |
| `get_package_info` | Returns installed package versions and direct dependencies. Useful before suggesting library usage to avoid API mismatch. |
| `get_impact_of_change` | Shows what files are affected when a given file changes. Returns direct importers and all transitively affected files. |
| `get_dependency_chain` | Shows the full dependency chain for a file: what it imports and what imports it, with export names. |
| `check_for_updates` | Checks if the AI OS artifacts installed in this repo are out of date. Returns update instructions when a newer version of AI OS is available. |
| `get_memory_guidelines` | Returns repository memory rules and memory usage protocol from .github/ai-os/context/memory.md. |
| `get_repo_memory` | Retrieves persisted repository memory entries from .github/ai-os/memory/memory.jsonl, optionally filtered by query/category. |
| `remember_repo_fact` | Stores a durable repository memory entry in .github/ai-os/memory/memory.jsonl using dedupe/upsert rules (marks superseded conflicts and avoids duplicate facts). |
| `get_active_plan` | Returns the persisted active session plan from .github/ai-os/memory/session/active-plan.json. Use after context resets to restore goals and avoid drift. |
| `upsert_active_plan` | Creates or updates the persisted active plan (objective, criteria, current/next step, blockers). This provides durable task state across context resets. |
| `append_checkpoint` | Appends a progress checkpoint to .github/ai-os/memory/session/checkpoints.jsonl to preserve intent and execution state during long tool-call sequences. |
| `close_checkpoint` | Closes an existing checkpoint by id in .github/ai-os/memory/session/checkpoints.jsonl. |
| `record_failure_pattern` | Records or updates a failure pattern in .github/ai-os/memory/session/failure-ledger.jsonl to prevent repeating the same mistakes. |
| `compact_session_context` | Creates a compact session summary from active plan, open checkpoints, and recent failure patterns to reduce context stuffing and preserve continuity. |
| `get_session_context` | Returns the compact session context card with MUST-ALWAYS rules, build/test commands, and key file locations. CALL THIS at the start of every new conversation to reload critical context after a session reset. |
| `get_recommendations` | Returns stack-appropriate recommendations: MCP servers, VS Code extensions, agent skills, and GitHub Copilot Extensions. Useful for setting up a new developer environment. |
| `suggest_improvements` | Analyzes project structure and memory entries to return architectural and tooling optimization suggestions (e.g. missing env var documentation, undocumented key paths, skills gaps). |
| `set_watchdog_threshold` | Configures the automatic watchdog checkpoint interval for the current session (default: 8 tool calls). Increase for complex multi-step tasks; decrease for shorter focused work. Range: 1–100. |
| `reset_session_state` | Clears all session state files (active-plan.json, checkpoints.jsonl, failure-ledger.jsonl, runtime-state.json, compact-context.md) so a new branch or task starts from a clean slate. Durable repo memory (memory.jsonl) is never modified. |
| `sync_hosted_memory` | Returns guidance and a prompt template for mirroring durable facts from Copilot hosted/in-context memory into .github/ai-os/memory/memory.jsonl. Lists existing entries to prevent duplication. |
| `get_context_freshness` | Computes a freshness score (0–100) for AI OS context artifacts by comparing them against the stored context snapshot. Returns a list of stale artifacts, changed source files, and targeted sync recommendations. Run after structural code changes to detect context drift. |
| `prune_memory` | Compacts the repository memory file by running full hygiene (near-duplicate detection, TTL enforcement, superseded entry removal) and physically deleting all stale entries. Returns a maintenance summary with counts of removed vs. kept entries. |
| `detect_drift` | Scans AI OS artifacts (skills, instructions, agents, MCP config, context snapshot) for drift. Reports missing files, unreplaced template placeholders, stale context snapshot (>7 days), broken MCP server paths, agent schema gaps, and skills not listed in instructions. Returns a formatted report; exits non-zero when errors exist. |

## Session Start Protocol

At the start of every new Copilot session in an AI OS repo:

1. Call `get_session_context` → reloads MUST-ALWAYS rules and key commands
2. Call `get_repo_memory` → recovers durable architectural decisions
3. Call `get_conventions` → enforces local coding style

## MCP Server Modes

| Mode | How to invoke | Use case |
| --- | --- | --- |
| Standalone JSON-RPC stdio | default (no flag) | VS Code Copilot MCP integration |
| Copilot SDK client | `--copilot` flag | Copilot CLI integration |
| Health check | `--healthcheck` flag | Post-install validation |

```bash
# Health check the MCP server
AI_OS_ROOT=. node .ai-os/mcp-server/index.js --healthcheck

# Debug mode
AI_OS_MCP_DEBUG=1 node .ai-os/mcp-server/index.js --healthcheck
```

## Bundle Architecture

`npm run bundle` uses esbuild to produce `dist/server.js` — a single self-contained bundle with zero npm dependencies for the default standalone mode. `@github/copilot-sdk` is dynamically imported only when `--copilot` is passed. This file is committed and deployed as-is — no `npm install` required in target repos.
