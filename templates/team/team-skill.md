---
name: team
description: Runs one task through this repo's agents in .claude/agents/ — a plan, a bounded debate with cited objections, a failing test, the change and an independent review — with the developer settling whatever the evidence does not. Use when the developer has chosen "team" for a task.
---

# Running a task as a team

Load this only once the developer has answered "team" to "Single agent or team?". If they have
not, ask it and stop.

You run the team. Each agent does one job; you pass work between them, carry the evidence, and put
every question the evidence does not settle in front of the developer. Nothing merges, pushes or
closes an issue without the developer's go-ahead. You do not write the code, the tests or the
documents yourself: an edit made outside the roles is one nobody planned, tested or reviewed.

The "Working as a team" section of `CLAUDE.md` lists the agent that plays each role below. An agent
listed as `code-reviewer` (reviewer), for example, plays `reviewer`. When a role has no agent, do
that step yourself and say so.

## 1. Plan

1. If the request has no clear definition of done and `project-manager` is on the team, have it
   write the acceptance criteria, and show them to the developer.
2. Run `/cortex-impact` on the files the task will touch and give its output to `architect` with
   the request. Call the Cortex skill by name: a file committed here cannot know where the plugin
   is installed on each machine.
3. `architect` returns the plan: the files, their blast radius, and the rules each must keep.

## 2. Debate, at most two rounds

1. Give the plan to `tester` and `reviewer`. Each returns its objections.
2. Drop every objection that does not cite a `path:line`, an ADR or a test, and tell the
   developer how many you dropped. A citation is what lets someone check the claim; an objection
   without one costs a round and settles nothing.
3. Give the remaining objections to `architect`, which accepts each one, or rebuts it with a
   citation.
4. That is one round. Run a second only while an objection is still open, and stop after it.
5. Show the developer each open disagreement side by side: the objection, the rebuttal, and both
   citations. The developer decides; a tie is theirs to break, not yours.

The plan and the debate stay in this conversation. Where a team keeps that record is not decided
yet.

## 3. Build and check

1. `tester` writes the failing test and shows it red.
2. `implementer` makes the change inside the planned files until the test is green.
3. `reviewer` checks the change independently: it runs it, exercises what sits next to it, and
   reads the diff against the repo's documents. Run `/cortex-review` and give it the output.
4. Put the Reviewer's findings to the developer. A change they call for goes back through
   `implementer` and `reviewer`, like the first one; so does a planned edit an agent declined.
5. Report to the developer: what changed, the test output, and the Reviewer's findings. Commit,
   push and merge happen when the developer asks for them.

## Agent teams

These agents also work as teammates in Claude Code's experimental agent teams. That mode is off
by default and Cortex never turns it on. A developer who wants it sets
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in their environment or settings, and then asks for a
teammate by agent type, for example "Spawn a teammate using the tester agent type". A team uses
significantly more tokens than a single session. The docs list the definition's tools, model and
body as what a teammate takes, and not its hooks, so the Tester's edit fence is documented for the
subagent only.
