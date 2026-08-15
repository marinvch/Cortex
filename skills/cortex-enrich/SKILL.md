---
name: cortex-enrich
description: Add semantic summaries, roles and tags on top of the deterministic index, so recall and findings describe what code MEANS and not just how it is wired. Use when the user says "enrich the index", "summarise the codebase", "what does each file do", or after a first /cortex-install on a large unfamiliar repo. Costs tokens — always say so before starting.
---

# /cortex-enrich — put meaning on top of structure

The deterministic index knows how a repo is *wired*. This pass adds what each file is *for*.

It is the one part of Cortex that costs real tokens, and it is **optional by design**: everything
else works without it, and a missing or stale enrichment degrades Cortex to deterministic
behaviour rather than breaking it. Say the cost out loud before starting, with a number.

## 1. Plan

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-enrich.mjs" plan .
```

Prints how many batches and files, and writes `.cortex/index/batches.json`. Batching is
deterministic — same index, same batches — which is what makes an interrupted run resumable.

**Tell the user the size before doing anything.** Roughly one model call per batch. Forty batches
is a real cost; offer to enrich only the areas that matter if the repo is large. Wait for a yes.

## 2. Work the batches

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-enrich.mjs" status .
```

For each **pending** batch, read `batches.json` for that `batchIndex`, read the actual files, and
write `.cortex/index/enrich/batch-<n>.json`:

```json
[
  {
    "path": "src/billing/charge.js",
    "summary": "Applies the rate multiplier to an amount and returns the charge. The multiplier lives only in rates.js.",
    "role": "core-logic",
    "tags": ["billing", "pricing"]
  }
]
```

Rules that the merge step enforces, so following them saves a round trip:

- **One entry per file in the batch — no more, no fewer.** A path that was not in the batch is
  dropped and reported; a path you skip is reported as uncovered.
- `role` is one of: `entrypoint`, `core-logic`, `adapter`, `config`, `test`, `docs`,
  `infrastructure`, `types`, `utility`, `generated`. Anything else is cleared.
- `summary` is required and capped at 400 characters.
- At most 8 tags; they are lowercased and deduped.

Write summaries from **reading the file**, not from its name. A summary derived from the path
teaches nothing that the path did not already say, and it reads as authoritative — which makes it
worse than no summary at all.

Say what the file is *for* and what a reader would get wrong. Name the constraint that is not
visible from the signature. `neighbours` in each batch tells you what the batch touches without
paying to summarise it.

Batches are independent. Several can be done in parallel, and a run can stop and resume — `status`
always reports what is left.

## 3. Merge

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-enrich.mjs" merge .
```

Validates every batch against what was requested, then writes `.cortex/index/enriched.json`.

**Read the issues it prints and relay them.** Dropped hallucinated paths and uncovered files are
reported rather than swallowed, because a silently incomplete enrichment is indistinguishable
from a complete one. If a batch was rejected, redo that batch and merge again — merging is
idempotent.

## 4. Report

Give the coverage figure (`N/M indexed files`) and where the file is. Mention that `recall` and
the findings report use enrichment when it is present.

## Gotchas

- **Enrichment is additive.** The deterministic index stays the source of truth for structure;
  this only attaches prose. Never let an enrichment pass edit `index.json`.
- **Re-plan after significant changes.** `merge` warns when the enrichment no longer covers the
  current index. A summary describing a file that has since been rewritten is actively misleading.
- Files under three lines and files of unknown type are skipped on purpose — there is no meaning
  to extract and paying for it is waste.
- If the user only wants one area, enrich its batches and leave the rest pending. Partial coverage
  is a supported state, not a failure.
