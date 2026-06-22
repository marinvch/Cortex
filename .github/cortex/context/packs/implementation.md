# Context Pack: implementation

## Scope

Use for feature work and bug fixes in the AI OS codebase.

## Must-Load Inputs

- Session context via get_session_context
- Repository memory via get_repo_memory
- Conventions via get_conventions

## Primary Files

- src/generate.ts
- src/generators/
- src/mcp-server/
- src/tests/generators.test.ts
- README.md

## Linked Notes

- ../knowledge-vault.md
- ../memory.md
- ../templates/decision-note.md
- ../templates/failure-pattern.md
- ../templates/tool-recipe.md

## Execution Checklist

1. Confirm task boundaries and assumptions.
2. Check impact of change for shared files before edits.
3. Apply minimal, in-scope changes.
4. Run npm test and npm run build.
5. Record verified durable facts only.

## Exit Criteria

- Requested behavior is implemented.
- Validation commands pass.
- No unrelated files were modified intentionally.
