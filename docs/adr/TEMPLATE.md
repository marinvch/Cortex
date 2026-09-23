<!--
  An architecture decision record. Copied into a target repo as docs/adr/NNNN-slug.md.

  Write one ONLY when the decision is hard to reverse, surprising without context, or a real
  trade-off. A record of an obvious choice is noise, and noise is what stops people reading the
  records that matter.
-->

# {{NNNN}}. {{A short claim that states the decision, not the topic it is about}}

<!--
  The title — and the file slug after the number — is the decision itself, so a reader who meets
  the record cited mid-sentence gets the verdict without opening it. From Cortex's own records:

    0004-no-runtime-dependencies            "Cortex ships with no runtime dependencies"
    0010-the-shell-half-gets-the-guard-too  "The shell half gets the root guard too"
    0013-the-version-has-one-home           "The version has one home"

  Not the topic: `0010-guard-destructive-shell-tools` says what the record is about; the claim says
  what was decided. Keep it plain enough to survive being read cold — if the title only makes sense
  after the Context section, it is a riddle, not a claim.
-->

**Date:** {{YYYY-MM-DD}}
**Status:** {{proposed | accepted | superseded by [NNNN](NNNN-slug.md)}}

## Context

{{What forced a decision. The constraint, the pressure, what was already true. Someone reading
this in a year should understand the pressure without having been there.}}

## Decision

{{What was decided, stated plainly and in the present tense.}}

## Alternatives rejected

| Option | Why not |
|---|---|
| {{option}} | {{the actual reason — cost, risk, a constraint it violated}} |

This table is the point of the record. Without it, the decision gets re-litigated by the next
person who has the same idea.

## Consequences

{{What this makes easy, and what it makes hard. Include the cost you are accepting — a record
that lists only benefits is a sales pitch, not a decision.}}
