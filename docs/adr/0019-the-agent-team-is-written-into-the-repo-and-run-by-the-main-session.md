# ADR 0019 — the agent team is written into the repo and run by the main session

**Status:** accepted · 2026-09-28 · design: [the agent-team spec](../specs/2026-09-28-agent-team-design.md)

## Context

`/cortex` now offers a repo a team of single-job agents: Architect, Implementer, Tester, Reviewer,
and a Project manager where there is a plan folder. The roles, their tools and the debate between
them are in the spec. This record holds the four decisions that are hard to reverse once teams
commit the files, and the ones most likely to be proposed again:

- where the agents live;
- who runs them;
- how they disagree;
- what Cortex does about Claude Code's experimental agent teams.

Four facts from Claude Code's docs, checked on 2026-09-28, constrain all four:

- **An agent setting replaces the session's prompt.** Running a session *as* an agent
  (`claude --agent`, or the `agent` setting) replaces the default Claude Code system prompt.
- **Plugin agents lose three fields.** "Plugin subagents don't support the `hooks`, `mcpServers`,
  or `permissionMode` frontmatter fields. These fields are ignored when loading agents from a
  plugin." The agent-teams page documents teammates from the project, user or managed scope. It
  does not document teammates from a plugin.
- **Frontmatter hooks need a trusted folder.** A project subagent's frontmatter hooks run only
  after the folder's workspace trust dialog is accepted, and "a `-p` session doesn't count as
  trusted".
- **Agent teams are experimental and costly.** They are "experimental and disabled by default",
  behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, and "use significantly more tokens than a single
  session". A teammate takes the agent definition's tools, model and body, and the page does not
  list hooks among what it takes.

Cortex had also learned one lesson of its own. The note on `cortex-role-reviewer` records that an
ungrounded expert persona "returns advice that is true everywhere and actionable nowhere".

## Decision

1. **The team is written into the repo** (T8). Each role is a project-scope agent in
   `.claude/agents/<role>.md`, rendered from the repo's own commands, briefs and ADR directory, and
   recorded in `.cortex/stamps.json`. The Tester's edit fence is a `PreToolUse` hook in its own
   frontmatter, which only a project agent honours.
2. **The main session orchestrates** (T1). A section of about ten lines in `CLAUDE.md` names the
   team. For each new task that changes code, it has the session run `/cortex-impact --size` on the
   files the task touches and **ask the developer** single or team (T2). On "team" it loads the
   `team` skill, which holds the rest. The session passes work between the agents and edits nothing
   itself. Nothing sets `agent:`.
3. **Debate is bounded and evidence-only** (T5).
   - The Architect proposes a plan.
   - The Tester and the Reviewer object, and every objection cites a `path:line`, an ADR or a test.
     The session drops one that does not, and says how many it dropped.
   - The Architect accepts each remaining objection or rebuts it with a citation.
   - After at most two rounds, whatever is still open goes to the developer side by side, and the
     developer decides.
4. **Agent teams are compatible and never enabled** (T7). The agent files work as teammates. The
   `team` skill says how a developer starts a team; Cortex never sets the flag.

## Alternatives rejected

| Option | Why not |
|---|---|
| `agent: orchestrator` in settings, or `claude --agent` | It replaces Claude Code's own system prompt for the whole session, so the developer loses the default behaviour to gain a router. |
| An orchestrator subagent | The developer sees only its summary and cannot answer mid-run. T2 needs the developer in the loop at the choice and at every open disagreement. |
| Shipping the roles as plugin agents in `agents/` | Plugin agents ignore `hooks`, so the Tester's fence would silently not exist, and they are not documented as teammates. They also could not be grounded in one repo's commands and briefs, because one plugin file serves every repo. |
| Debate until the agents agree | It is expensive and can loop, and agreement between models is not evidence. Two rounds of cited objections surface the real disagreement, and the developer settles it. |
| Debate only in agent-teams mode | Most developers never turn that mode on, so they would get no debate at all. |
| Letting uncited objections stand | An objection nobody can check costs a round and settles nothing. It is the generic-advice failure the role reviewer's note records. |
| Turning agent teams on for a team repo | It spends a large token cost for everyone on a feature the docs call experimental. The developer opts in. |
| The session fixing small things itself | It happened in the first live run: the session reworded two comments and made a documentation edit that the Implementer had declined. An edit outside the roles is one nobody planned, tested or reviewed. |

## Consequences

**The limits, stated where the team is stamped** (`templates/team/README.md`):

- **Untrusted folders.** The Tester's fence does not run in an untrusted folder or under
  `claude -p`, and the agent still runs.
- **Bash.** Bash goes around the fence. The Tester needs Bash to run tests, so its body tells it to
  write only through Edit and Write, and that is an instruction, not a guard.
- **Teammates.** A Tester spawned as an agent-teams teammate is not documented to carry the hook,
  so the fence is documented for the subagent only.

**The live run** (plan step 15, #497). The team ran on an invented five-repo workspace under
`claude -p`, and the model followed the protocol:

- sizing before any work: a one-file fix read `single`, and a four-area change read `team`;
- a plan dense with `path:line`;
- cited objections: eight of eight in one run;
- the round limit held, including a rebuttal and withdrawal that stopped at two;
- red before green;
- a Tester that wrote only tests;
- a Reviewer that launched the service and found a real duplicate-POST risk;
- no commit, push or merge.

The one failure was the session editing files itself. The fix was one text change to the `team`
skill: the session writes nothing, and a change a review calls for goes back through the
Implementer and the Reviewer. The re-run followed it.

Two gaps stayed open. With the developer's answer supplied in the prompt, the session reported the
recommendation but never wrote the question out, and in one run it claimed it had. Interactive
sessions stop and ask, so the playbook was not changed.

**Costs accepted.**

- A team task costs several agents.
- The paths and commands inside each agent go stale as the repo moves. The stamp record notices
  when their templates change.
- Where the plan and the debate are kept is not decided. They stay in the conversation.

**Rollback** is deleting the `CLAUDE.md` section, `.claude/skills/team/` and the agents.
