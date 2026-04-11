# Copilot Context — Quick Start

> **If starting a new conversation**: call `get_session_context` before any task to reload all critical context.

## MUST-ALWAYS Rules

- Use Markdown conventions for all new code
- Primary language: Markdown with TypeScript
- Package manager: npm — do not mix with others
- Call get_repo_memory before starting any non-trivial task
- Call get_conventions before writing new code
- Call get_impact_of_change before editing any shared file

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