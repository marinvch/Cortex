---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
capability: mechanical
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

# /handoff — hand the live session to the next agent

Write a handoff document summarising the current conversation so a fresh agent can continue the
work. Save it to the **temporary directory of the user's OS** — never the workspace, never this
vault.

Include a **suggested skills** section naming which skills the next agent should invoke.

Do not duplicate content already captured in other artifacts — specs, plans, ADRs, issues,
commits, diffs. Reference them by path or URL instead.

Redact anything sensitive: API keys, passwords, tokens, connection strings, personally
identifiable information. **Say what you redacted and where**, so the next agent knows a value
exists rather than silently inheriting a gap.

If the user passed arguments, treat them as a description of what the next session will focus on
and tailor the document accordingly.

## Which ritual you actually want

Three Cortex rituals move context across a gap, and they are not interchangeable:

| Ritual | Gap it crosses | Where it writes | Lifespan |
|---|---|---|---|
| `/handoff` | **this live session → another agent, now** | OS temp dir | ephemeral |
| `/dream` | today → tomorrow, for the whole team | `.cortex/memory/<date>.md`, committed | permanent |
| `/catch-me-up` | you were away → what changed | nothing; it reads | — |

The cut is **in-flight state versus durable knowledge**. Everything a future reader of the
codebase would want — a decision and its rejected alternative, a gotcha, a dead end not worth
re-exploring — belongs in `/dream`, because a handoff in the temp directory is gone by next week.
Everything that only matters until this task is finished — what you were mid-way through, which
file you had open, what the user just said they wanted — belongs here.

When a session produced both, write both. Running `/handoff` alone on a day that taught you
something is how the lesson gets lost.

## Rules that hold while writing one

- **The employer firewall applies.** A handoff is still a written record. Day-job systems,
  colleagues and client names do not enter it.
- **A handoff is not a substitute for committing.** If the work is finished, ship it. Handing an
  agent a description of uncommitted work is strictly worse than handing it the commit.
- **Name the branch and the working-tree state.** A handoff that omits which branch the work sits
  on sends the next agent to `master` to look for changes that are not there.
- **Write it for `/resume`, because that is what reads it.** The next session establishes the repo's
  state from git and `.cortex/memory/` on its own; what it cannot recover is the part only you know —
  what you were about to try, what you already ruled out and why. Spend the words there and let the
  deterministic half stay deterministic.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT). The instruction body
is upstream; the ritual comparison, the redaction-disclosure rule and the firewall/branch rules
are Cortex additions.
