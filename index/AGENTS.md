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
- **Validate everything a model produced.** `enrich.mjs` assumes its input is wrong: a summary for
  a file that was not in the batch is dropped *and reported*, uncovered files are named, unknown
  roles cleared. Never let an unreported drop happen — a silently incomplete enrichment looks
  exactly like a complete one.

## Gotchas

- **`walk.mjs` asks git, not `.cortexignore`.** Those answer different questions:
  `.cortexignore` says what is not *knowledge in a vault*, and honouring it here dropped this
  repo's own `tools/` and `skills/` from its index. Do not "fix" this by reading it again.
- **Import resolution is regex-based**, so dynamic and computed imports are missed. That is a
  documented limit, not a bug — it is why the orphan finding says "worth checking", never "safe to
  delete".
- **Coverage uses two signals**, name *and* import. Either alone misreports: naming alone called
  `mcp/lib` untested when its tests live in `mcp/test`.
- Batching is deterministic so an interrupted enrichment resumes — re-run `plan`, and `status`
  still lists exactly what is pending. Do not make batch identity depend on anything but the index.
- A single file over the line budget is allowed through as its own batch; only *accumulation* is
  bounded.

## Tests

```bash
node --test index/test/*.test.mjs
```

The CLIs themselves have no tests — Cortex reports this about itself, and it is a true positive.
`lib/` is well covered; the gap is argument parsing and file writing at the top level.
