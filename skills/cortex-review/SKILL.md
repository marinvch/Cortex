---
name: cortex-review
description: Review a change against the repo's OWN documented context — the AGENTS.md, CONTEXT.md and ADRs Cortex wrote — on two axes: does the change break a documented rule, and did it just make one of those documents wrong. Use when the user asks to review a diff, check a change before committing, or asks whether the docs still match the code.
capability: judgment
---

# /cortex-review — read the context back

Cortex writes `AGENTS.md`, `CONTEXT.md` and ADRs. Until this ritual, nothing ever **read them
back**. The context layer could be generated, and audited for bloat by `/optimize-context`, and
never once consulted to judge a change.

That leaves two failures with nothing watching for them, and the second is the one no other review
tool looks for.

## The two axes

**Standards** — does the change break a rule this repo has written down? Not your taste, not
general best practice: a rule that appears in one of the documents below, quoted.

**Drift** — did the change make one of those documents **wrong**? Documentation rots silently
because a diff touches code and nobody re-reads the prose describing it. From this repo's own
history, both found by a human reading rather than by any check:

- `index/AGENTS.md` said *"Coverage uses two signals"* for weeks after it used three.
- `AGENTS.md` pointed at `mcp/lib/scrub.js` for months after scrub moved to `core/`.

Neither broke a test. Both misled the next agent that read them — the entire cost of a context
layer being *wrong* rather than merely absent.

## Run the evidence pass first

```bash
node index/cortex-review.mjs --staged        # what you are about to commit
node index/cortex-review.mjs --since HEAD~3  # a range
node index/cortex-review.mjs path/to/file.ts # named files
node index/cortex-review.mjs --staged --json # to walk it yourself
```

Deterministic and read-only. It finds and cites; it never judges. It gives you:

- **Governing documents**, nearest scope first — the leaf `AGENTS.md` that owns the directory, then
  the root. Both apply: a review consulting only the leaf misses the repo-wide invariants.
- **Glossary terms** the change works in, from `CONTEXT.md`.
- **Documents that NAME something the change touched** — the drift candidates.

If it reports no context layer, say so and stop. There is nothing to review against, and
`/cortex-install` is the answer, not a review improvised from general principles.

## Then do the judging

1. **Read every governing document.** Not skim — the rules are prose, and the one that matters is
   rarely the one with a heading. Pair this with `node index/cortex-impact.mjs` when the change
   touches something widely imported; a documented rule about a module matters more when twenty
   files depend on it.
2. **For each documented rule the change touches, decide: followed, broken, or not applicable.**
   Quote the rule and cite `file:line`. A finding that cannot quote the document it rests on is not
   a standards finding — it is an opinion, and it belongs in the *other* section clearly labelled as
   such.
3. **For each named mention, re-read that line against the new code.** A mention is not a defect —
   it is where one would hide. Ask only: *is this sentence still true?* Report the ones that are
   not, with the line and what it should now say.
4. **Say what you could not check.** Rules described in prose without naming a path are invisible to
   the evidence pass, and a change can violate one without ever appearing in the drift list.

## Reporting

Lead with drift, then broken rules, then everything else. Drift comes first because it is the
finding the author cannot see for themselves — the code in front of them looks right, and the
sentence describing it is somewhere else.

Never edit a document on your own authority here. `/cortex-review` reports; the human decides what
the sentence should say, the same way `/optimize-context` never deletes prose it merely judged
bloated.

If nothing is wrong, say that plainly and name what you checked. A review that manufactures a
finding to look useful costs more than one that returns clean, because the next one gets skipped.
