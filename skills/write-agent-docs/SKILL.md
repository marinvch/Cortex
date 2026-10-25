---
name: write-agent-docs
description: The discipline for writing documents an agent reads — skills, AGENTS.md, CONTEXT.md, any doc behind a pointer — and the steps that create and wire a new Cortex skill. Triggers — "this brief is bloated", "why doesn't the agent pick this up", "make a skill for X", "add a ritual".
metadata:
  capability: judgment
---

# /write-agent-docs — documents an agent will follow

This applies to anything an agent reads to decide what to do: a skill, an `AGENTS.md` or
`CLAUDE.md`, a `CONTEXT.md`, a document reached from a pointer in one of those. They are packaged
differently and written the same way. The goal is not identical output on every run. It is that the
agent **takes the same route through the work every run**, so that when the result is wrong, the
document is what you fix.

- Writing a skill: also read [`SKILL-MECHANICS.md`](SKILL-MECHANICS.md) for the frontmatter, the
  choice between model-invoked and user-invoked, and router skills.
- Creating a new Cortex skill, or turning a repeated task into a `/slash` command: follow
  [`NEW-SKILL.md`](NEW-SKILL.md) to name it, write it, wire it into the tables, give it an inbound
  edge and verify it. Ask the user before writing.

## Two budgets

Every line you add is paid for from one of two budgets.

- **Context load** is the agent's. Anything always loaded (an `AGENTS.md` line, a skill
  description) uses tokens and attention on every turn, whether or not the turn needs it.
- **Cognitive load** is the human's: knowing which documents exist and when to use each. The person
  is acting as the index. This budget is not something to drive to zero; it is what keeps a person
  in control. Spend it where their judgment matters and remove it where it does not.

Material behind a pointer costs context load only for the pointer's line. Material that nothing
points at costs no context load, and is found only if a person remembers it.

## Pointers

A **context pointer** is a line in loaded context that names material held elsewhere and says when
to fetch it. A skill's description is a pointer; so is a row in an `AGENTS.md` routing table. The
**wording of the pointer, not the content of the target, decides whether the agent fetches it**,
and how reliably. If something essential sits behind a weakly worded pointer, the agent will
sometimes miss it. Reword the pointer first; move the material inline only if rewording does not
work.

A pointer says what the material is, and lists the cases that should lead to it. A **branch** is
one distinct case the document handles, a path some runs take and others do not. Because a pointer
is always loaded, cut it harder than the body:

- **Start with the leading word** (below). The opening of the pointer does most of the matching.
- **One trigger per branch.** Three synonyms for the same case are one branch. Keep one; keep
  separate triggers only for cases that are actually different.
- **Do not repeat what the body says about itself.** The pointer's job is to be reached.

## Where each piece goes

A document contains **steps**, the actions the agent carries out in order, and **reference**, the
rules, definitions and facts it looks up as needed. A document can be all steps (a procedure), all
reference (the rules for a review, or this page), or a mix.

Place each piece by how soon the agent needs it:

1. **Steps in the file.** The main content: what to do, in order.
2. **Reference in the file.** Looked up when needed. A flat list of equal rules is a normal shape
   for this, not a defect.
3. **Reference in another file**, behind a pointer, read only when the pointer fires. That can be a
   sibling file in the skill's folder or a shared file anywhere that several documents point at.

Keeping too much in the file buries the steps; moving too much out hides what the agent needs.

**Disclosure** is moving material down that list, out of the file and behind a pointer, so the
main file stays readable. Its purpose is keeping the steps visible, more than saving tokens. The
test is by branch: keep in the file what every branch needs, and move out what only some branches
use. When reference that should have moved sits between the steps, whether the agent attends to a
given step becomes a matter of chance.

**Keep related material together.** A concept's definition, its rules and its exceptions belong
under one heading, so reading one part brings the rest. A document grouped this way reads like
documentation for the agent; one where a concept is split across sections does not. This is
different from duplication: duplication says one thing twice, scattering splits one thing into
pieces.

**Sprawl** is a document that is too long even though every line is current and unique. Attention
spreads thinner over each extra line, and each line is one more to keep correct. The cure is the
same list: move reference behind pointers, and split by branch or by sequence so each path carries
only its own material.

## How a step ends

Every step needs a **completion criterion**: the condition under which the step is done. It works
along two dimensions.

- **Clarity: can the agent tell done from not done?** A soft criterion ("once the problem is
  understood") leads to **premature completion**, where the agent stops because finishing is
  attractive, not because the step is finished. The steps still ahead pull it forward; a clear
  criterion holds it in place. Fix this by making the criterion checkable first, since that is local
  and cheap. Only if it cannot be made sharp, and you have seen the agent rush it, hide the later
  steps by splitting the sequence. Hiding works only across a real context boundary, such as a
  hand-off to a new session or a subagent dispatch. Calling another file inline keeps the later
  steps in context.
- **Demand: how much does it ask for?** "Every changed model accounted for" produces thorough work
  where "list the changes" does not. Demand sets how much digging the agent does without the digging
  being written as steps. It works on reference too: "every rule applied" sets a bar for a flat list
  of rules the same way "every step done" does for a procedure.

The best criteria are checkable and exhaustive at once.

## Splitting one document into two

A split spends one of the two budgets, so it needs a reason:

- **By sequence.** When the steps that come later tempt the agent to rush the current one, put them
  in a separate document so the current step gets full attention. Merging two sequences has the
  opposite effect: each step can now see more steps after it.
- **By invocation.** Only for skills; see [`SKILL-MECHANICS.md`](SKILL-MECHANICS.md).

## Words that do work

A **leading word** is a short term the model already understands from training, used so the agent
thinks with it while it works. Used repeatedly as the same token, it gathers meaning from every
place it appears and steers a whole area of behaviour for very few tokens. You can coin a term, but
a new word brings no prior understanding, so you pay for its definition; look for an existing word
first.

It acts in two places. In the body, it shapes **execution**: each time the word appears, the agent
does the same kind of thing, and inside a list of reference it tells the agent what class of
problem to look for. In a pointer, it shapes **invocation**: when the same word appears in the
user's prompts, the repo's documents and the code, the agent connects them and reaches the material
more reliably.

Look for places where a phrase can become one word. Two from Cortex's own rituals:

- `/debug-issue` asks for a command that goes **red** on the bug. "A check you trust" is a
  judgment; red is a state the agent can observe.
- `/challenge-plan` asks the **frontier** each round. "The questions that are ready to ask" needs a
  sentence of explanation every time; the frontier is one word, defined once.

The result is fewer tokens and a firmer anchor for the agent's reasoning. Most documents contain
restatements a leading word would replace.

**Steer toward the behaviour, not away from it.** A prohibition puts the unwanted behaviour into
context and makes it more likely: the named thing is strongly activated, the "do not" attached to it
is weak, and the instruction partly reads as a suggestion. Write the target ("keep comments to one
line") and the unwanted behaviour never needs naming. Use a prohibition only as a hard limit that
cannot be phrased positively, and even then state the positive target beside it.

## Keeping a document short and correct

- **One home per meaning.** Each fact or rule lives in one place, so changing the behaviour is one
  edit. **Duplication** costs upkeep and tokens, and makes the repeated point look more important
  than it is. A leading word is different: it repeats a token on purpose, never the explanation.
- **Do not restate the environment.** `package.json` scripts, config files, the directory layout
  and `--help` already say what they say. A document that repeats them is a **cache** of a lookup,
  worth keeping only when the lookup is expensive. Write down what looking cannot find: the
  unwritten convention, the reason for a choice, the trap no config file mentions.
- **Cite a name, not a line number.** A `path:line` goes stale the moment anything above the line
  changes, so the rule depends on how long the document lives, not on what kind of document it is.
  A **finding** is read within hours and never again, so `path:line` is correct there and required:
  a review comment or a grounded role reviewer keeps giving it. A **durable** document (a brief, a
  skill, a code comment meant to outlast its commit) is read for months, so it names a function, a
  constant or a heading: `markerLine`, not `findings.mjs:196`. Paths can be checked by tooling
  because a path is a name; a line number is the one form of citation that escapes the check. A
  rename shows up in the diff. A line moving from 196 to 218 does not. This repo shipped exactly
  that inside one PR on one day, when an edit to an unrelated finding above the cited line moved it.
- **Check each line still applies.** A line stops applying when it never bore on the task
  (explanation for its own sake, or a branch that should have moved out) or when what it describes
  has changed. Short documents are easier to keep current. Without regular pruning, documents
  collect **sediment**: old layers that stay because adding feels safe and deleting feels risky,
  until finding the live part means digging.
- **Remove no-ops.** A **no-op** is an instruction the model would follow anyway; it costs load and
  changes nothing. Test each sentence by asking whether it changes behaviour compared with no
  sentence at all. The answer depends on the model, not on the reader, so settle a disagreement by
  running the document, not by arguing. When a sentence fails, delete all of it rather than trimming
  it. The same test applies to leading words: a word too weak to move the default (*careful*, for an
  agent that is already fairly careful) is a no-op, and the fix is a stronger word (*exhaustive*),
  not a different technique.
- **Write the procedure, not a patch for one model.** A step belongs when any capable reader would
  read it correctly: what to do and why. A sentence whose only reason is that one model skips a step
  or overdoes another is a patch. The next model reads it as a rule without a cause, and no one can
  tell when it is safe to remove. Record the observation in an issue, with the transcript that shows
  it. If a step is unclear to every reader, fix the step and give its reason. A capability floor is
  a different thing: it is declared once in the frontmatter, and the ritual says what to do below it.

## What this governs in Cortex

Every document Cortex writes into a repo is one of these, so this page is the authoring standard for
the rituals that write them:

| Cortex writes | Written by | What matters most |
|---|---|---|
| root `AGENTS.md` and its routing table | `/write-context-docs` | the table is a set of context pointers; their wording decides whether a leaf is ever read |
| scoped `AGENTS.md` leaves | `/write-area-brief` | disclosure: a leaf exists so the root stays readable |
| `CONTEXT.md` | `/define-terms` | one home per meaning: a term defined twice is not defined |
| `skills/<name>/SKILL.md` | this ritual, by [`NEW-SKILL.md`](NEW-SKILL.md) | see [`SKILL-MECHANICS.md`](SKILL-MECHANICS.md) |
| `.cortex/memory/` digests | `/end-of-day-summary` | relevance: a digest that restates the diff is sediment the day it is written |

- **`/trim-agent-docs` audits against this page.** When it reports a repo's agent files as
  bloated, its findings are the problems named here: sprawl, duplication, no-ops, an essential
  target behind a weak pointer. It never deletes prose on its own authority, so the judgment calls
  go back to the user.
- **In Cortex, `disable-model-invocation: true` is also a safety flag.** As a load trade it is
  covered in [`SKILL-MECHANICS.md`](SKILL-MECHANICS.md). Cortex also uses it so that a once-only or
  destructive ritual can never fire on its own, and that outranks the load trade. Keep the flag when
  editing such a ritual's frontmatter. `grep -l '^disable-model-invocation: true' skills/*/SKILL.md`
  is the list of record. Keep the anchor: this page and `NEW-SKILL.md` mention the flag in prose, and
  an unanchored grep counts them.

## The official rules this sits on

Everything above is judgment. The hard limits are Anthropic's, and a document that breaks one is
wrong however well it reads. The pages that state them:

- [Skills](https://code.claude.com/docs/en/skills): the frontmatter keys Claude Code recognises
  (others are ignored without an error; custom data goes under `metadata:`), `description` plus
  `when_to_use` truncated at 1,536 characters, and `SKILL.md` kept under 500 lines.
- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices):
  the limits of the Agent Skills format, which the API and a claude.ai upload read. A name of at
  most 64 characters in lowercase letters, numbers and hyphens, a description of at most 1,024
  characters, and a table of contents at the top of a reference file over 100 lines. Claude Code
  loads a skill that breaks these, so Cortex reports them as low.
- [Subagents](https://code.claude.com/docs/en/sub-agents): their own frontmatter keys, and the tools
  a subagent inherits when it names none.
- [Memory](https://code.claude.com/docs/en/memory) and
  [Best practices](https://code.claude.com/docs/en/best-practices): how long a `CLAUDE.md` may run,
  `@path` imports, and emphasis that works on one line and stops working on many.
- [Hooks](https://code.claude.com/docs/en/hooks): which exit codes block, and which events can.
- [Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5):
  effort, and why a text-only end of turn is read as a report, not as proof the work is done.

Cortex holds each rule as data with the sentence that states it (`core/claude-code.js`), and its
findings report every breach under `claude-setup/`, on this repo too, where any finding fails the
build.
