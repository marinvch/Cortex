# Design: a rule ledger — which rules in the briefs name a test

- **Date:** 2026-10-12
- **Status:** Approved by the maintainer on 2026-10-12 and built in the same change. Decision L5
  was replaced during validation; the first version is recorded under it.
- **Area:** `index/` ([`index/AGENTS.md`](../../index/AGENTS.md)), read through
  `index/cortex-review.mjs`.
- **Source of the idea:** the reconstruction obligation ledger in `morluto/rea`, where a claim
  closes only when it has an owner, a fixture and a passing verifier. Cortex takes the list and
  the evidence, and leaves out the closing: see [Decisions locked](#decisions-locked), L4.

## Destination

One command lists every rule written in a repo's briefs and says, for each, which test files the
rule itself names. A maintainer reads the list and sees which rules rest on prose alone.

Three things are true when this is done:

1. `node index/cortex-review.mjs --rules` prints the ledger for the whole repo, and `--json` gives
   the same rows to a ritual.
2. The same tree gives the same bytes, with no model and no network.
3. The numbers were checked by opening cited lines on cloned public repos, and every guard in the
   new module has been mutated and has failed a test.

## Context

- **The context layer is read back in one place.** `index/lib/review.mjs` judges a change against
  the briefs and finds citations that stopped resolving (`citationDrift`). Nothing reads the briefs
  to ask what holds each rule up ([`docs/changing-cortex.md`](../changing-cortex.md), the
  `/cortex-review` line).
- **This repo already believes the answer matters.** ADR 0016 says a guarantee that can be kept by
  code goes in code, and a guarantee left in prose gets a test that the prose is there. Several
  rules in `docs/changing-cortex.md` end by naming the test that pins them. No check says which
  rules do not.
- **Many rules that name no test are not failures.** `index/AGENTS.md` holds gotchas such as
  "import resolution is regex-based". That is a fact about a limit, and no test could enforce it.
  A ledger that called such an item "unenforced" would be wrong about the reader's own repo, which
  is the cost `lib/orphans.mjs` names in its header.
- **`analyse()`'s ranking is control flow** (ADR 0006). A new finding there changes the install
  interview for every user.
- **`/cortex-review` has a measured baseline** (`evals/skills.mjs`). Editing its body means a model
  run to record a new one.
- **`templates/target-AGENTS.md` stamps two sections for rules**, `## Invariants` and `## Gotchas`,
  and writes each rule as a plain list item.

## Decisions locked

| # | Decision | Rejected alternative |
|---|---|---|
| L1 | The logic is a pure module, `index/lib/rule-ledger.mjs`, taking the index and a `readText` function, as `review.mjs` does | Reading the filesystem inside the module, which makes every case need a temp tree |
| L2 | It is reached by a new flag, `cortex-review.mjs --rules`, repo-wide and needing no diff, like `--citations` | A new CLI. `cortex-review.mjs` is already the one reader of the context layer, and a second reader is how `context-docs.mjs` came to exist |
| L3 | It is **not** a finding in `analyse()` in this version | Adding it to the report now. Under ADR 0006 an unproven finding changes the interview |
| L4 | The ledger **finds and cites and never judges**. A row says what the rule names. It never says "enforced" or "unenforced" | rea's closing rule (owner, fixture, passing verifier). Deciding that a test enforces a sentence needs a model, and then the command cannot run in CI |
| L5 | A rule is a top-level list item in a section whose heading says invariants, gotchas or rules, as a whole word in any case. A subsection belongs to its section. The briefs read are `AGENTS.md` at any depth, and a `CLAUDE.md` or `GEMINI.md` that is not a shim | **The first version, built and then replaced:** any top-level item opening with bold text, under any heading. See [What validation changed](#what-validation-changed) |
| L6 | `CONTEXT.md`, ADRs and everything under `templates/` are not read. An item that is only a template placeholder, `{{…}}`, is not a rule | Reading every context document. A glossary defines terms and an ADR records history; neither states a rule a test would pin |
| L7 | Evidence is the files the item cites that resolve in the index, sorted into three states by the index's own flags: `test` (at least one cited file has `isTest`), `other` (it names files, none of them a test: an implementation file, an ADR, another brief), `none` | Keyword states such as "has a `--check`". A spelling rule is the kind `evals/AGENTS.md` forbids for a scorer, and the index already knows what a test is |
| L8 | Citation parsing is `review.mjs`'s: its two patterns, `looksLikePath` and `normalizeFrom` are exported and used, not copied. One rule is added: a bare file name counts when exactly one indexed file carries it, because leaf briefs write `build.test.mjs` with no directory | A second copy of the citation rules. `looksLikePath` took 157 findings down to 7 once, and a copy would not inherit the next fix |
| L9 | The exit code is always 0 for `--rules` | A non-zero exit on rules that name nothing. A check that fails a build over accurate prose is switched off |
| L10 | A row carries `doc`, `line`, `section`, the first 120 characters of the item's opening line, `state`, and the cited files split into `tests` and `others`. Rows sort by document, then line | Sorting by state, which moves rows when a citation is added and makes a diff of two runs unreadable |
| L11 | The printed summary gives three counts, then lists the `other` rows and the `none` rows, eight of each; `--json` lists every row | Printing all rows. The reader's question is which rules do not name a test, and on this repo the `other` state is the largest of the three |
| L12 | No skill body changes in this version. The flag is documented in `index/AGENTS.md` and the CLI's usage line | Adding a step to `/cortex-review` now, which costs a model run for a baseline before the flag has been tried by hand |
| L13 | The result says how many briefs were read and how many hold a rules section, and the printed summary states the difference | Printing rows alone. A brief that keeps its rules elsewhere would read as a brief with none |

## What validation changed

The first version of L5 read a format: an item was a rule when it opened with bold text. It was
run on this repo and on six cloned public repos on 2026-10-12, and it was wrong in both directions.

- **It invented rules.** In vercel/ai, all 21 rows were definitions such as "**Node.js**:
  v22.13+". In langchainjs all 6 were the same kind, and in opencode all 4 were a component list.
- **It missed rules.** rea's brief holds 18 list items and none opens with bold. The template
  Cortex stamps writes invariants as plain items, so a repo `/cortex-scaffold` set up would have
  listed nothing.

Bold is this repo's habit. The heading is what the product writes, so L5 now reads the place.

| Repo | Briefs | With a rules section | Rows | test · other · none |
|---|---|---|---|---|
| this repo | 6 | 5 | 101 | 21 · 57 · 23 |
| sst/opencode | 18 | 1 | 9 | 0 · 0 · 9 |
| langchain-ai/langchainjs | 1 | 1 | 0 | |
| vercel/ai | 2 | 0 | 0 | |
| openai/codex | 2 | 0 | 0 | |
| biomejs/biome | 1 | 0 | 0 | |
| morluto/rea | 2 | 0 | 0 | |

All 9 opencode rows were opened and each is a rule (`packages/ai/AGENTS.md`, under "Rules").
langchainjs has a "Lint Rules" heading with prose under it and no list. On this repo, the 80 rows
not in state `test` were searched for anything shaped like a test path: one hit,
`test/<skill>.test.mjs`, which is a pattern and names no file.

**What this does not show.** Nine rows is the whole sample outside this repo. Most public briefs
keep their rules under headings of their own, and the ledger says so and lists nothing for them.
It is useful today on repos Cortex scaffolded and on this one.

**Mutation check.** 34 guards in `rule-ledger.mjs` were broken one at a time; 33 failed a test.
The one that did not is splitting on `\r?\n` against `\n`: a trailing carriage return never
reaches a row, because every reader of a line trims it or stops before it, so the two are the
same program.

### The first scaffolded repo (2.41.60)

`/cortex-brief` at 2.41.59 was run headlessly on a clone of a Java service that `/cortex` had set
up: a root brief with `## Invariants` and `## Gotchas` as plain items, and no scoped briefs. It
wrote two leaves under those headings, 16 rules, and moved seven rules out of the root. Two things
were wrong with the ledger, and neither was visible on this repo.

- **Seven rules named a real test and the ledger counted none.** The leaves say "Covered by
  `ShipmentServiceTest.trackingOnlyMovesForward`": a type and a method, as a Java reader writes it,
  and all six methods exist in the classes named. L8 read file paths only. A type name, alone or
  with one member, now counts when exactly one indexed file is named for it and the name starts
  with a capital letter. A lower-case word never does: `build`, `index` and `test` are words in
  every brief and file stems in most repos.
- **`CLAUDE.md` was counted as a brief with no rules section.** There it is the `@AGENTS.md` shim
  plus the verification block `/cortex` appends, so every installed repo was told one of its
  briefs was not counted. A file that imports the root brief is now a brief of its own only once
  it holds a rules section.

| | Before | After |
|---|---|---|
| Briefs read | 4, one "with no rules section" | 3 |
| Rules | 20 | 20 |
| test · other · none | 0 · 1 · 19 | 9 · 9 · 2 |

All 20 rows were opened after the change and each is in the right state. The two that name nothing
are rules about another repo and about the README's error codes. This repo's counts did not move,
and the six public repos read as before. 42 guards mutated, 41 test failures.

**What that run did not show.** The session reached its turn limit before it printed the report
the ritual now ends with, after nine commands were refused by the allow-list the test gave it. So
the report step of `/cortex-brief` has still not been seen to complete.

## Architecture

```
index.json ──┐
             ├─▶ ruleLedger(index, { readText }) ─▶ { hasBriefs, briefs, withSections, unread, rows, counts }
brief text ──┘            │
                          └─ uses review.mjs: citation patterns, looksLikePath, normalizeFrom
                             uses context-docs.mjs: pointsAtRootBrief

cortex-review.mjs --rules [--json] ─▶ prints counts + the "other" and "none" rows, exit 0
```

**Reading a section.** A heading that matches opens a rules section, which runs to the next
heading at the same level or above. Headings inside a code fence are not read.

**Reading an item.** A line starting `- ` at column 0 opens an item. Indented lines after it
belong to it, across blank lines. Text at column 0 ends it. Lines inside a code fence are never
items. The row's `line` is the opening line.

**Resolving a citation.** As `citationDrift` does: relative to the brief's directory first, then
from the repo root. A citation that does not resolve is not evidence here and is not reported
here; `--citations` already reports it.

**Invariants this must not break**

- Nothing here modifies a target repository (`index/AGENTS.md`, first invariant). The flag reads
  and prints, and a shell test fingerprints the tree before and after.
- Determinism: same tree, same bytes. No clock, no model, no network.
- Every CLI declares its flags through `lib/open.mjs`. `--rules` is one more row in the existing
  declaration, and it is refused together with path arguments, `--staged`, `--since`,
  `--citations` or `--fix`.
- `review.mjs` "finds and cites; it never judges". L4 holds the new module to the same line.
- `isContextDoc` is not widened. The ledger filters its own narrower set (L5, L6).

## Risks & edges

- **The count reads as a score.** "23 rules name no file" will be read as "23 rules are
  unprotected". The printed text says what was counted, and ends by saying a row is not a defect.
  The words "enforced" and "unenforced" appear in no output, and a test pins that.
- **A heading is a place, not a meaning.** A brief that keeps its rules under "Conventions" or in
  paragraphs yields no rows. L13 makes the command say so.
- **This repo's own `## The outcome harness` section is not read**, because its heading names no
  rule word. Its eleven rules are missing from the count above. Undercounting is the chosen
  direction.
- **A test named in a nested sub-item** belongs to its parent item.
- **A rule that names a test directory, not a file,** is not evidence: a citation needs a file
  extension, as it does for `--citations`. The ledger may say a rule names no test when it does,
  and never the reverse.
- **Rollback.** One flag, one module, one test file. Removing them removes the feature; nothing is
  written to any repo.

## Not yet specified

- **Rules that live one link away.** This repo's own contributor rules are in
  `docs/changing-cortex.md`, which is not a brief. Whether the ledger follows a brief's links one
  hop, and how it stops that from reading every linked guide, is still open. The public repos gave
  no evidence either way.
- **Fixture and vendored briefs.** Whether a brief under a test or vendored path is skipped. None
  of the seven repos held one with a rules section, so nothing was decided.
- **Which other headings count.** "Conventions", "Constraints" and "Do not" are candidates. Each
  needs real briefs that use it for rules, and the sample has none.
- **When it becomes a finding.** What the numbers on real repos must look like before a row enters
  `analyse()`, and at what severity.
- **Which other ritual reads it.** `/cortex-brief` does since 2.41.59: it heads its lists
  `Invariants` and `Gotchas`, names a test in an item where one already fails with the rule, and
  reports the ledger for the leaves it wrote. It was chosen first because it writes the rules the
  ledger reads and always has an index. `/optimize-context` must run in a repo with no index, and
  `/cortex-review` has a measured baseline, so both wait.
- **The reverse direction.** A test whose text names a brief or quotes a rule is evidence the item
  does not carry. Whether that is worth a pass over the test files is not known.

## Out of scope

- Deciding that a rule is enforced, or that a test covers a sentence. That needs a model.
- Writing or editing a brief, or adding a test.
- Any change to `analyse()`, `offers()` or the loop rows.
- Reading `.cursorrules`, `.windsurfrules` or `.github/copilot-instructions.md`.
