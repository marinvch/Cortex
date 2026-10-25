---
name: improve-codebase-architecture
description: Find shallow modules worth deepening, report them as an HTML page, then grill through the one the user picks.
effort: high
disable-model-invocation: true
metadata:
  capability: strong
---

# /improve-codebase-architecture — find the shallow modules worth deepening

The output is a short list of **deepening opportunities**: places where several shallow modules
could become one deep module with a smaller interface. The point is code that is easier to test and
easier for an agent to find its way around, not tidiness.

Two sources of vocabulary, and both are binding:

- [[codebase-design]] (`references/codebase-design.md`) for the architecture: module, interface,
  implementation, depth, seam, adapter, port, leverage, locality, and the tests for shape (the
  deletion test, testing through the interface, counting adapters). Use those words and no
  substitutes. "Component", "service", "API" and "boundary" do not appear in the report.
- The repo's `CONTEXT.md` for the domain, and its ADRs (`docs/adr/` or `adr/`) for decisions that
  are already made. A decision recorded there is not reopened without a reason that would survive
  the ADR's own argument.

## 1. Decide where to look

Deepening pays back through future changes, so look where change is happening.

- If the user named a module, subsystem or pain point, start there and skip the rest of this step.
- Otherwise read a long stretch of history (`git log --oneline`, and `git log --name-only` for the
  files) and find the areas that keep changing. Start with those. If the changes are spread evenly,
  widen the search.

Read `CONTEXT.md` and any ADRs covering the chosen area before reading its code. If the repo has a
`.cortex/` index, `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-impact.mjs" <files>` shows each
candidate's dependents and which of them no test covers.

## 2. Explore

Hand the walk through the code to a sub-agent and have it report where understanding was hard. No
checklist; these are the questions to keep in mind:

- Where does following one concept mean jumping through many small modules?
- Which modules are shallow, with an interface nearly as complicated as their implementation?
- Where were pure functions pulled out to be tested, while the bugs sit in how they are called?
- Where do closely coupled modules reach across each other's seams?
- What is untested, or hard to test through the interface it has now?

Run the deletion test on every suspect: if the module were removed, would its complexity vanish or
reappear in the callers? Reappearing is what marks a real module; vanishing marks a candidate.

## 3. Report the candidates

Write one self-contained HTML file to the OS temp directory, so nothing lands in the repo:
`$TMPDIR`, else `/tmp`, else `%TEMP%` on Windows, named `architecture-review-<timestamp>.html` so
each run gets a new file. Open it (`xdg-open` on Linux, `open` on macOS, `start` on Windows) and give
the user the absolute path.

[HTML-REPORT.md](HTML-REPORT.md) has the page skeleton, the card layout, the diagram types and the
style rules. In short, each candidate gets a card with the files involved, a before-and-after
diagram, the problem, the change, the gains in terms of leverage and locality, and a strength of
`Strong`, `Worth exploring` or `Speculative`. The page ends with the one candidate to do first, and
why.

Name things with the repo's own words. If `CONTEXT.md` defines *Booking*, the card says "the Booking
module", not the class name and not "the booking service".

If a candidate goes against an existing ADR, include it only when the friction is serious enough to
justify reopening the decision, and say so on the card: "contradicts ADR 0007; worth reopening
because ...". Leave out refactors an ADR rules out unless that bar is met.

Do not propose interfaces in the report. When the file is written, ask the user which candidate they
want to explore.

## 4. Work through the chosen candidate

Run `/grilling` on it: the constraints, what depends on it, the shape of the deepened module, what
sits behind its seam, and which tests survive.

Keep the domain model current while decisions land, as `/domain-modeling` describes:

- A deepened module named after a concept missing from `CONTEXT.md`: add the term, creating the file
  if needed.
- A term sharpened in the conversation: update its entry then.
- The user rejects the candidate for a reason a later review would need: offer an ADR, so future
  runs do not propose it again. Skip reasons that are temporary ("not now") or obvious.
- The interface is still open: use the "Comparing interface designs" section of [[codebase-design]]
  to put two or three designs side by side.

## When the floor is not met

Finding deepening opportunities means holding the shape of a whole codebase at once and arguing
about where modules end. A weaker setup returns generic advice such as "consider splitting large
files", which costs tokens and tells the user nothing.

Below the floor, run **`/cortex-install`** and read the findings report instead. It is
deterministic, ranks by size, churn and missing tests, and names real files. That is a smaller
claim, and an honest one.
