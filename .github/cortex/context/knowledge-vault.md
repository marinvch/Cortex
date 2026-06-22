# Knowledge Vault Workflow

Use this workflow to keep project knowledge durable, linked, and easy for humans and agents to retrieve.

## Purpose

- Capture decisions, patterns, and failures as small reusable notes
- Link related notes so context can be assembled quickly per task
- Improve response quality by reducing repeated rediscovery

## Note Taxonomy

- Decision Notes: Stable technical choices and tradeoffs
- Prompt Patterns: Reusable prompt and tool orchestration patterns
- Failure Patterns: Root cause and reliable fix recipes
- Tool Recipes: Repeatable command and validation sequences
- Context Packs: Task-scoped bundles of links and constraints

## Operating Rules

1. Keep each note atomic: one decision, one pattern, or one failure per file.
2. Keep titles explicit and stable.
3. Prefer links over duplication.
4. Record evidence and validation commands for each non-trivial claim.
5. Mark superseded notes explicitly instead of silently editing history.

## Suggested Cadence

1. During work: add rough notes in branch-local drafts.
2. Before merge: convert durable notes using templates.
3. End of task: store only verified facts in repository memory.

## Suggested Folder Layout

- `.github/ai-os/context/templates/decision-note.md`
- `.github/ai-os/context/templates/prompt-pattern.md`
- `.github/ai-os/context/templates/failure-pattern.md`
- `.github/ai-os/context/templates/tool-recipe.md`
- `.github/ai-os/context/templates/context-pack.md`
- `.github/ai-os/context/packs/implementation.md`

## Retrieval Flow

1. Start with session context and repository memory.
2. Load matching context pack for the task type.
3. Pull linked decision/failure/tool notes as needed.
4. Keep active task context minimal and relevant.

## Weekly Measurement

Use `.github/ai-os/metrics/scorecard.json` to track:

- first-pass success rate
- tool-call success rate
- rework rate
- average time to fix
- context hit rate

Update with `npm run scorecard:update` and review with `npm run scorecard:show`.
