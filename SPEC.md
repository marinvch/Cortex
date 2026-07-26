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
.cortex/
  config.json                    version, slug, guard settings
  memory/
    gotchas.md                   accumulated tribal knowledge — COMMITTED
    decisions.md                 ADR log — COMMITTED
.claude/
  hooks/reflect.mjs              SessionEnd → mine session → guard → append
  settings.json                  registers the hook (merged, never clobbered)
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
| Installs clean on a foreign repo | `npx cortex-init --yes` against fixtures (Next.js, Django, Go, monorepo) |
| Detection is right | fixture repos with asserted expected `AGENTS.md` stack facts |
| **Guard blocks** | red-team corpus: real-shaped keys, credentialed URIs, `.env` values, high-entropy strings — every one must fail the write |
| **Guard doesn't over-block** | benign corpus: hashes, UUIDs, lockfile digests, base64 images — none may trip it |
| No escape | tests asserting `../`, absolute paths, and symlinks outside cwd all throw |
| No egress | source grep + dependency-tree assertion in CI |
| Idempotent | run twice, assert second run is a no-op; assert human prose survives `--refresh` |

The guard's two corpora are the most important tests in the project. Committed-ungated memory is
only safe if they are exhaustive.

---

## Out of scope

- The personal vault. It becomes a separate optional consumer that may *read* a repo's brain; it is
  never required to install one, and no automatic promotion crosses that boundary.
- Team-brain sync / shared remote note repos.
- MCP server. `AGENTS.md` is plain text; agents read it without one.

## Open questions

- npm package name — `cortex-init` may be taken; needs a registry check before publish.
- Does `--refresh` rewrite stack facts in place, or write a diff for human review?
- Should `.cortex/memory/` ship with a `.gitattributes` merge strategy? Append-only files from
  parallel branches will conflict constantly otherwise.
