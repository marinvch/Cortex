# AI Coding Assistant — Project Instructions

> **Persona:** Act as a Senior TypeScript developer.

## Project: ai-os

**Primary Language:** TypeScript  
**Framework(s):** TypeScript  
**Package Manager:** npm  
**TypeScript:** Yes

---

## Tech Stack

- **TypeScript** (45% of codebase, 86 files)
- **Markdown** (39% of codebase, 75 files)
- **Shell** (6% of codebase, 12 files)
- **JSON** (4% of codebase, 7 files)
- **JavaScript** (3% of codebase, 5 files)

---

## Build Commands

- **Build:** `npm run build`
- **Test:** `npm run test`
- **Dev:** `npm run dev`
- **Lint:** `npm run lint`

---

## Detected Conventions

- **Naming:** kebab-case for files and identifiers
- **Linter:** ESLint
- **Formatter:** none detected
- **Test Framework:** Vitest
- **Test Directory:** none detected

---

## Key Files

- `README.md`
- `package.json`
- `Dockerfile`

---

## Architecture

See `.github/ai-os/context/architecture.md` for the full architecture overview.  
See `.github/ai-os/context/conventions.md` for detailed coding conventions.  
See `.github/ai-os/context/stack.md` for the complete dependency inventory.

---

## General Rules

- Prefer **early returns** (guard clauses) over deep nesting
- Validate all external inputs at the boundary (API/form/webhook)
- Scope database queries by the current user/owner when applicable
- Keep business logic out of UI components — delegate to services/utilities
- Use async/await over .then() chains
- Never commit secrets or credentials
- Only comment code that genuinely needs clarification

---

## Session Restart Protocol

**Start every new conversation by calling `get_session_context` before any task.**

When starting a new conversation or after a context window reset:
1. Call `get_session_context` → reloads MUST-ALWAYS rules, build commands, and key file locations
2. Call `get_repo_memory` → reloads durable architectural decisions and constraints
3. Call `get_conventions` → reloads coding rules and naming conventions
4. Call `get_active_plan` → restores active task plan and open checkpoints (if any)

---

## Project-State Strategy

Always start by reviewing `.github/copilot-instructions.md` and aligning it to the current repository state before implementation.

1. **New Project Strategy:**
Create a lightweight baseline first (stack, conventions, build/test commands, key paths). Keep instructions concise and expand only when new codepaths appear.

1. **Existing or Large Project Strategy:**
Audit instruction drift first. If context is missing, fill architecture/build/pitfall gaps before coding so Copilot can reason with fewer retries and less token waste.

---

## MCP Tools Available

Use these tools to fetch project-specific context on demand:

| Tool | When to call |
| --- | --- |
| `get_session_context` | **At the start of every new conversation** — reloads MUST-ALWAYS rules and key context |
| `search_codebase` | To find symbols, patterns, or usage examples |
| `get_project_structure` | Before exploring unfamiliar directories |
| `get_conventions` | Before writing new code in this repo |
| `get_stack_info` | Before suggesting any library or tooling changes |
| `get_file_summary` | To understand a file without reading it fully |
| `get_impact_of_change` | **Before editing any file** — shows blast radius |
| `get_dependency_chain` | To trace how a module connects to the rest of the code |
| `get_env_vars` | Before referencing environment variables |
| `check_for_updates` | To see if AI OS artifacts are out of date |
| `get_memory_guidelines` | At task start to load memory safety protocol |
| `get_repo_memory` | Before coding to recover durable repo decisions and constraints |
| `remember_repo_fact` | After substantial tasks to persist verified learnings |
| `get_recommendations` | To see stack-appropriate tools, extensions, and skills |
| `suggest_improvements` | To surface architectural and tooling gaps |

---

## Memory Workflow

- MUST before implementation, retrieve relevant memory with `get_repo_memory`
- Follow `.github/ai-os/context/memory.md` for memory safety and quality rules
- MUST after completing a substantial task, store only verified durable findings with `remember_repo_fact`
- Prefer memory-backed decisions over assumptions to reduce drift in long sessions
- Never store speculative, duplicate, or transient status notes in repo memory

---

## Context Budget Policy

Load context in priority order — stop when you have enough to act:

1. `get_session_context` (≤ 500 tokens) — always first
2. `get_repo_memory` — durable decisions; load at task start
3. `get_conventions` — before writing new code
4. `get_file_summary` — before reading full files (token-efficient)
5. Full file reads — only when edits require exact content
6. `search_codebase` — targeted lookup over broad scans

**Avoid context flooding:** do not load entire directories or re-read files already in context.
**Avoid context starvation:** do not skip steps 1–3 before non-trivial tasks.
**After a context reset:** reload steps 1–3 explicitly before resuming — never assume prior context is intact.

See `.github/ai-os/context/context-budget.md` for the full policy.

---

## AI OS Value Mode

Use AI OS to make Copilot more effective than default behavior:

1. **Problem Understanding First:** Restate the objective in implementation terms, derive constraints and acceptance criteria from repo context and memory, and ask focused clarification when ambiguity changes behavior.
1. **Token Spending Discipline:** Prefer targeted retrieval tools before full reads, reuse already loaded context, report deltas instead of repetition, and stop exploration when confidence is sufficient.
1. **User-Value Delivery:** Complete tasks end-to-end when feasible (implementation plus validation), surface tradeoffs and risks clearly, and optimize for reduced user effort.

---

## Protected Block Conventions

Certain code regions may be marked as protected using inline comment markers.
**MUST NOT modify, delete, simplify, or refactor content inside a protected block.**

Marker syntax (language-agnostic comment style):

```text
// @ai-os:protect reason="<why this is protected>"
... protected code ...
// @ai-os:protect-end
```

Rules:

- If a protected block is found inside a file you are editing, preserve its content exactly
- Do not remove, reorder, or summarize the lines between the markers
- If the task requires changing a protected region, stop and ask the user for explicit permission
- Protected blocks are opt-in; absence of markers means no protection is in effect

Recovery: to unprotect a region, remove the `@ai-os:protect` and `@ai-os:protect-end` comment lines.

See `.github/ai-os/context/protected-blocks.md` for the full design and recovery behavior.

---

## Strict Behavior Guardrails

- MUST ask clarifying questions first when the request is ambiguous, underspecified, or conflicts with existing instructions
- MUST NOT improvise requirements, API contracts, or migration scope beyond what is explicitly requested
- If a requested change is outside the described scope, pause and confirm the boundary before editing code

### Allowed Actions

- Read relevant project context and memory before implementation
- Make the smallest in-scope change that satisfies the request
- Run non-destructive validation commands (build/test/lint) to verify correctness

### Forbidden Actions

- Silent fallback that hides core runtime failures
- Destructive operations (hard reset, force delete, irreversible rewrites) without explicit approval
- Broad refactors, dependency swaps, or architecture changes without user confirmation

### Escalation Flow (When Ambiguous)

1. State what is unclear and list assumptions that would change behavior.
2. Ask focused clarifying question(s) and propose bounded options.
3. Continue only after clarification; if unavailable

<!-- [AI OS] truncated to 8 KB Copilot budget -->
