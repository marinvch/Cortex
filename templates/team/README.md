# templates/team — the agent-team roles

One Claude Code subagent per role, written to `.claude/agents/<role>.md` in the target repo.
[The design](../../docs/specs/2026-09-28-agent-team-design.md) holds each role's job and tools.
Nothing stamps these yet: the `/cortex` offer arrives in plan step 14.

Render with `node index/cortex-stamps.mjs render team/<role>.md --values-file <json>`. A value
`/cortex` did not detect is a question for the user, never a guess.
`index/test/team-templates.test.mjs` fails when a template uses a placeholder this table does
not list, or the table lists one that no template uses.

| Placeholder | Used by | Filled with | Detected from | When not detected |
|---|---|---|---|---|
| `{{TEST_CMD}}` | `implementer`, `reviewer`, `tester` | the test command, verbatim | `state.commands.test` in `cortex-loop.mjs --json` | ask the user |
| `{{RUN}}` | `reviewer` | the command that launches the change | the value `verifier.md` was stamped with, when `.cortex/stamps.json` records it | ask the user |
| `{{ADR_DIR}}` | `architect` | the decision-record directory, with a trailing `/` | `adrLocation(root).dir` in `index/lib/adr.mjs` | always detected; it falls back to `docs/adr/` |
| `{{TEST_PATHS}}` | `tester` | where tests live, as comma-separated code spans such as `` `test/**` `` | the files the index marks `isTest` | ask where tests go |
| `{{PLAN_DIRS}}` | `project-manager` | the plan folders that exist, as comma-separated code spans | which of `intent/`, `docs/specs/` and `docs/plans/` exist | the role is not offered |
| `{{SCOPED_BRIEFS}}` | `architect` | one line per scoped brief, in the form `` - `<dir>/AGENTS.md` `` indented three spaces, under step 1 | every `<dir>/AGENTS.md` in the index | empty, which removes the line |
