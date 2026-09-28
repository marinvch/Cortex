# templates/team — the agent-team roles

One Claude Code subagent per role, the Tester's fence, the playbook every session loads, and the
`team` skill that holds the debate protocol.
[The design](../../docs/specs/2026-09-28-agent-team-design.md) holds each role's job and tools.
`/cortex` offers them through its `team` loop row, one role at a time, and stamps what the developer
picks ([`skills/cortex/TEAM.md`](../../skills/cortex/TEAM.md)). `index/lib/team.mjs` decides what is
offered and fills every value below it can detect; `cortex-loop.mjs . --team <roles>` prints them.

| Template | Lands at |
|---|---|
| `<role>.md` | `.claude/agents/<role>.md`, for each role the developer picked |
| `test-paths.sh` | `.claude/hooks/test-paths.sh`, executable, only with `tester.md` |
| `playbook.md` | appended to `CLAUDE.md` |
| `team-skill.md` | `.claude/skills/team/SKILL.md` |

Render with `node index/cortex-stamps.mjs render team/<file> --values-file <json>`. A value
`/cortex` did not detect is a question for the user, never a guess.
`index/test/team-templates.test.mjs` fails when a template uses a placeholder this table does
not list, or the table lists one that no template uses.

| Placeholder | Used by | Filled with | Detected from | When not detected |
|---|---|---|---|---|
| `{{TEST_CMD}}` | `implementer`, `reviewer`, `tester` | the test command, verbatim | `state.commands.test` in `cortex-loop.mjs --json` | ask the user |
| `{{RUN}}` | `reviewer` | the command that launches the change | the value `verifier.md` was stamped with, when `.cortex/stamps.json` records it | ask the user |
| `{{ADR_DIR}}` | `architect` | the decision-record directory, with a trailing `/` | `adrLocation(root).dir` in `index/lib/adr.mjs` | always detected; it falls back to `docs/adr/` |
| `{{TEST_PATHS}}` | `tester` | where tests live, as comma-separated code spans such as `` `test/**` `` | the files the index marks `isTest` | ask where tests go |
| `{{TEST_GLOBS}}` | `test-paths` | the same locations as shell globs, one double-quoted glob per line indented two spaces, such as `"*/test/*"` or `"*.test.ts"`; each is matched against `/` plus the path from the repo root | the files the index marks `isTest` | ask; an empty list refuses every edit |
| `{{PLAN_DIRS}}` | `project-manager` | the plan folders that exist, as comma-separated code spans | which of `intent/`, `docs/specs/` and `docs/plans/` exist | the role is not offered |
| `{{ROSTER}}` | `playbook` | the agent playing each role, as comma-separated code spans such as `` `architect`, `tester` ``; an existing agent mapped to a role carries the role after it, as `` `code-reviewer` (reviewer) `` | the roles the developer picked in this run, plus any existing agent mapped to a role | never empty: with no agent on the team, picked or already here, the playbook is not written |
| `{{SCOPED_BRIEFS}}` | `architect` | one line per scoped brief, in the form `` - `<dir>/AGENTS.md` `` indented three spaces, under step 1 | every `<dir>/AGENTS.md` in the index | empty, which removes the line |

## The Tester's fence

`test-paths.sh` lands at `.claude/hooks/test-paths.sh`, executable. The `PreToolUse` hook in
`tester.md`'s frontmatter runs it before every Edit and Write the Tester makes. It is an allow-list,
so it fails closed: an edit is refused unless the path resolves inside the repo, outside `.claude/`,
to a file matching a glob. A missing script blocks too, because the command ends in `|| exit 2`.

What it does not cover:

- **An untrusted folder, and `claude -p`.** Claude Code skips a project subagent's frontmatter hooks
  until the folder's workspace trust dialog is accepted, and a `-p` session does not count
  ([subagents](https://code.claude.com/docs/en/sub-agents#hooks-in-subagent-frontmatter)).
- **Bash.** The Tester has it to run tests, and a shell command can write any file. The body tells
  the Tester to write through Edit and Write only; that is an instruction, not a fence.
- **Windows without Git Bash.** The command runs `bash`, and without Git Bash Claude Code runs
  hooks in PowerShell. Whether a PowerShell failure there still exits 2 depends on its version, so
  treat Git Bash as required, as it already is for `protected-paths.sh`.

The first half of `test-paths.sh` reads the hook input exactly as the loop's `protected-paths.sh`
and `format-changed.sh` do. Each hook is stamped alone into a repo with no library to source, so the
reader is copied, and `tools/test/test-paths.test.sh` fails when the copies differ.
