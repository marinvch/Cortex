# Changelog

All notable changes to Cortex. Format based on [Keep a Changelog](https://keepachangelog.com);
this project now versions independently of any package manager (see `VERSION`).

## [2.7.0] — 2026-08-18

### Added
- **`server-setup.sh` provisions the cron half.** It set up the git half of server mode and stopped;
  scheduling was a section of `references/living-cortex.md` a human copied by hand.

  `bash tools/server/server-setup.sh cron <clone-url> [work-dir]` clones the working brain, creates
  the env file, and **prints** the two crontab lines it recommends — changing nothing else. Re-run
  with `--install` to write them into a marked block (`# cortex-cron (managed)`) that replaces any
  previous one and leaves every other cron line untouched.

  **Printing is the default on purpose.** A crontab is user-global, easy to clobber and annoying to
  reconstruct, and people run setup scripts speculatively. This is the consent structure Cortex
  already uses (ADR 0005, ADR 0006) applied to a new surface: read and report, apply on request.

  The cron script path is resolved from `server-setup.sh`'s own location. The docs hardcoded
  `$HOME/ai-os`, which is wrong for anyone who cloned elsewhere — and a provisioning step that prints
  a path which does not exist is worse than one that prints nothing, because it looks finished.

### Fixed
- **The documentation told operators to put a live API key in their crontab.** The published example
  was `ANTHROPIC_API_KEY=sk-... bash cortex-cron.sh --daily` as a crontab line. `crontab -l` prints
  it — the one command anyone runs to check their schedule — and it is carried into any backup of
  `/var/spool/cron`. It also contradicted the rest of the repo, where `core/scrub.js` refuses a memory
  write carrying a credential and `/wizard` output is never committed with values baked in. **The
  docs were asking for exactly what the code refuses.**

  The key now lives in `${XDG_CONFIG_HOME:-$HOME/.config}/cortex/cron.env` at mode `0600`, which the
  crontab lines *source*. Created with `umask 077` rather than a `chmod` afterwards, so it is never
  briefly world-readable, and never overwritten if it already exists. `cortex-cron.sh`'s own usage
  comment stopped teaching the pattern too. Recorded in
  [ADR 0009](docs/adr/0009-provisioning-prints-before-it-installs.md).

## [2.6.1] — 2026-08-18

### Added
- **The shell half has behaviour tests.** `bash tools/test/run.sh` — a dependency-free harness
  (ADR 0004: no bats, no shellspec) that discovers `tools/test/*.test.sh` and runs each in its own
  subshell and temp directory. 43 assertions over `cortex-cron.sh` and `server-setup.sh`, wired into
  the existing `cortex-init test` workflow.

  CI already `bash -n`'d and shellchecked every script and ran `cortex-init.sh` end to end. What it
  had none of was **behaviour** for `tools/server/`, and that is where every bug below lived. Tests
  build real git repositories in temp directories — a bare repo on disk is a complete remote, so push
  and pull are exercised honestly with no network.

### Fixed
- **A broken AI summary is no longer silent.** A bad key, a retired model id or an unreachable
  network all produced a normal-looking digest, exit 0, and no warning. The deterministic fallback is
  the design working as intended — the *silence* was the defect, and it is how a nonexistent
  `CORTEX_MODEL` sat unnoticed. `cortex-cron.sh` now reports the failure on stderr, names the model,
  echoes part of the response, and states plainly that the run itself is fine. **The exit code stays
  0**: a failed optional summary must never fail the cron run, which would trade a silent bug for a
  loud regression. It also warns when `jq` is missing, since the response is then unparseable even on
  a successful call.
- **`server-setup.sh` died on an unset `$USER`.** Not guaranteed to be exported — absent under cron
  (which strips the environment), in minimal containers, and in Git Bash on Windows. Under `set -u`
  that killed the script one line before printing the clone URL, which is the entire reason anyone
  runs it, and *after* it had already created the repo. Falls back through `USERNAME` and `id -un`.
- **`server-setup.sh client` reported success while producing an unusable clone.** Its commit and
  push are both `|| true`, so on a machine with no git identity — a fresh server or container,
  exactly where it runs — the commit failed, no branch existed, the push failed, and it printed
  `ready` anyway. The MCP's pull/push would then fail later for a reason nobody could trace back. It
  now verifies the upstream exists, names `git config user.email` as the fix, and exits non-zero.
- **The test runner could not fail correctly.** Two bugs found while writing the first real test: a
  test file that died mid-way reported `0 passed, 0 failed` and exited 0 — a crashed suite looking
  exactly like a passing one — and `assert_exit` ended with a bare `set -e`, switching on a mode the
  runner had deliberately switched off, so the first non-zero command after any assertion killed the
  file. Both fixed before any test was trusted.

### Changed
- `cortex-cron.sh` accepts `CORTEX_API_URL`, so the API failure path is testable at all. A hardcoded
  endpoint cannot be exercised without the network; the test points at a closed local port.

## [2.6.0] — 2026-08-18

### Added
- **The three-audience resolver — the last open item of the big task.** Cortex claimed to serve solo
  developers, teams and self-hosted setups, and only solo was ever exercised. `/team-init`,
  `/team-add`, a connector file and `tools/server/` all existed; nothing tied them to the running
  brain.

  `mcp/lib/resolve.js` now answers where the brain is and who it serves —
  `resolveBrain({ cwd, env }) → { audience, root, team, teamClone, source }`. `server.js` resolves
  once at startup.

  **Solo and team are detected**, from a `.cortex/connector.json` found by walking **up** from the
  working directory — an agent runs in a subdirectory far more often than at a repo's top, and
  without the walk-up team mode silently degrades to solo. **Server is declared** with
  `CORTEX_AUDIENCE=server`, because it leaves no filesystem trace to detect: it is solo minus
  interactive prompts, plus a scheduler, plus a model that is not Claude Code. Declaring beats
  detecting, so a scheduled run inside a connected repo is still a server run.

  A malformed `connector.json` resolves to solo with `source: "unreadable:<path>"` rather than
  throwing. A brain that refuses to start because one JSON file is corrupt has turned a papercut
  into an outage.

  **The resolver never invents a root.** The three-mode spec described a fallback chain — connector,
  then `AI_OS_ROOT`, then a repo-local `.cortex/memory/` — and `mcp/AGENTS.md` forbids exactly that:
  an unset `AI_OS_ROOT` is a hard exit, because a guessed root can file a private note into a work
  repository. The invariant won; the fallback is recorded as a rejected alternative in
  [ADR 0008](docs/adr/0008-three-audiences-one-seam.md) so it is not re-proposed as an improvement.

### Changed
- **`capture` and `catch_me_up` stopped asking the caller which world it is in.** `team` was a tool
  *argument*, so the calling agent had to know it was on a team before it could act like one — the
  seam leaking in the one place the design says it must not. The team now comes from the resolution;
  a repo with a connector writes to the team brain without anyone asking. The argument survives as an
  explicit **override**, and its description says so.
- **`audience` is a third axis, not a rename of `mode`.** `mcp/lib/mode.js` owns repo-vs-vault;
  `resolve.js` owns solo/team/server. They are orthogonal — a repo-mode brain can run on a server, a
  vault-mode brain can belong to a team — and welding them into one word would guarantee a future bug
  where changing one silently changes the other. It also keeps `CORTEX_AUDIENCE` clear of the
  `CORTEX_MODEL` that `cortex-cron.sh` already reads.
- The startup line now reports `audience`, `source`, `mode` and `root` on **stderr** — never stdout,
  which is the MCP protocol channel where one stray line corrupts the stream for every client. A test
  parses every stdout line as JSON to keep it that way.

### Fixed
- **`tools/server/cortex-cron.sh` had a dead model id.** `CORTEX_MODEL` defaulted to
  `claude-sonnet-4-6`, which no longer exists. The API call is `curl … || true`, so this never
  aborted a run — it failed **silently**, producing a digest with no AI summary and exit 0. The
  scheduler appeared to work while half of it was dead. Now `claude-sonnet-5`; the silence itself is
  fixed in 2.6.1.
- **The two halves of server mode shared no vocabulary.** `cortex-cron.sh` keyed on `BRAIN_DIR` while
  the rest of Cortex uses `AI_OS_ROOT`. `AI_OS_ROOT` is now accepted as a fallback; `BRAIN_DIR` still
  wins when both are set, so existing crontabs keep working. Neither bug was caught by a test,
  because nothing tests the shell half — which is worth knowing.

## [2.5.0] — 2026-08-18

### Changed
- **The root guard became a door instead of a habit.** `core/paths.js` held a correct guard —
  `resolveInRoot` refuses a path that escapes the vault root — and it was optional. Five modules
  read and wrote vault content, each deciding for itself whether to call it. `projects.js` used it
  for `getProjectContext`, added after a caller-supplied slug of `../../secret` was found to read any
  file on disk, and then joined `projects` onto the root unguarded three lines earlier.
  `cortexignore.js` read `join(root, ".cortexignore")` with a bare `readFileSync`. `recall.js` seeded
  a recursive walk with `walk(root, "")` and joined onto a local variable on every entry — never
  writing `join(root, …)` at all. The traversal patch that shipped standalone was a lock on one door
  in a building with three.

  Now `mcp/lib/vault.js` owns every filesystem operation on a vault root — `abs` · `exists` ·
  `isFile` · `isDirectory` · `mtimeMs` · `entries` · `list` · `read` · `append` · `write` — each
  taking a root-relative path and resolving it through the guard. **Nothing else under `mcp/` may
  join onto a vault root**, and `vault.js` is now the only importer of `core/paths.js` there.

  Enforced by a test rather than by convention, and stated at two altitudes because one is not
  enough: a scan for `join(root, …)`, plus an assertion that the four converted modules import no
  `node:fs` at all. The second exists because `recall` bypassed the guard through a closure variable
  and the first is structurally blind to it. Teaching the regex to chase a variable through a closure
  would have made the check clever and unreadable.

  **No behaviour changes.** `recall` and `listProjects` still return absolute paths; `list` is
  root-relative internally because that is the safer currency, and the conversion back is now an
  explicit step rather than an accident of how a path was built. Characterization tests were written
  and passing *before* any code moved, which is what caught the conversion the one time it slipped.

  The Vault does **not** scrub — secret refusal is policy and stays in `core/scrub.js`; folding it in
  would make every write pay for it and hide a policy refusal behind a path operation. It lives in
  `mcp/lib/` rather than `core/` because `index/` has no use for vault semantics: it asks git what
  belongs to a repo (ADR 0003) and deliberately does not read `.cortexignore`. Recorded in
  [ADR 0007](docs/adr/0007-the-vault-is-the-only-door.md).
- **`lib/cortexignore.js` is pure.** It decides what the patterns mean and no longer reads a file;
  `makeIgnoreFilter` takes the `.cortexignore` text (or `null`) instead of a root, and
  `loadCortexignore` is gone. Its test file imports no `node:fs` — a test that needed a temp
  directory to check a regex was telling us something. The dependency runs one way only: `vault.js`
  imports `cortexignore.js`, never the reverse, or the two would import each other.

## [2.4.0] — 2026-08-18

### Added

- **`cortex-findings.mjs --offers`** — prints the ranked worklist as JSON and writes nothing at all,
  not even the report. The report stays prose for a human; this is the machine surface the wizard
  walks. Two surfaces over one analysis rather than one doing two jobs — a wizard forced to parse
  its questions back out of rendered markdown would drift from the findings the moment either was
  reworded.
- Findings that propose the three repo-scale offers nothing produced before: `enrich` (a large repo
  with no `enriched.json`, stating the token cost), `memory` (no committed `.cortex/memory/`,
  explaining the committed/gitignored asymmetry once), and `bundle` (a tier the index gives a reason
  for — a frontend proposes `browser-qa`). The enrichment threshold is a named constant
  (`ENRICH_WORTH_IT = 50`) because it is a judgement call meant to be argued with, not a number
  buried in a conditional. Frontend detection keys on file extension, not language: `langs.mjs` maps
  `.tsx` to `typescript`, so language alone cannot tell a frontend from a TypeScript backend.
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

### Changed

- **`/cortex-install` became the wizard it always described.** It presented four choices at once —
  context layer, briefs, bundle, nothing — in a fixed order with no relation to what the repo
  actually needed. `analyse()` already ranked every finding by severity and that ranking was thrown
  away before reaching the only place it mattered, so a repo whose worst problem was a possible
  secret and one whose worst problem was a missing `AGENTS.md` were asked the same four questions in
  the same order.

  Findings now carry an optional machine-readable **offer** — `scaffold` · `brief` · `enrich` ·
  `bundle` · `triage-secrets` · `memory` — and `offers()` returns them as a ranked, de-duplicated
  worklist the skill walks top-down. **The report is the wizard's script**; the repo's own state
  chooses the running order.

  Offers **collapse by action**, which is what keeps a thirty-finding report from becoming a
  thirty-question interview: five areas that each want a brief are one question naming five
  candidates. A merged entry inherits its highest member's severity, so collapsing can never bury a
  critical finding, and carries the titles that produced it so the wizard can say *why* it is
  asking. Severity does not imply an offer — *no test files found* is high and Cortex has no action
  that writes tests, so it stays a finding with no question attached.

  Consent is **propose-all-then-one-yes**: step 4 walks every offer with nothing on disk, step 5
  plays the worklist back as a list of paths and takes one confirmation, step 6 applies in worklist
  order. Rejected on both flanks — per-write prompts train users to click through the one prompt
  that matters, and a single up-front yes stretched to cover files it never named is not consent
  either. Enrichment states its token cost *before* its question and must be named in the playback;
  it is the only offer that spends real money. `triage-secrets` shows and stops — no rotation, no
  redaction, because some hits are fixtures and a false positive acted on destroys trust in every
  other finding. "Later" is a real answer and survives into the close.

  Verified against two real legacy repos (108 and 70 files): dozens of findings, five ranked
  questions each. Recorded in
  [ADR 0006](docs/adr/0006-the-report-is-the-wizards-script.md).
- **The install sequence can finally start itself.** Cortex's design promises that landing on a repo
  with code *fires* the sequence — index, report, user picks, apply. It never could:
  `/cortex-install` carried `disable-model-invocation: true`, so only a human typing its name could
  begin it. The flag had no stated reason — `AGENTS.md` justifies it for `/onboard`,
  `/migrate-engine`, `/team-init` and `/connect-brain` (once-only or destructive) and the test guards
  exactly those four. `/cortex-install` only reads. The flag was inherited, and it blocked the
  sequence the whole design is built around.

  Protection moves to where it belongs — a **consent gate on the first write**. With no `.cortex/`
  yet it asks before writing anything, including the index, because generated-and-gitignored is not
  the same as invisible: those are files appearing in a project on a run nobody asked for. Once
  `.cortex/` exists, re-indexing needs no ceremony. Reading was never gated and still isn't.

  Rejected: shipping a `SessionStart` hook (the plugin ships no hooks at all today, and it would run
  before the user expressed any intent) and splitting off a read-only "orient" skill (a second
  spelling of a shipped ritual, and useless for the motivating case — a repo with no index is
  exactly where an agent needs to act). Recorded in
  [ADR 0005](docs/adr/0005-the-install-sequence-may-start-itself.md).
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

### Fixed

- **`/cortex-scaffold` had no source to write from on a greenfield repo.** It opens by refreshing
  the index and warning that "a scaffold written from assumption is worse than none: it reads as
  authoritative and is wrong" — then tells the agent to fill every `{{placeholder}}` from the index
  and the code. On an empty repo there is no code, so following it means inventing a stack (the
  exact failure it warns about) or leaving `{{placeholders}}` behind, which read as instructions to
  the next agent and never get cleaned up.

  The honest source on greenfield is the user, so it now **interviews instead of reading** — via
  `/grilling`, asking the four questions the template needs in one round rather than one at a time.
  Layout and `CONTEXT.md` behave differently there (no aspirational directories; seed the glossary
  from the words the user actually used), and the result is labelled for what it is: a greenfield
  brief is a **hypothesis**, and the first `/cortex-install` over real code is what tests it.
- **The greenfield install flow existed in the design and nowhere in the code.** `/cortex-install`
  claimed in its own description to work on "greenfield and legacy repos", and the design spec
  specifies two distinct sequences — but only the legacy one was implemented. Running it on an
  empty repo produced **three ranked findings, one of them `high`**, about missing documentation
  for code that does not exist: AGENTS.md called "the single highest-leverage file" for a repo with
  zero files, and a glossary demanded because "domain terms are undefined" where there is no
  domain. It then closed by pointing at `/cortex-brief` for "the areas listed above" — naming areas
  the index had explicitly found none of.

  Absurd output on a first run is expensive: it teaches a new user the report is noise, and the
  report is the entire product before anything is written.

  Now `analyse` forks on `isGreenfield` and emits one honest `low` finding, `render` closes with
  the matching instruction (scaffold; briefs and enrichment wait for code), and `/cortex-install`
  carries the fork explicitly — on the index's file count, not on a guess about the repo. Also
  fixes the stray `- ` bullet an empty language map rendered.
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

[2.7.0]: https://github.com/marinvch/Cortex/releases/tag/v2.7.0
[2.6.1]: https://github.com/marinvch/Cortex/releases/tag/v2.6.1
[2.6.0]: https://github.com/marinvch/Cortex/releases/tag/v2.6.0
[2.5.0]: https://github.com/marinvch/Cortex/releases/tag/v2.5.0
[2.4.0]: https://github.com/marinvch/Cortex/releases/tag/v2.4.0
[2.3.0]: https://github.com/marinvch/Cortex/releases/tag/v2.3.0
[2.2.0]: https://github.com/marinvch/Cortex/releases/tag/v2.2.0
[2.1.0]: https://github.com/marinvch/Cortex/releases/tag/v2.1.0
[2.0.0]: https://github.com/marinvch/Cortex/releases/tag/v2.0.0
[1.1.0]: https://github.com/marinvch/ai-os/releases/tag/v1.1.0
[1.0.0]: https://github.com/marinvch/ai-os/releases/tag/v1.0.0
