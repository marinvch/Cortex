# index/ — the indexer, findings and enrichment

Turns a repository into a structural map, then into one ranked report. `lib/` holds the logic; the
four `cortex-*.mjs` files at the top are the CLIs that skills invoke.

## Invariants

- **Nothing here may modify a target repository**, except by writing under `.cortex/`. `findings`
  returns data; `/cortex-scaffold` is the separate skill that applies changes. This separation is
  what makes "the user decides" structural rather than a promise a model has to keep — if you add
  a write to a source file here, you have broken the product's central claim.
- **The index is deterministic.** No LLM, no network, no clock, no randomness. Same tree, same
  bytes. This is what makes it safe in CI and cheap on every install; `build.test.mjs` asserts two
  runs agree exactly.
- **`index/` never imports from `mcp/`.** Shared code goes in `core/`. Enforced by
  `core/test/architecture.test.js`.
- **Enrichment is additive.** It attaches summaries to files and never edits `index.json`, adds
  files, or removes them.
- **Validate everything a model produced, but only drop what is actually wrong.** `enrich.mjs`
  assumes its input is wrong: a summary naming a file that is **not in the index** is dropped *and
  reported*, unknown roles cleared. A path that is real but arrives against a different batch
  number is **kept and reported** — batch indexes are positional, so adding or removing a layer
  renumbers every batch after it, and treating that as a hallucination discarded 210 correct
  summaries in one run. Coverage is therefore checked in `mergeEnrichment`, across all batches at
  once; a per-batch gap means nothing once files can move. Never let an unreported drop happen —
  a silently incomplete enrichment looks
  exactly like a complete one.

## Gotchas

- **`walk.mjs` asks git, not `.cortexignore`.** Those answer different questions:
  `.cortexignore` says what is not *knowledge in a vault*, and honouring it here dropped this
  repo's own `tools/` and `skills/` from its index. Do not "fix" this by reading it again.
- **`bin/` and `obj/` are skipped by name only until git contradicts it.** Those two live in
  `AMBIGUOUS_SKIP_DIRS`, not `CODE_SKIP_DIRS`, because the name means build output in one ecosystem
  and hand-written source in the next — `bin/cli.js`, `bin/rails`, an ops repo's shell tools. A
  file git *tracks* is source; an untracked one is output. Skipping them outright made `bin/n` —
  the whole of `tj/n` — invisible, with nothing in the report to say so. Keep the set to those two:
  a vendored `node_modules/` is committed too and must still never be indexed.
- **What a guess drops gets counted; what a certainty drops does not.** `listFiles` returns
  `{ files, skipped }`, and `skipped` carries only the ambiguous-directory losses — measured, so
  the number means *readable source you cannot see* rather than compiled output. It reaches the
  reader as `stats.skipped` and one CLI line. Do not extend it to `node_modules/`: a count nobody
  can act on buries the one they can, and walking that tree to produce it costs more than the
  index. This half is why the `bin/` bug was expensive rather than merely wrong — the run printed
  a plausible number and nothing marked it incomplete.
- **Import resolution is regex-based**, so dynamic and computed imports are missed. That is a
  documented limit, not a bug — it is why the orphan finding says "worth checking", never "safe to
  delete".
- **Coverage uses three signals** — name, import, and a quoted string mention — and lives in
  `lib/coverage.mjs`, shared by `findings.mjs` and `impact.mjs`. Each alone misreports: naming
  alone called `mcp/lib` untested when its tests live in `mcp/test`; a CLI spawned as a subprocess
  is invisible to both name and import, which is what the mention signal is for. Quoted-only, so a
  file named in a comment is not counted as exercised. Do not copy this heuristic into a third
  caller — two copies would agree today and disagree in a month, with nothing to say which is right.
- **`cortex-impact.mjs` reads the graph backwards** — who imports me, not what do I import — and
  every count it returns is a floor, named `atLeast` so a caller cannot print it as a total.
- Batching is deterministic so an interrupted enrichment resumes — re-run `plan`, and `status`
  still lists exactly what is pending. Do not make batch identity depend on anything but the index.
  Note the limit that buys: identity is **positional**, so it is stable for an interrupted run
  against the *same* index, not across a re-plan after files were added or removed. `merge`
  absorbs that shift rather than discarding the work; `status` will still show the renumbered
  batches as pending, which is cosmetic.
- A single file over the line budget is allowed through as its own batch; only *accumulation* is
  bounded.

## Tests

```bash
node --test index/test/*.test.mjs
```

`lib/` is well covered. Most CLIs at the top level are not — Cortex reports this about itself and
it is a true positive; the gap is argument parsing and file writing. `cortex-impact.mjs` is the
exception, covered by `tools/test/cortex-impact.test.sh` against a real git fixture, because its
failure mode is a confident wrong sentence rather than a crash and only the CLI prints sentences.
