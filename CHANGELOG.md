# Changelog

All notable changes to Cortex. Format based on [Keep a Changelog](https://keepachangelog.com);
this project now versions independently of any package manager (see `VERSION`).

## [2.29.0] — 2026-08-24

### Added — `/cortex-view`, because the documented command did not work for anyone who installed the plugin

The viewer shipped with one address: `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-view.mjs" .`. That
variable is set **inside a skill and nowhere else**, so a user who installed Cortex as a plugin and
typed the documented line into their own terminal got `node "/index/cortex-view.mjs" .` and a
missing file. Verified, not assumed: in a plain shell here, `CLAUDE_PLUGIN_ROOT` is unset.

Their only working alternative was a path into the plugin cache pinned to the installed version —
which breaks on the next update. So the feature Cortex advertises as *"see the repo instead of
reading about it"* was reachable only from a clone of Cortex itself.

`skills/cortex-view/SKILL.md` gives it an address a person can remember. The skill carries the
consent gate (`.cortex/` may not appear in someone's project on a run they did not ask for) and the
four hedges the picture needs more than the prose did — an orphan is a question, "no test found" is
a floor, markdown is not drawn, depth is a floor too.

`/cortex-next`, `/cortex-install`, the README and the `AGENTS.md` ritual table now all name
`/cortex-view` rather than the node line. The sequence step that told users to run something that
could not work was the last one it printed.

## [2.28.0] — 2026-08-24

### Fixed — "unreferenced" meant "unimported", and Cortex reported it about itself

Run against this repo, the orphan finding named `tools/cortex-version.mjs` and
`tools/cortex-capability.mjs` — the script that releases Cortex and the script that proves its
capability table. Both are invoked by ADRs, by `docs/changing-cortex.md`, by `AGENTS.md` and by a
shell test. Neither is `import`ed by anything, so both were listed as unreferenced.

That is how repo tooling is normally wired, and it is the failure mode the finding's own docstring
warns about: *"a reader either believes it and deletes live code, or learns the section is noise and
stops reading the ones that are true."*

A file whose path another file names literally is referenced. The signal is the most checkable one
available — the literal repo-relative path appearing in the text of some other indexed file, the
same standard `citationDrift` holds itself to, run in reverse. **The direction of error is chosen:**
this can only ever *remove* entries from the list. Missing a true orphan costs a suggestion nobody
was obliged to act on; inventing one costs trust in every other line of the report.

Validated against three real repos rather than fixtures: apex-engine 20 → 17, and **no change** on
`token-dashbord` or `expressjs/express`, whose remaining orphans are Jest `__mocks__` and standalone
`examples/` — genuinely unimported, correctly still listed. It suppresses where there is evidence
and nowhere else.

Orphan detection now lives in `index/lib/orphans.mjs`, shared by `findings.mjs` and the viewer. There
were two copies; they would have drifted the moment either learned something, which is precisely what
just happened.

### Fixed — the secret-scan exemption told you to re-read files it never named

The finding said *"worth re-reading occasionally: the marker is a claim by whoever added it, not a
guarantee"* — against a bare count. That is not an instruction anyone can follow, and the entire
reason an exemption is surfaced rather than applied silently is so a human can go and check it.

It now names each file and how many secret-shaped strings it carries. Both of this repo's were
checked while making the change and are honest: scanner test assertions (`hunter2`,
`correcthorsebattery`) and a fixture repo built from sixteen zeroes.

## [2.27.1] — 2026-08-23

### Fixed — the answer was buried under 2,478 image tiles ([#367](https://github.com/marinvch/Cortex/issues/367))

`/cortex-impact`'s "Not in the index" section is the one the skill is most emphatic about, because a
path the graph does not know contributes nothing to the walk and silently ignoring it reads as
"nothing depends on this". So it printed every unknown path, one per line.

On a repo with a DeepZoom tile set that came to **2,483 entries, 2,478 of them tile PNGs**. The
actual signal — two staged source deletions a reader genuinely had to resolve — was buried, and the
terminal never reached the affected / unverified / suggested-tests sections at all. **A section
nobody can read has the same effect as one that was dropped, while looking like diligence.**

Assets are now counted by directory and extension; source is still listed one per line. The total is
unchanged, and `--json` still carries every path. The asset list is a **closed set** of binary media
and archives rather than "anything that does not look like code" — an unfamiliar extension is still
shown individually, because surfacing the path nobody expected is the whole job of the section.

Grouping is by nested map rather than a joined string key: the first version used a space, which
would have split a directory named `my assets` into a bogus path on any repo that uses spaces.

### Fixed — `/optimize-context` classified by location, halving its headline number ([#372](https://github.com/marinvch/Cortex/issues/372))

Pass 1 decided "always-loaded" vs "on demand" by where a file sits — root versus nested. For
`.github/instructions/*.md` that is wrong: Copilot decides by `applyTo` frontmatter, so two files
with `applyTo: "**"` load on **every** file while sitting in a directory the skill treated as
on-demand. On the repo that reported this, the headline number the skill says to lead with was
understated by roughly half.

The error ran in the dangerous direction — a repo looks leaner than it is, so the findings that
would recover the most context rank lowest or get dropped. There was a second-order effect too: two
always-loaded files are co-loaded, and that is what makes repointing one at the other
content-preserving rather than lossy. Without reading the frontmatter, a safe repoint was
indistinguishable from an unsafe one.

Pass 1 now carries a signal table (`applyTo`, `alwaysApply`, `globs`, location as the fallback) and
requires stating which signal was used per file, so the classification can be checked rather than
trusted.

## [2.27.0] — 2026-08-23

### Added — vendored code is declared, and stops skewing everything that ranks by size ([#369](https://github.com/marinvch/Cortex/issues/369), [#368](https://github.com/marinvch/Cortex/issues/368))

`walk.mjs` asks git what exists and nothing else, and that stays right. The gap was afterwards: a
legitimately committed vendored tree — a plugin cache, a generated server, another tool's
instruction files — was indistinguishable from hand-written source. On a real repo with ~1,900 lines
of application TypeScript, the index reported 13,532 lines, the **top three** scoped-brief candidates
were all vendored with the actual application fourth, and `/cortex-enrich` planned 13 of 21 batches
over that material.

The mechanism is **declared, never guessed** — the same rule as `go.mod`, `composer.json` and
`tsconfig`. `.gitattributes` already has the vocabulary, and it is the one GitHub itself uses:

```
.agents/**  linguist-vendored
.ai-os/**   linguist-generated
```

A repo that has already marked its vendored trees gets this for free; one that has not says so in a
file its other tools already read, rather than learning a Cortex-only format. A repo that declares
nothing is completely unaffected — asserted by a test, because that is the property that makes this
safe to ship.

**Nothing is excluded from the index.** Git-truth stands: a file you cannot see is worse than one
you can rank correctly. What changes is that `briefCandidates` and `isEnrichable` skip vendored
material, and `stats.vendored` names what was skipped — a cost estimate that silently omits half a
repo reads exactly like one that covers it.

### Added — `/cortex-enrich plan` can finally scope itself ([#368](https://github.com/marinvch/Cortex/issues/368))

The skill has always told the agent to "offer to enrich only the areas that matter if the repo is
large". There was no flag to express that, so the only way to obey it was to eyeball `batches.json`
and skip `batchIndex` values by hand — leaving `status` reporting a large pending set with nothing
to say the skipping was deliberate. **A partial run and an interrupted one looked identical.**

```bash
cortex-enrich.mjs plan . --include src/
cortex-enrich.mjs plan . --exclude .github/,.vscode/
```

The scope is written into `batches.json` and replayed by `status`, so "still to do" and "never
planned" are finally different states. Prefix matching is on path segments, so `--include src` does
not sweep in `srcextra/`.

## [2.26.0] — 2026-08-23

### Fixed — the protection was attached to a skill, not to the act ([#366](https://github.com/marinvch/Cortex/issues/366), [#370](https://github.com/marinvch/Cortex/issues/370))

Two issues, one root cause. `/cortex-scaffold` was the only place that added `.cortex/` to
`.gitignore`, and `/cortex-install` was the only place that stated the consent gate — but neither is
the only place that **creates** `.cortex/`. `/cortex-brief` re-indexes when the index is stale,
`/cortex-enrich plan` writes batches, `/cortex-scaffold` and `/cortex-skills` re-index, and an
install a user stops halfway through has already written one. Each left a directory of generated
artifacts in `git status`, and one of them created it on a user who was never asked.

**The mechanical half moved into code.** `index/lib/generated.mjs` ignores the generated
directories at the moment `.cortex/` first exists, by whichever entry point got there first — no
skill has to remember. Append-only and never clobbering: a broader `.cortex/` the user wrote
themselves is honoured rather than duplicated, and `.cortex/memory/` is never ignored, because it is
committed on purpose.

**The gate stayed in the skills, and is now checked.** ADR 0005 says the missing invocation flag
"is only safe while the gate is present"; `core/test/plugin.test.js` now fails if a skill that can
create `.cortex/` does not say the user must be asked first. A machine can be relied on to remember
a `.gitignore` line. It cannot be relied on to ask, so that half is tested rather than assumed.

Every CLI now prints what it created and what it ignored — "generated and gitignored" must never
quietly mean "invisible".

`/cortex-brief` also gained the step it was missing: **if there is no root `AGENTS.md`, hand off to
`/cortex-scaffold`.** Every leaf opens by pointing up at a root, and step 3 wires a routing table
into it, but no step said what to do when there is none — so the agent improvised a spine, which is
exactly what `/cortex-install` step 6 forbids.

### Fixed — `--out` had quietly stopped meaning it

Caught while writing the above. `--out` exists so Cortex can be pointed at a project someone cares
about without modifying it, and the new gitignore write used the repo root rather than the output
path — so `--out` began editing the target's `.gitignore` while leaving no `.cortex/` behind.

The read-only test could not see it: it checked for a stray `.cortex/` directory and nothing else.
It now fingerprints the **whole tree** before and after, so a write to somewhere the author did not
think to name still fails. Verified by disabling the fix and watching both assertions fail.

## [2.25.1] — 2026-08-23

### Fixed — churn silently reported zero on any repo younger than the window ([#365](https://github.com/marinvch/Cortex/issues/365))

`hotspots()` counted commits over a hardcoded three-month window. A repo whose entire history
predates it scored `commits: 0` for **every** file, and nothing said so — not an error, not a
warning, just a signal that had quietly become a constant. Found on a real repo with 11 commits and
120 files.

The damage was downstream and invisible: `/cortex-brief`'s "ranked by size, churn and absence of
tests" degraded to ranking by size alone, `/cortex-impact` lost its tiebreak, and the viewer's hot
spots emptied. Every one of them printed its usual confident sentence.

When the window finds nothing and the repo does have history, all of it is counted and the index
records which window was used — `stats.churnWindow` is `"3 months ago"`, `"all history"`, or `null`
when there is no git at all. That last distinction is the one `UNRESOLVED_LANGUAGES` exists to keep
for imports: *I looked and found nothing* must not print the same sentence as *I could not look*.
The findings report now says "in this repo's whole history" when that is what it means, rather than
claiming three months.

### Fixed — skills invoked Cortex's scripts by a path that does not exist in a target repo ([#371](https://github.com/marinvch/Cortex/issues/371))

Rituals run **inside a target repo**, where `index/` does not exist — the plugin lives in the plugin
cache. `skills/cortex-impact/SKILL.md` told the agent to run `node index/cortex-impact.mjs`, which
fails with `MODULE_NOT_FOUND` unless the agent silently substitutes an absolute path; one that does
not reports the ritual as broken.

The issue named one skill. There were **21 occurrences across five** — `cortex-impact`,
`cortex-review`, `diagnosing-bugs`, and `cortex-install` and `cortex-next`, both of which acquired
theirs earlier the same week. All now use `${CLAUDE_PLUGIN_ROOT}`, and `core/test/plugin.test.js`
fails on any skill that invokes an `index/`, `core/`, `mcp/` or `tools/` script by a bare path — the
lint the issue asked for, so this cannot come back. The README's plugin-facing commands are fixed
too, with its clone-only block labelled as such.

## [2.25.0] — 2026-08-23

### Added — TypeScript path aliases resolve, so modern repos stop reading as empty

`index/lib/imports.mjs` resolved relative specifiers and treated everything else as an external
package. On a modern TypeScript repo that is most of the graph. Measured on a real Next.js app:

| | before | after |
|---|---|---|
| resolved imports | 116 | **589** |
| orphans reported | 154 | **20** |
| layer depth | 4 | **11** |

428 of that repo's imports were written `@/components/…` against 104 relative ones. The index held
about a fifth of its edges, and **every consumer was confidently wrong** — the orphan finding named
134 files that are imported constantly, `/cortex-impact` under-reported blast radius on all of them,
`depth.mjs` flattened the architecture to four levels, and the viewer drew a scatter of unconnected
dots. Each output was correctly hedged and each was useless.

`tsconfig.json` / `jsconfig.json` `paths` and `baseUrl` are **declared**, exactly like `go.mod`'s
module path and `composer.json`'s PSR-4 prefixes, so reading them is not a guess. `build.mjs`
follows the `extends` chain — splitting options into a base config is the normal layout, and a
resolver that stops at `extends` sees nothing — and matches the nearest config per file, so a
monorepo package's own aliases beat the root's.

Two properties keep it honest. The alias pass runs **only after** the relative resolver returns
null, so it is strictly additive: a repo declaring nothing cannot get a different graph because of
it. And a bare specifier no alias claims stays external — resolving `react` to a local file because
a `baseUrl` sat above one would be worse than missing the edge.

`parseJsonc` handles what these files actually contain: `//` and `/* */` comments, which every
TypeScript generator writes, and the trailing comma a real config carried after its last `paths`
entry. Strings are respected, so a `//` inside a URL survives. Unparseable input returns `null` —
a config that cannot be read costs its aliases, never the run.

**Validated against six cloned and local repos**, not fixtures: across all of them, **every one of
the newly resolved targets exists on disk** — zero false edges — and the two with no `tsconfig`
produced byte-identical indexes to before. Nothing in the existing test suite could have found this
gap, which is the argument for the rule.

## [2.24.2] — 2026-08-23

### Fixed — the viewer crashed on the first repo that had an import cycle

`index.cycles` is `depth.cyclic`: a **flat list of the paths** sitting in a strongly connected
component, not a list of cycles. `buildGaps` read it as an array of arrays, so `c.map` threw and
blanked **every tab** — Map, Files, Areas, the sequence, all of it. The page loaded its chrome and
nothing else.

It survived review, unit tests and CI because this repo has zero import cycles and the fixture
passed `cycles: []`. The branch had never executed. It took pointing the tool at somebody else's
codebase to run it once — which is the whole reason
[the standing rule](AGENTS.md) is to validate `index/` against real repos rather than fixtures:
a fixture is written by the same person as the code, and it inherits their blind spots.

The count was also mislabelled. Three files in one cycle were reported as "3 cycles", which
disagreed with what `cortex-index` prints for the same repo — it says "3 files in import cycles".
Both now say the same thing. `tools/test/cortex-view.test.sh` grew a real two-file cycle in its git
fixture, so the branch runs on every CI job from here.

### Fixed — a dozen nodes all called `index.jsx`

On a React app the map drew twelve nodes reading `index.jsx`, every one a different component and
none of them identifiable. A basename is only a name when it is unique. Barrel and route files
(`index`, `main`, `mod`, `__init__`, `route`, `page`, `layout`) now carry their directory —
`Modal/index.jsx`, `Header/index.jsx` — which is what a developer calls them anyway. Ordinary files
keep their plain name.

## [2.24.1] — 2026-08-23

### Fixed — the page disagreed with itself between runs

`cortex-view` read "see the repo as a graph" off the filesystem while writing the very page that
step refers to. The first run therefore rendered a stale answer about itself, and a second run
produced different bytes from the same index — which breaks the determinism the rest of `index/`
promises, and makes the page undiffable. It now states the fact it is in the middle of making.
`readState` grew a narrow `overrides` seam for exactly this case: a caller mid-write that knows
something the filesystem does not have yet. It is not for assuming a step someone else must run.

### Added — CLI tests for the two CLIs that print instructions

`index/AGENTS.md` already set the standard: a CLI earns a shell test when its failure mode is a
confident wrong sentence rather than a crash, which is why `cortex-impact.mjs` has one. Both CLIs
added in 2.24.0 meet that bar and shipped without one.

`tools/test/cortex-next.test.sh` (24 assertions) and `tools/test/cortex-view.test.sh` (17) run
against real git fixtures. They defend the sentences, not the numbers: that a bare repo is told the
entry point by name, that an optional step never becomes "next", that a retired `.ai-os/` engine
outranks every finished step, that `/optimize-context` is offered before `/cortex-scaffold` no
matter which file was written first — and, for the viewer, that it refuses rather than rendering an
empty page, writes nothing outside `.cortex/`, leaves tracked files byte-identical, and emits a page
with no remote script. The determinism regression above is the assertion that caught it.

`cortex-next` also asserts the thing worth asserting about a read-only tool: run on a bare repo, it
leaves no `.cortex/` behind. That is the product's central claim, made executable.

## [2.24.0] — 2026-08-23

### Added — the sequence, and a picture of the repo

Cortex had an ordering problem, not a capability one. Every ritual knew its own job and none of them
knew what came after, so the honest answer to *"I installed the plugin, now what"* was a table of
eleven commands sorted by nothing. A user who ran `/cortex-install` was handed a menu and left to
guess which row applied to them — and the one row that had to come **before** `/cortex-scaffold`
(`/optimize-context`, on a repo that already had an `AGENTS.md`) was indistinguishable from the ten
that did not.

**`/cortex-next` answers it, from the filesystem rather than from memory.**

```
node index/cortex-next.mjs .          # the ordered runbook, ✓ / → / ·
node index/cortex-next.mjs . --line   # one line, for a footer
node index/cortex-next.mjs . --json   # for a ritual to walk
```

Every ✓ names its evidence — `.cortex/index/index.json`, a report under `.cortex/findings/`,
`CONTEXT.md`, a `<dir>/AGENTS.md`, a `SKILL.md` under `.claude/skills/`. A step nothing on disk can
settle is `optional`: it never becomes "next" and never blocks, so nothing is ever ticked silently.
This is a script and not a judgment call for the same reason the index is deterministic — the
sequence is a fact about the repository, and a model re-deriving it each session hands the user a
different answer every time they ask.

`cortex-index`, `cortex-findings` and `cortex-view` now end with the same `Next →` line, so the
order is never something you have to go back to the README to look up.

### Added — `cortex-view`: the repo as one offline page

The vault has had a force-graph viewer since v1, but `tools/cortex.sh` walks vault folders and
follows `[[wikilinks]]`. Pointed at a codebase it found nothing and cheerfully wrote an empty graph.
This is the codebase half:

```
node index/cortex-view.mjs .     # writes .cortex/view/repo.html and opens it
```

One self-contained page — no server, no CDN, no runtime, data inlined, works offline. **Next steps**
(the sequence above, with this repo's position), **Map** (files coloured by area, laid out by import
depth so it reads top-down rather than as a hairball), **Files** (who imports it, what it imports,
both clickable), **Areas**, **Gaps** (orphans, cycles, busiest untested code).

Three things it deliberately does not do. It does not draw markdown or config: they have no imports,
and on this repo 171 isolated nodes pushed the 98 connected ones off screen. It does not call an
orphan dead — regex import resolution makes dynamic imports invisible, so every row is a question.
And it does not invent a coverage number: it reuses `lib/coverage.mjs`, so a file exercised only
through a subprocess reads as untested, which is the safe direction to be wrong in.

It follows the viewer's system theme and renders at device resolution.

## [2.23.0] — 2026-08-22

### Added — `--citations`: drift without a diff
`/cortex-review` has always had a Drift axis: *did this change make one of these documents wrong?*
It is change-triggered, and that turns out to make it **structurally blind to the second of the two
failures its own header cites**:

> `AGENTS.md` pointed at `mcp/lib/scrub.js` for months after scrub moved to `core/`

The stale pass seeds only on files a diff touched. Once `mcp/lib/scrub.js` stopped existing, no diff
could ever touch it, so the document naming it was never flagged. The tool could not see the example
it was built for — and neither could anything else, which is the state of every repo that installed
Cortex and then shipped for six months without running a review. Documents do not rot from one
change; they rot from a hundred, each of which individually looked fine.

A citation that no longer resolves is provable staleness, and it needs neither a diff nor a model.

```
node index/cortex-review.mjs --citations              # the whole layer, no diff
node index/cortex-review.mjs --citations --since HEAD~20  # the CI gate
node index/cortex-review.mjs --citations --fix        # a patch for the provable ones
```

**Three classes, because "wrong" is a claim the tool mostly cannot make:**

| Class | Means | Gate |
|---|---|---|
| `provable` | The path is gone and **git recorded where it went** | fails |
| `suspected` | The path is gone and nothing proves a destination | reports |
| `historical` | An ADR, or prose stating an absence ("…is deleted") — correct as written | reports |

Only `provable` exits non-zero, which is what makes it safe in CI. An ADR *should* name retired
files; a check that fails a build over accurate prose gets switched off, and then nothing is checked
at all.

`--fix` emits a unified diff on stdout and **writes nothing** — `index/` may not modify a target repo
outside `.cortex/`, and `cortex-review.mjs` promises in its header that it writes nothing at all.
That is what "self-heal" reduces to once you refuse to guess: a small, provable subset, proposed in
a form a human can reject in one command.

### Fixed — what running it on a real repo taught, twice
Both numbers below come from pointing the checker at this repository, not at fixtures.

**Resolution is doc-relative first.** `mcp/AGENTS.md` saying `` `lib/resolve.js` `` means
`mcp/lib/resolve.js`. Resolving only against the root reported 27 findings where 7 were plausible.

**A slash is not enough to make a token a path.** The first working implementation returned **157**
findings on this repo and almost none were drift: forty ritual names (`/cortex-audit`), JSON-RPC
methods (`tools/call`), repo slugs (`marinvch/Cortex`), bare directory names. Two rules — a
repo-relative path never starts with `/`, and its last segment carries an extension — brought it to
7, the same seven the design predicted. `../` in a markdown link is now resolved too; it was
reporting `mcp/AGENTS.md`'s own ADR links as dangling.

Not one of these showed up in tests written from literals. Real prose was the only thing that
surfaced them, which is now written into `index/AGENTS.md` as a rule for the next change here.

### Not covered, on purpose
It checks **pointers, not sentences**. `index/AGENTS.md` saying "Coverage uses two signals" while the
code used three is real drift and invisible here — the path was never wrong. Catching that needs a
model reading prose against code, which the ritual may do over this candidate list. The CLI must not:
a deterministic tool that claims to find *all* drift is worse than one that states where it stops.

## [2.22.2] — 2026-08-22

### Added — the index says what a guessed skip cost it
[2.22.1](#2221--2026-08-22) stopped `bin/` from overruling git, which fixes the common case. But a
guess remains a guess: an untracked file under `bin/`, or any repo with no git to ask, is still
dropped on the strength of a directory name. That was the expensive half of
[#360](https://github.com/marinvch/Cortex/issues/360) — not that the number was wrong, but that it
*looked complete*. Every other number the indexer prints describes what it found; there was none
for what it did not.

`listFiles` now returns `{ files, skipped }`, the index carries `stats.skipped`, and `cortex-index`
prints one line when there is anything to print:

```
Indexed 1 files (2 lines), 0 imports, 0 tests
Skipped by name: 1 file under bin/ — git-tracked files there are indexed as source
```

The line disappears once git can answer, so a repo where `bin/` genuinely is build output pays a
single line and a repo where it is not is told what to do about it.

Two limits on the count, both deliberate, because a number nobody can act on buries the one they
can:

- **Only ambiguous names.** `node_modules/` is not a guess, so it is not a gap — and walking it to
  produce a count would cost more than the index does.
- **Only measured files.** A path is counted only if it was read as text under the size limit, so
  the number means *readable source you cannot see* rather than compiled output. Otherwise it would
  be loudest in exactly the repos where the skip was right.

`walkFiles` now descends into an ambiguous directory and drops per file rather than pruning at the
directory, so the git and non-git paths produce the same count. Certain names are still pruned where
they were.

`index/test/walk.test.mjs` gains the four halves of this: that a guess is counted, that a certainty
is not, that the non-git case is covered, and that a compiled artefact never counts as hidden
source. `build.test.mjs` and `cli.test.mjs` cover `stats.skipped` and the printed line.

## [2.22.1] — 2026-08-22

### Fixed — `bin/` hid a repo's source, and shell tests did not count as tests
Two reports from a homelab install ([#360](https://github.com/marinvch/Cortex/issues/360),
[#361](https://github.com/marinvch/Cortex/issues/361)), both in `index/`, both silent.

**`bin/` and `obj/` were skipped by name, overruling git.** `CODE_SKIP_DIRS` treated them as build
output unconditionally, so every file inside vanished from the index even when git tracked it — and
the run printed a file count with no hint that anything was missing. The reporter's ops repo lost 12
of its 38 files; `cortex-findings`, `cortex-review` and `cortex-impact` all then reasoned about a
repo with a third of its code absent.

The two names now live in `AMBIGUOUS_SKIP_DIRS`, resolved by asking git rather than by guessing from
the name: a **tracked** file under `bin/` is source, an untracked one is still output. That is the
same principle the file already opened with — "which files belong to a repository is a question git
already answers" — applied to the one place it had been excepted. Outside a git repo the name is
still all the evidence there is, so nothing changes there. The set stays at those two on purpose:
`node_modules/` is committed in plenty of repos and must never be indexed.

Against two real repos, the files this was hiding are the ones that matter most:

| repo | recovered |
|---|---|
| `tj/n` | `bin/n` — the entire program — plus `bin/dev/release` and `test/bin/run-all-tests` |
| `bats-core` | `bin/bats` — the tool's entry point |

`test/bin/run-all-tests` shows the second half of the bug: the skip matched `bin` at *any* depth, so
it also swallowed directories that merely had one inside them.

**`test-*.sh` was not recognised as a test, which produced a false High finding.** `TEST_PATTERNS`
knew `test_*.py` (pytest's underscore) but not the hyphenated form that shell and ops repos have
used for decades — `test-foo.sh` beside `foo.sh`. A repo with a passing 17-assertion suite was told
"No test files found", ranked **High**, as the first thing in its report. A false High is worse than
a wrong count: it teaches the reader to discount everything under it. `*.bats` was unmatched too.

The hyphenated prefix is now recognised for `sh`, `bash`, `zsh` and `py`, and `.bats` outright.
Deliberately not for `ts`/`js`: `src/test-utils.ts` is a helper, not a test.

### Added
- `index/test/walk.test.mjs` — the walker had no test file of its own. Covers the tracked-file
  override, the untracked file that must still be skipped, `node_modules/` staying out even when
  committed, and the non-git fallback.

## [2.22.0] — 2026-08-19

### Added — `/diagnosing-bugs`, ported and given the repo's map
The last unharvested skill from [mattpocock/skills](https://github.com/mattpocock/skills) that fit
Cortex. Phases 1–6 are upstream and sound: **build a red-capable feedback loop before forming any
theory**, reproduce, minimise, generate 3–5 falsifiable hypotheses before testing one, instrument
one variable at a time, fix with a regression test, clean up.

Three additions, and each is only possible because the repo has an index and a context layer:

- **Phase 0 — orient before guessing.** `cortex-impact` gives the blast radius and, more usefully,
  *which of it no test covers* — a bug lives disproportionately in code nothing exercises, and the
  uncovered dependent is where the Phase 5 regression test belongs. `cortex-review` gives the
  documents that govern the suspect, which frequently *state* the bug outright: "the raw body is
  required for signature verification". `index.layers` places it — a depth-0 failure implicates
  everything above it; an entry point usually does not implicate the kernel.
- **A violated invariant outranks a hunch.** Phase 3 ranks anything Phase 0 surfaced near the top,
  because it is the only class of hypothesis that arrives with written evidence behind it.
- **The regression test must fail for the right reason.** Upstream says *watch it fail*; that is not
  enough. A test failing for an unrelated reason goes green on the fix and proves nothing. This repo
  shipped four such assertions in a single week and found every one by making the code wrong on
  purpose. Phase 6 also asks that a bug caused by a stale document gets the document fixed — that
  one recurs otherwise.

`capability: judgment`. Phase 0 is skipped when the repo has no `.cortex/` index; the rest works
anywhere.

`/diagnosing-bugs` and `/cortex-review` both read the context layer and are **not**
interchangeable: review judges a *change* you already made, diagnosis hunts a *symptom* you cannot
explain. Phase 0 is where the second borrows the first's evidence.

## [2.21.0] — 2026-08-19

### Fixed — `index.layers` was a list of directories
It grouped files by top-level folder, so `.github`, `agents` and `docs` were reported as
architectural strata. The CLI printed *"Areas: 23"* and the findings report said *"23 structural
areas"* — only the field name still claimed to be layering, and anything reading `index.layers`
for structure got folders.

It is `index.areas` now, from `inferAreas`. Same data, honest name.

### Added — real layering, from the import graph
`index.layers` now means what it says: depth 0 imports nothing inside the repo, depth *n* is one
more than the deepest in-repo file it imports. Every file carries `depth`, and `index.cycles` lists
files with no order among themselves.

This needed trustworthy edges across every language, which arrived in 2.18.0 — it was not
computable before.

It reproduces this repo's documented architecture without being told it: `core` avg depth 0.50,
`index` 0.90, `mcp` 1.45 — the `core/ ← index/ + mcp/` that `AGENTS.md` claims and
`core/test/architecture.test.js` enforces by hand.

**Cycles are condensed, not skipped.** The first version memoised a depth-first walk and skipped
back-edges: correct on a DAG, quietly wrong everywhere else, because a node finalised while a
dependency was still on the stack keeps a depth computed without it and every dependent compounds
the error. On gson that produced **fourteen levels with ninety-nine files sharing the deepest** — a
number that looks like architecture and is arithmetic noise. Tarjan for strongly-connected
components, then longest path over the condensation, gives gson seven levels and 31 files in
cycles.

An earlier draft also marked everything *downstream* of a cycle as cyclic, which on a Java repo —
where mutually-referencing classes are ordinary — swallowed 163 of 313 files. Only the members of a
cycle are in it.

Documentation is excluded: a markdown file imports nothing and sat at depth 0 beside the kernel,
which put 238 documents into "the foundation" and buried the handful actually there.

Both numbers are printed by `cortex-index`, because a reader shown only one will assume it is the
other — which is exactly what the old field name did.

### Tests
11 added and mutation-tested. One mutation was **missed and should have been**: removing the
self-edge filter changes nothing, because the condensation already drops edges inside a component.
The guard is defensive rather than load-bearing, and the test now says so instead of implying it
protects something.

## [2.20.0] — 2026-08-19

### Added — `/cortex-review`: the context layer gets read back
Cortex writes `AGENTS.md`, `CONTEXT.md` and ADRs. Nothing ever **read them back**. The context
layer could be generated, and audited for bloat by `/optimize-context`, and never once consulted
to judge a change — which made it write-only, and left the whole product one-directional.

Two axes:

- **Standards** — does the change break a rule this repo has *written down*? Quoted, with
  `file:line`. A finding that cannot cite the document it rests on is an opinion, and is labelled
  as one.
- **Drift** — did the change just make one of those documents **wrong**? This is the half no other
  review tool looks for, and this repo has shipped the failure twice: `index/AGENTS.md` said
  *"Coverage uses two signals"* for weeks after it used three, and the root pointed at
  `mcp/lib/scrub.js` months after scrub moved to `core/`. Neither broke a test. Both misled the
  next agent that read them — the entire cost of a context layer being wrong rather than absent.

`node index/cortex-review.mjs --staged | --since REF | <paths> [--json]` is the deterministic
evidence pass: governing briefs nearest-scope-first, glossary terms, and every document that names
something the change touched. It finds and cites; it never judges. The ritual does the judging, at
the `judgment` capability floor.

Three rules earn their keep, each found by running it rather than reasoning about it:

- **The nearest brief first, and the root always too.** A review reading only the leaf misses the
  repo-wide invariants. Sorting on the display label (`"(repo root)"`, eleven characters) put the
  root ahead of every leaf — the exact opposite of the stated order.
- **A shim is not a third authority.** `CLAUDE.md` and `GEMINI.md` hold one line, `@AGENTS.md`.
- **A basename is evidence only when it identifies one file.** `coverage.mjs` occurs once, so a
  document naming it means that file. `AGENTS.md` occurs in every package — matching it flagged
  twenty documents the moment the root brief was edited. Length cannot see that; the index can.

A repo with no context layer is told so, and pointed at `/cortex-install`. Improvising a review
from general principles is how a tool that claims to check *documented* rules starts inventing
them.

### Tests
14 unit and 16 CLI. The module was **mutation-tested** — all six rules deleted in turn, each
caught. One CLI assertion was **vacuous on first writing**: it matched the phrase "two signals",
which also appears in the tool's own cautionary footer, so it passed with the quoted line removed
from the output entirely. It now asserts the rendered `:3  <text>` form.

## [2.19.0] — 2026-08-19

### Fixed — the secrets finding cried wolf on well-maintained repositories
Run against six respected open-source projects, **four came back with a `critical` secrets
finding, and not one was a leak**:

| repo | matched | what it actually was |
|---|---|---|
| gson | `token="$next-version$"` | a Maven antrun placeholder |
| sinatra | `secret: 'CHANGEME…'` | a commented-out example in Rack's own docs |
| requests | `http://{}:{}@{}:9000` | a Python format template |
| gin, requests | `tests/certs/*.key` | test certificates |

Severity is control flow ([ADR 0006](docs/adr/0006-the-report-is-the-wizards-script.md)) — the
wizard walks `offers()` top-down — so **the first question Cortex asked a new user was a false
alarm**. A tool that cries wolf on four of six respected repos teaches people to skip the section,
and then it fails on the one that matters.

Two rules, in `core/scrub.js` and `index/lib/findings.mjs`:

- **A placeholder standing in for a credential is not a credential.** `${VAR}`, `{{var}}`, `{}`,
  `$name$`, `<your-key>`, `process.env.X`, `CHANGEME`. This is not a loosening of the gate: there
  is no secret in a reference to protect.
- **A match only under a test or fixture path reports `medium`, not `critical`**, with wording that
  says where it came from. A test certificate is a real private key and belongs in the report; it
  is not the thing to deal with first. One match outside a test path and the finding is critical
  again, so this cannot be used to hide a leak by filing it under `tests/`.

All six repos now open the interview with `scaffold`, the question actually worth asking first.

### Fixed — the scanner flagged its own documentation
Writing those examples as literals set the scanner off against `core/scrub.js` itself. They are
prose now: a file that must never hold credentials should not need an exemption marker to describe
them, and reaching for the marker by reflex is how a real finding gets buried later.

### Tests
Four added, **mutation-tested in both directions** — the placeholder rule disabled *and* inverted,
the severity rule removed *and* over-applied. Each mutation fails a different test, so neither rule
can silently stop working or start swallowing real leaks.

## [2.18.0] — 2026-08-19

Ruby, PHP and Java had *no import extraction at all* — not a resolution gap, an absent case in the
switch. And `UNRESOLVED_LANGUAGES` had never named them, so all three reported blindness as
absence. Measured against `sinatra/sinatra`, `slimphp/Slim` and `google/gson`:

| repo | language | edges | unreferenced |
|---|---|---|---|
| gson | Java | 0 → **1018** | 122 → 15 |
| Slim | PHP | 0 → **305** | 72 → 7 |
| sinatra | Ruby | 0 → **109** | 56 → **0** |

`/cortex-impact` on `Gson.java` — the library's central class — reported *"Nothing in the index
imports these"*. It now reports **124 affected files**.

### Added — Java, PHP and Ruby imports resolve

- **Java.** A package is a directory, so `import com.google.gson.internal.Excluder` is
  `com/google/gson/internal/Excluder.java` beneath a `src/main/java`-style root. Roots are matched
  longest-first, because a multi-module build has one per module and the same package path can
  exist under two. `import static a.b.C.member` names a member, so the path shortens until it lands
  on a file.
- **PHP.** PSR-4 maps a namespace prefix to a directory and `composer.json` declares it — read, not
  guessed, for the same reason Go reads `go.mod`. Longest prefix wins, so a specific namespace beats
  the umbrella one. `autoload-dev` counts too.
- **Ruby.** `require_relative 'x'` is path-relative; `require 'sinatra/base'` searches the load path,
  which for a gem is its `lib/`. Extraction tags the relative form so the resolver never has to
  guess which one a line meant. A repo shipping several gems has several load paths — sinatra
  carries three.

Every candidate must exist in the index, so a wrong reading yields no edge rather than an invented
one. Third-party namespaces (`java.util`, `Psr\Http`, the `rack` gem) resolve to nothing, correctly.

**A stated limit:** Java classes in the *same package* need no import, so a class used only within
its own package still shows as unreferenced. Resolving that means resolving unqualified type names,
which needs a parser — ruled out by [ADR 0004](docs/adr/0004-no-runtime-dependencies.md). Most of
gson's fifteen remaining orphans are that, plus `package-info.java` files and build-time templates.

### Fixed — a language with a framework row but no language row
`rails`, `laravel`, `django` and `flask` were signals; Ruby, PHP, Java and Python were not. A
Sinatra app is not Rails and a Maven project is neither, so all four reported **no language at
all** — and the skills chosen from an empty stack are the generic ones.

Java is asserted from either build tool, since a Gradle project has no `pom.xml` and is no less
Java for it.

### Fixed — the reported manifest list had drifted from the manifest specs
It is a second regex rather than something derived from `SIGNALS`, and it never learned about Maven
or Gradle: gson detected Java *from* `pom.xml` while reporting zero manifests. It now lists all
eight of gson's modules.

### Tests
Ten added, and the resolvers were **mutation-tested** — each rule deleted in turn to confirm
something failed. No regression across the other four repositories: gin holds at 248 edges, ripgrep
at 119, requests at 98, Cortex itself at 93.

## [2.17.0] — 2026-08-19

### Added — Rust imports resolve
2.16.0 taught the reports to say *"Cortex cannot resolve rust imports"* rather than *"nothing
depends on this"*. Saying it honestly was the floor, not the goal.

`resolveRustImport` handles `mod x;` and `use crate::a::b`, measured against `BurntSushi/ripgrep`:
**0 edges → 119**, and **92% of extracted specifiers resolve**. The remainder are inline
`#[cfg(test)] mod tests { … }` blocks, which have no file to point at — an honest ceiling rather
than a gap.

Three rules carry it, each found by pointing it at a real workspace rather than reasoned out:

- **A crate root owns its own directory.** `mod color;` in `src/lib.rs` means `src/color.rs`; the
  same line in `src/printer.rs` means `src/printer/color.rs`. The same holds for a nested `mod.rs`,
  which is where getting it wrong does damage — the crate-root fallback silently returns the wrong
  file rather than nothing.
- **`crate::` means the crate the FILE is in, not the workspace.** Roots are derived from where
  `lib.rs`/`main.rs` actually sit, not from `Cargo.toml` + `/src`: ripgrep keeps its binary crate in
  `crates/core/main.rs` with no `src/` at all, and the manifest-derived guess missed a third of the
  workspace. Longest match wins.
- **A file directly in `tests/`, `benches/`, `examples/` or `src/bin/` is its own crate root**, since
  cargo compiles each as a separate binary. Without this every integration test's helper module
  resolved to nothing.

A use path is tried longest-first and shortened, because `use crate::json::Printer` names a type
inside `json.rs` — only the filesystem knows where the module stops and the item begins. Every
candidate must exist in the index, so a wrong reading yields no edge rather than an invented one.

`UNRESOLVED_LANGUAGES` is now empty and stays in place. The distinction is the point: a language
listed there that does resolve suppresses a real graph, and one missing that does not resolve
reports blindness as absence. Both fail silently, so a test pins both directions.

### Fixed — `pub mod x;` was never extracted
The pattern matched bare `mod x;` only, so it missed precisely the public surface of every library
crate. Three of ripgrep's `ignore` modules were reported unreferenced while `lib.rs` declared them
one line away from ones that resolved fine. `pub(crate) mod` too.

ripgrep's unreferenced list: **59 → 8**. What remains is `build.rs`, benches, examples, fuzz targets
and a facade crate — all genuinely imported by nothing.

### Tests
Seven added, and the suite was **mutation-tested** rather than assumed. One rule — the crate-root
module directory — could be deleted with nothing failing, because the fallback rescued the only case
under test. The fix was a fixture where both candidate files exist, so the fallback returns the
*wrong* one instead of nothing. No regression elsewhere: gin holds at 248 edges, requests at 98,
Cortex itself at 93.

## [2.16.0] — 2026-08-19

The Go, Rust and Python signal rows had only ever been exercised by fixtures written by whoever
wrote the test. Pointed at three real repositories — `gin-gonic/gin`, `BurntSushi/ripgrep` and
`psf/requests` — two of them produced an empty import graph, and everything downstream reported
that emptiness as fact.

**gin: 130 files, 0 edges.** `/cortex-impact` on a file the whole framework depends on printed
*"Nothing in the index imports these"*. The orphan finding called **59 of 130 files** unreferenced.
Both outputs carried their honest hedge and both were useless.

### Added — Go imports resolve
A Go import names a *package*, and a package is a directory, so one specifier resolves to many
files — the only language here that does. `resolveGoImport` reads the module path from `go.mod`,
strips it to get a directory, and maps that to the non-test `.go` files in it. Manifest-driven and
deterministic, like the rest of the index.

Imports outside the module stay external. `net/http` is a real dependency but not a file in this
repo, and an invented edge is indistinguishable from a true one for every consumer of the graph.
The module boundary is checked on a path separator, not a string prefix: `github.com/x/y-extra` is
not `github.com/x/y`.

**gin now indexes 248 edges.** `/cortex-impact` reports 16 affected files with correct depths, and
the orphan finding reports none.

### Fixed — Cortex said "nothing depends on this" when it meant "I did not look"
Rust still resolves through a module system Cortex does not model. That was already documented in
`imports.mjs`; what was not handled is what the reports do with it. Every Rust file was an orphan
by construction, and `/cortex-impact` reported no dependents for all of them.

`UNRESOLVED_LANGUAGES` now names those languages so consumers can tell blindness from absence:

- the orphan finding **excludes** them, and a separate finding says the graph does not cover them —
  a quietly missing finding is indistinguishable from a clean bill of health
- `/cortex-impact` prints *"Cortex cannot resolve rust imports, so it has no graph for these files.
  This is not 'nothing depends on them' — it is 'Cortex did not look'."*

On ripgrep the unreferenced list went from **59 files to one** — a Homebrew formula that genuinely
is not imported.

Also fixed: that finding read *"1 file appear unreferenced"*, visible only once the count dropped
to one.

### Tests
Four added. One was **vacuous on first writing** — the module-boundary assertion passed even with
the boundary check removed, because a loose prefix match sliced out a directory name that happened
not to exist. It now uses a directory the loose match would find, and fails when the check is
removed. Every new assertion was verified by planting a regression.

## [2.15.0] — 2026-08-19

Found by pointing Cortex at two repositories on stacks it had never been tuned on — a mobile app,
and a monorepo whose manifests live in subdirectories. Both passes were read-only: the index went
to a temp file via `--out`, and neither target was left with a `.cortex/`.

The monorepo passed cleanly, which is the more reassuring half. Cortex read all four nested
`package.json` files, and reported Express, React, Mongoose, TypeScript and GitHub Actions with a
correct evidence sentence for each. Nothing about that stack had been anticipated.

### Added — React Native and Expo are detected
The mobile app reported as `react`, full stop. Every skill proposed from that stack described a
website, and nothing in the report hinted the answer was wrong — the failure `stack.mjs` warns
about in its own header comment, reached from the outside for the first time.

They are two rows, not one. A bare React Native app is not an Expo app — different build, different
router, different commands — and collapsing them would put an `npx expo` instruction in front of
someone with no `expo` CLI. A test pins that a bare RN app is *not* called an Expo app.

### Fixed — a repo with a test runner and no tests fell between two candidates
`write-first-test` required that *no* runner be declared; `add-test` fired whenever one was,
regardless of whether a single test existed. A repo with jest in `devDependencies` and zero test
files landed in the gap and was told **"jest already set up — new work should extend it, not invent
a second way"**, when there was no convention to extend. That is `create-expo-app`, CRA, and most
starters — not an edge case.

Zero tests is now the whole trigger for `write-first-test`, and `add-test` requires a runner *and*
an existing test to read the convention off.

The offer had to become honest rather than merely present. Its old title — *Set up a test runner and
write the first real test* — is visibly wrong to someone whose manifest already names one, and a
report wrong on the part a reader can check is not trusted on the parts they cannot. That is exactly
why the previous test forbade the offer here. It is now titled *Get a real test running for the first
time*, true either way, with the evidence sentence naming which case the repo is in: "jest is in a
manifest but no test file exists — the runner is installed, not used".

### Tests
Two added, both verified non-vacuous by planting regressions. The revised test pins the *wording* of
the offer rather than its absence, and carries the old assertion's reasoning so the next person to
widen a candidate knows what the constraint was protecting.

## [2.14.0] — 2026-08-19

### Added — `/cortex-impact`: what breaks if this changes
The index has carried import edges since the first version, and everything read them forwards:
*what does this file import*. Nobody asks that. The question before touching a file is the reverse
one — **who depends on me, and is any of it tested?** Nothing could answer it.

`node index/cortex-impact.mjs <paths|--staged|--since REF>` walks the graph backwards and prints the
blast radius nearest-first: hop count, whether a test exercises each file, and churn as the tiebreak
within a depth. Three sections carry the answer — paths the index does not know (reported, never
dropped: a typo contributing nothing reads as *nothing depends on this*), files no test exercises,
and the tests worth running. `--json` for a ritual to walk, `--depth N` to bound an enormous radius.

Deterministic per `index/AGENTS.md` — no LLM, no network, no clock — so it sits in the `mechanical`
capability tier and runs on any model, or none.

**Every number is a floor.** Import resolution is regex-based ([ADR 0004](docs/adr/0004-no-runtime-dependencies.md)
rules out a parser, since a plugin install clones the repo and runs no build), so dynamic and
computed imports are invisible. The field is `atLeast`, there is no `total`, and no flag turns it
into one: "3 files affected" when the truth is 5 invites a reader to stop looking; "at least 3"
does not. An empty radius prints *a floor, not a proof* — an entry point or a dynamically loaded
module looks exactly like dead code here.

### Changed — coverage detection has one home
`index/lib/coverage.mjs`, extracted from `findings.mjs` where the three-signal heuristic (name ·
import · string-mention) was computed inline. Impact needs the same answer, and a second copy would
agree today and disagree in a month with nothing to say which was right. Behaviour is unchanged —
all 41 findings tests pass against the extracted module.

### Tests
`index/test/impact.test.mjs` (15) covers the reverse walk, cycles, depth ordering, the churn
tiebreak, unknown-path reporting and output stability. `tools/test/cortex-impact.test.sh` (20)
covers the CLI against a real git fixture, and most of its assertions defend a *sentence* rather
than a number — the failure mode here is a confident total, not a crash. Both were verified
non-vacuous by planting regressions.

## [2.13.0] — 2026-08-19

### Added — every ritual declares what it needs from the setup running it
Cortex names self-hosted and own-LLM setups as an audience ([ADR 0008](docs/adr/0008-three-audiences-one-seam.md))
and gave them nothing to consult. A ritual that needs multi-round judgment looked exactly like one
that appends a line to a file.

The failure this closes is not a crash. A weak model runs `/cortex-enrich`, writes plausible-but-wrong
summaries for every file, and those summaries feed `recall` — so it is not a bad answer once, it is a
bad answer **every time anyone searches**, and nothing announces it.

- **`capability:` frontmatter on all 34 rituals** — `mechanical` (12), `judgment` (16), `strong` (6).
  Assigned by asking one question each: what happens on a small model? "Still works" is mechanical;
  "produces something plausible and wrong" is judgment, because plausible-and-wrong is the failure
  nobody notices.
- **`node tools/cortex-capability.mjs`** prints the table, filterable by tier. It reads the
  frontmatter rather than restating it, so the table cannot drift from the rituals it describes.
- **Every `strong` ritual carries a `## When the floor is not met` section** — a declared floor with
  no way under it is a wall. Each names a real alternative rather than "use a better model":
  `/level-up` → `/audit` (a fixed rubric instead of judgment); `/analyze-spec` → `/plan-feature`;
  `/improve-codebase-architecture` → the deterministic findings report; `/grilling` → the same
  interview conducted in writing, so the file carries the state the model cannot; `/cortex-audit` →
  run it with every finding treated as `[judgment]`, withdrawing the autonomy but keeping the scan;
  `/cortex-enrich` → **skip it**, because enrichment is additive by design and a missing one degrades
  Cortex to deterministic behaviour while a wrong one poisons it.
- **Two guards.** `core/test/plugin.test.js` asserts every skill declares a valid floor *in the
  frontmatter* — checked across all skills, not a named list, so a new ritual cannot ship undeclared —
  and that every `strong` one has its degraded section. `tools/test/capability-floor.test.sh` asserts
  the CLI that reads them, because a table nobody can print is a table nobody consults.

This was the last open item on the 2026-08-15 "big task" follow-on list, and it was blocked on the
ritual collapse in 2.9.0: a floor declared on both `/cortex-doctor` and `/cortex-audit` would have
described one job twice and hardened the duplication. Collapse first, declare second.

## [2.12.0] — 2026-08-19

### Added — a profile says which world an install serves
The employer firewall always opened by asserting *"one vault instance holds exactly one world"* — and
then hardcoded that world to *personal*. So a work machine could not say it was one, even though the
manual's own answer to work knowledge is "a separate vault instance on the work machine". And the
rule was prose everywhere and code nowhere: grepping `core/`, `index/` and `mcp/` for "firewall"
returned one hit, in an unrelated test.

- **`core/profile.js`** owns `home` · `work` · `lab`, declared with `CORTEX_PROFILE`.
  `home` (the default) refuses employer and client material. `work` is the same rule read from the
  other side — employer material is expected, personal notes are refused, because a private note in
  a work brain is the mirror of the leak `home` guards against. `lab` refuses nothing.
- **`lab` refusing nothing and publishing nothing is one decision, stored as one policy object.** A
  profile that refused nothing locally and still pushed would be a way to switch the firewall off and
  keep leaking. `mcp/lib/capture.js` still *writes* the team note — sealing must not lose work — and
  returns `pushed: false, error: "outward_sync_disabled"` instead of a silent success.
- **Declared, never detected.** A work laptop and a home laptop have the same shape on disk, so
  there is nothing honest to infer; the same reasoning that made `server` a declared audience in
  [ADR 0008](docs/adr/0008-three-audiences-one-seam.md). Inferring it from a hostname would be a
  guess about which secrets are safe to write down.
- **The default fails safe.** An undeclared work machine gets the strict-about-employer-content
  firewall — worst case, a refused write someone wanted. The opposite default would let an
  undeclared machine behave like a lab, which is a leak rather than an inconvenience.
- **An unknown value is fatal.** `CORTEX_PROFILE=works` exits 1 and names the valid set. Falling back
  quietly to `home` would look identical to a correct home install while the user believed the
  firewall pointed the other way.
- **`/cortex-profile`** reports and sets it, and is required to explain the consequence first — a
  profile decides what Cortex will refuse to write. It also names the mismatch worth catching:
  `work` left on a personal machine fills the brain with employer content on a box that may sync to
  a personal remote.
- The server's startup line now prints all three axes:
  `cortex: profile=home (default) audience=solo (...) mode=vault root=...`
- [ADR 0015](docs/adr/0015-a-profile-is-the-world-an-install-serves.md).

### Changed
- `AGENTS.md`'s firewall now says *which* profile it describes instead of asserting one world. It is
  still `home` for this instance, and the twelve ritual restatements are unchanged — detecting
  "employer content" deterministically is not possible, and pretending otherwise would be worse than
  the honest prose. What moved into code is the axis and the one enforceable consequence.

## [2.11.0] — 2026-08-19

### Added — skills chosen from the stack, not from a default list
Every repo used to get the same two skills. A Next.js app with Prisma and no tests got exactly what
a Rust CLI got, because nothing downstream of the index could tell them apart — the context layer
was tailored and the skills were not.

- **The index knows the stack now.** `index/lib/stack.mjs` detects runtime, frameworks, data layer,
  services, test runner and delivery from manifests and file paths — deterministic, per
  `index/AGENTS.md`: no network, no LLM, no clock. It reads dependency names as **keys**, so
  `next-auth` never implies Next.js and `flask-admin` never implies Flask.
  Two signal shapes, because the difference is load-bearing: a file can **confirm** a manifest hit
  (a Prisma dependency without a `schema.prisma` is someone else's schema, and an `/add-migration`
  skill pointing at it would be worse than no skill) or **stand alone** (a `tsconfig.json` is proof
  of TypeScript by itself, since framework-compiled repos never name the compiler).
- **`index/lib/skills.mjs` proposes from that stack** — declarative, the way `offers()` already is.
  Each candidate declares its own `when()` and an evidence sentence naming what was *detected*, so
  the set is enumerable without reading any bodies and a new stack is a row, not another branch.
  Rank is control flow: the ritual walks it top-down, as in
  [ADR 0006](docs/adr/0006-the-report-is-the-wizards-script.md).
- **`index/cortex-skills.mjs`** prints the proposal, or `--offers` for the JSON worklist. It writes
  **nothing at all**, not even under `.cortex/`.
- **`/cortex-skills`** presents the proposals with their evidence, the user picks each one, and the
  agent writes the bodies — because a useful body quotes this repo's real commands and real paths,
  and inventing those is exactly the failure a deterministic module cannot detect in itself.

On a real Next.js repo this now detects TypeScript · Next.js · React · Prisma · NextAuth · Stripe ·
Supabase and proposes six skills, each with its reason: a webhook skill because Stripe is a
dependency, a migration skill because the repo owns a Prisma schema, a first-test skill because it
has none.

### Fixed
- **A stackless index now proposes nothing instead of guessing.** An index written before stack
  detection has no `stack` key, and falling back to an empty one let candidates fire on `stats`
  alone — telling a repo with Vitest configured that it had "no test runner in any manifest", when
  nothing had read a manifest. Every candidate's evidence presumes detection ran; if it did not, the
  honest answer is to say so and re-index.

### Changed
- `/cortex-scaffold` now offers `/cortex-skills` alongside `/cortex-brief` as the next step, and says
  what it is for: the context layer it just wrote is tailored to the repo, and its skills are not.
- `tools/test/install-on-a-project.test.sh` asserts the whole chain end to end — index detects the
  stack, the proposal names the skills that stack implies, and the target repo is left untouched.
  The fixture gained a `tsconfig.json` and declares `@prisma/client` rather than the CLI, which is
  what a real Next.js repo looks like; both corrections came from the fixture failing and exposing
  genuine detection gaps.

## [2.10.1] — 2026-08-19

### Fixed
- **`/cortex-scaffold` could skip a file it was told to write, and report success.** Step 3 lists
  the files as bullets, and a bulleted list is easy to half-complete — the second shim is the one
  that goes missing, because writing the first satisfies the feeling of having written the shims.
  Observed on a real install: `CLAUDE.md` was written and `GEMINI.md` was not. Nothing errored.
  A missing shim fails silently and forever — that agent reads no context, and the gap only ever
  surfaces as it being inexplicably worse in that repo.
  Step 4 verified placeholders, commands and paths, but never that the files it had just been told
  to write existed. It now runs an explicit existence check over the whole list, and anything
  MISSING is written or named to the user as deliberately skipped.

### Changed
- **`archives/` holds one lifecycle now: your vault's, ignored in full.** It used to hold two — the
  product's own retired pieces (the Node installer, the engine-era framework docs, the old view
  scripts, the stale-engine prompts) sat next to personal removals, so the ignore rules needed six
  lines and two negations to say which half was shareable. Every negation is a chance to get it
  backwards, and getting it backwards *in this folder* means committing something that was archived
  to keep it private. The rules are now `archives/*` plus `!archives/README.md`.
- **The product half moved to `docs/history/`**, with a README saying what each retired piece was
  and what replaced it. `.cortexignore` already excludes `docs/`, so none of it is loaded as
  knowledge — retired instructions should not come back through recall as if they were current.
- **`tools/test/archives-is-personal.test.sh`** pins both halves: everything under `archives/` is
  ignored except the README, nothing but the README is tracked there, `docs/history/` is tracked and
  excluded from the graph, and no file still points at a pre-move path.

### Added
- **`tools/README.md` documents how to try Cortex on your own repo without letting it write
  anything** — `CORTEX_E2E_REPO=/path/to/your/repo bash tools/test/run.sh install-on-a-project`.
  It runs the real pipeline against your code and asserts your repo is left without a `.cortex/`.

### Fixed
- **A v1.0.0 changelog entry named a private repository.** Cortex is public, and developing it by
  testing against real repositories creates a standing temptation to write down what was learned in
  the terms it was learned in — which ties a named account to a private codebase. The entry now
  describes the shape and not the subject, and `tools/test/no-private-names.test.sh` keeps it that
  way: it fails if any tracked file names a known private project, or if a test hardcodes an
  absolute path to somebody’s repo instead of taking `CORTEX_E2E_REPO` at runtime.
- **`.gitignore` said "dated archive folders come from `/cortex-audit` and `/cortex-audit`."** A
  find-and-replace in 2.9.0 renamed both halves of "`/cortex-doctor` and `/cortex-audit`" when only
  one of them was the collapsed ritual. The line is rewritten as part of the change above.

## [2.10.0] — 2026-08-19

### Added — the version fact has one home
- **`tools/cortex-version.mjs` owns version propagation.** A release used to write the version by
  hand into seven files and verify it in four, so releasing was a memory exercise with a test that
  fired *after* the mistake — and two sites where it never fired at all. `VERSION` is now the
  interface and the rest are implementation:
  `node tools/cortex-version.mjs --set 2.10.0` stamps them all, a bare run checks for drift, and
  `--list` shows what each site holds. Adding a site is one entry in `SITES`, which **both** the
  writer and the checker read — a checker with its own private idea of where versions live is how
  four of seven sites came to be verified.
- **The `## [x.y.z]` changelog entry is checked, never generated.** A release entry says what
  changed and why, which no string substitution knows; `--set` refuses and names the missing
  heading. The link *reference* is fully derivable, so that one is generated — it was the site that
  got missed by hand, because a missing one breaks no build and renders as literal text.
- **`tools/test/version-sites.test.sh`** — the guard behind the generator, not instead of it. It
  fails a build whose sites disagree, and exercises the writer against a scratch repo via
  `CORTEX_VERSION_ROOT`, so the writer is never shipped having only ever been read.
- [ADR 0013](docs/adr/0013-the-version-has-one-home.md).

### Added — proof that Cortex works on somebody else's repo
- **`tools/test/install-on-a-project.test.sh`** runs the whole install pipeline — index → findings →
  the `--offers` worklist the wizard walks — against a repository shaped like real product code: a
  Next.js app with TypeScript, an api directory, generated Prisma output, committed `.env` files and
  no tests. Every other test in the suite points Cortex at fixtures shaped by the people who wrote
  the tests; this one asserts the product works, not just the parts.
  It **builds** that repo rather than pointing at a path on disk, so it runs on every machine. Set
  `CORTEX_E2E_REPO=<path>` to additionally run a read-only pass against a real project — that mode
  writes through `--out` and asserts the target repo is left without a `.cortex/`, which is
  `/cortex-install`'s promise made executable.

### Fixed
- **`core/package.json` read `2.2.0` while the product shipped `2.9.1`** — six releases behind,
  drifting in silence because nothing compared it to anything. It is in `SITES` now, so it cannot
  rot again. This was the exact failure `mcp/test/version.test.js` exists to prevent, occurring in
  the one site it does not cover.

### Decided
- [ADR 0014](docs/adr/0014-the-package-split-stays-rejected.md) — **Cortex is not being split into
  published packages.** [ADR 0001](docs/adr/0001-two-repos-not-two-packages.md) set the test ("the
  split is a directory boundary, not a distribution one") and
  [ADR 0004](docs/adr/0004-no-runtime-dependencies.md) settles it: a plugin install clones the repo
  and runs no `npm install`, so three manifests would be resolved by nobody. The rotted
  `core/package.json` above is the empirical version of the same argument — a manifest nobody
  resolves is a manifest nobody notices is wrong. Recorded so the next review stops here.

## [2.9.1] — 2026-08-19

### Fixed
- **`capture` filed notes under the UTC day, not yours.** `core/date.js` stamps local time;
  `mcp/server.js` carried its own clock — `new Date().toISOString().slice(0, 10)` — eleven lines
  below an import of `core/memory.js`, which stamps through `core/date.js`. A thought captured at
  01:00 in UTC+3 landed in `daily/2026-08-18.md` when the person filing it was living on the 19th.
  Demonstrated end-to-end through the MCP protocol at 03:59 UTC with `TZ=Pacific/Midway`: before the
  fix `capture` wrote `inbox/2026-08-19.md`, a day that timezone has not reached; after it, the
  `2026-08-18.md` the user is actually in. `server.js` was the **only** UTC clock in the repository —
  memory, findings and every shell tool already stamped local — so the fix is a deletion, not a
  choice between conventions.
- **Two shell scripts invented a date when `date` failed.** `|| echo 2026-07-01` wrote a hardcoded
  past day into every project stub's frontmatter, and `|| echo 0` set an epoch of zero that made
  `age_days` go negative, silently classifying every dormant repo as active — the inverse of the
  check it fed. Both are plausible wrong values a reader cannot spot. There is no system Cortex runs
  on without `date`, so the stamp is now a hard, named failure.

### Added
- **`core/date.js` has its first test.** It was the one `core/` module without one, which is how a
  second clock came to sit beside it unnoticed. The suite pins local-vs-UTC at both ends of the day,
  zero-padding, and the explicit-`Date` seam that keeps callers testable — with `TZ` fixed inside the
  test so it means the same thing on a UTC machine and a negative-offset one.
- **`mcp/test/one-clock.test.js`** scans `mcp/` for `new Date()`, `Date.now()` and `toISOString`, so a
  second clock fails the suite instead of shipping. Same shape as
  `mcp/test/vault-is-the-only-door.test.js`. The allowlist has one reasoned entry: `lib/noteid.js`
  uses an epoch as a collision-resistant id component, never as a calendar day.
- **`cortex_today`, `cortex_timestamp` and `cortex_epoch`** in `tools/_cortex-lib.sh` — the shell
  counterpart of `core/date.js`, used by `cortex-rm.sh` and `cortex-scan-projects.sh`.
- **`tools/test/date-parity.test.sh`** pins the two scripts that cannot source the lib.
  `cortex-init.sh` is a zero-dependency installer and `tools/server/cortex-cron.sh` lands on a server
  beside only `server-setup.sh`, so both keep their own `date` call and get the slugify treatment: a
  parity test comparing format strings (normalising `%F` against `%Y-%m-%d`) and refusing any new
  literal fallback. Shell tests: 107 → 118.
- [ADR 0012](docs/adr/0012-one-clock-per-language.md) — the wall clock is read in exactly one place
  per language, and two tests enforce it.

## [2.9.0] — 2026-08-19

### Changed — `/cortex-doctor` and `/scope-area` are gone
Four rituals covered two jobs. Typing either removed name now resolves to nothing; reach for
`/cortex-audit` and `/cortex-brief`, which absorbed them along with their trigger phrases.

- **`/cortex-doctor` → `/cortex-audit`.** The doctor scanned six categories. The `cortex-auditor`
  subagent that `/cortex-audit` dispatches scans the same six, plus employer-firewall breach, plus a
  content-health signal — the doctor's scan was a strict subset of the auditor's, and
  `/cortex-audit` already carried an inline fallback for when the subagent is unavailable, which is
  the doctor's whole remit. That fallback is now a real pointer: it names `agents/cortex-auditor.md`
  as the file to read and run, so the report comes out the same either way and only the context
  isolation is lost.
- **`/scope-area` → `/cortex-brief`.** Both wrote one `AGENTS.md` leaf into a critical directory and
  wired a root routing table; their rules were the same sentence written twice. The only real
  difference was where step 1 got its candidate, and `/cortex-brief` now has both entry points —
  ranked from the index, or a directory you name, which skips the ranking. It also picked up the
  three leaf conventions it lacked: a leaf points up to the root, a fact that moves into a leaf comes
  out of the root, and a leaf ships in the same PR as the code it covers.
- **The prose that told them apart is deleted, not rewritten.** Each sibling said "I am not my
  sibling" in its own body, again in the other's, and a third time in `AGENTS.md` — 33 lines of a
  file every agent loads on every run, and the second-most-churned file in the repo. Two ritual rows
  and three gotchas are gone from `AGENTS.md`, two rows from `README.md`.
- **`/audit` and `/reindex` were held to the same test and survived it.** Read-only scoring of
  content, mutating repair of structure, and rebuilding the graph are three jobs, not one. Three
  health rituals became two, not one.

### Fixed
- **`AGENTS.md` named four rituals as carrying `disable-model-invocation`; eight do.** The list was
  never updated as rituals were added, so a gotcha written to prevent an agent auto-firing a
  destructive ritual was silently describing half the set. It now names all eight and points at
  `grep -l disable-model-invocation skills/*/SKILL.md` as the list of record.

### Added
- [ADR 0011](docs/adr/0011-four-rituals-covered-two-jobs.md) records the decision, what survived it,
  and the test it establishes: when the prose separating two rituals grows longer than the
  difference it describes, they are one ritual.

## [2.8.1] — 2026-08-18

### Fixed
- **`cortex-vault-extract.sh` could delete the personal layer after an incomplete copy.** The script
  is careful by design — dry-run by default, `--apply` to copy, `--remove-source` as a separate
  opt-in, and a verification before anything is deleted. Its own header says why: *the personal layer
  is gitignored, so it exists only in your working tree, and a careless delete is unrecoverable.*

  The verification counted the wrong set. `copied=$(find "$DEST" -type f | wc -l)` counts
  **everything already in the destination**, not what this run copied. Verified: a destination
  holding 8 unrelated files reported `copied 10 files` for a 2-file move. A non-empty destination —
  what you have after a first attempt goes wrong — inflated the number enough for a partial copy to
  clear the `-lt "$total"` guard, and `--remove-source` would then delete the source.

  It now counts per planned path, comparing source and destination with the same
  `.gitkeep`/`README.md` exclusions the plan phase uses, and refuses to remove anything if any path
  is short — naming which. A test proves a copy that fails never reaches the delete.

### Added
- **Behavioural tests for `cortex-vault-extract.sh`** (21 assertions; 107 shell assertions total) —
  the last untested destructive tool. Pins that the dry run writes nothing, `--to` is required, it
  refuses outside the Cortex repo, an empty vault exits 0, `--apply` leaves the source in place, and
  `--remove-source` keeps the `.gitkeep` and `README.md` placeholders.

## [2.8.0] — 2026-08-18

### Fixed
- **`cortex-rm.sh` would archive a file from outside the vault.** Verified, not theorised:

  ```
  $ cd vault && bash tools/cortex-rm.sh ../outside/secret.md
  ✓ archived → archives/removed/secret.20260818-134621.md
  ```

  It did `ROOT="$(pwd)"` and then `[ -f "$ROOT/$F" ]`, which accepts `../` without complaint.
  ADR 0007 made `mcp/lib/vault.js` the only door onto a vault root for exactly this reason; **the
  bash half never got the same treatment.**

  Not remote-exploitable — it is a local CLI run with a path someone typed. It was worth fixing
  anyway because the tool cannot keep its own promise: it says *archive, don't delete* and prints
  "recover from `archives/removed/`", and for a file dragged in from outside, the original location
  is gone from the record. And because Cortex is driven by agents, which construct paths — "a person
  would not type that" is not a property of this codebase.

### Added
- **`resolve_in_root` in `tools/_cortex-lib.sh`** — the shell counterpart of `core/paths.js`. It
  lives in the shared lib, not in `cortex-rm.sh`, so the next destructive tool inherits the guard
  instead of re-deriving it; "five modules each had to remember" is the failure ADR 0007 was written
  about. Uses `cd` + `pwd -P` rather than `realpath` (absent on macOS by default, and ADR 0004 keeps
  this repo dependency-free), and walks up to the deepest existing ancestor so a target that does not
  exist yet still resolves. Not a string-prefix check: a symlink out of the root passes any prefix
  comparison and is still an escape. Recorded in
  [ADR 0010](docs/adr/0010-the-shell-half-gets-the-guard-too.md).
- **Behavioural tests for `cortex-rm.sh` and `cortex-sync-skills.sh`** (72 shell assertions total).
  Six `cortex-rm.sh` promises are pinned that never were: the note is moved rather than deleted,
  `[[slug|alias]]` becomes the alias, a bare `[[slug]]` becomes plain text, `archives/` is not
  rewritten, and **an unrelated link in the same file survives** — the de-link pass `sed -i`s every
  note containing the slug, so a greedy pattern would quietly damage the whole vault, and two links
  in two files would not catch it.

  For `cortex-sync-skills.sh`, the test that matters is that a **mirror-only** skill survives a full
  sync. `.claude/skills/` is gitignored, so deleting one is unrecoverable — which is exactly what
  nearly happened on 2026-08-17 to a skill a parallel session had written there and nowhere else.

  Checked and deliberately left alone: `cortex-vault-extract.sh` resolves its root from the script's
  own location, and `cortex-scan-projects.sh` only removes inside `$VAULT/projects/` under a
  slugified name, which cannot express a traversal segment. Adding a guard where there is no door is
  noise, and noise is how a real guard stops being noticed.

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
- Demonstrated end-to-end on a real repo: brain installed, old engine migrated (10 verified
  memory facts harvested), nested briefs created for auth / webhooks / RAG.

[2.29.0]: https://github.com/marinvch/Cortex/releases/tag/v2.29.0
[2.28.0]: https://github.com/marinvch/Cortex/releases/tag/v2.28.0
[2.27.1]: https://github.com/marinvch/Cortex/releases/tag/v2.27.1
[2.27.0]: https://github.com/marinvch/Cortex/releases/tag/v2.27.0
[2.26.0]: https://github.com/marinvch/Cortex/releases/tag/v2.26.0
[2.25.1]: https://github.com/marinvch/Cortex/releases/tag/v2.25.1
[2.25.0]: https://github.com/marinvch/Cortex/releases/tag/v2.25.0
[2.24.2]: https://github.com/marinvch/Cortex/releases/tag/v2.24.2
[2.24.1]: https://github.com/marinvch/Cortex/releases/tag/v2.24.1
[2.24.0]: https://github.com/marinvch/Cortex/releases/tag/v2.24.0
[2.23.0]: https://github.com/marinvch/Cortex/releases/tag/v2.23.0
[2.22.2]: https://github.com/marinvch/Cortex/releases/tag/v2.22.2
[2.22.1]: https://github.com/marinvch/Cortex/releases/tag/v2.22.1
[2.22.0]: https://github.com/marinvch/Cortex/releases/tag/v2.22.0
[2.21.0]: https://github.com/marinvch/Cortex/releases/tag/v2.21.0
[2.20.0]: https://github.com/marinvch/Cortex/releases/tag/v2.20.0
[2.19.0]: https://github.com/marinvch/Cortex/releases/tag/v2.19.0
[2.18.0]: https://github.com/marinvch/Cortex/releases/tag/v2.18.0
[2.17.0]: https://github.com/marinvch/Cortex/releases/tag/v2.17.0
[2.16.0]: https://github.com/marinvch/Cortex/releases/tag/v2.16.0
[2.15.0]: https://github.com/marinvch/Cortex/releases/tag/v2.15.0
[2.14.0]: https://github.com/marinvch/Cortex/releases/tag/v2.14.0
[2.13.0]: https://github.com/marinvch/Cortex/releases/tag/v2.13.0
[2.12.0]: https://github.com/marinvch/Cortex/releases/tag/v2.12.0
[2.11.0]: https://github.com/marinvch/Cortex/releases/tag/v2.11.0
[2.10.1]: https://github.com/marinvch/Cortex/releases/tag/v2.10.1
[2.10.0]: https://github.com/marinvch/Cortex/releases/tag/v2.10.0
[2.9.1]: https://github.com/marinvch/Cortex/releases/tag/v2.9.1
[2.9.0]: https://github.com/marinvch/Cortex/releases/tag/v2.9.0
[2.8.1]: https://github.com/marinvch/Cortex/releases/tag/v2.8.1
[2.8.0]: https://github.com/marinvch/Cortex/releases/tag/v2.8.0
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
