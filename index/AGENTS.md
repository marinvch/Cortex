# index/ — the indexer, findings and enrichment

Turns a repository into a structural map, then into one ranked report. `lib/` holds the logic; the
`cortex-*.mjs` files at the top are the CLIs that skills invoke. Each `lib/` module's header comment
holds the rules for that module alone — read it before editing the module.

## Invariants

- **Nothing here may modify a target repository**, except by writing under `.cortex/`. `findings`
  returns data; `/cortex-scaffold` is the separate skill that applies changes. This separation is
  what makes "the user decides" structural rather than a promise a model has to keep — if you add
  a write to a source file here, you have broken the product's central claim. **Four named
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
  `/plugin` toggle, and someone chose it. Without the flag the key is never written. The third,
  **`cortex-section.mjs --replace`**, rewrites one section of `CLAUDE.md`, and only in state
  `outdated` (below). Every byte outside the section stays where it was, and the result is read back
  as exactly one section holding exactly the new text before it is written. Never widen it to
  `edited`. The fourth, **`ensureGitignored`** (`lib/generated.mjs`), appends the generated
  directories a target's `.gitignore` lacks when a CLI writes under that repo's `.cortex/` — append
  only, never `.cortex/memory/` (it is committed), and nothing at all when `--out` points elsewhere.
- **Tests that count loop rows delete `CORTEX_PROFILE` at the top of the file**, because a developer
  on a work profile must get CI's answers. Which repo is a team's is `teamServed`
  (`lib/shared-plugin.mjs`).
- **The index is deterministic.** No LLM, no network, no clock, no randomness. Same tree, same
  bytes. This is what makes it safe in CI and cheap on every install; `build.test.mjs` asserts two
  runs agree exactly.
- **A stamped file's state, adoption and the hash rule are `lib/stamps.mjs`'s header.** Where each
  loop file lands is `LOOP_STAMPS` in `lib/loop.mjs` — do not keep a second list.
- **A section Cortex appends to a shared file** (`current` · `outdated` · `edited` · `kept`) is
  defined in the headers of `lib/section.mjs`, `lib/sections.mjs` and `lib/shipped-sections.mjs`.
  Recomputing the roster from the agents would not do: `rosterFor` (`lib/team.mjs`) writes a
  Cortex-stamped agent as `` `tester` `` and an existing one as `` `tester` (tester) ``, so every
  stamped section would read `edited`.
- **Every CLI here opens through `lib/open.mjs`, and declares its flags rather than testing for
  them** — all but `cortex-memory.mjs`, which takes a subcommand and a `--root` that means
  `.cortex`. The declaration *is* the allowlist: an unregistered or misspelled flag is refused with
  a message naming it, never reinterpreted as a path. Do not write a ninth `parseArgs` — there were
  seven, and each one was a different subset of the same bugs.
- **Whether a command refuses, degrades or builds when the index is unreadable is `spec.index`**
  (`openTarget`). `readIndex` also checks `INDEX_VERSION`, which for one release was written into
  every index and read by no consumer at all — so an index in an older format was read confidently
  rather than refused.
- **Enrichment is additive.** It attaches summaries to files and never edits `index.json`, adds
  files, or removes them.
- **`enriched.json` has one reader — `readEnrichment` in `lib/enrich.mjs` — and it returns a state,
  not a document.** **`ok` is the only one a caller may trust**; the states, their notes and why
  staleness never points at `merge` are in its JSDoc. The viewer declines stale enrichment — the
  policy and its argument are in `cortex-view.mjs`.
- `findings.mjs` and `next.mjs` ask `has(ENRICHED_REL)` and that is correct — "was this step ever
  run" is a question about a file existing, and `next.mjs` may only tick a step on the strength of
  one. Do not route them through the content reader to make the caller count come out at one.
- **Validate everything a model produced, but only drop what is actually wrong.** Never let an
  unreported drop happen — a silently incomplete enrichment looks exactly like a complete one. How
  `enrich.mjs` tells a hallucinated path from a renumbered batch is in `validateBatch`.

## Gotchas

- **Vendored is declared in `.gitattributes`, never inferred from a directory name.** Same rule as
  `go.mod` and `composer.json`: declared beats guessed, because a directory a team genuinely writes
  can be called `vendor/` and guessing would drop it from every ranking. `briefCandidates` and
  `isEnrichable` skip it and `stats.vendored` names what was skipped. A consumer that ranks or costs
  by size must use it *and* say which side it counted: silently dropping half a repo reads exactly
  like covering it. The rest is `lib/vendored.mjs`'s header.
- **`walk.mjs` asks git, not `.cortexignore`.** Those answer different questions:
  `.cortexignore` says what is not *knowledge in a vault*, and honouring it here dropped this
  repo's own `tools/` and `skills/` from its index. Do not "fix" this by reading it again.
  [ADR 0003](../docs/adr/0003-git-decides-what-belongs-to-a-repo.md) holds the argument and what it
  rules out — read it before proposing a second ignore source. Which directories are skipped by
  name, and which losses are counted, is `lib/walk.mjs`'s (`AMBIGUOUS_SKIP_DIRS`, `listFiles`).
- **"Stale" has exactly one definition, and it is `indexFreshness` in `lib/open.mjs`.** It briefly
  meant two things, which is worth remembering because neither copy was wrong: preflight's was
  written when it was the only reachable definition, and the CLIs grew one because they could not
  reach `tools/`. Two right answers to one question still disagree the moment one of them changes.
  Do not add a second.
- **Import resolution is regex-based**, so dynamic and computed imports are missed. That is a
  documented limit, not a bug — it is why the orphan finding says "worth checking", never "safe to
  delete". A code language `extractImports` has no case for belongs in `UNRESOLVED_LANGUAGES`
  (`lib/imports.mjs`).
- **One slot per language: a row in `ADAPTERS` (`lib/resolvers.mjs`).** Its header holds the
  `prepare` / `resolve` contract.
- **Rust: a file no crate root contains is rooted at its own directory** (`resolveRustImport`).
  Known limit: a nested helper (`tests/index/basic.rs` in ripgrep) roots at its own directory rather
  than at the test crate's, so its `crate::util` finds nothing.
- **"Unreferenced" means more than "unimported", and lives in `lib/orphans.mjs`.** **The direction
  of error is chosen:** it can only ever *remove* entries. `findings.mjs` and `view.mjs` both call
  it — there is no second copy, for the reason `coverage.mjs` says.
- **A path alias is read from the repo, never guessed.** Never widen this into inferring an alias
  from directory names — the value of an edge is that it means something, and resolving `react` to
  a local file because a `baseUrl` sat above one is worse than missing the edge.
- **This gap was invisible to fixtures and obvious on one real repo.** A Next.js app wrote 428
  imports as `@/…` against 104 relative ones: the index held a fifth of its edges and called 154
  files orphans, and *every* consumer — orphans, impact, depth, the viewer — was confidently wrong.
  Nothing in the test suite could have found it. It happened a second time, the same way: the
  `extends` half was fixed and `references` was never considered, so a stock Vite React-TS app —
  the layout `npm create vite` generates — resolved **13** of its 109 imports and reported **30**
  unreferenced files. Validate resolver changes against cloned repos,
  and check that every resolved target actually exists on disk; more edges is not the same as
  correct edges.
- **The route map** (`lib/routes.mjs`; design and limits in
  [`docs/specs/2026-09-27-route-map-design.md`](../docs/specs/2026-09-27-route-map-design.md)) was
  validated on the Harbor workspace (7/7 calls, 3/3 gateway routes, each to one repo), the RealWorld
  React + Spring pair (22/22 calls, 19/19 handlers) and spring-petclinic; every cited `file:line`
  was opened and checked.
- **Coverage uses three signals** — name, import, and a quoted string mention — and lives in
  `lib/coverage.mjs`, shared by `findings.mjs` and `impact.mjs`. Each alone misreports: naming
  alone called `mcp/lib` untested when its tests live in `mcp/test`; a CLI spawned as a subprocess
  is invisible to both name and import, which is what the mention signal is for. Do not copy this
  heuristic into a third caller — two copies would agree today and disagree in a month, with
  nothing to say which is right.
- **A skill Cortex wrote is checked against the repo it describes, by `lib/skill-drift.mjs`.**
  Validated on the first upgraded repo (#462): 12 findings, all real.
- **`cortex-impact.mjs` reads the graph backwards** — who imports me, not what do I import — and
  every count it returns is a floor, named `atLeast` so a caller cannot print it as a total.
- **`--size` recommends and never decides** (`lib/sizing.mjs`). A finer sizing-local area key was
  tried and rejected: zustand's `vanilla.ts`, `react.ts` and `traditional.ts` share one directory,
  so no directory key sees that refactor as spread.
- **Every path two change sets compare goes through `normalizeChangedPath`** (`lib/changed.mjs`).
  `--against` itself is `lib/overlap.mjs`'s header.
- **Where ADRs live is `lib/adr.mjs`'s one answer** (`isAdrPath`, `adrLocation`); no reader keeps
  its own `docs/adr/` regex.
- **The page carries nothing about the machine that built it** — no absolute root, no home
  directory (`scrubPaths` in `lib/view.mjs`). The viewer's other rules — what draws on the Map, one
  `stats` field per count, `safeJson` — are in the comments of `lib/view.mjs` and
  `lib/view-html.mjs`.
- A single file over the line budget is allowed through as its own batch; only *accumulation* is
  bounded.

### The loop reader — `lib/loop.mjs`

Its rules are in its comments and `loop.test.mjs`; the second-round rows are `SECOND_ROUND` in
`lib/next.mjs`.

- Validated on `got` (npm), `fzf` (Make, Go) and `flask` (Python, nested example manifests), and
  mutation-tested: nine guards broken one at a time, nine test failures. The watcher, lockfile and
  hooks rules were validated on bulletproof-react, vitest (root and examples), zustand, the Nest
  starter, a CRA app, ripgrep and fzf, with nineteen more guards mutated. Do both again when a row
  or a detector changes — fixtures here share the author's blind spots.

### The Claude-setup checker — `lib/claude-setup.mjs`

Validated on superpowers, anthropics/skills and anthropics/claude-code; each false positive found
there (a negated "not read-only", `[Title](URL)`, "explain the reasoning", unindented prose in a
description) has a test.

### The agents a repo already has — `lib/agents.mjs`

- Validated by hand on 83 agents in seven public repos (octez-manager, metaxy, spica, kapi-sprints,
  a-safe-pulse, Heimdall, posthog). Two mappings are still wrong, and both are recoverable because
  the developer confirms every mapping. octez-manager's `architect` is a pre-merge architecture
  reviewer, and the name outranks a description with no job words. spica's `pr-review-analyst`
  reviews other reviewers' comments. Mutation-checked: 32 guards, each breaking a test.

### The team offer — `lib/team.mjs`

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

Every CLI but `cortex-memory.mjs` earns a `tools/test/cortex-*.test.sh` against a **real git
fixture**, by the rule: **does it print a sentence a user will act on, or write into their repo?** A
CLI whose only failure mode is a crash does not need one — a stack trace is its own report. The
reason these must be git fixtures and not `mkdtemp` directories is that git is what decides the
answer: `walk.mjs` asks it (ADR 0003), churn drives severity, and a non-git fixture can only ever
execute one side of both. Each test's header says what it defends.
