# Copilot Context — Quick Start

> **If starting a new conversation**: call `get_session_context` before any task to reload all critical context.

## MUST-ALWAYS Rules

- Call get_repo_memory before non-trivial implementation tasks.
- Call get_conventions before writing new code.
- Call get_impact_of_change before editing shared source files.
- Prefer minimal, in-scope edits and avoid broad refactors unless requested.
- Run npm run build and npm run test after substantial code changes.
- Use Markdown conventions for all new code
- Primary language: Markdown with TypeScript
- Package manager: npm — do not mix with others
- Call get_repo_memory before starting any non-trivial task
- Call get_conventions before writing new code

## Build & Test

```bash
npm run build   # build
npm run test   # test
```

## Key Files

| File | Role |
|------|------|
| `README.md` | key file |
| `package.json` | key file |
| `Dockerfile` | key file |

## Session Restart Protocol

1. Call `get_session_context` → reloads this card
2. Call `get_repo_memory` → reloads durable decisions
3. Call `get_conventions` → reloads coding rules

## Non-Trivial Task Protocol

> Before writing any code on a non-trivial task:

1. **Clarify** — state what is ambiguous; ask focused questions if needed
2. **Discover** — call `get_project_structure` and `get_file_summary` on relevant files
3. **Assess impact** — call `get_impact_of_change` before editing any shared file
4. **Plan** — use `/plan` to produce a task list before touching code
5. **Build one task at a time** — use `/build`, confirm, then proceed