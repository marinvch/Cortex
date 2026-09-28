# index/ — the indexer, findings and enrichment

Turns a repository into a structural map, then into one ranked report. `lib/` holds the logic; the
`cortex-*.mjs` files at the top are the CLIs that skills invoke.

## Invariants

- **Nothing here may modify a target repository**, except by writing under `.cortex/`. `findings`
  returns data; `/cortex-scaffold` is the separate skill that applies changes. This separation is
  what makes "the user decides" structural rather than a promise a model has to keep — if you add
  a write to a source file here, you have broken the product's central claim. **Two named
  exceptions.** The first, `cortex-stamps.mjs update`, rewrites a file Cortex itself stamped, and only in state
  `update` — untouched since it was recorded, re-renderable, template changed. `/cortex` runs it
  only for the paths the user confirmed. The rule lives in the code (`planUpdates`), not in the
  skill, because a guarantee belongs to the act (ADR 0016). Never widen it to `edited`,
  `conflict` or `review`. **And never from an older plugin:** when the record's `cortex` is newer
  than the running `VERSION`, its templates are the older ones, every untouched file reads as
  `update`, and applying it puts the older template back. `planUpdates` refuses the whole plan
  then, and takes `running` as a required argument so the check cannot be forgotten; status,
  `diff` and `next.mjs` name it with the two plugin-update commands (`olderPlugin`). `cortex: null`
  (adopted only) and equal versions never warn. The second, **`cortex-shared-plugin.mjs --write`**,
  adds two entries to `.claude/settings.json` on a team's repo (spec S6). It **merges and never
  replaces**: it inserts text in the file's own style, leaving every other byte where it was, and
  keeps an entry already there whatever it says. It refuses a file that does not parse. The parser
  must agree the result is exactly the original plus the two entries, or nothing is written. Do not
  re-serialise the file, which reflows every inline array a team wrote. `--auto-update` adds
  `"autoUpdate": true` **only on a `cortex` entry this run adds**. An entry already there keeps its
  `autoUpdate` — true, false or unset — because the committed value outranks each teammate's own
  `/plugin` toggle, and someone chose it. Without the flag the key is never written.
- **"A team's repo" is the `work` profile or `.cortex/connector.json`** (`lib/shared-plugin.mjs`
  `teamServed`). The profile is this machine's `CORTEX_PROFILE`, the one environment input the loop
  reads. A loop row may declare `applies`, and a row that does not apply drops out of every bucket
  and count, so a solo repo's numbers do not move. Tests that count loop rows delete
  `CORTEX_PROFILE` at the top of the file, because a developer on a work profile must get CI's
  answers.
- **The index is deterministic.** No LLM, no network, no clock, no randomness. Same tree, same
  bytes. This is what makes it safe in CI and cheap on every install; `build.test.mjs` asserts two
  runs agree exactly.
- **A stamped file's state is two hash comparisons, never a judgement** (`lib/stamps.mjs`, spec
  [stamp record](../docs/specs/2026-09-28-stamp-record-design.md) S3). File now against as-written,
  template now against as-then: `current` · `update` (template moved, file untouched — the only
  state that may be rewritten without a per-file yes) · `conflict` · `edited` · `missing`, plus
  `retired` when this Cortex no longer ships the template, which is reported and never offered.
  **`update` also needs `renderable`**: `recordStamp` checks that the template filled with the
  recorded values (`lib/placeholders.mjs`, one definition shared with `tools/cortex-placeholders.mjs`)
  gives back the file as written. /cortex fills some templates partly by hand, and a file the values
  do not reproduce would lose those lines on a re-render. So its template change is `review`, a
  state of its own, so that no caller that auto-applies `update` has to remember a flag.
  **Where each loop file lands is `LOOP_STAMPS` in `lib/loop.mjs`** (a `stamps` field per row).
  Adoption reads it (callers pass it to `adoptionCandidates`; `stamps.mjs` importing `loop.mjs`
  was a cycle once the team row imported the record), and `cortex-output-passes.test.mjs` pins it to
  the `/cortex` skill's table. Do not keep a second list. **A site marked `adopt: false` is never
  adopted** — the team's files: they shipped after the record, so no Cortex wrote one unrecorded, and
  a `.claude/agents/tester.md` in a repo with no record is the team's own. **Adoption** is for a repo stamped before the record existed: files
  at those locations and no record at all. It records them with nothing known (`version`, both
  hashes `null`, `renderable: false`), so each reads as `conflict` and is never rewritten
  unasked. It is offered only while no record exists; after that, a file outside the record is
  the team's. **`next.mjs`'s `stamps` row** exists only while something needs attention. It is
  required only for a decision /cortex can make (`update`, `review`, `conflict`, a damaged
  record). A deleted file, a retired template, an ignored record and adoption are optional,
  because each can be a deliberate choice. Declining adoption leaves no trace, so a required row
  there would never clear.
  **Hashes fold CRLF to LF and drop trailing newlines, nothing else** — a `core.autocrlf` checkout
  or a formatter's final newline read as an edit would freeze the file at `edited` forever, which
  is the stale-hook bug the record exists to end. An absent record is `null`; a damaged one is an
  error naming the file, never `null`, or a re-run would treat every stamped file as unknown.
- **`index/` never imports from `mcp/`.** Shared code goes in `core/`. Enforced by
  `core/test/architecture.test.js`.
- **Every CLI here opens through `lib/open.mjs`, and declares its flags rather than testing for
  them.** The declaration *is* the allowlist: an unregistered or misspelled flag is refused with a
  message naming it, never reinterpreted as a path. Do not write a ninth `parseArgs` — there were
  seven, and each one was a different subset of the same bugs. `cortex-enrich` found that
  `!a.startsWith("--")` reads `-v` as a repo ROOT and writes into a directory invented from a
  mangled flag; it fixed its own copy and left the bug live in the rest. The undashed shape was
  live everywhere until the front door: `cortex-index.mjs . --ouput x.json` matched no branch, so
  the typo was dropped, `x.json` was ignored because the root was already set, and the index went
  to the default path. A confident wrong destination with no error.
- **Whether a command refuses, degrades or builds when the index is unreadable is `spec.index` —
  declared by the caller, executed by the front door.** Four CLIs used to hand the user a raw
  `SyntaxError`, one rebuilt in silence and one degraded to `null`: three answers to one question,
  and none of them chosen. `readIndex` also checks `INDEX_VERSION`, which for one release was
  written into every index and read by no consumer at all — so an index in an older format was read
  confidently rather than refused.
- **Enrichment is additive.** It attaches summaries to files and never edits `index.json`, adds
  files, or removes them.
- **`enriched.json` has one reader — `readEnrichment` in `lib/enrich.mjs` — and it returns a state,
  not a document.** `absent` · `unreadable` · `invalid` · `stale` · `ok`, and **`ok` is the only one
  a caller may trust**. This is `spec.index`'s argument one layer up: `cortex-view` opened the file
  inline and collapsed *never enriched*, *enriched and truncated* and *enriched against a tree that
  has moved* into the same silent `null` — so on a 638-file repo it rendered **625 summaries about
  the wrong commit and said nothing**, and told a user whose file was damaged to go re-run the model
  pass. Absence stays free of charge: enrichment is optional by definition (`CONTEXT.md`), so
  `absent` carries no note and nothing fails. Every other state carries one sentence naming the
  file, the reason, and what to run — and **what to run is not the same for damage as for
  staleness.** A damaged document points at `merge`, which rebuilds it from the batch results
  already on disk for no model pass. A stale one must never point there: `mergeEnrichment` stamps
  `indexCommit` and `coverage.indexed` from the index it is handed, so re-merging yesterday's
  batches against today's index writes a document `isStale` calls **fresh**, laundering the exact
  prose the viewer just declined — by following our own advice. Staleness costs a real enrichment
  pass and the note says so. `enrich.test.mjs` asserts that per state, because the first draft of
  this reader gave the stale advice and the whole suite stayed green — the note is the entire
  deliverable of a state nothing else can observe, so it is the one thing that must be pinned.
  **Staleness is answered at the read, through `stalenessReason`**, which is what `isStale` now asks
  rather than a second copy of the same two comparisons.
- **The viewer declines stale enrichment rather than marking it.** The policy is in
  `cortex-view.mjs` with its argument: the page is self-contained and copies anywhere, so the reader
  who acts on a summary is often not the person who saw the terminal; and staleness is a property of
  the document while the damage is per-card, since a summary attaches wherever the path survived and
  may describe a version of that file that did not. There is deliberately no flag to override it — a
  flag here would be the decision not taken.
- `findings.mjs` and `next.mjs` ask `has(ENRICHED_REL)` and that is correct — "was this step ever
  run" is a question about a file existing, and `next.mjs` may only tick a step on the strength of
  one. Do not route them through the content reader to make the caller count come out at one.
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
  [ADR 0003](../docs/adr/0003-git-decides-what-belongs-to-a-repo.md) holds the argument and what it
  rules out — read it before proposing a second ignore source.
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
- **"Stale" has exactly one definition, and it is `indexFreshness` here.** mtime, tracked files
  only, capped at five. `tools/cortex-preflight.mjs` — the definition every ritual is told to
  consult — imports it rather than carrying its own; that is why `indexFreshness` accepts a
  directory as well as a file. It briefly meant two things, which is worth remembering because
  neither copy was wrong: preflight's was written when it was the only reachable definition, and the
  CLIs grew one because they could not reach `tools/`. Two right answers to one question still
  disagree the moment one of them changes. Do not add a second.
- **Import resolution is regex-based**, so dynamic and computed imports are missed. That is a
  documented limit, not a bug — it is why the orphan finding says "worth checking", never "safe to
  delete". A code language `extractImports` has no case for belongs in `UNRESOLVED_LANGUAGES`, so
  the report says it is blind instead of calling every file unreferenced — Kotlin did, 22 of 24 on
  spring-petclinic-kotlin, until it was listed (#465). `imports.test.mjs` walks `CODE_LANGUAGES`
  and fails on a language that has neither.
- **One slot per language, in `lib/resolvers.mjs`: `prepare(env) → ctx` and
  `resolve(spec, from, ctx) → string[]`.** A language's own knowledge — that Go reads `go.mod`, that
  `crate::` is relative to the crate a file belongs to, that a JS alias is consulted only after the
  relative resolver fails — belongs in its adapter, not in `buildIndex`. `resolve` always returns an
  array: Go alone resolves one specifier to many files, because it imports a package, and when that
  asymmetry was the builder's problem it read as a six-deep ternary that had to know, per language,
  what to precompute, in what order to pass it, and whether to wrap the answer. Adding a language
  means adding a row to `ADAPTERS`.
  **`prepare` is pure and reading is injected**, for the same reason `repo-text.mjs` injects it:
  every derivation — crate roots, Java source roots, PSR-4 prefixes, the module path, the alias
  tables — is then testable from a literal file list with no tree on disk, and *that* is where both
  resolver bugs this repo has shipped actually lived.
- **JS/TS tries `.d.ts` and `/index.d.ts` last**, after every implementation extension, so `x.ts`
  beats `x.d.ts`. Without them `shadcn-ui/taxonomy`'s `types/index.d.ts` — imported eleven times as
  `"types"` — had no inbound edge at all.
- **Rust: a file no crate root contains is rooted at its own directory**, which is what a file in
  `tests/`, `benches/`, `examples/` or `src/bin/` is — its own crate. Before, `crate::` paths from
  those files never reached the shortening loop, so `use crate::hay::SHERLOCK` missed `tests/hay.rs`.
  The fallback is reached **only** when `crateRoots.find` comes back empty; widening it for a file
  under a real root would resolve `crate::` against the wrong crate, and a test holds a decoy file
  for exactly that. Known limit: a nested helper (`tests/index/basic.rs` in ripgrep) roots at its own
  directory rather than at the test crate's, so its `crate::util` finds nothing.
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
  `coverage.mjs` says. **A JVM entry point is read from the code, not the path** (`isEntrySource`
  in `lib/langs.mjs`): `@SpringBootApplication`, a static `main(String[])`, a Kotlin top-level or
  `@JvmStatic` `fun main` — through `javaCode`, so a comment naming `main` is not one. `build.mjs`
  sets `isEntry` from it and `findOrphans` asks again, because an older index is read without
  complaint. Nothing wider: `@Configuration` and `@Component` are an ordinary class's annotations,
  and a dead one is exactly what the finding exists for. `package-info.java` and
  `module-info.java` are never candidates — they declare no class to reference.
- **A path alias is read from the repo, never guessed.** `tsconfig.json` / `jsconfig.json` `paths`
  and `baseUrl` are declared, exactly like `go.mod`'s module path and `composer.json`'s PSR-4
  prefixes, and the JS adapter follows both links a config can carry: `extends` upward, because splitting
  options into a base config is the normal layout, and `references` sideways, because a solution-style
  repo puts every option somewhere the name `tsconfig.json` never reaches. A reference names a file
  or a directory; the table it yields is keyed at **that config's own directory**, since its `paths`
  are relative to it, and several configs governing one directory are merged rather than raced — the
  nearest claim tried first. Aliases are tried **only after** the relative resolver returns null, so the
  pass is strictly additive: a repo declaring nothing cannot get a different graph because of it.
  Never widen this into inferring an alias from directory names — the value of an edge is that it
  means something, and resolving `react` to a local file because a `baseUrl` sat above one is worse
  than missing the edge.
- **A workspace package is declared twice, and both declarations are read.** The globs in
  `pnpm-workspace.yaml` / `package.json` `workspaces` choose directories; each directory's own
  `package.json` `name` claims the specifier. `@scope/pkg` then tries `exports`, `module`, `main`,
  `types`, `src/index.*`, `index.*` — first one that is a file wins, so an entry into an uncommitted
  `dist/` falls through to source. It runs **after** the alias pass, additive like it. A
  `package.json` no glob matches is not a package, whatever its directory is called.
- **A Java class in the same package needs no import, so the extractor reads the code for it.**
  Capitalised names used bare — not after a `.`, not imported, not declared in the file — reach the
  resolver as `./Name`, and resolve beside the file, or in the same package under the module's
  other `src/{main,test}/java` root. Comments and every literal form are blanked first; a name in a
  javadoc is not a dependency. Never across modules: which module's package a class sees is a
  build-file question.
- **The route map is the one cross-repo reader, and extraction and joining are kept apart.**
  `extractRoutes` runs inside `buildIndex`, per repo, and writes `index.routes` — always present, so
  "found none" and "an index older than this" stay different answers; `resolveRoutes` joins several
  repos' rows, and `cortex-routes.mjs` owns finding them (#436's workspace: git repos directly under
  a directory, team-brains out). One normal form for a path — `{id}`, `:id`, `${id}` are all `{}`.
  Four rules each came from a real repo, not a fixture: a verb call counts only on a receiver that
  reads as an HTTP client (a service worker's `cache.put("/index.html")` was a call); a path with no
  literal segment is `unread`, not `/{}` (Angular's `this.url + "/" + id`); a call naming another
  host is never reported unmatched (third-party APIs); and inside one repo a literal segment beats a
  variable, as Spring decides it (`/articles/feed` is not `/articles/{slug}`). A gateway's target
  only ever **narrows** path-true matches and never to nothing. The findings are **not** in
  `analyse()`: on a front-end-only repo every call is unmatched by construction. Design and limits:
  [`docs/specs/2026-09-27-route-map-design.md`](../docs/specs/2026-09-27-route-map-design.md).
  Validated on the Harbor workspace (7/7 calls, 3/3 gateway routes, each to one repo), the RealWorld
  React + Spring pair (22/22 calls, 19/19 handlers) and spring-petclinic; every cited `file:line`
  was opened and checked.
- **Those configs are JSON with Comments.** Every generator TypeScript ships writes `//` lines into
  them, and a real one carried a trailing comma after its last `paths` entry. `parseJsonc` strips
  both — respecting strings, so a `//` inside a URL survives — and returns `null` rather than
  throwing. A config that cannot be read costs its aliases, never the run.
- **This gap was invisible to fixtures and obvious on one real repo.** A Next.js app wrote 428
  imports as `@/…` against 104 relative ones: the index held a fifth of its edges and called 154
  files orphans, and *every* consumer — orphans, impact, depth, the viewer — was confidently wrong.
  Nothing in the test suite could have found it. It happened a second time, the same way: the
  `extends` half was fixed and `references` was never considered, so a stock Vite React-TS app —
  the layout `npm create vite` generates — resolved **13** of its 109 imports and reported **30**
  unreferenced files. Validate resolver changes against cloned repos,
  and check that every resolved target actually exists on disk; more edges is not the same as
  correct edges.
- **Coverage uses three signals** — name, import, and a quoted string mention — and lives in
  `lib/coverage.mjs`, shared by `findings.mjs` and `impact.mjs`. Each alone misreports: naming
  alone called `mcp/lib` untested when its tests live in `mcp/test`; a CLI spawned as a subprocess
  is invisible to both name and import, which is what the mention signal is for. Quoted-only, so a
  file named in a comment is not counted as exercised. Do not copy this heuristic into a third
  caller — two copies would agree today and disagree in a month, with nothing to say which is right.
  **`briefCandidates` reads it too**, as the `tested` set both callers pass: counting the tests
  inside an area told every Maven/Gradle `src/main` it had "no tests" while the same report had
  found tests in `src/test` for most of it (#460).
  **The import signal follows barrels**, through edges `build.mjs` marks `reexport` (`export … from`
  only — never an ordinary import inside the target, which would call everything under a test
  covered). A *named* re-export carries `names` and is followed only when the test uses one of
  them: zustand's `middleware.ts` re-exports `ssrSafe as unstable_ssrSafe`, which no test calls, and
  loading a barrel is not testing it. Without test text a named hop is not followed. **Only code,
  scripts and `.bats` can be tests** (`canBeTest` in `lib/langs.mjs`): a `tests/AGENTS.md` written by
  `/cortex-brief` counted as a test and its prose marked configs tested, so Cortex's own output
  changed its findings. Coverage asks `canBeTest` too, so an older index cannot lend coverage from
  a document.
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
- **A skill Cortex wrote is checked against the repo it describes, by `lib/skill-drift.mjs`.**
  Three claims the disk can refute: a backticked path that is gone, "no tests" beside a test suite,
  a script no `package.json` declares (or a missing `mvnw`/`gradlew`). `/cortex` keeps existing
  files by design, so on the first upgraded repo two skills told agents there were no tests beside
  83 and cited moved paths — and nothing re-read them (#462). Every rule can only **drop** a
  candidate: the path must miss the index, the disk, every indexed suffix and `git check-ignore`;
  a create-verb before it or an absence word on its line excuses it; a claim scoped to a module,
  conditional or historical is not a claim about the repo. No index means `null`, never a clean
  bill. `next.mjs` shows it as a `skill-drift` row that exists only while a line is wrong, so a
  repo without drift reads exactly as before. Validated on that repo: 12 findings, all real.
- **`cortex-impact.mjs` reads the graph backwards** — who imports me, not what do I import — and
  every count it returns is a floor, named `atLeast` so a caller cannot print it as a total.
- **`--size` recommends and never decides** (`lib/sizing.mjs`, agent-team spec T2). It is a
  policy over `impactOf`, `layerKeyFor` and `UNRESOLVED_LANGUAGES`, and it recomputes none of
  them. Its lines live in `SIZING_THRESHOLDS` alone. They are **provisional**: calibrated on four
  repos' commit history, not measured against outcomes, and the eval harness (#407) is where they
  get settled. Three choices in it are load-bearing. **Only non-test source counts toward areas.**
  Counting tests, docs and config made a fix-plus-test two areas and every release four. **A
  blind file is `null`, never `single`**, unless another signal crosses anyway. **No index is
  `null` with the reason, never a default.** Its known gap is that `layerKeyFor` is coarse: all of
  spring-petclinic's Java is one area and zustand's core is `src`, so a multi-file refactor inside
  one area is sized by its dependents alone. zustand's store-API change reads `single`.
- **`--against` reads one hop in both directions between two change sets, and nothing further**
  (`lib/overlap.mjs`, #408 v0). A two-hop chain is real coupling, but reporting it would turn every
  shared utility into a warning; the full radius is what the plain command is for. Three choices in
  it are load-bearing. **Every compared path goes through `normalizeChangedPath`** in
  `lib/changed.mjs` — `impactOf` included — because `src\a.js`, `./src/a.js`, an absolute path and
  `src/a.js` compared literally are four files and report no overlap. **`--against-ref` has no
  fallback**: `HEAD...ref` is their work alone, and a bare diff would hand my own commits back to me
  as theirs, so no merge base is a named failure. **An empty "theirs" exits 2**, never "no overlap" —
  it is usually a list written to the wrong place, or a session that has not committed yet.
  Unknown paths still take part in direct overlap (two sessions creating one new file is a real
  collision) and are listed, never dropped.
- **`next.mjs` may only call a step done on the strength of a file that exists.** Every ✓ names its
  evidence — `.cortex/index/index.json`, a report under `.cortex/findings/`, `CONTEXT.md`, a
  `<dir>/AGENTS.md`. `done`/`total` count **required** steps only — the viewer ticks its own
  optional step, and counting it made the page and the CLI print different fractions. It is deterministic for the same reason the index is: the sequence is a fact
  about the repository, and a model re-deriving it each session hands the user a different answer
  every time. A step nothing on disk can settle is `optional`, which never becomes "next" and never
  blocks — never a silent tick.
- **The `loop` row is done when one `/cortex` pass has nothing left to write, not when the loop is
  complete.** `evals` and `bands` are blocked until that pass writes `CLAUDE.md` and `REVIEW.md`,
  and then wait on history no second pass can invent — real past tasks, a metric with a record.
  `SECOND_ROUND` gives each its own row naming `/cortex evals` or `/cortex bands`. Before it, the
  row said "Next → /cortex" forever on a repo whose owner had rightly deferred bands. `bands` is
  `optional`: a library with no production metric is finished without one.
- **ADRs live in `docs/adr/` or `adr/`, and `lib/adr.mjs` is the one answer to which.** `adr/` is
  proposed when `docs/` is a published site (a generator config, or a workflow that deploys pages
  from `docs`), because an ADR under a site's source is published with it. Every reader — review,
  `isContextDoc`, the view, `readState` — goes through `isAdrPath`/`adrLocation`; a sixth
  `/docs\/adr\//` regex is the drift this replaced. Not `.cortex/adr/`: the walker skips `.cortex/`,
  so review would never see them.
- **A cadence step answers two questions, and `done` is only the first.** `done` means *started* —
  a file exists — and that is right for `enrich`, which is run once on an unfamiliar repo. It is
  half an answer for `memory`, which is a **cadence**: a digest is meant to land at the end of a
  working day, so a store last written weeks ago and one written this morning are not the same
  state. They printed the same green tick and the same sentence — `4 digests in .cortex/memory/
  (committed)` — which is the enrichment defect one layer down, three conditions arriving as one
  value. The evidence therefore names the newest digest, and `readState` carries `memoryLatest` so
  a caller reads the fact instead of re-deriving it from the listing.
- **The currency is a date, never an age — `next.mjs` has no clock.** "27 days stale" cannot be
  computed here: a duration needs `now`, and the same tree would answer differently tomorrow, which
  is the determinism rule at the top of this file. `latestDigest` returns the date the filename
  carries and stops. A caller that legitimately owns a clock may subtract; this module states the
  fact, exactly as `readEnrichment` returns a state and lets `cortex-view` own the decline policy.
  If you are about to add `daysSince` here, you are moving a policy into a reader.
- **The viewer draws only what can have an edge.** `view.mjs` marks a node `inMap` for `code` and
  `script` alone. Docs and config stay in the Files tab: on this repo 171 of them are isolated
  nodes that pushed the 98 connected ones off screen. If you widen it, the legend swatch and the
  node colour must still agree — a legend that does not match the picture is decoration.
- **The page carries nothing about the machine that built it.** It is the artifact people share, and
  it once inlined the absolute root — `C:\Users\<name>\…` — through `generated.root` and the
  sequence's `state`. `buildView` emits the repo's name and repo-relative paths, trims the sequence
  to what the page draws, and scrubs any string still quoting the root or home directory.
  `view-repo.test.mjs` asserts it on a real git fixture; a literal index has no root to leak.
- **Every count on the page is a `stats` field, computed once in `buildView`.** A subset gets its
  own name (`mapFiles`, `mapEdges`) and its own label, never the headline's. The untested set is
  `codeCoverage` from `findings.mjs`, the same answer the report's title prints. The demo run found
  imports at 70 / 69 / 66 and untested at 11 / 26 across tabs of one page.
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

### The loop reader — `lib/loop.mjs`

`/cortex`'s script, the way `findings.mjs` is `/cortex-install`'s. It answers "which artifacts of the
SDLC loop does this repo have" from files on disk, with no model and no clock, and `next.mjs`
borrows its three numbers rather than keeping a second list.

- **An unbuilt index is an unanswered question, never an answer.** `greenfield` requires an index
  that reports zero files; a missing index makes it `false`. The first run said "no code yet" over
  this repository's several hundred files because `stats.files ?? 0` read absence as zero.
- **Commands are detected, never assumed.** `detectCommands` reads `package.json` scripts and real
  Makefile targets — not `.PHONY`, not assignments, not an empty script string — and Make wins where
  both exist. A Python or Go repo with neither returns nulls on purpose: the ritual asks. Adding a
  source means adding a detector that can be wrong in only one direction, toward "not found".
  `detectFormatters` follows the same rule — a config file the formatter itself reads, never a
  `format` script — and an empty list stamps a `format-changed.sh` that does nothing. Lint is a
  family of names (`lint`, `test:lint`, a lone `lint:*`). Several parts with no aggregate return
  null rather than a command that checks half the repo, and a fixer is never chosen.
- **A test command must exit.** `"test": "vitest"` watches in a terminal, so the verification
  block, the verifier and the evals workflow all named a command that hangs. A watching `test`
  script gives way to `test:run` / `test:ci` / `test:once` when one runs once; otherwise `test` is
  null and `commandNotes.test` says why — never an invented `vitest run`. Scripts are followed
  within the manifest, never into another package (`--filter`, `-r`): vitest's own root script
  reaches a watcher that way and is still reported, a documented limit.
- **A protected path needs evidence, not a name.** For `migrations?/` the file is the evidence —
  SQL or code, never under a `docs/` tree — because zustand's hand-written upgrade guides in
  `docs/reference/migrations/` were proposed for a hook that blocks edits.
- **Lockfiles are read off the disk, not the index.** `walk.mjs` drops `*.lock`, `*-lock.json` and
  anything over its size cap, so a fixture listing `yarn.lock` in `index.files` passes while every
  real repo reports none. The index names the directories holding a manifest; `has()` checks for
  a lockfile beside each, by exact name. Trees and lockfiles are capped apart.
- **The Maven and Gradle wrappers are generated, and read off the disk the same way** (#482). The
  scripts (`mvnw`, `mvnw.cmd`, `gradlew`, `gradlew.bat`) must be files and the wrapper homes
  (`.mvn/wrapper/`, `gradle/wrapper/`) must be directories, found beside the root or a JVM build file
  the index saw. Most JVM repos are looked at before they have an index at all, so the root is
  always asked. Wrappers get their own cap, and one project's entries stay together, nearest project
  first. Sorted flat by depth, `.mvn/wrapper/` fell behind every nested `gradlew`, and the cap cut
  every wrapper directory.
- **The hooks row applies only where a hook template has work** — a path to protect or a
  formatter to run. It once promised a "test-file lock" no template provides, and stamped two no-op
  scripts on repos with neither; a `hooks` block on disk does not make such a row served.
  `loop.test.mjs` fails when any row's text names a file no template provides.
- **Every `why` goes through `evidence()`, and every blocked row's `needs` through `unmet()`.** Both
  rules were written after a real run: `null` printed inside a sentence, and a row claimed to need
  the CI system that its own evidence said was present. `unmet` returns only prerequisites that
  fail *now* — a static list is true of the row and false of the repo.
- **Presence is a file fact, not a grade.** A hollow `REVIEW.md` is `present` and is never offered
  for rewrite; an empty `intent/` is `missing`. Blocked rows never hold `complete` open — a repo
  with no CI is finished without an eval suite.
- **Rank is control flow and ranks are unique.** Re-ranking a row changes the interview's order.
- **Every entry carries `protectedWrites`** — its paths under `.claude/`, from `protectedClaudePath()`
  in `core/claude-code.js`, never from a local list. Claude Code refuses those writes in a
  `claude -p` run whatever the allow rules say, so a headless `/cortex` leaves exactly these rows
  missing while the rest lands; the ritual and the E2E harness read the field to say so instead of
  reporting the row as written or as declined.
- Validated on `got` (npm), `fzf` (Make, Go) and `flask` (Python, nested example manifests), and
  mutation-tested: nine guards broken one at a time, nine test failures. The watcher, lockfile and
  hooks rules were validated on bulletproof-react, vitest (root and examples), zustand, the Nest
  starter, a CRA app, ripgrep and fzf, with nineteen more guards mutated. Do both again when a row
  or a detector changes — fixtures here share the author's blind spots.

### The Claude-setup checker — `lib/claude-setup.mjs`

Grades a repo's `CLAUDE.md`, skills, subagents, hooks and direct Messages API calls against
`core/claude-code.js`; `analyse` appends what it returns. **A new check is a `CHECKS` row, not a
branch** — and its `rule` must be an id in `core/claude-code.js`, whose evidence sentence the detail
quotes. A check with no documented sentence behind it is Cortex's own threshold and says so in the
detail at `low`. Severity is never above `medium`: these are findings about a user's repo, not
failures (spec D3). `cortex-output-passes.test.mjs` stamps every template the `/cortex` skill's
table places and expects zero findings, so a template that breaks a rule fails here first.
Validated on superpowers, anthropics/skills and anthropics/claude-code; each false positive found
there (a negated "not read-only", `[Title](URL)`, "explain the reasoning", unindented prose in a
description) has a test.

### The agents a repo already has — `lib/agents.mjs`

Spec T6: before `/cortex` offers the agent team, each `.claude/agents/**/*.md` at the repo root is
graded, mapped to one of the five roles in `templates/team/`, and given edits the developer confirms
one agent at a time. `cortex-loop.mjs --json` carries it as `agents`.

- **Reuse, never re-derive.** The agent list, the frontmatter reader, tool reading and the read-only
  prose test are `claude-setup.mjs`'s. `subagentGrades` runs the checker's own rows one agent at a
  time. The roster's tools and every sentence a proposal quotes are read from the role templates,
  so a template change is a proposal change. Do not keep a second tools table here.
- **Every mapping rule may only drop a candidate.** Candidates come from a role word in the name
  and a job phrase in the description. They are removed by negation, by a sequencing clause ("use
  after implementing"), by another agent's hyphenated name, by `<example>` dialogue, by a lens
  (`security-`, `ux`, `docs`), by a job the roster lacks (`debugger`, `researcher`, `orchestrator`),
  by missing edit tools for the two roles that write files, and by a name that names one role. Two
  survivors or none is `null`, "unmapped — ask". A wrong mapping hides a role the repo lacks, since a
  covered role is never offered, and pushes edits toward the wrong job.
- **A description phrase is a verb or a job, never a bare role noun.** The templates themselves
  say "before the Implementer starts". QA names both Tester and Reviewer, and only the description
  chooses. A generic noun (`developer`, `dev`) names the Implementer only when nothing more specific
  stands beside it. `engineer` never does: `prompt-engineer` and `release-train-engineer` were
  mapped that way on real repos, and they are not.
- **A proposal must be provable from the file and the roster, and names its line.** Edit tools on
  the Architect or the Reviewer, no `tools:` line at all, a tool outside the roster (never an MCP
  tool or TodoWrite, which are the repo's own tuning), a description that never says when to call
  it, no citation rule, or a scoped `AGENTS.md` the agent never reads. A root `AGENTS.md` loaded
  through CLAUDE.md, as an `@` import or a symlink, needs no line. `saysWhen` is generous on
  purpose: only an absence is proposed. An unmapped agent gets no proposals.
- **`.claude/agents/` is scanned recursively, and so is a plugin's `agents/`** — the sub-agents docs
  say so, and identity comes from `name`, not the path. A `[^/]+` pattern once missed every agent
  in a subfolder, here and in `claude-setup.mjs`.
- **The developer's answer outranks the mapper** (`opts.as`, `{ path: role | null }`, reason
  `developer`). A path that is no agent here and a role the roster lacks are refused, not ignored.
  The verifier keeps its upgrade only when it is answered as the reviewer.
- Validated by hand on 83 agents in seven public repos (octez-manager, metaxy, spica, kapi-sprints,
  a-safe-pulse, Heimdall, posthog). Two mappings are still wrong, and both are recoverable because
  the developer confirms every mapping. octez-manager's `architect` is a pre-merge architecture
  reviewer, and the name outranks a description with no job words. spica's `pr-review-analyst`
  reviews other reviewers' comments. Mutation-checked: 32 guards, each breaking a test.

### The team offer — `lib/team.mjs`

Plan step 14 (spec T4, T6, T9): turns `agents.mjs`'s report into the `team` loop row and, after the
picks, the files, values and `{{ROSTER}}` `cortex-loop.mjs --team` prints. `skills/cortex/TEAM.md`
is the ritual's half.

- **Every role is its own pick, and a withheld role is named with its reason.** Covered, no plan
  folder (the Project manager only), or a collision. Never dropped silently.
- **Never clobber, never a second agent of one name.** A role whose file (`.claude/agents/<role>.md`,
  on disk even if the index never saw it) or whose name another agent has is withheld with "rename
  it first"; so is the upgrade. Found on kapi-sprints: answering its own `reviewer.md` as "not the
  reviewer" freed the role, and the Reviewer template would have been written over it. A
  `.claude/skills/team/SKILL.md` Cortex did not record is a `conflicts` entry, never overwritten —
  the playbook loads the skill by that name.
- **A value is detected or asked, never invented.** `needs` lists each placeholder a picked role's
  files use (the Tester's include `test-paths.sh`'s) that came back `null`. RUN is the verifier's
  recorded value, and a damaged record costs that value only. Test globs come only from files the
  index marks `isTest`: an extra glob widens a fence that fails closed.
- **The row is present once the playbook is in `CLAUDE.md`**, not when every role is. Declined roles
  are the developer's T4 choice and must not hold the row open. The playbook is a block in a shared
  file, so it is not recorded; every whole file the team writes is.
- Validated on kapi-sprints (offers the architect only; four roles covered), octez-manager (tester
  and Project manager; `docs/plans/` exists) and zustand (no agents: four roles, the Project manager
  waits). Mutation-checked with `agents.mjs`, `loop.mjs`, `stamps.mjs` and the CLI: 41 guards,
  each breaking a test.

## Tests

```bash
node --test index/test/*.test.mjs
```

`lib/` is well covered, and since `lib/open.mjs` exists that now includes **argument handling**:
`open.test.mjs` drives the unknown flag, the `-v`-shaped root, the corrupt index and the version
mismatch from literals, with a fake io so a refusal is an observation rather than a dead test
runner. It used to be reachable only by spawning a real process from a shell fragment, which is why
seven copies of it went unexercised.

`cortex-memory.mjs` is the one CLI here that does not come through the front door — it takes a
subcommand and a `--root` that means `.cortex`, not a repo. Its whole surface is one write and one
refusal — `index/test/cli.test.mjs` asserts the exit code and that the refusal never echoes the
secret, and the judgement it forwards to lives in `core/scrub.js`. It is the only CLI here that
needs nothing more.

Every other one earns a `tools/test/cortex-*.test.sh` against a **real git fixture**, by the rule:
**does it print a sentence a user will act on, or write into their repo?** A CLI whose only failure
mode is a crash does not need one — a stack trace is its own report. The reason these must be git
fixtures and not `mkdtemp` directories is that git is what decides the answer: `walk.mjs` asks it
(ADR 0003), churn drives severity, and a non-git fixture can only ever execute one side of both.

- `cortex-index.mjs` — the `Skipped by name` count is what stops an incomplete index from reading
  as a complete one, and only git can overrule the `bin/` guess. It also writes `.gitignore`, where
  `.cortex/memory/` must stay *un*ignored because it is committed.
- `cortex-findings.mjs` — the report is the wizard's script (ADR 0006), so severity is control flow,
  and the branch that promotes a finding to `high` is reachable only from a real commit history.
- `cortex-enrich.mjs` — the one place a model wrote the input. Every drop must be reported, and
  `status` and `merge` must agree about what a batch result looks like: they did not, so `status`
  told agents to redo work `merge` accepted without a single issue.
- `cortex-skills.mjs` — it writes nothing, so everything it is worth is in the sentences it prints,
  including the three refusals: no index, no manifest, already present — and the drift lines,
  whose one failure worth a git fixture is reporting a path the repo's `.gitignore` declares.
- `cortex-impact.mjs` — a confident total instead of a floor tells someone to stop looking. Its
  `--against` half is also pinned from outside by `tools/test/e2e-workspace.test.sh`, which runs
  the workspace harness's S4 overlap check on a two-repo workspace it builds.
- `cortex-next.mjs` — a wrong "next", or a ✓ on a step nobody ran, walks the user past the step
  that writes their context layer.
- `cortex-loop.mjs` — `/cortex` walks its JSON, and the agents section decides which team roles
  are offered: a role it calls covered is never offered again. `tools/test/cortex-team.test.sh`
  runs `--team` through `cortex-stamps.mjs render` and `record` on a real git fixture: the stamped
  team passes the checker, the fence refuses code, and a template bump reads as `update`.
- `cortex-review.mjs` — the only thing that reads the context layer back, and its two honest
  failures are claiming a rule exists where there is no context layer, and staying quiet about a
  document the change just made wrong.
- `cortex-routes.mjs` — "nothing reaches this endpoint" is a sentence someone deletes code on, so
  it must stay a floor, and a workspace must be read without writing into any repo of it.
- `cortex-stamps.mjs` — `record` writes `.cortex/stamps.json` and nothing else, and status names the
  files a re-run may rewrite. The record only works if it is committed, so an ignored one is warned
  about, with the rule that hides it (`git check-ignore -v`) and a fix that works on real git: under
  a `.cortex/` rule a bare `!.cortex/stamps.json` re-includes nothing, since git cannot re-include a
  file inside an excluded directory — the advice is `.cortex/*` plus the negation. A `!` match
  exits 0 from `check-ignore -v` too, so the exit code alone would warn about the fix itself. The
  user's `.gitignore` is never edited here.
- `cortex-shared-plugin.mjs` — it writes a team's `.claude/settings.json`, so the test is a git
  diff. After `--write`, the only lines removed are the two that gain a comma, a second run writes
  nothing, and a file that does not parse is refused and left untouched, with no temp file.
- `cortex-view.mjs` — it writes into a target repo, so *where* it writes is the invariant, and its
  determinism is only observable from outside. A first run did once disagree with the second,
  because the page reported on its own existence.

`tools/test/install-on-a-project.test.sh` is not one of these and does not replace them: it asserts
the *pipeline* works on a repo shaped like product code, so a red there names three CLIs at once.
