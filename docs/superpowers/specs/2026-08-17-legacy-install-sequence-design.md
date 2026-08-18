# Design: the sequenced install wizard for existing codebases

**Date:** 2026-08-17 · **Status:** Draft for review · **Area:** `skills/cortex-install`,
`index/lib/findings.mjs` (see [`index/AGENTS.md`](../../../index/AGENTS.md))

## Destination

An agent lands in a repo that already has code. The user is carried, one decision at a time, from
"nothing" to a context layer that fits *this* repo — and every question asked is one the index
earned the right to ask.

Reaching the end looks like: the findings report is the wizard's script rather than a document read
beside it; the user answered a ranked sequence instead of a flat menu; and nothing was written until
they saw the complete list of paths and said yes once.

## Context

`/cortex-install` describes a wizard and implements a questionnaire. Steps 1–3 index and report;
step 4 presents four choices — context layer, scoped briefs, bundle, nothing — all at once, in a
fixed order, identical whether the index found 40 files or 40 000, secrets or none.

The greenfield half landed on 2026-08-17:

- `baf8140` — `isGreenfield(index)` forks on `index.stats.files === 0`; the empty repo stopped
  getting three ranked findings about missing docs for code that does not exist.
- `8f51e9f` — `/cortex-scaffold` interviews the user when there is nothing to read.
- `906596a` — the flag came off `/cortex-install`; [ADR 0005](../../adr/0005-the-install-sequence-may-start-itself.md)
  moved protection to a consent gate on the first write.

Those three define the legacy branch by contrast. Greenfield has no code, so it asks the user;
legacy *has* code, so it should ask the index — and today it does not ask anything at all.

Why now: the greenfield branch made the fork real, so the `false` side of `isGreenfield` is a
branch with no behaviour behind it. The wizard is also the last structural piece before the
team/solo/self-hosted split, which needs a sequence to thread through.

## Decisions locked

1. **The sequence lives inside `/cortex-install`.** Steps 4–5 become an ordered interview on the
   legacy side of the existing fork. No new ritual name — a second entry point is the failure the
   2026-08-17 harvest named repeatedly, and ADR 0005 already rejected splitting off a companion
   skill on exactly those grounds.
2. **Findings severity drives the order.** The wizard walks the ranked report top-down, one item at
   a time. Critical security findings lead, as step 3 already requires. The report stops being a
   document beside the conversation and becomes its script.
3. **Propose all, one yes, then write.** Picks accumulate across the interview without touching
   disk. At the end the wizard plays back every path it will create, takes one confirmation, then
   applies with a running log. One decision point — not a dozen prompts users learn to click
   through, and not a single up-front yes stretched to cover files it never named.
4. **Enrichment is offered; the audience split is not asked.** Legacy repos are where enrichment
   pays, so it enters the sequence with its token cost stated out loud. Team/solo/self-hosted is
   the other open big-task item and gets its own spec.

## Architecture

### The offer — findings gain a proposed action

`analyse()` today returns findings: severity, category, title, body. The wizard needs to know what
each finding *asks for*, and deriving that by re-reading prose in the skill would put the mapping in
two places.

Each finding gains an optional `offer`: a machine-readable action name plus its target
(`scaffold` · `brief:<area>` · `enrich` · `bundle:<tier>` · `triage-secrets` · `memory`). Findings
that propose nothing carry no offer and are reported as context only.

This stays **data**. `render()` keeps sole responsibility for prose, and the invariant from
`index/AGENTS.md` holds unchanged: nothing under `index/` modifies a target repo except by writing
under `.cortex/`.

### The sequence

```
1. Orient          (read-only; consent gate here if no .cortex/ — ADR 0005, unchanged)
2. Index           .cortex/index/index.json
3. Findings        .cortex/findings/<date>.md          <- the script
4. Walk the offers, ranked, one at a time              <- accumulates a worklist, writes nothing
5. Play back the worklist as paths; one confirmation
6. Apply: /cortex-scaffold, /cortex-brief, /setup-plugins, enrichment — in worklist order
7. Close: paths written, what to commit, what to re-run
```

Step 4 asks about each offer in rank order and records yes/no/later. "Later" is real and is written
to the close summary — a user who declines everything has been served completely, which step 4
already says today and must keep saying.

### Invariants this must not break

- **`index/` never writes outside `.cortex/`.** The offer field is data; only skills write.
- **The analysing skill has no authority to modify a repo.** `/cortex-scaffold` remains the only
  path to a source-tree write. This is what makes "the user decides" structural rather than a
  promise a model keeps.
- **The index stays deterministic** — no LLM, no clock, no network in `analyse()`. Offers are
  derived from index facts, so two runs on one tree produce identical offers; `build.test.mjs`
  already asserts the general form of this.
- **Never clobber a curated file** — `AGENTS.generated.md` beside it, as today.
- **Secrets are never auto-remediated.** `triage-secrets` shows the finding and stops. Some hits are
  fixtures, and a false positive acted on destroys trust in every other finding.

## Risks & edges

- **The report becomes load-bearing.** If `analyse()` mis-ranks, the wizard asks the wrong question
  first. Mitigation: order is severity-then-category, both already tested; the regression test from
  `baf8140` (missing `AGENTS.md` ranks high over real code) is the anchor case.
- **A long report becomes a long interview.** A repo with 30 findings must not produce 30 questions.
  Offers collapse by action — five untested areas propose one `brief` conversation naming five
  candidates, not five prompts.
- **Enrichment cost lands mid-sequence.** It is the only offer that spends real tokens. It must
  state the cost before the yes, never after, and never be bundled into the single confirmation
  without having been named in the playback.
- **Rollback:** everything written is either under `.cortex/` (generated, gitignored) or a new file
  the playback named. Nothing is edited in place, so undo is `rm` of a listed path.
- **Re-run:** a second install over an existing `.cortex/` re-indexes freely (ADR 0005) and must
  skip offers already satisfied — an existing `AGENTS.md` with real content produces no `scaffold`
  offer, only the never-clobber path.

## Not yet specified

- **Team / solo / self-hosted.** The sequence is where an audience question would live, but the
  split has no design yet. When it lands it likely changes step 4's ordering and which bundle tiers
  are offered — not the consent structure.
- **Monorepos.** Step 5 already suggests indexing one package when the tree is large; whether the
  wizard runs once per package or once per repo depends on how offers aggregate across packages,
  which needs a real monorepo to answer honestly.
- **Whether `/grilling` drives step 4.** Greenfield scaffolding uses it to ask a whole frontier in
  one round. Ranked offers are sequential by construction, so the two disciplines may conflict;
  decide against a real report, not in the abstract.

## Out of scope

- Any change to the greenfield branch — it shipped and is not reopened here.
- A `SessionStart` hook or any automatic firing. ADR 0005 rejected it; the plugin ships no hooks.
- Auto-remediation of any finding, secrets or otherwise.
- Changes to `/cortex-scaffold`'s templates or never-clobber rules — it owns those, and this spec
  only calls it.
