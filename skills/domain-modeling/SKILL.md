---
name: domain-modeling
description: Sharpen a repo's domain language — challenge fuzzy terms, and write its CONTEXT.md glossary and ADRs. Triggers — "what should we call this", "these two words mean the same thing", "record this decision", "write an ADR".
metadata:
  capability: judgment
---

# /domain-modeling — one word per concept, written down when it settles

A codebase decays when one concept carries two names, or one name covers two concepts. This ritual
is for the moments the model is being **changed**: a term is disputed, a boundary is unclear, a
decision is being made. Looking a word up in an existing glossary is not this ritual; any ritual
does that in passing.

[[codebase-design]] supplies the words for the shape of the code; this ritual supplies the words
for what the code is about. `/cortex` stamps the context layer, and this ritual keeps the language
in it precise.

## Which "context" this is

| | Where | What it holds |
|---|---|---|
| a vault's `context/` | the user's vault, private | **the user**: priorities, values, how they work |
| a repo's `CONTEXT.md` | the *target* repo, committed | **the repo's vocabulary**: a glossary and nothing else |

This ritual writes only the second. It never edits a vault's `context/`, and it never carries an
employer's or client's terms into a personal vault. That is the firewall in
[`templates/vault-AGENTS.md`](../../templates/vault-AGENTS.md), not a preference.

## Files in the target repo

```
CONTEXT.md            the glossary, at the root; most repos need nothing more
CONTEXT-MAP.md        only when the repo has several bounded contexts
docs/adr/NNNN-*.md    decisions; adr/ instead when docs/ is the source of a published site
```

Create each file when it first has content: `CONTEXT.md` when the first term is settled,
`docs/adr/` when the first decision qualifies. An empty glossary is worse than none, because it
looks maintained.

When `CONTEXT-MAP.md` exists, each context keeps its own `CONTEXT.md` beside its code
(`src/billing/CONTEXT.md`). Work out which context the current discussion belongs to, and ask when
it is not clear.

## While the discussion runs

- **Hold the user to the glossary.** When they use a term differently from its written definition,
  point it out at once and ask which meaning is right: "`CONTEXT.md` says a *refund* returns the
  whole payment; you are describing a partial one."
- **Pin down vague words.** When a word could mean two things, name both and ask which: "by
  *member* do you mean the person or their seat on the plan?" Propose one canonical term.
- **Test boundaries with cases.** When two concepts are being related, invent a specific case that
  falls between them and ask where it belongs.
- **Check claims against the code.** When the user says how something works, read the code. If it
  disagrees, say so: "you said a booking can move between rooms, but `Booking.room` is set once in
  the constructor."
- **Write the term the moment it settles.** Edit `CONTEXT.md` in the same turn. Updates saved for
  the end of the session do not get written.

[CONTEXT-FORMAT.md](CONTEXT-FORMAT.md) has the entry format and the multi-context layout.

`CONTEXT.md` holds definitions only. No implementation notes, no specs, no decisions, and no
general programming terms, however often the project uses them. A term earns an entry when it means
something particular in this domain.

## When a decision earns an ADR

Offer one only when the decision is all three:

1. **Costly to undo.** Reversing it later takes real work.
2. **Puzzling without the story.** Someone reading the code later would ask why it was done this way.
3. **A choice between real options.** Something else was viable and lost for a stated reason.

If any one is missing, do not offer it. A cheap decision gets reversed, an obvious one raises no
question, and a decision with no alternative has nothing to record.

[ADR-FORMAT.md](ADR-FORMAT.md) has the layout, the numbering and the kinds of decision that usually
qualify. A repo's ADRs are not a vault's `decisions/log.md`: that log holds the user's personal
decisions and stays in the vault.
