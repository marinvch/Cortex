---
applyTo: "**"
---

# AI OS — Active (ai-os)

This repository uses **AI OS** for context-enriched Copilot assistance.
The following MCP tools are available — use them proactively:

| Tool | When to call |
|---|---|
| `get_project_structure` | Before exploring unfamiliar directories |
| `get_stack_info` | Before suggesting any library or tooling changes |
| `get_conventions` | Before writing new code in this repo |
| `get_file_summary` | To understand a file without reading it fully |
| `get_impact_of_change` | **Before editing any file** — shows blast radius |
| `get_dependency_chain` | To trace how a module connects to the rest of the code |
| `search_codebase` | To find symbols, patterns, or usage examples |
| `get_env_vars` | Before referencing environment variables |
| `check_for_updates` | To see if AI OS artifacts are out of date |
| `get_memory_guidelines` | At task start to load memory safety protocol |
| `get_repo_memory` | Before coding to recover durable repo decisions and constraints |
| `remember_repo_fact` | After substantial tasks to persist verified learnings |

## Memory Protocol

1. Start each non-trivial task by checking relevant repository memory.
2. Prioritize memory-backed constraints over assumptions.
3. Persist durable facts and decisions at the end of the task.

## Update AI OS

If `check_for_updates` returns an available update, run:
```bash
npm run update
```
This refreshes all context docs, agent files, skills, and MCP tools in-place.