# Skill mechanics

What changes when the document is a skill. Everything about writing it well is in
[`SKILL.md`](SKILL.md); this page covers who can start it, when to split one off, and skills that
exist to point at other skills.

## Who can start it

A skill is either model-invoked or user-invoked, and the choice moves cost between the two budgets
in `SKILL.md`.

| | Model-invoked | User-invoked |
|---|---|---|
| Frontmatter | no `disable-model-invocation` | `disable-model-invocation: true` |
| Who can start it | the agent, other skills, and the user by name | only the user, by typing its name |
| `description` | written for the model: what it is and the trigger for each branch | written for a person reading the `/` menu: one line, no trigger list |
| Context load | the description is loaded on every turn | none |
| Cognitive load | low: the agent can find it | the user must remember it exists |

Making a skill model-invoked never takes anything from the user; they can still type it. The
description is the skill's top-level context pointer, and the price of being found is that it is
always loaded. Write it by the pointer rules in `SKILL.md`.

Choose model-invoked only when the agent has to reach the skill unprompted, or another skill has to
reach it. A skill that only ever runs because someone typed it should be user-invoked and cost no
context.

**Shared reference.** A model-invoked skill that is all reference can serve as the one home for
material several skills need: they invoke it. Two user-invoked skills cannot share that way,
because neither can start the other. Put what they share in a plain file outside the skill system
and point both at it.

## Splitting by invocation

`SKILL.md` covers splitting by sequence. The other reason to split part of a skill into its own
skill is reach: split off a model-invoked skill when it has its own leading word, one that actually
appears in your prompts and should trigger it alone, or when another skill needs to reach it. The
new description is loaded on every turn, so the separate reach has to be worth that.

## Router skills

When there are more user-invoked skills than a person can remember, add a **router skill**: one
user-invoked skill that lists the others and says when to use each, so there is one name to
remember instead of many. A router can only suggest. The skills it lists have no description, so
only the user can start them.

## In Cortex

The ritual table in `AGENTS.md` is a router, naming 30-plus rituals and when to use each. It is a
file, not a skill, so it is read without being invoked. The guidance under the table exists because
a name is not enough when two rituals sound alike and are not (`/handover-notes` writes for the next agent,
`/end-of-day-summary` commits for the next reader). When the text needed to tell two rituals apart grows longer
than the difference itself, they are one ritual. `/cortex-doctor` and `/scope-area` were deleted for
that reason, and `/audit` and `/reindex` became modes of `/audit-notes`. See
[ADR 0011](../../docs/adr/0011-four-rituals-covered-two-jobs.md).

The "Where to look" table in `AGENTS.md` routes the same way, to the `core/`, `index/` and `mcp/`
leaves, and it says **read one**. A router that does not say how many targets to open gets all of
them opened.
