---
name: grilling
description: Interview the user relentlessly about a plan, decision or idea until every branch of the design tree is resolved. Use when thinking needs stress-testing before it becomes work, or when another ritual reaches a decision it must not guess at. Triggers — "grill me", "stress-test this", "poke holes in this", "what am I missing", "interview me about this".
---

# /grilling — resolve the design tree before you build

Interview the user relentlessly until you reach a shared understanding. Map this as a **design
tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already
settled — the questions you can ask *now* without guessing at answers you haven't heard yet. Ask
the whole frontier in one round: number each question and give your recommended answer. Then wait
for the user's answers before the next round.

Format each question like this:

```
❓ **Q1** - **<question title>**: <question body, may be several paragraphs, and may offer choices>

➡️ <your recommended answer>
```

Each round of answers reshapes the tree: settled decisions push the frontier outward and unblock
questions that depended on them. Recompute the frontier and ask the next round. A question whose
answer depends on another question still open *in this round* belongs to a **later** round, not
this one.

**Finding facts is your job, never the user's.** When a frontier question needs a fact from the
environment — the filesystem, the index, a tool — dispatch a sub-agent to find it. Don't ask the
user anything you could look up yourself. Don't block on it either: a running exploration is an
unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report.
Ask the rest of the frontier now.

The **decisions** are the user's. Put each to them and wait.

The session is done when the frontier is empty: every branch visited, nothing left silently
assumed. **Do not act on it until the user confirms** you have reached a shared understanding.

## Where this fits in Cortex

Grilling is the shared interview discipline the other rituals borrow — it is vocabulary and
method, not a stage in any one workflow:

- `/improve-codebase-architecture` runs its grilling loop here, once the user picks a candidate
  from the report.
- `/analyze-spec` grills the brainstorm before it hardens into a design spec.
- `/level-up` and `/onboard` interview the user; both should ask in rounds with a recommended
  answer rather than one question at a time.

Two Cortex rules apply while grilling, because a grilling session is where they get broken:

- If a decision crystallises a **term**, add it to the target repo's `CONTEXT.md` as you go.
  If it settles a **trade-off with a rejected alternative**, offer an ADR under `docs/adr/`.
- The employer firewall holds. Grilling a personal project must not pull day-job systems,
  colleagues or client names into the conversation record.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT). The design-tree and
frontier method is upstream and unmodified; the "Where this fits in Cortex" section is a Cortex
addition.
