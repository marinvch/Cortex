## Working as a team

This repo has single-job agents in `.claude/agents/`: {{ROSTER}}. This session runs them.

For each new task that changes code:

1. Run `/cortex-impact --size` on the files the task will touch. It recommends single or team,
   with its reasons.
2. Give the developer that recommendation and its reasons, and ask the developer which to use.
   The developer decides.
3. On "single", work as usual. On "team", load the `team` skill and follow it: a plan, at most two
   rounds of cited objections, then a failing test, the change and an independent review.

To stop using the team, delete this section, `.claude/skills/team/` and the agents.
