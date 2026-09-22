# How changes here are reviewed

<!-- Written by /cortex. The three lenses are durable. The severity line, the cap and the exclusions
     are this repo's own — tune them from real reviews, roughly monthly. -->

## Three lenses

Label every finding with the lens that produced it.

| Lens | Looking for |
|---|---|
| Correctness | wrong logic, unhandled edges, behaviour that quietly changed |
| Safety | untrusted input reaching a sink, missing auth checks, secrets or personal data in logs |
| Fidelity | drift from `spec.md`, `plan.md`, and the rules written in `AGENTS.md` |

## Severity

A finding is **blocking** only if merging it would break behaviour, expose data, or violate a
written rule. Everything else — naming, formatting, taste — is a **suggestion**.

## Volume

At most **{{NIT_CAP}}** suggestions per review; report any beyond that as a single count. A review
people learn to skim is a review that stops catching things.

## Out of scope

{{DO_NOT_REPORT}}

Anything a CI check already fails the build on.

## Closing the gap

The second time a review catches the same mistake, the fix goes into `CLAUDE.md` in the same PR,
so the next session is told before it makes it. A change that makes `CLAUDE.md` or `AGENTS.md`
inaccurate is itself a finding.
