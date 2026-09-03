# Cortex — Repo Brain

**Status:** draft · **Date:** 2026-07-26

A codebase brain that installs into any repository with one command, is committed alongside the
code so the whole team inherits it, and gets smarter as the project grows.

---

## Context

This repo previously held two welded-together products: a personal knowledge vault and a
codebase-brain installer. That coupling failed three requirements:

1. **"Can anyone install it on any repo?"** — No. Getting the installer meant cloning an entire
   personal second brain, PARA folders and all. A corporate dev had to pull down someone's private
   knowledge product to get a project `AGENTS.md`.
2. **"Does it help a team?"** — Half. `AGENTS.md` + cross-agent shims worked well, but the brain
   never learned. `## Gotchas / tribal knowledge` was a static heading nothing ever filled. The
   session-reflection loop that could have filled it was wired to the personal vault instead.
3. **"Does it leak corporate data?"** — Not by egress (verified: zero network calls outside git),
   but there was no safety net either. No secret detection existed anywhere in the codebase.

The repo has been reset to an empty commit. This is a greenfield build of the repo-brain half only.
The personal vault is out of scope and becomes a separate, optional consumer.

**Intended outcome:** `npx cortex-init` in any repo produces a brain that every AI agent reads, that
accumulates the team's tribal knowledge automatically, and that cannot write a secret into git.

---

## Requirements

| # | Requirement | Source |
|---|---|---|
| R1 | One command, no clone, no prior install | "anyone installs on whatever repo" |
| R2 | Writes only inside the target repo; reads nothing outside it | "without taking his data" |
| R3 | Zero network egress; no telemetry | "will this leak corporate data" |
| R4 | Every agent (Claude, Copilot, Gemini, Cursor, Codex) reads one source of truth | team |
| R5 | Memory accumulates automatically and is **committed** so the team inherits it | decision |
| R6 | No secret can reach disk or git — **detection blocks the write** | decision |
| R7 | Idempotent; re-runnable; never destroys human edits | operational |
| R8 | The repo can extend itself — author its own skills, agents, hooks and MCP servers | capability layer |
| R9 | The repo carries a committed structural map stating its own coverage | capability layer |

---

## Design

### Distribution — `npx cortex-init`

Published to npm. `files:` ships `bin/`, `src/`, `templates/` only. Because npm serves the tarball
rather than the repo, consumers never receive anything but the installer — the privacy problem that
motivated splitting the products is solved by the distribution channel itself, so **one repo is
enough**; no second public repo is needed.

```
npx cortex-init              # interactive
npx cortex-init --yes        # accept detected defaults
npx cortex-init --dry-run    # print the plan, write nothing
npx cortex-init --refresh    # re-scan, update stack facts, preserve human prose
```

### What gets stamped into the target repo

```
AGENTS.md                        canonical brain — the only file with real content
CLAUDE.md                        shim → @AGENTS.md
GEMINI.md                        shim → see AGENTS.md
.github/copilot-instructions.md  shim → see AGENTS.md
.cursor/rules/project.mdc        shim → see AGENTS.md
.gitattributes                   marks memory merge=union (created or extended, never clobbered)
.cortex/
  config.json                    version, slug, guard settings, map on/off
  memory/
    gotchas.md                   accumulated tribal knowledge — COMMITTED, one entry per line
  map.md                         structural map — COMMITTED
  lib/                           vendored guard + map generator, byte-identical to src/
    .manifest.json               cortexVersion + sha256 per file — provenance (D5)
.claude/
  hooks/cortex-reflect.mjs       SessionEnd → mine session → guard → append
  settings.json                  registers the hook (merged, never clobbered)
  skills/cortex-capability/      the meta-skill (D9)
```

Shims hold no content of their own — content in two places drifts. `AGENTS.md` is canonical; that
is what makes a mixed-tool team coherent (R4).

### Memory model

Memory is **committed, ungated** — a session's learnings append straight to `.cortex/memory/` and
land in company git history on the next commit.

This is the highest-value and highest-risk choice in the spec. It is what makes tribal knowledge
survive a developer leaving, and it is why **the secret guard is load-bearing rather than a nicety**:
with no human promotion step, the guard is the only thing between an agent's observation and a
permanent record in the company's repository.

Noise control, since nothing else gates writes:
- dedupe candidates against existing entries before appending
- cap entries per session
- each entry carries a date + one-line provenance so a human can prune later

### Secret guard

One choke point: **every write into `.cortex/memory/` passes the guard, which blocks on detection.**
No silent redaction, no warn-and-continue. On a hit: refuse the write, print the matching rule and
the offending line, exit non-zero.

Detection layers:

1. **Known key shapes** — `AKIA…`, `ghp_/gho_/ghs_`, `sk_live_`, `xox[baprs]-`, `-----BEGIN … PRIVATE KEY-----`, JWTs, `AIza…`
2. **Credentialed URIs** — `scheme://user:password@host`
3. **`.env` value matching** — read the repo's `.env*` files and refuse any candidate containing one
   of those literal values. This catches the project-specific secrets no regex knows about, which is
   most of them, and costs almost nothing.
4. **Entropy** — base64/hex runs over a length threshold whose Shannon entropy exceeds a bound.
   Last resort, tuned to under-fire; layers 1–3 do the real work.

`.env` files are read for **comparison only** and their contents never enter memory, a log, or an
error message — the guard reports *which* variable matched, never its value.

### Self-improvement loop

`SessionEnd` hook reads the Claude Code transcript, extracts candidate gotchas, runs them through
the guard, appends survivors to `.cortex/memory/gotchas.md`. Committed by the team like any file.

For agents without a hook system, `AGENTS.md` instructs the agent to append a gotcha when it learns
one — same file, same guard on the next `cortex-init` run.

### Capability layer (R8, R9)

One meta-skill ships as plain markdown in `.claude/skills/cortex-capability/`, branching to the four
shapes it can author — skill, subagent, hook, MCP server (D9). A skill that creates skills is itself
just a skill, so there is no generator code and nothing to keep in sync. What it creates registers in a
`## Project skills` section of `AGENTS.md` that sits **outside** the `cortex:generated` markers —
`--refresh` maintains the built-in list and never touches the team's.

The plugin declaration layer was **cut**. `.cortex/plugins.json` and `--with-plugins` were a hardcoded
list from one marketplace, meaningful only in Claude Code, inside a product whose pitch is being
cross-tool — a manifest format, a flag, a settings-mutation path and six tests to deliver what a README
sentence delivers, with the curation rotting in shipped source. Removing it also left `installHook` as
the sole writer of `.claude/settings.json`, which fixed a real bug: the two writers ran in the same
pass, so the hook's `.bak` captured Cortex's own earlier edit rather than the user's file.

`.cortex/map.md` is a committed structural map: entry points, routes, data layer, per-module imports
and exports. Extraction is zero-dependency heuristics, which are strong on JS/TS and thin elsewhere,
so the map ends with a Coverage section naming what it parsed, what it could only list, and whether
the file cap was hit. A map that overstates itself is worse than none, because agents trust it.
A structural hash in the header lets the SessionEnd hook regenerate it on drift and stay silent on
cosmetic edits. `.claude/` and `.cortex/` are excluded from the scan — that is Cortex's own
scaffolding, not the project's architecture.

### Boundary enforcement (R2, R3)

- Every write resolves through a path guard that realpaths the target and throws if it escapes
  `process.cwd()`.
- No HTTP client in the dependency tree. CI asserts this with a source grep **and** a dependency-tree
  check, so egress can't be added later without the test failing.
- Runtime deps: zero, or as close as Node allows.

---

## Verification

| Check | How |
|---|---|
| Installs clean on a foreign repo | `npx cortex-init` against fixtures (Next.js, Django, Go, monorepo) |
| Detection is right | fixture repos with asserted expected `AGENTS.md` stack facts |
| **Guard blocks** | red-team corpus: real-shaped keys, credentialed URIs, `.env` values, high-entropy strings — every one must fail the write |
| **Guard doesn't over-block** | benign corpus: hashes, UUIDs, lockfile digests, base64 images — none may trip it |
| No escape | tests asserting `../`, absolute paths, and symlinks outside cwd all throw |
| No egress | source grep + dependency-tree assertion in CI |
| Idempotent | run twice, assert second run is a no-op; assert human prose survives `--refresh` |
| Capabilities survive refresh | create a project skill, `--refresh`, assert it is still there |
| Plugins not provisioned | default run asserts `enabledPlugins` is absent from `.claude/settings.json` |
| Map is honest | assert the cap and the parsed/listed-only split are reported, not hidden |
| Map is not born stale | assert `isStale()` is false the moment install finishes |

The guard's two corpora are the most important tests in the project. Committed-ungated memory is
only safe if they are exhaustive.

---

## Out of scope

- The personal vault. It becomes a separate optional consumer that may *read* a repo's brain; it is
  never required to install one, and no automatic promotion crosses that boundary.
- Team-brain sync / shared remote note repos.
- Cortex shipping *as* an MCP server. `AGENTS.md` is plain text; agents read it without one. (Scaffolding
  an MCP server *for the host repo* is in scope — that is the MCP branch of `/cortex-capability`, and it
  only runs when asked.)
- Declaring or provisioning third-party plugins. Cut; see the Capability layer section.

## Decisions

Resolved 2026-09-03 after a full-team audit (auditor, qa, product-manager, refactorer). Each
supersedes the corresponding open question.

**D1 — npm name: keep the scoped `@marinvch/cortex-init`.** Nobody discovers a CLI installer by
guessing a package name; the invocation is copy-pasted from a README. An unscoped `repo-brain` would
not fix the real risk, which is brand collision with an adjacent product in the same category.
*Trade-off:* a scoped name reads as one person's side project — a marginal first-contact trust cost.
Free to reverse at v0.1.0 with no users, so it blocks nothing.

**D2 — `--refresh` rewrites stack facts in place and prints what changed.** Git is already the human
review surface; a `.patch` artifact would add a format, a step, and a second renderer to keep in sync.
*Trade-off:* a mis-detected fact lands unreviewed in the working tree. Mitigated by printing the facts
that moved (`Tests: Vitest → Jest`), not by a diff file. Additionally, the rewrite must be **gated
behind the flag** — today it happens on any run when `AGENTS.md` exists, which is the silent
stack-fact rewrite this tool exists to prevent.

**D3 — memory merge strategy: `merge=union` via a stamped `.gitattributes`, which requires a format
change first.** Custom merge drivers live in `.git/config` and do not survive a clone, which
disqualifies them outright for a tool whose premise is "clone the repo, inherit the brain". Union
merge is line-based, so it is only safe if every entry is exactly one line with no shared trailing
footer — the blank line written at `src/memory.mjs:80` must go. Rejected: one-file-per-entry, which is
conflict-free by construction but trades a solved merge problem for an unreadable directory and breaks
"the brain is a file you can read". *Trade-off:* union merge silently yields duplicates and
non-chronological order. A duplicate costs a line; a recurring conflict costs the feature, because
people delete files that fight them.

**D4 — `decisions.md` and the merge strategy are one decision, not two.** Union merge would interleave
multi-line ADRs into garbage. So `decisions.md` either gains a writer and a one-line-per-entry format
(a `DECISION:` marker, symmetrical with `GOTCHA:`, same harvester and guard) or it is cut. Shipping a
permanently empty file that the README calls an "append-only decision log" is not an option — it is
exactly the noise this project claims to hate.

**D5 — the vendored `.cortex/lib/` gains a `.manifest.json` before any guard fix ships.** `VENDORED`
(`src/install.mjs:114,123`) is a raw byte copy with no version stamp, no manifest, and no hash;
`config.json`'s `version: 1` is a config-schema number never read back. Nothing detects or repairs a
stale copy, so a repo that installed at v0.1.0 runs that guard forever. `.cortex/lib/.manifest.json`
(`{cortexVersion, files:{name:sha256}}`) yields version-change reporting and local-edit detection
before overwrite. Rejected: a version comment stamped into each copy (breaks byte-identity, killing
`diff src/guard.mjs .cortex/lib/guard.mjs` as an audit), and npm `postinstall` (target repos have no
dependency on us). **This lands before the guard fixes**, or 0.2.0 ships with no way to tell which
repos received it.

An earlier draft of D5 also promised an offline `MIN_GUARD_VERSION` warning emitted by the hook. That
is **dropped, deliberately**: `templates/cortex-reflect.mjs` is itself vendored into `.claude/hooks/`,
so it goes stale in lockstep with the guard it would be checking — a stale file warning about stale
files is theatre, and it would have made the spec promise a safety net that could not exist. The
installer reporting the upgrade on re-run is the only signal that is actually load-bearing. Recorded
here rather than silently deleted, because the gap between what a spec promises and what ships is the
exact failure this project exists to prevent.

**D9 — the four meta-skills consolidate into one `/cortex-capability`, and the MCP branch survives.**
Each meta-skill occupies a permanent slot in the user's skill namespace, which belongs to them, not to
us; one entry point that asks "skill, subagent, hook, or MCP server?" costs the same prose and one slot
instead of four. The product-manager recommended deleting `/cortex-mcp` outright. Rejected: R8 promises
the repo can author "skills, agents, hooks and MCP servers" and Out of scope names `/cortex-mcp` as
in-scope, so deleting the capability would break a stated requirement to solve a problem that is really
about namespace slots and docs burden. The branch keeps the text that talks a user out of an MCP server
when a plain `AGENTS.md` would do — that honesty is the useful part.

**D11 — `.manifest.json` is committed, therefore its contents are untrusted input.** The manifest
travels through merges, rebases and human edits like any other committed file, so its keys are data
supplied by the repo, not a delete list Cortex may act on. The sweep guards on **shape before
provenance**: a candidate must match `/^[^/\\]+\.mjs$/` — a direct child, a `.mjs`, no separators — and
only then is its hash consulted.

This was a real hole, not a hypothetical. An earlier version drove candidates from manifest keys alone,
on the reasoning that a two-pass design "subsumed" the shape checks. It did not: the two-pass split
solved which map is read, never what a key is allowed to name. `resolveInRepo` rejects escapes *outside*
the repo and says nothing about traversal *within* it, so a key of `../../IMPORTANT.txt` resolved to a
real path, passed the guard, and was deleted. Manifest keys naming `guard.mjs.bak` deleted the very
backup the manifest feature exists to create. Found by a test, not by review.

The general rule for this codebase: **a file Cortex writes into a repo it does not control is input on
the next run.** `resolveInRepo` is a containment boundary, not a validator.

**D10 — orphan pruning ships before it is needed, not after.** When a module leaves `VENDORED` in
version N, only the manifest written by N-1 still lists it, so only N's installer can prove the file on
disk is an untouched copy of ours and remove it safely. Ship the sweep in N+1 and provenance is already
gone: the orphan becomes permanently undeletable-with-confidence, and `.cortex/lib/` keeps a module
nothing imports, no manifest mentions, and a hand-written hook can still load.

The sweep is two passes separated by their **source**, not by a flag, so the path that can delete never
sees a file it cannot vouch for. The delete pass is driven from `Object.keys(previousManifest.files)`
minus current `VENDORED` — by construction the dropped set, and provably empty if it is ever wired to
the manifest being written instead of the one read from disk, so the failure mode is obviously dead
rather than silently no-op. The report pass reads the directory and names any `.mjs` that no manifest
records, and can only report. Deletion needs no `.bak`: the hash proves the bytes are ours, the file is
committed, and every prior npm version still ships it, so `git checkout` is the better undo. Accepted
limit, and it belongs in a comment at the delete site: a matching hash proves the bytes are ours, not
that nothing imports them.

A deliberate downgrade — a repo installed at 0.3.0, someone running a pinned 0.2.0 — puts a legitimate
file in the delete pass, because it is recorded, absent from the older `VENDORED`, and hash-matched.
**Accepted.** The installer already produces the shape of the version you ran for every other artifact
it writes, including the hook that would import that module, so the result stays internally consistent
and self-heals on the next upgrade. Making the sweep uniquely conservative would be the inconsistency,
and gating it on a semver comparison buys a rare, deliberate, self-healing case at the price of a new
parsing surface (prerelease and build-metadata forms) in the one code path allowed to delete files from
someone's repo. The plan row makes the removal visible either way.

**D6 — drop interactive mode and `--yes` from this spec.** Lines below previously documented
`npx cortex-init` as interactive with `--yes` to accept defaults. Neither exists, and the CLI is
unconditionally non-interactive by design. The spec follows the code here rather than the reverse.
Separately, an unknown flag must exit non-zero: `--dryrun` currently warns on stderr and then performs
a real install with exit 0.

**D7 — the guard's entropy threshold stays at 4.5.** `ENTROPY_THRESHOLD` (`src/guard.mjs:39`) exceeds
log2(16) = 4.0, so layer 4 can never catch a hex-encoded secret at any length. The repair belongs in
layer 1 (known shapes plus key-name adjacency for long hex runs), **not** in the threshold — 4.5 is
precisely what keeps commit SHAs and `sha512-` integrity digests from over-firing.

**D8 — "exhaustive" corpora get a definition and a meta-test.** `MUST_BLOCK` grows 18 → ~40 and
`MUST_NOT_BLOCK` 11 → ~30, each entry labelled with the class it exercises, plus a test asserting every
named detection rule has at least one blocking entry — so a rule added without corpus coverage fails
CI instead of shipping untested. Without this, "exhaustive" in the Verification section is an
aspiration rather than a claim.

## Open questions

- None outstanding. See Decisions above.
