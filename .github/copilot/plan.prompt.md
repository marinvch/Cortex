---
description: "Break a defined feature into discrete, ordered implementation tasks"
---
Given the feature brief produced by /define, create an implementation plan.
Output a numbered task list where each task:
- Has a clear, actionable title (≤ 10 words)
- Lists the files to create or modify
- Notes dependencies on other tasks
- Flags any task that requires a schema migration, API contract change, or external service
Order tasks so each can be validated independently before the next begins.
Do NOT write any code yet — planning only.
