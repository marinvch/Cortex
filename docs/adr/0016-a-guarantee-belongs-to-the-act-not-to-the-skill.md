# ADR 0016 — a guarantee belongs to the act, not to the skill that performs it

**Status:** accepted · 2026-08-23 · Cortex 2.26.0

## Context

Cortex makes two promises about the first time it writes into someone's repository:

1. the generated directories are gitignored, so `.cortex/` never shows up as noise in `git status`
2. the user is asked before that first write — [ADR 0005](0005-the-install-sequence-may-start-itself.md)
   moved the protection off an invocation flag and onto "a consent gate on the first write", and
   said plainly that the missing flag *"is only safe while the gate is present"*

Both promises were written down. Both were attached to a **skill** rather than to the **act**:

| Promise | Where it lived | Who else performs the act |
|---|---|---|
| gitignore the generated dirs | `/cortex-scaffold`, step 3 | `/cortex-brief`, `/cortex-enrich plan`, `/cortex-skills`, an interrupted `/cortex-install` |
| ask before the first write | `/cortex-install` | `/cortex-brief`, `/cortex-enrich`, `/cortex-skills`, `/cortex-scaffold` |

Five entry points could create `.cortex/`; one carried each promise. Both failures were reported
from the same real install ([#366](https://github.com/marinvch/Cortex/issues/366),
[#370](https://github.com/marinvch/Cortex/issues/370)): a repo left holding a directory of untracked
generated artifacts, created by a ritual that never asked. `/cortex-install`'s own Gotchas section
said to gitignore them — reachable only by running the skill that already did it.

The tempting fix is to repeat the paragraph in all five skills. That is how it got here: the
paragraph was already repeated once, and the sixth entry point will be written by someone who did
not read all five.

## Decision

**A guarantee attaches to the act that needs it, and is enforced by whichever layer can actually be
relied on to keep it.** That splits by what the layer is good for:

- **A machine reliably remembers a mechanical step.** The `.gitignore` write moved into
  `index/lib/generated.mjs` and happens at the moment `.cortex/` first exists, performed by whichever
  CLI got there first. No skill has to remember, and the sixth entry point inherits it by calling the
  same helper.
- **A machine cannot be relied on to ask.** Consent stays prose in the skills — but
  `core/test/plugin.test.js` now fails if a skill that can create `.cortex/` does not state the gate.
  ADR 0005's sentence about the gate being present became checkable instead of aspirational.

The general rule: *if a promise can be kept by code, move it into code; if it genuinely requires
judgment, leave it in prose and test that the prose is there.*

## Alternatives rejected

| Option | Why not |
|---|---|
| Repeat the gate paragraph in all five skills | This is the state that failed. Five copies drift, and the rule protects nothing the moment a sixth entry point exists. |
| Make the indexer refuse to create `.cortex/` without a `--yes` flag | A real gate, but it puts the protection back on a flag — the exact thing ADR 0005 rejected — and breaks every existing skill invocation and script. |
| Have the code ask | Nothing here is interactive. `cortex-index.mjs` runs in CI, in hooks, and inside another tool; a prompt would hang the very contexts determinism exists to serve. |
| Ignore `.cortex/` wholesale instead of its generated subdirectories | Would silently reverse the decision that `.cortex/memory/` is **committed** ([ADR 0002](0002-committed-repo-memory.md)). The asymmetry is the product; a broader rule is not a simpler version of it. |
| Drop the consent gate now that artifacts are ignored | "Generated and gitignored" is not the same as "invisible". These are files appearing in a project on a run the user did not ask for. |

## Consequences

**Easier.** A new entry point that writes under `.cortex/` inherits the gitignore behaviour by
construction. The consent rule is enforced at the only point it can be — before a human writes the
skill — rather than discovered by a user whose repo already has the directory.

**Harder, and accepted.** Every CLI touching `.cortex/` now depends on one more module, so `index/`
has a shared helper that must stay honest about `--out`; the first version of it keyed the gitignore
write off the repo root and quietly broke `--out`'s read-only promise. The read-only test could not
see it, because it checked for a stray `.cortex/` directory and nothing else — so it now fingerprints
the whole tree before and after. **Assert the property, never the one symptom you thought of**: that
is the second lesson of this record, and it cost a green CI run to learn.

**The cost of the split.** Two enforcement mechanisms instead of one, and a reader has to know which
half is code and which is prose. That is the price of not pretending a model will reliably ask.
