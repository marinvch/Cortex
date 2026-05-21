---
description: "Refactor a component following project conventions"
---
Refactor the component I specify following the project conventions.
Before touching anything:
1. Read the component file completely
2. List all imports and consumers (grep for the component name)
3. Identify props, data hooks (custom/fetching), and state
Then:
- Apply the naming conventions from .github/ai-os/context/conventions.md
- Extract business logic to the existing shared module pattern used by this repo (for example lib/, services/, or hooks/)
- Ensure TypeScript strict compliance (no any)
- Verify all callers still compile after the refactor
