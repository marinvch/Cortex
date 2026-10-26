# 0031. One instruction file for every agent, and a skills copy only for the agents that need it

**Date:** 2026-10-26
**Status:** accepted

## Context

A team using Cortex often runs more than one coding agent. The question was whether the rules and
the skills a repo carries can have one source that every agent reads. It came up as a request for
`.claude/rules/`, which only Claude Code reads.

On 2026-10-26 the vendors' own docs said this:

| Agent | Reads `AGENTS.md` | Nested `<dir>/AGENTS.md` | Reads skills from |
|---|---|---|---|
| Claude Code | only when no `CLAUDE.md` is at or above the working directory (v2.1.277+) | same condition | `.claude/skills/` |
| Copilot | yes, for agent work. Repo-wide chat and code review use `.github/copilot-instructions.md` | yes, nearest wins | `.github/skills/`, `.claude/skills/`, `.agents/skills/` (VS Code) |
| Cursor | yes, no `.cursor/rules/` needed | yes, merged with parents | `.agents/skills/`, `.cursor/skills/`, and `.claude/skills/` for compatibility |
| Codex | yes | yes | `.agents/skills/` only |
| Gemini CLI | only if `context.fileName` lists it. Default is `GEMINI.md` | yes, for the configured names | `.gemini/skills/`, `.agents/skills/` |

Instructions already have one source. Skills do not: no single folder is read by all five agents.

## Decision

**Rules live in `AGENTS.md` and nested `<dir>/AGENTS.md`, and nowhere else.** A nested `AGENTS.md`
is the path-scoped rule every agent above understands. Cortex writes no `.claude/rules/`,
`.cursor/rules/` or Copilot instruction files from `/write-context-docs`. It keeps the two shims
the table still requires: `CLAUDE.md` (`@AGENTS.md`, per [ADR 0021](0021-cortex-ships-no-mod-and-keeps-the-claude-md-shim.md))
and `GEMINI.md`.

**Skills live in `.claude/skills/`.** Claude Code, Copilot in VS Code and Cursor read it. When the
team also uses Codex or Gemini CLI, `/suggest-skills` writes a byte-identical copy of each skill
to `.agents/skills/<id>/SKILL.md`. The `.claude/skills/` file is the source.
`index/lib/skill-drift.mjs` reports a copy that differs as `mirror` drift, so the copy cannot
quietly become a second source.

## Alternatives rejected

| Option | Why not |
|---|---|
| Write `.claude/rules/` | Claude Code is the only reader. A rule placed there is missing for every other agent, which is the opposite of one source. |
| Make `.agents/skills/` the source | Claude Code does not read `.agents/`. The agent most Cortex users run would get no skills. |
| Symlink `.agents/skills` to `.claude/skills` | Git on Windows checks a symlink out as a one-line text file unless `core.symlinks` is set, and that is off by default. The agents on those machines would read a path, not a skill. |
| Always write the copy | A Claude-only team would carry a folder no agent of theirs reads, plus a drift check to maintain. Asking once costs one question. |
| Shims for Cursor and Copilot in `/write-context-docs` | Both read `AGENTS.md` directly now. A shim adds a file that only repeats "read AGENTS.md". `tools/cortex-init.sh` still writes them for older versions of those tools. |

## Consequences

- One rules file per directory, read by all five agents (for Gemini CLI, through `GEMINI.md`).
- The cost of ADR 0021 stands. Under the `CLAUDE.md` shim, Claude Code reaches nested briefs through
  the root routing table, not by opening a file in that directory.
- A repo that serves Codex or Gemini CLI carries two copies of each skill. The drift check keeps
  them equal, but it only runs when someone runs `/suggest-skills` or `/setup-repo`. A copy edited
  by hand stays wrong until then.
- Copilot code review and repo-wide chat still read only `.github/copilot-instructions.md`.
  Whether a one-line pointer there is enough for them is not measured, so Cortex does not write it
  from `/write-context-docs`.
- The table above is a snapshot. Agent support changes fast; re-check the vendors' docs before
  relying on a row.
