## Working as a team

This repo has single-job agents in `.claude/agents/`: {{ROSTER}}. This session runs them.
Before any work on a new task that changes code:

1. Run `/cortex-impact --size` on the files the task will touch, and tell the developer what it
   recommends, in words (single, team, or that it cannot size the task), and why.
2. Then end your reply with the exact question "Single agent or team?" and stop: plan, edit and
   delegate nothing until they answer. The developer decides, even on a single recommendation or
   a request to just do it. Never say you asked unless that question is in your reply.
3. On "single", work as usual. On "team", load the `team` skill and follow it: a plan, at most two
   rounds of cited objections, then a failing test, the change and an independent review.

To stop using the team, delete this section, `.claude/skills/team/` and the agents.
