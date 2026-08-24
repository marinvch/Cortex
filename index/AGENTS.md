# index/ — the indexer, findings and enrichment

Turns a repository into a structural map, then into one ranked report. `lib/` holds the logic; the
`cortex-*.mjs` files at the top are the CLIs that skills invoke.

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

- **Vendored is declared in `.gitattributes`, never inferred from a directory name.** `linguist-vendored`
  and `linguist-generated` are the standard vocabulary and the one GitHub already uses, so a repo
  that has marked its vendored trees gets this for free and one that has not says so in a file its
  other tools already read. Same rule as `go.mod` and `composer.json`: declared beats guessed,
  because a directory a team genuinely writes can be called `vendor/` and guessing would drop it
  from every ranking. **Nothing is excluded from the index by this** — git-truth stands, and a file
  you cannot see is worse than one you can rank correctly. What changes is that `briefCandidates`
  and `isEnrichable` skip it and `stats.vendored` names what was skipped. A consumer that ranks or
  costs by size must use it *and* say which side it counted: silently dropping half a repo reads
  exactly like covering it. The gap this closed was real — on one repo the top three scoped-brief
  candidates were a plugin cache, a generated server and another tool's instruction files, with the
  application fourth, and enrichment planned 13 of 21 batches over that material.
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
- **"Unreferenced" means more than "unimported", and lives in `lib/orphans.mjs`.** A file whose
  path another file names literally — a CI workflow, a shell test, a README, an ADR — is referenced;
  that is how repo tooling is normally wired. Cortex reported the false positive about itself:
  `tools/cortex-version.mjs` and `tools/cortex-capability.mjs`, the two scripts it cannot release or
  verify itself without, were listed as unreferenced because nothing `import`s them. The signal is
  the most checkable one available — the literal repo-relative path appears in another indexed
  file — and it is the same standard `citationDrift` holds itself to, run in reverse. **The
  direction of error is chosen:** this can only ever *remove* entries. Missing a true orphan costs a
  suggestion nobody had to act on; inventing one costs trust in every other line of the report.
  `findings.mjs` and `view.mjs` both call it — there is no second copy, for the reason
  `coverage.mjs` says.
- **A path alias is read from the repo, never guessed.** `tsconfig.json` / `jsconfig.json` `paths`
  and `baseUrl` are declared, exactly like `go.mod`'s module path and `composer.json`'s PSR-4
  prefixes, and `build.mjs` follows the `extends` chain because splitting options into a base config
  is the normal layout. Aliases are tried **only after** the relative resolver returns null, so the
  pass is strictly additive: a repo declaring nothing cannot get a different graph because of it.
  Never widen this into inferring an alias from directory names — the value of an edge is that it
  means something, and resolving `react` to a local file because a `baseUrl` sat above one is worse
  than missing the edge.
- **Those configs are JSON with Comments.** Every generator TypeScript ships writes `//` lines into
  them, and a real one carried a trailing comma after its last `paths` entry. `parseJsonc` strips
  both — respecting strings, so a `//` inside a URL survives — and returns `null` rather than
  throwing. A config that cannot be read costs its aliases, never the run.
- **This gap was invisible to fixtures and obvious on one real repo.** A Next.js app wrote 428
  imports as `@/…` against 104 relative ones: the index held a fifth of its edges and called 154
  files orphans, and *every* consumer — orphans, impact, depth, the viewer — was confidently wrong.
  Nothing in the test suite could have found it. Validate resolver changes against cloned repos,
  and check that every resolved target actually exists on disk; more edges is not the same as
  correct edges.
- **Coverage uses three signals** — name, import, and a quoted string mention — and lives in
  `lib/coverage.mjs`, shared by `findings.mjs` and `impact.mjs`. Each alone misreports: naming
  alone called `mcp/lib` untested when its tests live in `mcp/test`; a CLI spawned as a subprocess
  is invisible to both name and import, which is what the mention signal is for. Quoted-only, so a
  file named in a comment is not counted as exercised. Do not copy this heuristic into a third
  caller — two copies would agree today and disagree in a month, with nothing to say which is right.
- **A citation is checkable; a claim is not.** `citationDrift` resolves the paths a context document
  names — doc-relative first (honouring `../`), then root — and only tokens whose last segment has an
  extension and which do not start with `/`. Those rules are not fussiness: without them, run against
  this repo, "contains a slash" returned **157** findings and almost none were drift — forty ritual
  names, JSON-RPC methods, repo slugs. With them, 7. Literal fixtures showed none of it; only real
  prose did, so run it against a real repo before trusting a change here. And it deliberately does
  not chase prose: `index/AGENTS.md` saying "Coverage uses two signals" while the code used three is
  real drift and invisible here, because the path was never wrong. Do not extend the CLI to guess at
  sentences — a deterministic tool claiming to find *all* drift is worse than one that states where
  it stops.
- **`cortex-impact.mjs` reads the graph backwards** — who imports me, not what do I import — and
  every count it returns is a floor, named `atLeast` so a caller cannot print it as a total.
- **`next.mjs` may only call a step done on the strength of a file that exists.** Every ✓ names its
  evidence — `.cortex/index/index.json`, a report under `.cortex/findings/`, `CONTEXT.md`, a
  `<dir>/AGENTS.md`. It is deterministic for the same reason the index is: the sequence is a fact
  about the repository, and a model re-deriving it each session hands the user a different answer
  every time. A step nothing on disk can settle is `optional`, which never becomes "next" and never
  blocks — never a silent tick.
- **The viewer draws only what can have an edge.** `view.mjs` marks a node `inMap` for `code` and
  `script` alone. Docs and config stay in the Files tab: on this repo 171 of them are isolated
  nodes that pushed the 98 connected ones off screen. If you widen it, the legend swatch and the
  node colour must still agree — a legend that does not match the picture is decoration.
- **The page inlines its data, so the data must not be able to close the script.** `safeJson`
  escapes `<` and the two line separators; an enrichment summary quoting markup would otherwise end
  the element mid-object and render a blank page. There is a test for exactly that payload.
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
it is a true positive; the gap is argument parsing and file writing.

Three are exceptions, each covered by a `tools/test/cortex-*.test.sh` against a real git fixture.
The rule for which CLI earns one: **does it print a sentence a user will act on, or write into
their repo?** A CLI whose only failure mode is a crash does not need one — a stack trace is its own
report.

- `cortex-impact.mjs` — a confident total instead of a floor tells someone to stop looking.
- `cortex-next.mjs` — a wrong "next", or a ✓ on a step nobody ran, walks the user past the step
  that writes their context layer.
- `cortex-view.mjs` — it writes into a target repo, so *where* it writes is the invariant, and its
  determinism is only observable from outside. A first run did once disagree with the second,
  because the page reported on its own existence.
