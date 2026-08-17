# Changelog

All notable changes to Cortex. Format based on [Keep a Changelog](https://keepachangelog.com);
this project now versions independently of any package manager (see `VERSION`).

## [Unreleased]

### Changed
- **`/analyze-spec` gained the vocabulary for what it cannot yet see.** It could lock decisions and
  rule work out of scope, but had no way to say "this is in scope and I cannot yet phrase the
  question sharply" — so that material either hardened into confident detail nobody had decided, or
  fell into `Out of scope` and was silently abandoned.

  Now: **destination** (named first, because it fixes the scope every later decision is judged
  against), **fog of war** (in scope, not yet sharp), and the test between them — can you state the
  question *precisely now*, not can you answer it. The spec template gained **Not yet specified**
  alongside `Out of scope`; the two are different rulings, one about sharpness and one about scope.
  If naming the destination surfaces no fog at all, the ritual now says so and stops: that is
  `/plan-feature` work, not a spec.

  Harvested from upstream's `wayfinder`, which is **not** being ported. Reading it showed the
  overlap concern was wrong — it is genuinely different — but it is hard-wired to an issue tracker
  (map as a labelled issue, tickets as child issues, frontier from native blocking dependencies)
  and cascades into `research` and `prototype`, both already skipped. This repo has zero issues and
  runs on PRs, the same reason `to-tickets` and `triage` were skipped. Verdict and reasoning are
  recorded in the harvest doc; revisit only if a tracker is adopted.

### Added
- **`/handoff`** — compact the live conversation into a document another agent can pick up, written
  to the OS temp directory. Ported because Cortex's whole thesis is not losing context and this was
  a hole in it: `/dream` consolidates a day for the *team*, `/catch-me-up` reads git after time
  *away*, and neither packages an **in-flight** session for a **different agent right now**.

  Exactly the failure that produced today's work — a parallel session on 2026-08-15 was closed with
  its skills survey unrecorded and `/improve-codebase-architecture` stranded on a gitignored path.

  Cortex additions on top of the upstream body: a table cutting it against `/dream` and
  `/catch-me-up` on **in-flight state versus durable knowledge** (a lesson learned belongs in the
  committed digest, not a temp file gone by next week); redaction must **say what it redacted**, so
  the next agent knows a value exists instead of inheriting a silent gap; and name the branch, or
  the next agent goes to `master` looking for changes that are not there.
- **`/writing-for-agents`** — the authoring discipline for documents an agent consumes, and the
  vocabulary Cortex was missing for its own product: **context pointers** (a skill description, a
  routing-table line — the wording, not the target, decides whether the material is ever reached),
  the **two loads** (context load on the agent's window, cognitive load on the human), the
  **information hierarchy** and progressive disclosure, **completion criteria** and premature
  completion, **leading words**, and the pruning tests — duplication, relevance, sediment, no-ops.

  Ported because it names what Cortex does for a living. Every ritual writes one of these
  documents — root `AGENTS.md` and its routing table, scoped leaves, `CONTEXT.md`, skills,
  `.cortex/memory/` digests — and `/optimize-context` could **audit** them while nothing described
  how to **write** one. Those two are now wired as halves of one job, and `/skill-creator` points
  at `SKILL-MECHANICS.md` for the model-invoked vs user-invoked choice it cannot make alone.

  Cortex keeps one deliberate divergence: upstream weighs `disable-model-invocation` purely as
  context load versus cognitive load, while `/onboard`, `/migrate-engine`, `/team-init` and
  `/connect-brain` carry it because they are once-only or destructive. Safety outranks the load
  trade, and the skill says so.
- **`/grilling`** — the shared interview discipline: work a decision as a *design tree*, ask the
  whole settled *frontier* in one round with a recommended answer for each, and let every round of
  answers push the frontier outward until no branch is left silently assumed. Facts are the
  agent's job (dispatch a sub-agent), decisions are the user's.

  Ported because it was a **missing dependency**, not for completeness: `/improve-codebase-architecture`
  shipped in 2.3.0 telling the reader to "run the `/grilling` skill" for the loop that does the
  actual work after the report — and no such skill existed. `/analyze-spec`, `/level-up` and
  `/onboard` all interview the user ad hoc and now have one spelling to borrow.

### Fixed
- **MIT attribution on `/improve-codebase-architecture`.** It was ported from
  [mattpocock/skills](https://github.com/mattpocock/skills) by a parallel session without the
  footer every other ported file carries. A licence obligation, not a style nit.

### Documented
- `docs/superpowers/specs/2026-08-17-mattpocock-harvest.md` — the full survey of upstream's 18
  engineering + 7 productivity skills against what Cortex already ships: 5 already ported, 2 not
  ours to take, 5 already covered by the bundle, 4 worth porting, 9 skipped with reasons. The
  original survey was run by a parallel session on 2026-08-15 that recorded nothing and was closed,
  so the work was lost. Writing it down is the point.

## [2.3.0] — 2026-08-17

### Added
- **`/improve-codebase-architecture` is now a real skill.** It surfaces deepening opportunities —
  refactors that turn shallow modules into deep ones — reports them as HTML, then works through
  whichever one you pick. It had been written by a parallel session on 2026-08-15 and only ever
  existed in the **gitignored** `.claude/skills/` mirror, under a misspelled directory
  (`improve-codebase-arhitecture`) that did not match its own frontmatter `name:`. It carried no
  git history, so any mirror rebuild would have destroyed it silently. Promoted to canonical
  `skills/`, spelling corrected, and listed in the ritual table.

  Its three references to "the `/codebase-design` skill" were dead — `codebase-design` is a
  reference document (`references/codebase-design.md`), not a ritual. Repointed.

### Fixed
- **Re-planning an enrichment no longer discards it.** Batch indexes are positional, so adding or
  removing a layer renumbers every batch after it and the `batch-N.json` files already on disk end
  up describing a different batch. `validateBatch` treated that as a hallucinated path and dropped
  every entry — turning a one-file change into a total loss of the enrichment, the opposite of the
  resumability deterministic batching exists to provide. Found by dogfooding: deleting `.vscode/`
  removed one layer and the next merge reported **379 issues against 210 summaries, none of which
  were wrong**.

  A path that is real and indexed is now **kept and reported** when it arrives against a moved
  batch number; a path absent from the index is still dropped, because "landed in a renumbered
  batch" and "names a file that does not exist" are different failures. Coverage moved to
  `mergeEnrichment`, where it is computed across all batches at once — a per-batch gap is
  meaningless once files can legitimately move between batches.

  Verified by simulating the break: with every batch shifted by one, **198 of 198 surviving
  summaries were kept and zero dropped**.

### Changed
- `tools/cortex-sync-skills.sh` — refreshes the gitignored `.claude/skills/` mirror from the
  canonical `skills/`, with `--check` to report drift. The mirror had rotted to 22 of 30 skills
  with 9 stale copies, leaving five v2.0 rituals unavailable as slash commands. Mirror-only skills
  are reported and never removed: they have no git history to recover from.
- Deleted `.vscode/` — `settings.json` pointed at a `node_modules/typescript/lib` that does not
  exist, `tasks.json` ran npm scripts from a root `package.json` that does not exist, and
  `toolsets.json` listed retired engine MCP tools. `/migrate-engine` already named
  `.vscode/toolsets.json` as an engine artifact to delete.

## [2.2.0] — 2026-08-16

**The plugin actually installs now.** A live install round-trip — clone the repo the way a plugin
install does, then run the rituals against a real unrelated repository — found three defects that
166 passing tests could not, because every one of them was hidden by this development machine.

### Fixed
- **The MCP brain was dead on every fresh install.** `mcp/server.js` imported
  `@modelcontextprotocol/sdk`, but installing a plugin *clones* the repository — nothing runs
  `npm install` and no lockfile is honoured. Every user who installed Cortex from v2.0.0 onward
  got `ERR_MODULE_NOT_FOUND` and no `recall`, `remember` or `recall_memory`. It passed here only
  because `mcp/node_modules` existed on the machine the tests ran on.

  The SDK is gone. `mcp/lib/stdio.js` implements the MCP stdio transport directly — about 100
  lines of newline-delimited JSON-RPC replacing 22 MB across ~90 transitive packages, for the four
  symbols Cortex used. **Cortex now has no runtime dependencies at all**; `git clone` is the whole
  install. See [ADR 0004](docs/adr/0004-no-runtime-dependencies.md).
- **`/cortex-audit` was broken for everyone who installed the plugin.** The `cortex-auditor`
  subagent lived in `.claude/agents/`, which is project-local — an installed plugin loads
  subagents from `agents/` at its root. The ritual dispatched a subagent that did not exist. Moved
  to `agents/`.
- **Repo mode was misdetected on POSIX, and CI had been red about it for five commits.**
  `detectMode` delegated to `path.basename`, which resolves separators for the host it runs on —
  and on POSIX a backslash is an ordinary character, so a Windows `AI_OS_ROOT` came back as one
  long segment and every repo install looked like a vault. `path.win32.basename` understands both
  separators, so the bug was invisible on Windows while `mcp test` failed on every ubuntu runner
  from `bd51e11` onward. Which mode a root names is a fact about the string, not the host; both
  separators are now split explicitly, and a new test reads the source so it fails on **either**
  platform rather than only on Linux.
- **`core/*.js` relied on Node's ESM syntax-detection fallback.** No `package.json` above them
  declared `"type": "module"`, so every run printed `MODULE_TYPELESS_PACKAGE_JSON` and resolved
  against whatever `package.json` happened to sit above the install directory — which fails
  outright, not merely noisily, if that one says `"commonjs"`. Added `core/package.json`.

### Added
- **`core/test/install.test.js`** — the guard that would have caught all three. It reads the source
  of `core/`, `index/` and `mcp/` and fails on any non-builtin import, any declared runtime
  dependency, any ESM `.js` file without a `"type": "module"` above it, and any subagent a ritual
  dispatches that is not shipped in `agents/`. It reads source rather than attempting an import,
  because the environment is exactly what could not be trusted.
- **`mcp/test/stdio.test.js`** — pins the protocol edges an SDK used to own: notifications are
  never answered, unknown methods return `-32601`, a message split across reads still parses, two
  messages in one read are both handled, and a throwing tool produces `isError` instead of killing
  the session.

### Changed
- CI no longer has an install step, and `mcp/package-lock.json` is deleted — there is nothing left
  to lock. A future `npm ci` in the workflow would mean the plugin is already broken for users.
- `README`, `mcp/AGENTS.md`, `/connect-brain` and `references/living-cortex.md` no longer tell
  anyone to run `npm install`.

**182 tests, 0 failures** (was 166).

## [2.1.0] — 2026-08-15

### Added
- **An `api` tier carrying the official Postman plugin** — full API lifecycle management, powered
  by the Postman MCP Server. Offered when the index shows an API surface.
- **`core/test/bundle.test.js`** — fetches the official marketplace manifest and asserts every
  declared plugin really exists in it, so a bad name fails here rather than on a user's machine.
  Skips cleanly when the marketplace is unreachable.

### Fixed
- **Corrected a false claim.** v2.0.0 stated in `references/cortex-plugins.md`, the
  `/cortex-install` skill and its release notes that there was no Postman plugin in the official
  marketplace. There is. The claim came from listing the local plugin *cache* — 15 installed
  plugins — instead of the marketplace *catalog*, which holds 286. All three places are corrected,
  and the new bundle test is the mechanism that stops the mistake recurring.

## [2.0.0] — 2026-08-15

**Cortex becomes a context manager for new and legacy codebases, installable as a Claude plugin.**

### Added
- **Installable as a plugin** — `.claude-plugin/{marketplace.json,plugin.json}`. `/plugin
  marketplace add marinvch/Cortex` then `/plugin install cortex`, at user, project or global scope.
- **A deterministic index** (`index/`) — asks git what belongs to a repo, resolves imports for
  JS/TS, Python, Go, Rust and shell, infers layers from structure and hot spots from git history.
  No LLM, no network: the same tree always yields the same output, so it is safe to re-run in CI.
- **A findings report** — one ranked markdown artifact and nothing else. The module that finds has
  no authority to change a repository; `/cortex-scaffold` is the separate skill that applies.
- **Committed repo memory** (`.cortex/memory/`) — append-only dated files, so several developers
  and their agents share one context with git as the sync mechanism.
- **A secret gate** (`core/scrub.js`) — because memory is committed, any write carrying a
  credential is refused outright rather than sanitised.
- **Semantic enrichment** (`/cortex-enrich`) — optional summaries, roles and tags on top of the
  index. Deterministic batching, and validation that assumes the model's output is wrong.
- New rituals: `/cortex-install`, `/cortex-scaffold`, `/cortex-brief`, `/cortex-enrich`, `/dream`,
  plus `/wizard`, `/domain-modeling` and `/resolving-merge-conflicts` ported from
  `mattpocock/skills` (MIT).
- `references/codebase-design.md` — vocabulary for how code is shaped.
- `tools/cortex-vault-extract.sh` — moves the personal vault to its own repo. Dry run by default.

### Changed
- **The MCP server has two modes**, decided by the root it is given: a repo's `.cortex/` serves
  `recall` · `remember` · `recall_memory`; a personal vault serves the original tools. The vault
  tools are hidden in repo mode so an agent cannot write `inbox/` into a product repository.
- **Code is layered `core/` ← `index/` + `mcp/`**, enforced by `core/test/architecture.test.js`.
  `paths`, `scrub`, `memory` and `date` moved into the kernel.
- `listProjects` honours `.cortexignore` instead of hard-coding a `README.md` skip.
- `/analyze-spec` plans wide mechanical changes as expand → migrate → contract.
- Once-only rituals (`/onboard`, `/migrate-engine`, `/team-init`, `/connect-brain`) carry
  `disable-model-invocation`, so an agent can never auto-fire them.

### Fixed
- **`getProjectContext` read outside `AI_OS_ROOT`** — a slug like `../../secret` returned any file
  on disk. Both candidate paths now go through the existing `resolveInRoot` guard.
- **One slug rule** across `slug.js`, `cortex-init.sh` and `cortex-scan-projects.sh`, with a parity
  test. The mismatch made the employer-firewall purge delete a filename nothing ever wrote.
- **One project-stub contract** — the scanner wrote `**Local path:**` while the viewer selected on
  `^path:`, so scanner-registered projects were invisible in `cortex.html`.

### Note
This release moves the project's centre of gravity. The personal-vault half still works and is
being extracted into its own private repo — see `tools/cortex-vault-extract.sh`.

## [Unreleased]

**Repo health pass: contract enforcement, missing ritual, CI coverage.**

### Fixed
- **`recall` now honours `.cortexignore`** — `mcp/lib/recall.js` had its own hardcoded skip list, so
  the live brain indexed scaffolding and vendored third-party docs as if they were knowledge (256
  files indexed on this repo, 190 of them vendored; a search for "context engineering" returned
  library docs as all five top hits). It now shares the vault's single source of truth and produces
  a **byte-identical** knowledge set to `knowledge_files()` in `tools/_cortex-lib.sh`, guarded by a
  CI parity check.
- **`/daily` exists.** It was advertised in the README quick-start, the ritual table and `AGENTS.md`,
  but `skills/daily/SKILL.md` was never written.
- **Team captures can no longer overwrite each other.** The note id was `timestamp+pid`, so two
  captures in the same millisecond from one server process produced the same filename and the
  second silently replaced the first in an append-only store.
- **`.gitignore` negations now work.** `!context/.gitkeep` and friends could never re-include
  anything, because git does not descend into a fully-excluded directory; the personal folders now
  use the `dir/*` form. The `inbox/`, `daily/`, `notes/`, `projects/`, `areas/` and `resources/`
  READMEs the rule promised are committed, so a fresh clone has the **complete** vault skeleton —
  all eight folders, including `notes/` (the knowledge graph) and `daily/`, which the first pass
  missed.
- **Line endings normalized to match the stated policy.** `.gitattributes` declares "Git stores
  text as LF", but `* text=auto` only normalizes on write, so 12 files committed before it existed
  still carried **CRLF in the index** (11 historic `docs/superpowers/` plans and specs, plus
  `.vscode/settings.json`). `git add --renormalize` brings them in line; the change is
  byte-for-byte EOL-only (5896 insertions, 5896 deletions, zero content changes) and working
  copies stay platform-native.
- **`tools/README.md` was corrupt.** 1252 trailing NUL bytes had been appended after the final
  newline since the v1.0.0 release (`39e689e`), making the file register as *binary* — `grep`
  skipped it, and diffs of it were unreadable. The content was intact; the NUL tail is gone. It
  was the only tracked file in the repo carrying control bytes.
- **Version is single-sourced** from the `VERSION` file (`mcp/lib/version.js`); `server.js` no
  longer hardcodes it. The README advertised **v1.0.0** for the whole of the 1.1.0 release.
- Smoke test failures now report the server's stderr instead of a bare 5-second `timeout`.

### Added
- `LICENSE` (MIT) — the README promised it; the file did not exist.
- `.gitattributes` pinning `*.sh` to LF, so a Windows working copy cannot commit CRLF scripts that
  fail on Linux with `bash: $'\r': command not found`.
- **CI coverage** for the surfaces that had none: a Windows matrix leg for the MCP server (the
  primary dev platform, and `lib/capture.js` carries path-separator handling), a `hooks test`
  workflow (they run on every prompt and session end), shellcheck over `tools/`, a behavioural
  test for `knowledge_files()`, and a check that every hook wired in `.claude/settings.json`
  exists on disk.
- **Drift guards as tests**: `VERSION`/`package.json`/README/CHANGELOG agreement, and parity
  between `cortex-init.sh`'s hardcoded `CORE_PLUGINS` and `plugins/cortex-core-plugins.json`.

### Security
- **`fast-uri` host-confusion advisory resolved** (GHSA-v2hh-gcrm-f6hx, high) via a lockfile bump —
  `mcp/package.json` is unchanged, so this is not a breaking dependency change.
- The two remaining moderate advisories are **upstream-blocked and unreachable here**:
  `@hono/node-server` path traversal in `serve-static` (GHSA-frvp-7c67-39w9) arrives transitively
  through `@modelcontextprotocol/sdk`, which at its latest release (1.29.0) pins `^1.19.9` and so
  cannot reach the patched 2.0.5. The server connects over `StdioServerTransport` only and never
  serves static files, so the vulnerable path does not exist in this codebase. Revisit when the SDK
  bumps its dependency.

### Removed
- **330 vendored files under `.agents/` and 5 stale `.claude/skills/` copies** were tracked despite
  being gitignored — `git rm --cached` had never run, so "re-fetchable; keep the repo lean" was not
  true. Untracked, not deleted from disk.
- A stray `install.cmd` (Anthropic's Claude Code Windows installer, unrelated to this project).

## [1.1.0] — 2026-07-01

**Live MCP brain + team engine + plugin bundle.**

### Added
- **Live MCP brain** — `mcp/` Node server with `recall`, `get_project_context`, `list_projects`, and `capture` tools; security path-jail; one-line user-scope registration via `/connect-brain`.
- **Team context engine** — team-brain git sync (append-only, one-file-per-note, auto commit+push), generic `.cortex/connector.json`, `ai-os team init|add` (`/team-init`, `/team-add`).
- **Capture sources** — `ai-os digest` (read-only git/PR digest into brain notes).
- **Holiday catch-up** — `catch_me_up` MCP tool + `ai-os catch-up` (`/catch-me-up`).
- **Cortex Core Plugin Bundle** — committed manifest + `.claude/settings.json` stamping (Core tier out-of-the-box) + `ai-os setup-plugins` offering optional tiers by role.

### Resolved
- **#305**, **#306**.

## [1.0.0] — 2026-06-30

First stable **plain-files, bash-only** release. The vault and all tooling run with nothing but
bash — no Node, no Python, no engine. **Breaking:** the Node installer is retired.

### Added
- **Unified viewer app** — `bash tools/cortex.sh` builds and opens `cortex.html`: one self-contained
  page with four tabs — **Map** (Obsidian-style force graph), **Notes** (rendered markdown with
  clickable `[[wikilinks]]` and a 🗑 Remove button), **Repos** (registered codebases), **Gaps**
  (orphan notes + dead links). No server, no runtime.
- **Nested scoped briefs** — `/scope-area` adds a deep `AGENTS.md` leaf inside a critical directory
  plus an Area-map routing table in root, so agents load narrow, high-signal context.
- **`/migrate-engine`** — harvests an old engine's memory store into `AGENTS.md` *before* removing
  the old files, so no knowledge is lost across the breaking change.
- **`/analyze-spec`** — Spec-Driven Development grounded by the brain (Cortex context + Superpowers
  workflow).
- **`/reindex`** + `templates/moc.md` — keep the vault navigable as it grows (regenerate the viewer,
  nominate Maps of Content, resolve dead links).
- **Skill suggestion** and **old-engine detection** in `cortex-init.sh` and `/install-project`.
- **`.cortexignore`** — single source of truth for what *isn't* knowledge, shared by every generator
  via `tools/_cortex-lib.sh` (no per-script drift).
- **`cortex-rm.sh`** + in-UI Remove button — archive a note and de-link inbound references safely.
- **`--register-to-vault`** cross-repo registration; the Repos tab lists registered codebases.

### Changed
- Installer rewritten in **pure bash** (`tools/cortex-init.sh`) — zero runtime deps; works in
  git-bash, zsh, WSL, Linux, macOS.
- CI is now a **bash smoke test** (dropped the Node/bun matrix).
- Navigation model: **Maps of Content + links**, not deep folders.
- README rewritten with clear, step-by-step usage (including "use it on your other projects").

### Removed
- Node installer `cortex-init.mjs` → `archives/cortex-init.mjs.legacy`; both `package.json` files
  archived.
- Duplicate generators `cortex-nav.sh` / `cortex-brain.sh` → consolidated into `cortex.sh`.
- Stale `.vscode/*.chatprompt.md` old-engine leftovers and superseded static views → archived.

### Fixed
- **Graph noise** that looked like vault gaps: only genuine knowledge files are shown (23 vs 51) and
  dead-link detection is honest — examples, templates, comments, and inline-code `[[...]]` no longer
  count. False-positive dead links: 0.

### Validated
- Local CI green (12/12): every script parses, the installer smoke test passes, all 12 skills have
  valid frontmatter, the GitHub Actions workflow is bash-only.
- Demonstrated end-to-end on a real repo (`ai_saas`): brain installed, old engine migrated (10
  verified memory facts harvested), nested briefs created for auth / webhooks / RAG.

[2.3.0]: https://github.com/marinvch/Cortex/releases/tag/v2.3.0
[2.2.0]: https://github.com/marinvch/Cortex/releases/tag/v2.2.0
[2.1.0]: https://github.com/marinvch/Cortex/releases/tag/v2.1.0
[2.0.0]: https://github.com/marinvch/Cortex/releases/tag/v2.0.0
[1.1.0]: https://github.com/marinvch/ai-os/releases/tag/v1.1.0
[1.0.0]: https://github.com/marinvch/ai-os/releases/tag/v1.0.0
