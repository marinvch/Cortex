---
name: challenge-plan
description: Interview the user relentlessly about a plan or decision until every branch is resolved. Triggers — "grill me", "stress-test this", "poke holes in this", or a ritual reaching a decision it must not guess.
effort: high
metadata:
  capability: strong
---

# /challenge-plan — question a plan until nothing in it is assumed

A plan is a set of decisions, and most of them depend on others: the storage choice waits on the
consistency requirement, which waits on who reads the data. Treat the plan as a **decision tree**
and keep asking until every branch has an answer the user gave, not one you supplied.

## How a session runs

1. **Lay out the tree.** List the open decisions and, for each, which other decisions it depends
   on. Keep this in your working notes; the user does not need to see the whole tree.
2. **Find the frontier.** The frontier is every open decision whose dependencies are all settled:
   the questions that can be answered now without guessing at an earlier answer.
3. **Ask the whole frontier as one round.** Number the questions. Give each one your recommended
   answer and the reason for it. If a question's answer would change because of another question
   in the same round, it is not on the frontier yet; hold it for a later round.
4. **Wait for the answers.** Then mark those decisions settled, add any new decisions the answers
   opened, and recompute the frontier.
5. **Repeat until the frontier is empty**: every branch visited, nothing taken as given without
   being asked.
6. **Confirm before acting.** Summarise what was decided and ask the user to confirm it is the
   shared understanding. Nothing gets built on the plan until they do.

Write each question like this:

```
**Q3. <short title>**
<the question; as long as it needs to be, with options if there are any>

Recommended: <your answer, and why>
```

## Facts are yours to find; decisions are the user's

If a question turns on something you can look up (a file, the index, a config value, a tool's
output), look it up instead of asking. Hand the lookup to a sub-agent and keep going: only the
questions that depend on that fact wait for it, and the rest of the frontier goes out now.

What the user chooses (scope, trade-offs, priorities, risk) is never something to infer. Ask, and
wait for the answer.

## Where this fits in Cortex

Grilling is the interview method other rituals use; it is not a stage of any one of them.

- `/architecture-review` grills the candidate the user picks from its report.
- `/design-spec` grills a brainstorm before it becomes a design spec.
- `/write-context-docs` grills the user for what the code cannot tell it.
- `/retrospective` and `/personal-setup` also interview the user, but about the user: their week, their work.
  Those questions have no answer to recommend, so they do not use rounds. `/personal-setup` asks one
  question at a time, and on a re-run takes what the vault already holds as the default. Use rounds
  when the answers are decisions.

Two Cortex rules come under pressure in a grilling session, so hold them deliberately:

- When an answer fixes the meaning of a **term**, add it to the target repo's `CONTEXT.md` as you
  go. When it settles a **trade-off and an alternative was rejected**, offer an ADR in the repo's ADR
  directory (`docs/adr/`, or `adr/`). `/define-terms` has the formats.
- **The employer firewall holds.** Grilling a personal project does not bring day-job systems,
  colleagues or client names into the record.

## With nobody to answer

The method needs a person on the other end. In a headless run (`claude -p`), inside a subagent, or
when the user has said they are away, no one will answer the round.

In that case, write the current frontier once, each question with its recommended answer, and
report it as the blocker: which decisions are open, and what work waits on each. A recommended
answer is still only a recommendation, so build nothing on it. Continue only with work that no open
decision touches. When the user or the calling ritual answers, resume from that round.

## When the floor is not met

Each round depends on the answers to the last. A model that cannot hold that state repeats
questions and stops before the tree is resolved, and an early stop reads as agreement, so the
failure looks like success.

Below the floor, run it as a **written** interview: put three questions in a file, have the user
answer in the file, read the file again, and add the next three. The file holds the state the model
cannot. It is slower, and it still converges.
