# 0021. Cortex ships no mod and keeps the `CLAUDE.md` shim

**Date:** 2026-10-03
**Status:** accepted

## Context

Claude Code v2.1.287 added mods on 2026-10-01: a plugin whose `hooks/hooks.json` names a hooks
module, with handlers that run inside Claude Code. A mod can draw a pane or a band above the
prompt, add a command that runs without a model turn, and rewrite or answer a tool call. Cortex is a
plugin, so each of these was suddenly available to it. A band showing `cortex-next`'s one line is
the obvious use.

The same weeks changed a second thing Cortex depends on. Since v2.1.277 Claude Code reads
`AGENTS.md` directly when no `CLAUDE.md` is at or above the working directory, and then loads a
subdirectory's `AGENTS.md` as Claude opens a file there. `/cortex-scaffold` writes `CLAUDE.md` as
one line, `@AGENTS.md`. That file counts as a `CLAUDE.md`, so under it the scoped briefs
`/cortex-brief` writes are reached through the root's routing table and no other way.

Both pulled toward a change, and each change had a cost that is easy to miss. The sentences this
record rests on are rules in `core/claude-code.js` (`mod.*`, `agents-md.*`), so the daily docs check
reports when one of them stops being true.

## Decision

**Cortex ships no mod.** The plugin holds skills, subagents and an MCP server. It holds no
`hooks/hooks.json`, and nothing in it runs inside Claude Code.

**`/cortex-scaffold` keeps writing `CLAUDE.md` as `@AGENTS.md`.** Cortex states the cost instead of
removing it: the findings report and `cortex-next` say when a repo's scoped briefs load by routing
only, and name the setting a developer can change (`index/lib/instructions.mjs`).

**Cortex reports on mods a repo ships, by their files only** (`index/lib/claude-setup.mjs`). It
never reads a hooks module's code.

## Alternatives rejected

| Option | Why not |
|---|---|
| A `/cortex-next` band as a mod | "Mods aren't sandboxed": the module runs in every session of everyone who installs Cortex, with their permissions. Under `allowManagedModsOnly` a mod from a remote marketplace does not load, and a team on a work machine is the audience most likely to run under that policy, so the feature would be missing exactly where Cortex is used by several people. The line it would show is one command away. |
| Port the `optimize-prompt` hook to a mod and ship it | The same two costs, for a gate that is a preference of this repo's maintainer and is not shipped today. A `SessionStart` notice was dropped on 2026-09-30 for the smaller version of this reason. |
| Stop writing the shim; let Claude Code read `AGENTS.md` directly | Sessions before v2.1.277, sessions with the built-in `agents-md` plugin disabled, and some sessions before v2.1.281 read `CLAUDE.md` only. They would get no instructions at all, with no error. `/cortex` also appends `## Verifying your work` to `CLAUDE.md`, which would need a new home. The docs say to keep the import where some sessions cannot load `AGENTS.md`, and that it is never read twice. |
| Write a `CLAUDE.md` shim into every directory that has a scoped brief | It loads the briefs, and it doubles the files `/cortex-brief` owns. That ritual nests one filename, `AGENTS.md`, so a reader never has to ask which file holds the rule. |
| Set `claude-md-and-agents-md` for the user | The setting is read from user or managed settings and ignored in a project's. Writing into `~/.claude/settings.json` is outside any repo Cortex was pointed at. |
| Read a mod's code for the calls it makes | `claude plugin validate` already prints them from the real parser. A regex copy would miss cases and disagree with it, and Cortex has no parser by [ADR 0004](0004-no-runtime-dependencies.md). |

## Consequences

- Cortex's surface in a session stays what a user can read as text: skills, subagents, and tools
  from an MCP server. Nothing it ships can approve a tool call or see a prompt.
- Cortex gives up interface it could have had. A user who wants `cortex-next` on screen runs it.
- Scoped briefs keep depending on the routing table in repos that keep the shim. That is stated to
  the user, and it is the one cost here that falls on every stamped repo.
- The fences Cortex stamps (`protected-paths.sh`, the Tester's `test-paths.sh`) are `PreToolUse`
  hooks outside managed settings, and a mod a user installed can approve an edit they blocked. Both
  now say so. Cortex cannot close that from inside a repo.
- Revisit the shim when the versions that cannot read `AGENTS.md` directly are no longer in use by
  the people Cortex serves. The rule `agents-md.min-version` is the number to check against.
