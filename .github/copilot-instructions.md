# AI Coding Assistant — Project Instructions

## Project: ai-os

**Primary Language:** Markdown  
**Framework(s):** Markdown  
**Package Manager:** npm  
**TypeScript:** Yes

---

## Tech Stack

- **Markdown** (58% of codebase, 52 files)
- **TypeScript** (21% of codebase, 19 files)
- **Shell** (12% of codebase, 11 files)
- **JSON** (7% of codebase, 6 files)
- **HTML** (2% of codebase, 2 files)

---

## Detected Conventions

- **Naming:** kebab-case for files and identifiers
- **Linter:** none detected
- **Formatter:** none detected
- **Test Framework:** none detected
- **Test Directory:** none detected

---

## Key Files

- `README.md`
- `package.json`
- `.github\copilot-instructions.md`

---

## Architecture

See `.ai-os/context/architecture.md` for the full architecture overview.  
See `.ai-os/context/conventions.md` for detailed coding conventions.  
See `.ai-os/context/stack.md` for the complete dependency inventory.

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

- Before implementation, retrieve relevant memory with `get_repo_memory`
- Follow `.ai-os/context/memory.md` for memory safety and quality rules
- After completing a substantial task, store durable findings with `remember_repo_fact`
- Prefer memory-backed decisions over assumptions to reduce drift in long sessions

---

## Markdown Project

No specific framework template found. Follow the general rules above.
