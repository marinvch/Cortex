---
name: domain-modeling
description: Build and sharpen a repo's domain model — challenge fuzzy terms, stress-test them against scenarios, and write the glossary and decisions down as they crystallise. Use when discussing a codebase's terminology, writing or editing its CONTEXT.md, or recording an ADR. Triggers — "what should we call this", "these two words mean the same thing", "record this decision", "write an ADR". Runs inside a target repo, not the vault.
---

# /domain-modeling — name things once, argue about them never again

Two words for one concept is how a codebase rots. This ritual is the **active** discipline of
fixing that: challenging terms, inventing edge cases that force precision, and writing the result
down the moment it settles. Merely *reading* a glossary for vocabulary is not this skill — that's
a one-line habit any ritual can do. Reach for this when you're **changing** the model.

Pairs with [[codebase-design]] (which names the *shape* of code) the way a glossary pairs with a
blueprint. `/install-project` stamps the brain; this ritual sharpens the language inside it.

## Two different "context" — don't confuse them

| | Lives | Holds |
|---|---|---|
| the vault's `context/` | this repo, gitignored | **who the user is** — priorities, values, how they work |
| a repo's `CONTEXT.md` | the *target* repo, committed | **what its words mean** — a glossary, nothing else |

This ritual only ever writes the second. It never touches `context/` here, and it never carries
employer or client vocabulary back into this vault — that's the firewall, not a style preference.

## Where things go, in the target repo

```
CONTEXT.md            <- the glossary (root; most repos need only this one)
CONTEXT-MAP.md        <- only if the repo has several bounded contexts
docs/adr/0001-*.md    <- decisions worth remembering
```

**Create files lazily** — only when there's something to write. No `CONTEXT.md` until the first
term is actually resolved; no `docs/adr/` until the first ADR earns its place. An empty glossary
is worse than none: it looks maintained.

If `CONTEXT-MAP.md` exists, the repo has multiple contexts and each lives beside its own code
(`src/ordering/CONTEXT.md`). Infer which one the current topic belongs to; ask if it's unclear.

## During the session

**Challenge against the glossary.** When a term conflicts with what's already written, say so
immediately — "your glossary defines *cancellation* as X, but you mean Y — which is it?"

**Sharpen fuzzy language.** Propose a precise canonical term for vague or overloaded ones. "You're
saying *account* — do you mean the Customer or the User? Those are different things."

**Stress-test with scenarios.** When relationships are being discussed, invent concrete edge cases
that force precision about where one concept ends and the next begins.

**Cross-reference with the code.** When the user states how something works, check whether the
code agrees. Surface contradictions: "your code cancels whole Orders, but you just said partial
cancellation is possible — which is right?"

**Update `CONTEXT.md` inline.** The moment a term resolves, write it. Don't batch — batched
glossary updates never happen. Format: [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md).

Keep it a glossary. `CONTEXT.md` is **totally devoid of implementation detail** — not a spec, not
a scratchpad, not a home for decisions. Only terms specific to *this* domain; general programming
concepts don't belong however heavily the project uses them.

## Offer ADRs sparingly

Only when all three are true:

1. **Hard to reverse** — changing your mind later actually costs something.
2. **Surprising without context** — a future reader will wonder "why on earth did they do it this
   way?"
3. **The result of a real trade-off** — there were genuine alternatives and one was picked for
   specific reasons.

Miss any one and skip it. Easy to reverse? You'll just reverse it. Not surprising? Nobody will
wonder. No real alternative? There's nothing to record beyond "we did the obvious thing."

Format and the qualifying categories: [ADR-FORMAT.md](ADR-FORMAT.md). Note that a repo's ADRs are
**not** the vault's `decisions/log.md` — that one is the user's personal decisions, and it stays
here.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT). `CONTEXT-FORMAT.md`
and `ADR-FORMAT.md` are vendored; the two-contexts warning and firewall rules are Cortex additions.
