# Plan: the sequenced install wizard for existing codebases

Spec: [`2026-08-17-legacy-install-sequence-design.md`](../specs/2026-08-17-legacy-install-sequence-design.md)

Vertical slices — each step compiles, tests green, and is revertible on its own. No expand–contract
phase is needed: `offer` is an added optional field, so no existing call site changes shape.

Verification for every step:

```bash
node --test index/test/*.test.mjs
node --test core/test/*.test.js
```

---

## 1. Findings carry a proposed action

**Touches:** `index/lib/findings.mjs`, `index/test/findings.test.mjs`

Add an optional `offer` to the finding shape: `{ action, target? }` where action is one of
`scaffold` · `brief` · `enrich` · `bundle` · `triage-secrets` · `memory`. Attach one to each finding
that proposes work; leave it absent on context-only findings.

`render()` is not touched — the report's prose stays exactly as it is today.

**Verify:** new tests assert each mapping — missing context → `scaffold`, proposed areas → `brief`
naming the directories, oversized `AGENTS.md` → `brief` (split, never re-scaffold), possible secrets
→ `triage-secrets` — that greenfield's single low finding carries none, and that two runs on one
tree produce identical offers (determinism, per `index/AGENTS.md`).

Severity does **not** imply an offer. *No test files found* is high and Cortex has no action that
writes tests; it stays a finding with no offer. A test pins that, because filling the column for
symmetry would ask a question the index never earned.

**Done** — 23 tests in `findings.test.mjs`, index 71/71 green.

## 2. Offers collapse by action

**Touches:** `index/lib/findings.mjs`, `index/test/findings.test.mjs`

Export `offers(findings)` returning the ranked, de-duplicated worklist: severity order preserved,
same-action findings merged into one entry carrying all targets — five untested areas become one
`brief` entry naming five candidates.

**Verify:** test with five untested-area findings returns one `brief` offer with five targets, and
severity ordering survives the merge (the merged entry takes its rank from its highest member).

**Done** — 29 tests in `findings.test.mjs`, index 77/77 green. An entry also carries the titles that
produced it, so the wizard can say *why* it is asking rather than naming a bare action.

## 3. Satisfied offers are suppressed on re-run

**Touches:** `index/lib/findings.mjs`, `index/test/findings.test.mjs`

An offer whose work already exists is not proposed: a real `AGENTS.md` suppresses `scaffold`, an
existing `.cortex/memory/` suppresses `memory`, an area with a scoped `AGENTS.md` drops out of the
`brief` targets.

**Verify:** the `baf8140` regression case still ranks a missing `AGENTS.md` high; the same fixture
with an `AGENTS.md` present emits the finding without a `scaffold` offer.

**Done — no code needed.** The suppression already existed at the finding level: missing-context
findings only fire when the file is absent, and `briefCandidates` already filtered finished areas.
The three tests added here are characterization, pinning it at the *offer* surface where the wizard
reads it. Confirmed on this repo: fully served → 2 context-only findings, empty worklist.

## 3b. The three offers no finding produces yet

**Touches:** `index/lib/findings.mjs`, `index/test/findings.test.mjs`

Surfaced while implementing step 1: `enrich`, `bundle` and `memory` are in the action set but no
current finding proposes them — they are repo-scale offers, not defects, so they need findings of
their own before the wizard can ask about them.

- `enrich` — a large repo with no `.cortex/index/enriched.json`. Low severity, states the token cost.
- `memory` — no `.cortex/memory/`. Low. Explains the committed/gitignored asymmetry once.
- `bundle` — a tier the index gives a reason for: a frontend proposes `browser-qa`, an API surface
  proposes `api`. Never recite the whole list.

**Verify:** each new finding is low severity and absent when already satisfied (an enriched repo
proposes no `enrich`); the greenfield assertion from step 1 still returns zero offers.

**Done** — index 89/89 green. The enrichment threshold is a named constant (`ENRICH_WORTH_IT = 50`)
because it is a judgement call meant to be argued with, not a number buried in a conditional.
Frontend detection keys on file extension, not language: `langs.mjs` maps `.tsx` to `typescript`, so
language alone cannot tell a frontend from a TypeScript backend.

## 4. `/cortex-install` walks the offers

**Touches:** `skills/cortex-install/SKILL.md`

Rewrite steps 4–6 for the legacy side of the fork:

- Step 4 walks `offers()` top-down, one at a time, recording yes/no/later. States plainly that
  nothing is written yet. Enrichment names its token cost **before** the question.
- Step 5 plays back the accumulated worklist as a list of paths, takes **one** confirmation, then
  hands off in worklist order to `/cortex-scaffold`, `/cortex-brief`, `/setup-plugins`, enrichment.
- Step 6 closes with paths written and anything marked "later".
- `triage-secrets` shows and stops — no remediation, and the fixtures caveat stays.

Greenfield text is untouched.

**Verify:** `node --test core/test/*.test.js` (`plugin.test.js` asserts the consent gate is stated);
then a manual dry run of the chain against a real repo, which is how the greenfield bug was found —
reasoning about it is what missed it the first time.

## 5. The gate is tested, not just written

**Touches:** `core/test/plugin.test.js`

`plugin.test.js` already asserts `/cortex-install` is model-invocable **and** states its consent
gate. Extend it: the skill must also state the single-confirmation playback, so the two halves of
ADR 0005's bargain stay tested together.

**Verify:** `node --test core/test/*.test.js`; delete the playback sentence locally and confirm the
test fails before restoring it.

## 6. Record the decision

**Touches:** `docs/adr/0006-<slug>.md`, `AGENTS.md`

ADR 0006: severity-ranked sequence over flat menu, and propose-all-then-one-yes over per-write
gates. Record the rejected alternatives from the spec's brainstorm — a separate `/cortex-onboard`
skill, a fixed pipeline order, per-write prompts — with why each lost.

Add the one durable gotcha to root `AGENTS.md`: the findings report is the wizard's script, so
changing `analyse()`'s ranking changes what users are asked first.

**Verify:** `node --test core/test/*.test.js` (link and structure checks).

## 7. Release

**Touches:** `CHANGELOG.md`, `VERSION`, both plugin manifests, `mcp/package.json`, `README.md`

Cut 2.4.0 — it carries this plus the four already-merged harvest commits sitting unreleased.

**Verify:** `node --test core/test/*.test.js` — `version.test.js` guards all five places a version
string lives, and has already caught two of them once.

---

## Outcome — all steps done, 2026-08-18

**Step 4.** The plan listed only `SKILL.md` as touched, and that was a gap: the skill had no way to
*read* `offers()`. `render()` was deliberately left alone, so the worklist reached the wizard through
a new read-only `cortex-findings.mjs --offers` that prints JSON and writes nothing — two surfaces
over one analysis. Parsing questions back out of rendered markdown was the alternative, and it would
drift the moment either was reworded.

Verified the way the plan demanded — a manual dry run, not reasoning. Indexed two real legacy repos
to a scratch path (never into someone else's tree): 108 files and 70 files, dozens of findings,
**five ranked questions each**. The collapse holds outside a fixture.

**Step 5.** `plugin.test.js` now asserts the single-confirmation playback *and* the write-nothing
offer walk beside ADR 0005's consent gate. Mutation-checked: deleting the playback sentence turns it
red, restoring it turns it green.

**Step 6.** [ADR 0006](../../adr/0006-the-report-is-the-wizards-script.md) — severity-ranked sequence
over flat menu, propose-all-then-one-yes over per-write gates, with the rejected alternatives
(`/cortex-onboard`, fixed pipeline order, per-write prompts, rendering the worklist into the report).
Root `AGENTS.md` carries the consequence: `analyse()`'s ranking is now control flow, not
presentation.

**Step 7.** 2.4.0 cut. The plan said `version.test.js` guards five places a version string lives —
it guards **six**. It caught the `CHANGELOG.md` link reference after the other five were already
updated. Third time that test has paid for itself.

Full suite: core 38/1 skipped, index 90, mcp 87 — 0 failures.
