# One seam, three modes — design

**Date:** 2026-08-15
**Status:** approved (design); security fix already landed
**Extends:** `2026-08-12-cortex-framework-design.md`. Amends the *timing* of its Decision 1
and Decision 4; supersedes neither.

## Problem

Cortex has to serve three audiences that today are three different amounts of finished:

| Mode | Who | State today |
|---|---|---|
| **Solo** | one person, one machine, local files | works; the only mode actually exercised |
| **Team** | several devs, shared team-brain git repo | `/team-init`, `/team-add`, connector exist; untested beyond unit tests |
| **Server** | headless host, self-hosted LLM, rituals on a schedule | `tools/server/*.sh` exist; `server-setup.sh` references nothing else in the repo |

The temptation is to build three products. The 2026-08-12 spec already found the
answer: there is exactly **one** boundary in this system — `recall` / `capture` —
and the three modes are three ways of resolving what sits on the far side of it.
Everything else is deployment detail.

Three parallel investigations on 2026-08-15 (knowledge-graph analysis, an
architecture deepening review, and a scan of an external skills repo) converged on
the same structural complaint from different directions: **the seam is declared but
not enforced.** Five modules reach into vault paths; one of them was reading
outside the root.

## What the three investigations found

**Graph analysis** (197 nodes / 395 edges, 144 files). `paths.js` — the module that
owns the root guard — has an import fan-in of exactly **two**: `capture.js` and its
own test. `projects.js` and `recall.js` touch vault paths without it. `AGENTS.md` is
the highest fan-in node in the whole repo (14); `mcp/server.js` second (9).

**Architecture review.** Six deepening candidates, three live defects:

1. `getProjectContext` read outside `AI_OS_ROOT` — reproduced.
2. `cortex-scan-projects.sh:19` slugifies by *deleting* non-alphanumerics while
   `cortex-init.sh:302` and `slug.js` *replace* them (`my.app` → `myapp` vs `my-app`).
   The `rm -f` at line 59 deletes a filename nothing ever wrote — so the
   employer-firewall purge misses its target.
3. `cortex-scan-projects.sh` writes `**Local path:**`; `cortex.sh:51` selects repo
   cards with `grep -lER '^path:'`. Two writers, one reader, mismatched contract —
   scanner-registered projects are invisible in the viewer.

**External skills scan** (MIT, attribution required). Four ports greenlit, listed
under *Sequence* below.

A fourth finding, from the graph and confirmed by reading source: `README.md` claims
every generator reads `.cortexignore` via `tools/_cortex-lib.sh`. Only `cortex.sh`
sources it. `cortex-init.sh` and `cortex-scan-projects.sh` are self-contained. The
no-drift guarantee is documentation, not mechanism.

## Decisions

| # | Decision | Rejected alternatives |
|---|---|---|
| 1 | **Define the seam as a real contract; keep one repo for now.** The package split of 2026-08-12 Decision 1 stays the target, not this pass's work. | split packages now (touches every install path, the shims and CI at once); seam on paper only |
| 2 | **Solo / team / server are three resolvers behind one interface**, not three codepaths. | three products; mode flags threaded through call sites |
| 3 | **One Vault module owns every vault path access.** Root realpath, the traversal guard and `.cortexignore` live in exactly one place. | keep five modules, add guards at each call site (the state that produced the bug) |
| 4 | **Design the framework/vault separation now, execute later.** 2026-08-12 Decision 4 stands; the live personal content does not move in this pass. | move now (touches the daily driver); abandon the split |
| 5 | **Every cross-implementation duplicate gets a parity test or gets deleted.** | trust prose; trust review |

Decision 5 is the generalization of what already works here. The bash-vs-JS
`knowledge_files` / `listMarkdown` contract and the `CORE_PLUGINS` manifest parity
check are the two places this repo already got right — both are CI-enforced. The
three defects above are all in places where the same pattern exists **without** the
test.

## Architecture

### The seam

Unchanged from 2026-08-12, restated as an enforceable interface:

```
recall(query, opts) -> notes[]
capture(note)       -> void
```

Everything above the seam (dev skills, rituals, the viewer, cron) is mode-agnostic.
Everything below it is one Vault module plus a resolver.

### The Vault module

Collapses `paths` · `cortexignore` · `projects` · `capture` · `recall` into one
module with four operations:

```
list(scope)        -> paths[]      # .cortexignore applied, root-relative
read(path)         -> string       # guard enforced
append(path, text) -> void         # guard enforced
write(path, text)  -> void         # guard enforced
```

**Invariant:** no caller outside the Vault module may join a path onto the root.
The guard stops being something a module remembers to call and becomes the only
door. This is the structural fix for defect 1 — the standalone patch already
landed (below), but the patch is a lock on one door in a building with three.

`slug.js` and `gitsync.js` stay separate — they are genuinely different concerns
(naming, remote sync), and `gitsync` is the team mode's dependency, not the vault's.

### The three modes as resolvers

| Mode | Brain location | `capture` writes to | Firewall enforced |
|---|---|---|---|
| **Solo** | `AI_OS_ROOT` on this machine | local vault | at the Vault module |
| **Team** | cloned team-brain + local vault | local vault; team-brain via `gitsync` | same, plus: team-brain is business-scope, never personal |
| **Server** | `AI_OS_ROOT` on the host | host vault | same; no interactive rituals |

One resolver reads `.cortex/connector.json` (team), falls back to `AI_OS_ROOT`
(solo/server), then to repo-local `.cortex/memory/` (no brain). The dev side never
learns which one answered — that is the whole point of the seam.

**Server mode is mostly subtraction, not addition.** It is solo mode with: no
interactive prompts, a scheduler (`cortex-cron.sh`), and a model that is not Claude
Code. The last one matters — every ritual is markdown prose, so a weaker
self-hosted model is the real constraint, not the plumbing. Rituals that assume a
strong model (`/level-up`, `/cortex-audit`) need a declared minimum capability or a
degraded path. `server-setup.sh` currently references nothing but `mcp/server.js`;
it needs to actually provision the cron half it was written to pair with.

## What already landed

The traversal read is fixed, standalone, ahead of the refactor:

- `mcp/lib/projects.js` — both candidate paths in `getProjectContext` now go
  through `resolveInRoot`.
- `mcp/test/projects.test.js` — three regression tests: escaping slug throws
  `OutsideRootError`, absolute slug never reads, legitimate nested slug still
  resolves.
- Verified: 63 pass / 0 fail (1 pre-existing skip — symlink creation needs admin
  on Windows). Exploit re-run after the fix returns `OutsideRootError / outside_root`.

## Sequence

Ordered by blast radius, smallest first. Each step is independently shippable.

| # | Work | Why here |
|---|---|---|
| 1 | ~~`getProjectContext` traversal fix~~ | **done** |
| 2 | Fix the slug mismatch (defect 2) + parity test across `slug.js`, `cortex-init.sh`, `cortex-scan-projects.sh` | firewall correctness; small; Decision 5 |
| 3 | Fix the writer/reader contract (defect 3) + a test that registers a project and asserts the viewer finds it | user-visible bug; small |
| 4 | Make `cortex-init.sh` and `cortex-scan-projects.sh` source `_cortex-lib.sh` — or amend `README.md` to stop claiming they do | either fix the mechanism or fix the claim; not both ways |
| 5 | `codebase-design` → `references/codebase-design.md` | vocabulary the rest of the sequence is written in; zero risk |
| 6 | `disable-model-invocation: true` on `/onboard`, `/migrate-engine`, `/team-init`, `/connect-brain` | stops the model auto-firing once-only and destructive rituals |
| 7 | `domain-modeling` → `/install-project` as a fourth artifact (`CONTEXT.md` + lazy `docs/adr/`) | this repo has neither, and the architecture review hit their absence |
| 8 | `wizard` → `/wizard`, bash + PowerShell templates | formalizes the existing global "one consolidated self-elevating `.ps1`" rule |
| 9 | **The Vault module collapse** | the structural fix; rewrites what 15 test files cover, so it goes last |
| 10 | Three-mode resolver on top of the Vault interface | only meaningful once 9 exists |

Steps 2–4 are defect repair and can proceed in any order. Steps 5–8 are additive
and touch no existing behavior. Step 9 is the only one that needs a written plan of
its own.

Deferred, with the reasoning recorded so it is not re-litigated:

- **Package split** (2026-08-12 Decision 1) — after step 9. Splitting before the
  seam is enforced just relocates the coupling.
- **Vault instance extraction** (Decision 4) — after the split. The design assumes
  it; nothing in steps 1–10 blocks on it.
- **`resolving-merge-conflicts` port** and the **expand–contract carve-out** into
  `/analyze-spec` — both real, neither blocking.

## Verification

- Step 2 lands with a test asserting all three slug implementations agree on a
  corpus including `my.app`, `a_b`, `Foo Bar`, and a leading dot.
- Step 3 lands with a round-trip test: register → viewer selector finds the card.
- Step 9 is complete when `grep -rn "join(root" mcp/lib/` returns hits only inside
  the Vault module.
- Every mode is verified by running `recall` and `capture` through the seam with
  that mode's resolver, asserting identical results for identical vault content.

## Out of scope

Multi-writer conflict resolution in team mode. Any web UI beyond `cortex.html`.
Model-specific prompt tuning for self-hosted models — the capability floor gets
*declared* in step 10, not solved.

## Attribution

Ports in steps 5–8 derive from `github.com/mattpocock/skills` (MIT). Attribution
belongs in each ported file's header.
