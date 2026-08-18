# 0006. The findings report is the wizard's script; propose all, then one yes

**Date:** 2026-08-18
**Status:** accepted

## Context

Cortex's design promises that landing on a repo with code *fires a sequence* — index, report, the
user picks, apply. ADR 0005 made the sequence startable. It did not make it a sequence.

`/cortex-install` described a wizard and implemented a questionnaire. Step 4 presented four choices
— context layer, scoped briefs, bundle, nothing — all at once, in a fixed order that had nothing to
do with what the repo actually needed. The findings report sat beside the conversation as a document
the user was invited to go read. A repo whose worst problem was a possible secret and a repo whose
worst problem was a missing `AGENTS.md` were asked the same four questions in the same order.

The analysis already knew the answer. `analyse()` ranks every finding by severity; nothing carried
that ranking into what the user was asked. The ordering existed in one place and was thrown away
before reaching the only place it mattered.

Two questions had to be settled together, because the answer to each constrains the other: **what
decides the order of the questions**, and **where consent sits when there are many of them**.

## Decision

**The findings report is the wizard's script.** Findings carry an optional machine-readable `offer`
— `scaffold` · `brief` · `enrich` · `bundle` · `triage-secrets` · `memory` — and `offers()` returns
them as a ranked, de-duplicated worklist. `/cortex-install` walks that worklist top-down. Severity
decides what is asked first, so the repo's own state chooses the running order.

Offers **collapse by action**. Five areas that each want a brief are one question naming five
candidates, not five prompts. An entry inherits the severity of its highest-ranked member, so
merging can never bury a critical finding behind a low one, and carries the titles that produced it
so the wizard can say *why* it is asking. This is what keeps a thirty-finding report from becoming a
thirty-question interview.

Severity does **not** imply an offer. *No test files found* is a high finding and Cortex has no
action that writes tests; it stays a finding with no offer. Filling the column for symmetry would
ask a question the index never earned.

**Consent is propose-all-then-one-yes.** Step 4 walks every offer with nothing on disk. Step 5 plays
the accumulated worklist back as a list of paths and takes **one** confirmation. Step 6 applies in
worklist order. Enrichment states its token cost *before* its question and must appear by name in
the playback — it is the only offer that spends real money, and it may never ride along inside a
confirmation that never named it.

`triage-secrets` is an offer the wizard shows and stops on. No rotation, no redaction, no commit.
Some hits are fixtures, and a false positive acted on destroys trust in every other finding.

The offer field stays **data**. `render()` keeps sole responsibility for prose; the worklist reaches
the skill through `cortex-findings.mjs --offers`, which writes nothing at all. `index/` still never
modifies a repo except under `.cortex/`, and `/cortex-scaffold` remains the only path to a
source-tree write.

## Alternatives rejected

**A separate `/cortex-onboard` skill for the sequence.** Rejected as a second spelling of a shipped
ritual — the failure mode the 2026-08-17 harvest named repeatedly, and the same ground on which ADR
0005 rejected a read-only "orient" companion. The sequence belongs on the legacy side of the fork
`/cortex-install` already has.

**A fixed pipeline order** — always scaffold, then briefs, then bundle. Simple, predictable, and
rejected because it is exactly the flat menu being replaced. A fixed order cannot lead with a
critical secret finding, and it asks about enrichment on a repo whose `AGENTS.md` does not exist
yet. If order is not derived from the analysis, the analysis is decoration.

**Per-write prompts** — confirm each file as it is created. Rejected on two counts. It trains users
to click through prompts, which destroys the meaning of the one prompt that matters; and it puts the
decision point after the work has begun, when the honest moment to decline is before. The opposite
failure is just as real: a single up-front yes stretched to cover files it never named is not
consent either. The playback exists so the one yes is specific.

**Rendering the worklist into the report and parsing it back.** Rejected — the report is prose for a
human and would drift from the wizard's questions the moment either was reworded. Two surfaces over
one analysis, not one surface doing two jobs.

## Consequences

**The ranking is now load-bearing.** Changing how `analyse()` ranks findings changes what users are
asked first. That was previously a presentation detail in a document; it is now control flow. The
`baf8140` regression case — a missing `AGENTS.md` ranking high over real code — is the anchor test,
and root `AGENTS.md` carries the gotcha.

`core/test/plugin.test.js` asserts the single-confirmation playback and the write-nothing offer walk
alongside the ADR 0005 consent gate. All three are halves of one bargain: an agent may start this
sequence *because* it asks before it writes and writes once. They fail together on purpose.

Rollback stays trivial. Everything written is either under `.cortex/` (generated, gitignored) or a
new file the playback named. Nothing is edited in place, so undo is `rm` of a listed path.

Two things this deliberately does not settle. **Team / solo / self-hosted** is the remaining
big-task item; when it lands it likely changes step 4's ordering and which bundle tiers are offered,
but not the consent structure. **Whether `/grilling` drives step 4** stays open — greenfield
scaffolding asks a whole frontier in one round while ranked offers are sequential by construction,
and the two disciplines conflict. Decide that against a real report, not in the abstract.
