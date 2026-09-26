# ADR 0017 — Anthropic's docs are the authoring source, vendored with evidence and re-checked by the maintainer

**Status:** accepted · 2026-09-26 · Cortex 2.38.0

## Context

Cortex is a Claude Code plugin that also writes Claude Code configuration into other people's
repositories — `CLAUDE.md`, subagents, hooks, skills. Whether that output is right is decided by
Anthropic's documentation, and nothing in Cortex cited it. The authoring guidance it did have came
from elsewhere (`/writing-for-agents` is adapted from mattpocock/skills), and the numbers it carried
were written from memory:

- `/skill-creator` tells an author to aim under **~500 words**. The docs say `SKILL.md` should stay
  under **500 lines** — a rule Cortex stated, in prose, in the wrong unit, with nothing to notice.
- `tools/cortex-frontmatter.mjs` has a minimum description length and no maximum. The docs truncate
  `description` plus `when_to_use` at 1,536 characters in the skill listing.
- Cortex's frontmatter carries top-level keys of its own (`capability`, `reached-by`); the docs say
  an unrecognised field is ignored without an error, and offer `metadata` for custom data.

The docs also move. Several fields confirmed while writing this record need Claude Code v2.1.218 or
later; one frontmatter key listed today did not exist a few months ago. And Cortex is installed by
people who update it on their own schedule, so whatever it ships is frozen at the version they have.

## Decision

**The rules Cortex enforces about Claude Code live in `core/claude-code.js` as data, each carrying
the official page it came from, the sentence on that page that states it — copied, not
paraphrased — and the date it was last confirmed.** Checkers read values from there and never
hard-code them.

**Keeping them true is the maintainer's job, done by a tool, not by users.**
`tools/cortex-claude-docs.mjs --check` fetches each source page and confirms every sentence is still
on it; for the frontmatter key lists it also reads the reference table and reports keys Cortex does
not know. `.github/workflows/claude-docs.yml` runs it weekly and opens one `docs-drift` issue when a
sentence has gone or a page could not be read. Users receive rule changes the ordinary way — a
plugin update.

The module is in `core/` because both consumers need it and `core/` is the only package both may
import: `index/` for the findings that judge a target repo's Claude setup, and `tools/` for the
checks run against Cortex's own files. It is pure data with two lookups, so it adds nothing to the
kernel's security surface.

A rule with no sentence that states it does not go in. That is the line between this file and an
opinion about good practice.

## Alternatives rejected

| Option | Why not |
|---|---|
| Fetch the docs at runtime, in the user's checker | The same repo would get a different verdict on different days, a run offline or behind a proxy would fail or silently pass, and a finding would depend on a web page Cortex does not control. Determinism is what makes a finding worth acting on. |
| A prose reference file of best practices | That is what Cortex already had, and it drifted without anyone noticing — the ~500 words above. Prose cannot be checked against its source; data with an evidence sentence can. |
| Put the rules in `index/` | `tools/` would have to import a leaf to check Cortex's own files, which `tools/AGENTS.md` calls a smell for good reason: the shared piece belongs in `core/`. |
| Check the live docs in the ordinary PR test suite | Every contributor's PR would fail whenever Anthropic edits a page, for a change they did not make. A scheduled job that opens an issue puts the drift in front of the person who can act on it. |

## Consequences

- Every value a checker compares against has a citation a reviewer can open.
- A docs change surfaces within a week as an issue, rather than when a user notices Cortex
  recommending something Claude Code no longer does.
- Updating a rule is deliberate work — new value, new evidence, new `CHECKED` — and consumers may
  need changing with it. That cost is the point: a rule that changes should be looked at.
- The evidence match is textual. A page that rewords a sentence without changing its meaning raises
  a false alarm; the fix is to copy the new sentence, which takes a minute.
- `/writing-for-agents` still cites mattpocock/skills as its source. It should cite these rules and
  the Anthropic pages behind them as well — a follow-up, not part of this change.
