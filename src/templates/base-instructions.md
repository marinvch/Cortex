# AI Coding Assistant — Project Instructions

> **Persona:** {{PERSONA_DIRECTIVE}}

## Project: {{PROJECT_NAME}}

**Primary Language:** {{PRIMARY_LANGUAGE}}  
**Framework(s):** {{FRAMEWORKS}}  
**Package Manager:** {{PACKAGE_MANAGER}}  
**TypeScript:** {{HAS_TYPESCRIPT}}

---

## Tech Stack

{{STACK_SUMMARY}}

---

## Build Commands

{{BUILD_COMMANDS}}

---

## Detected Conventions

- **Naming:** {{NAMING_CONVENTION}} for files and identifiers
- **Linter:** {{LINTER}}
- **Formatter:** {{FORMATTER}}
- **Test Framework:** {{TEST_FRAMEWORK}}
- **Test Directory:** {{TEST_DIRECTORY}}

---

## Key Files

{{KEY_FILES}}

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

## MCP Tools Available

Use these tools to fetch project-specific context on demand:

- `search_codebase` — semantic search over project files
- `get_project_structure` — annotated file tree
- `get_conventions` — this project's coding conventions
- `get_stack_info` — full dependency/tech stack details
- `get_file_summary` — key exports and purpose of a specific file
- `get_memory_guidelines` — repository memory protocol
- `get_repo_memory` — retrieve durable project memory
- `remember_repo_fact` — persist verified project facts

---

## Memory Workflow

- MUST before implementation, retrieve relevant memory with `get_repo_memory`
- Follow `.github/ai-os/context/memory.md` for memory safety and quality rules
- MUST after completing a substantial task, store only verified durable findings with `remember_repo_fact`
- Prefer memory-backed decisions over assumptions to reduce drift in long sessions
- Never store speculative, duplicate, or transient status notes in repo memory

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
3. Continue only after clarification; if unavailable, take the safest minimal action and document limits.

---

{{FRAMEWORK_OVERLAY}}
