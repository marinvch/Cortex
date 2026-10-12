# Design: a rule ledger — which rules in the briefs name a test

- **Date:** 2026-10-12
- **Status:** Draft for review
- **Area:** `index/` ([`index/AGENTS.md`](../../index/AGENTS.md)), read through
  `index/cortex-review.mjs`. This document changes no code.
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
- **A probe on this repo, 2026-10-12.** Counting list items that open with bold text in the five
  `AGENTS.md` files and `docs/changing-cortex.md`: 134 rule-shaped items, 27 name a test file the
  index knows, 5 more name a `--check` command, 102 name neither. The probe is a scratch script and
  is not the design. It shows the list is long enough to be worth printing and that most of it is
  the third kind.
- **Many of the 102 are not failures.** `index/AGENTS.md` holds gotchas such as "import resolution
  is regex-based". That is a fact about a limit, and no test could enforce it. A ledger that called
  such an item "unenforced" would be wrong about the reader's own repo, which is the cost
  `lib/orphans.mjs` names in its header.
- **`analyse()`'s ranking is control flow** (ADR 0006). A new finding there changes the install
  interview for every user.
- **`/cortex-review` has a measured baseline** (`evals/skills.mjs`). Editing its body means a model
  run to record a new one.

## Decisions locked

| # | Decision | Rejected alternative |
|---|---|---|
| L1 | The logic is a pure module, `index/lib/rule-ledger.mjs`, taking the index and a `readText` function, as `review.mjs` does | Reading the filesystem inside the module, which makes every case need a temp tree |
| L2 | It is reached by a new flag, `cortex-review.mjs --rules`, repo-wide and needing no diff, like `--citations` | A new CLI. `cortex-review.mjs` is already the one reader of the context layer, and a second reader is how `context-docs.mjs` came to exist |
| L3 | It is **not** a finding in `analyse()` in this version | Adding it to the report now. Its numbers have not been seen on real repos, and under ADR 0006 an unproven finding changes the interview |
| L4 | The ledger **finds and cites and never judges**. A row says what the rule names. It never says "enforced" or "unenforced" | rea's closing rule (owner, fixture, passing verifier). Deciding that a test enforces a sentence needs a model, and then the command cannot run in CI |
| L5 | A rule is a top-level list item that opens with bold text, in a brief: `AGENTS.md` at any depth, and a `CLAUDE.md` or `GEMINI.md` that is not a shim | Only items under a heading named `Invariants`. This repo's briefs use "Invariants", "Gotchas" and "The rules", and a target repo may use any word |
| L6 | `CONTEXT.md`, ADRs and everything under `templates/` are not read | Reading every context document. A glossary defines terms and an ADR records history; neither states a rule a test would pin |
| L7 | Evidence is the paths the item cites that resolve in the index, sorted into three states by the index's own flags: **names a test** (at least one cited path has `isTest`), **names code only**, **names nothing** | Keyword states such as "has a `--check`". A spelling rule is the kind `evals/AGENTS.md` forbids for a scorer, and the index already knows what a test is |
| L8 | Citation parsing is `review.mjs`'s: its two patterns, `looksLikePath` and `normalizeFrom` are exported and used, not copied | A second copy of the citation rules. `looksLikePath` took 157 findings down to 7 once, and a copy would not inherit the next fix |
| L9 | The exit code is always 0 for `--rules` | A non-zero exit on rules that name nothing. A check that fails a build over accurate prose is switched off |
| L10 | A row carries `doc`, `line`, the first 120 characters of the item, `state`, and the cited paths split into `tests` and `code`. Rows sort by document, then line | Sorting by state, which moves rows when a citation is added and makes a diff of two runs unreadable |
| L11 | The printed summary gives three counts and then lists only the **names nothing** rows, capped as `--citations` caps; `--json` lists every row | Printing all rows. On this repo that is 134 lines, and the reader's question is about one state |
| L12 | No skill body changes in this version. The flag is documented in `index/AGENTS.md` and the CLI's usage line | Adding a step to `/cortex-review` now, which costs a model run for a baseline before the flag has been tried by hand |

## Architecture

```
index.json ──┐
             ├─▶ ruleLedger(index, { readText }) ─▶ { hasBriefs, rows, counts }
brief text ──┘            │
                          └─ uses review.mjs: citation patterns, looksLikePath, normalizeFrom
                             uses context-docs.mjs: which names are briefs, pointsAtRootBrief

cortex-review.mjs --rules [--json] ─▶ prints counts + the "names nothing" rows, exit 0
```

**Reading an item.** A line starting `- ` at column 0 opens an item. Following lines that are
indented belong to it. A blank line or a line at column 0 that is not a list item ends it. An item
is rule-shaped when its text after `- ` starts with `**`. The row's `line` is the opening line.

**Resolving a citation.** As `citationDrift` does: relative to the brief's directory first, then
from the repo root. A citation that does not resolve is not evidence here and is not reported
here; `--citations` already reports it.

**Invariants this must not break**

- Nothing here modifies a target repository (`index/AGENTS.md`, first invariant). The flag reads
  and prints.
- Determinism: same tree, same bytes. No clock, no model, no network.
- Every CLI declares its flags through `lib/open.mjs`. `--rules` is one more row in the existing
  declaration, and it is refused together with path arguments, `--staged` or `--since`.
- `review.mjs` "finds and cites; it never judges". L4 holds the new module to the same line.
- `isContextDoc` is not widened. The ledger filters its own narrower set from it (L5, L6).

## Risks & edges

- **The count reads as a score.** "102 rules name nothing" will be read as "102 rules are
  unprotected". The printed text says what was counted: "names no test file", and the usage line
  says a gotcha is expected to appear here. The words "enforced" and "unenforced" do not appear in
  any output, and a test pins that.
- **A bold-led item is a format, not a meaning.** A brief written as paragraphs yields no rows.
  The command then says how many briefs it read and that none held a bold-led item, so an empty
  ledger is not read as a clean one.
- **A test named in a nested sub-item** belongs to its parent item, by the reading rule above.
- **A rule that names a test directory, not a file,** resolves as a directory and counts as code
  only. This undercounts and is the safe direction: the ledger may say a rule names no test when
  it does, and never the reverse.
- **Fixture briefs.** A repo with `AGENTS.md` files inside test fixtures would list their items.
  See [Not yet specified](#not-yet-specified).
- **Rollback.** One flag, one module, one test file. Removing them removes the feature; nothing is
  written to any repo.

## Not yet specified

- **Rules that live one link away.** This repo's own contributor rules are in
  `docs/changing-cortex.md`, which is not a brief. Whether the ledger follows a brief's links one
  hop, and how it stops that from reading every linked guide, waits on what the public repos show.
- **Fixture and vendored briefs.** Whether a brief under a test or vendored path is skipped by the
  index's flags, or by nothing. To be settled by counting them on the validation repos.
- **When it becomes a finding.** What the numbers on real repos must look like before a row enters
  `analyse()`, and at what severity.
- **Which ritual reads it.** `/cortex-review`, `/optimize-context` and `/cortex-brief` could each
  use the ledger. Chosen after the flag has been used by hand.
- **The reverse direction.** A test whose text names a brief or quotes a rule is evidence the item
  does not carry. Whether that is worth a pass over the test files is not known.

## Out of scope

- Deciding that a rule is enforced, or that a test covers a sentence. That needs a model.
- Writing or editing a brief, or adding a test.
- Any change to `analyse()`, `offers()` or the loop rows.
- Reading `.cursorrules`, `.windsurfrules` or `.github/copilot-instructions.md`.
