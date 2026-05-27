---
applyTo: "**"
---

# AI OS — Active (ai-os)

AI OS MCP tools are available. **Session start:** call `get_session_context` → `get_repo_memory` → `get_conventions` → `get_active_plan`.

**Quick reference:** `search_codebase` · `get_file_summary` · `get_impact_of_change` · `get_dependency_chain` · `get_project_structure` · `get_stack_info` · `get_env_vars` · `check_for_updates` · `remember_repo_fact` · `suggest_improvements` · `get_recommendations`

## Value Mode

1. **Problem first:** derive constraints from repo context and memory before writing code.
2. **Targeted tools:** prefer retrieval tools over full file reads; stop exploring when confident.
3. **End-to-end:** implement + validate + surface tradeoffs, optimise for reduced user effort.

## Update AI OS

Run `npx -y github:marinvch/ai-os --refresh-existing` when `check_for_updates` signals a new version.