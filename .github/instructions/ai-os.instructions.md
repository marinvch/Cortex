---
applyTo: "**"
---

# AI OS — Active (ai-os)

This repository uses **AI OS** for context-enriched Copilot assistance.
The following MCP tools are available — use them proactively:

| Tool | When to call |
|---|---|
| `get_session_context` | **At session start** — reloads MUST-ALWAYS rules and key context |
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
| `get_recommendations` | To see stack-appropriate tools, extensions, and skills |
| `suggest_improvements` | To surface architectural and tooling gaps |

## Session Restart Protocol

**When starting a new conversation or after a context window reset:**
1. Call `get_session_context` → reloads MUST-ALWAYS rules, build commands, key files
2. Call `get_repo_memory` → reloads durable architectural decisions
3. Call `get_conventions` → reloads coding rules

## Memory Protocol

1. MUST start each non-trivial task by checking relevant repository memory.
2. Prioritize memory-backed constraints over assumptions.
3. MUST persist only verified durable facts and decisions at the end of the task.
4. Do not store speculative, duplicate, or transient status notes in repo memory.

## Project-State Strategy

Always start by reviewing `.github/copilot-instructions.md` and aligning it to the current repository state before implementation.

1. **New Project Strategy:** Create a lightweight baseline first (stack, conventions, build/test commands, key paths). Keep instructions concise and expand only when new codepaths appear.
2. **Existing or Large Project Strategy:** Audit instruction drift first. If context is missing, fill architecture/build/pitfall gaps before coding so Copilot can reason with fewer retries and less token waste.

## AI OS Value Mode

Use AI OS to expand Copilot capabilities beyond default behavior:

1. **Problem Understanding First:** Restate the objective in implementation terms, derive constraints and acceptance criteria from repo context and memory, and ask focused clarification when ambiguity changes behavior.
2. **Token Spending Discipline:** Prefer targeted retrieval tools before full reads, reuse loaded context, report deltas instead of repetition, and stop exploration when confidence is sufficient.
3. **User-Value Delivery:** Complete tasks end-to-end when feasible (implementation plus validation), surface tradeoffs and risks clearly, and optimize for reduced user effort.

## Strict Behavior Guardrails

1. MUST ask clarifying questions first when a request is ambiguous, underspecified, or outside described scope.
2. MUST NOT improvise requirements, API contracts, or migration scope beyond explicit instructions.
3. MUST avoid silent fallback for core runtime failures; return explicit diagnostics instead.

### Allowed Actions

- Read relevant context and repository memory before implementation.
- Apply minimal in-scope edits and validate with non-destructive checks.

### Forbidden Actions

- Destructive operations without explicit approval.
- Broad refactors or architecture changes without confirmation.
- Writing speculative or transient notes into repo memory.

### Escalation Flow (When Ambiguous)

1. State what is unclear and what assumptions would change behavior.
2. Ask focused clarifying question(s) with bounded options.
3. Continue after clarification; if unavailable, take safest minimal action and document limits.

## Update AI OS

If `check_for_updates` returns an available update, run:
```bash
npx -y github:marinvch/ai-os --refresh-existing
```
This refreshes all context docs, agent files, skills, and MCP tools in-place.