# Design: ai-os → a Personal AI OS that's Actually Alive

**Date:** 2026-06-10
**Status:** Draft for review
**Branch:** feat/personal-brain-extension

---

## Context

`ai-os` today is a powerful but narrow developer tool: a TypeScript/Node CLI engine
(v0.24.0, 642 tests) that scans a codebase, detects the stack, and generates AI-context
artifacts (`copilot-instructions.md`, `CLAUDE.md`, agents, skills, an MCP server, a memory
store, drift/freshness detection, a manifest). It is engineering-deep but has a high
adoption barrier (Node + build + `.github/` plumbing) and no memorable identity.

The reference project — [`AIS-OS`](https://github.com/nateherkai/AIS-OS) by Nate Herk
(736★, MIT) — is the opposite: a **Markdown-only** "personal AI operating system" you clone
and open in Claude Code, then run `/onboard` → `/audit` → `/level-up`. It spread because of
four things: **zero-barrier distribution** (no build), **memorable mental models**
(its "Three Ms" / "Four Cs"), an **onboarding ritual**, and a strong **"personal OS"
identity**. But it is *static* — it cannot maintain itself.

**The thesis:** *AIS-OS is a great userland with no kernel. ai-os is a great kernel with
no userland.* This design fuses them: a personal AI OS with AIS-OS-grade clone-and-go
simplicity for everyone, kept **alive** by the ai-os engine when a codebase is present.

### Decisions locked during brainstorming
1. **Strategy:** keep the engine as the moat; wrap it in an AIS-OS-grade userland.
2. **Audience:** shareable to *everyone*; the engine is a *progressive* enhancement that
   switches on only when a codebase + Node are present.
3. **Borrow all four AIS-OS wins:** zero-barrier distribution, memorable mental models,
   onboarding ritual, personal-OS identity.
4. **Restructure shape:** "front-door reframe" — single repo, engine moved into a bounded
   `engine/` subtree, repo root becomes the shareable starter.
5. **Data boundary (legal/IP requirement):** a three-domain data model with hard
   encapsulation, plus a **personal brain + opt-in, sanitized promotion** rule. Company /
   client data stays encapsulated inside its project repo and never bleeds into the
   personal or shared layer without an explicit, audited, sanitized action.
6. **One cross-tool instruction file:** `AGENTS.md` is the single canonical source of
   truth (read natively by Codex, GitHub Copilot, Cursor, Windsurf, Amp, Devin); Claude
   Code gets a thin `CLAUDE.md` shim (`@AGENTS.md` import). No more one-full-file-per-tool.

---

## Architecture: layered like a real OS

```
┌──────────────────────────────────────────────────────────────┐
│  IDENTITY     "Your personal AI OS — alive, not a folder"      │  borrow: identity
│  RITUALS      /onboard → /audit → /level-up  (engine-aware)    │  borrow: ritual
│  FRAMEWORK    Alive · Bounded · Sovereign                       │  borrow: mental models
│  USERLAND     AGENTS.md (canonical) + CLAUDE.md shim,           │  borrow: zero-barrier
│               context/, references/, decisions/                 │
│               — works with NO engine (clone-and-go)            │
│  KERNEL (opt) the ai-os engine — scan, refresh, memory, drift  │  the moat; lights up on code
└──────────────────────────────────────────────────────────────┘
```

Two killer properties this yields:
- **Zero-barrier for everyone** — clone, open Claude Code, run `/onboard`. No Node/build.
- **Self-maintaining for developers** — rituals call the kernel to re-scan code, refresh
  context, reconcile memory, check drift. The thing AIS-OS structurally *cannot* do.

---

## The three-domain data model (encapsulation guarantee)

```
SHARED TEMPLATE   structure + framework + skills, ZERO real data   → the only thing published
PERSONAL INSTANCE your brain: your context + memory                → private, local, gitignored
PROJECT INSTANCE  company/client data, ENCAPSULATED in its repo    → never absorbed upward
```

**Boundary invariant:** a fact can move in exactly one direction — `project → personal` —
and *only* via explicit promotion with a sanitization audit. Never `project → shared`,
never `personal → project`. The engine never silently copies project data anywhere.

`domain` classification rule:
- `shared`   — files in `engine/src/templates/` and committed repo files
- `project`  — anything written into a target repo's `.github/ai-os/` subtree
- `personal` — anything in `brain/` at the OS root (requires explicit promotion)

---

## The mental-model framework: **Alive · Bounded · Sovereign**

A small, memorable, three-property set — deliberately distinct from AIS-OS's
trademarked "Three Ms" / "Four Cs".

| Property | Promise | Architecture layer | Backed in code by |
|---|---|---|---|
| **Alive** | The OS maintains itself | the `engine/` kernel | `rememberRepoFact()`, `pruneMemory()`, freshness snapshots, `--check-drift`, `--compact-memory` |
| **Bounded** | Nothing crosses a boundary without your consent | three-domain data model | `.gitignore` rules, `brain/` vs `projects/<name>/`, the `promote_to_brain` gate |
| **Sovereign** | You own the whole stack — local, forkable, no cloud lock-in | repo root = your clone | plain files, MIT, full source |

Lives in `references/alive-os-framework.md` (deep) + `references/quick-reference.md`
(cheat sheet); referenced by `CLAUDE.md` and every ritual.

> *This framework name is a strong proposal, not yet final — open to renaming during review.*

---

## One canonical instruction file: `AGENTS.md` (+ thin Claude shim)

Rather than maintaining a separate full instruction file per tool, the OS uses the
cross-tool **`AGENTS.md`** standard as the single source of truth, with one-line shims for
tools that don't read it natively. This applies at **both** the personal-OS root and inside
each project.

| File | Audience | Role |
|---|---|---|
| `AGENTS.md` | Codex, GitHub Copilot, Cursor, Windsurf, Amp, Devin (native) | **Canonical** — stack, build/test commands, style, boundaries, operating manual |
| `CLAUDE.md` | Claude Code | **Thin shim** — `@AGENTS.md` import (one line); Claude Code does *not* read AGENTS.md natively as of mid-2026 |
| `GEMINI.md` *(optional)* | Gemini CLI | Thin shim, same pattern |

Decisions:
- **Drop** the old full per-tool files (`.github/copilot-instructions.md`, full
  `gemini-instructions.md`, etc.) in favor of canonical `AGENTS.md` + shims.
- **Use the import shim, not a symlink** (Windows-friendly; symlinks need dev-mode/privilege
  and git is finicky).
- This is also a **token-dedup win** (one file, not N copies) — continues the v0.24.0 goal.

Engine impact — refactor **`engine/src/generators/multi-model.ts`**: instead of emitting N
full files, emit one canonical `AGENTS.md` plus thin `CLAUDE.md`/`GEMINI.md` shims. The
`ModelTarget` set stays, but `copilot`/`codex`/`cursor`/etc. all resolve to "ensure
`AGENTS.md`"; `claude`/`gemini` additionally "ensure shim".

**Open implementation detail (validate in the relevant phase):** to keep the *shared*
`AGENTS.md` data-free, personal identity lives in gitignored `context/*.md` and is pulled in
via `@context/...` imports. Claude Code resolves `@imports`; **Codex/Copilot import-resolution
of arbitrary files is not guaranteed**. Fallback: `/onboard` generates a gitignored, filled
`AGENTS.md` from a committed token template (`AGENTS.template.md`). Confirm per-tool import
support before committing to the import approach.

---

## Target repository tree (front-door reframe)

```
ai-os/                                    [REPO ROOT = the shareable personal OS]
├── README.md            [SHARED]  identity landing page
├── AGENTS.md            [SHARED]  CANONICAL operating manual (structure + @context imports, zero data)
├── CLAUDE.md            [SHARED]  thin shim → `@AGENTS.md` (Claude reads this; others read AGENTS.md)
├── SETUP.md             [SHARED]  clone → open Claude Code → /onboard (no Node needed)
├── LICENSE
├── .gitignore           [SHARED]  ignores context/ decisions/ brain/ projects/ engine build
│
├── context/            [PERSONAL — gitignored]  about-me / how-i-work / values / current-focus
│   └── .gitkeep        [SHARED]
├── references/         [SHARED]  alive-os-framework.md, quick-reference.md, getting-started.md
├── decisions/          [PERSONAL — gitignored]  log.md (+ .gitkeep committed)
├── .claude/
│   ├── settings.json   [PERSONAL — gitignored]
│   └── skills/         [SHARED]  onboard/ audit/ level-up/  (each a SKILL.md)
│
├── brain/              [PERSONAL — gitignored entirely]  memory.jsonl, memory-log.md, sessions/
├── projects/           [PERSONAL — gitignored]  per-project encapsulation (or external repos)
│
└── engine/             [SHARED — the publishable npm package `ai-os`]
    ├── package.json (bin → ./bundle/generate.js)
    ├── src/  bundle/  scripts/  docs/  examples/  skill-creator/
    └── tsconfig.json  vitest.config.ts  eslint.config.mjs
```

### Migration map (current → new)
- `src/`, `bundle/`, `scripts/`, `docs/`, `examples/`, `skill-creator/`, build configs,
  `Dockerfile`, `bootstrap.sh`, `install.sh`, `CHANGELOG.md` → **`engine/…`** (verbatim).
- `README.md` (root) → **replaced** with personal-OS identity; old content → `engine/README.md`.
- `LICENSE` stays at root (MIT covers both layers).
- **New** at root: `AGENTS.md` (canonical), `CLAUDE.md` (shim → `@AGENTS.md`), `SETUP.md`, `references/*`, `.claude/skills/{onboard,audit,level-up}/SKILL.md`, `context/.gitkeep`, `decisions/.gitkeep`, root `.gitignore`.

### Backward-compat (critical)
`npx github:<user>/ai-os` resolves `bin` from the **root** `package.json`. After the move,
keep a minimal root `package.json`:
`{"name":"ai-os","version":"0.24.x","bin":{"ai-os":"./engine/bundle/generate.js"}}`.
The full package (devDeps, scripts) lives in `engine/`; `npm publish` runs from `engine/`.
Release automation must be updated accordingly. **Resolve in Phase 0 before any release.**

---

## The rituals (Claude Code skills, engine- and boundary-aware)

**`/onboard`** (one-time) — 8 steps: capture identity / working-style / values / current-focus
into `context/*`; initialize `brain/`; check `node --version`; for each project with code,
optionally run `npx ai-os --init --cwd projects/<name>`; personalize `CLAUDE.md`.
*Engine-aware:* engine steps gated behind a Node check with a graceful "engine not available"
fallback. *Boundary-aware:* steps 1–5 write only to the personal layer; project init writes
only inside the project.

**`/audit`** (weekly) — read-only health report: personal-layer freshness; **boundary audit**
(`npx ai-os --check-boundaries`); per-project `--check-freshness --json` and `--check-drift`
when the engine is present; memory hygiene; decision-log nudge. Reports leaks, never
auto-fixes (preserves auditability).

**`/level-up`** (biweekly) — grow the OS: update `context/*`; **promotion interview** per
project; **sanitized promotion** (`promote_to_brain`) with explicit confirmation + secret-pattern
warnings, appended to `brain/memory.jsonl` and logged to `brain/memory-log.md`; optional
`--compact-memory`; evolve `CLAUDE.md`; capture decisions.

These ritual skills are **static, committed files** at the OS root — *not* engine-generated.
The engine's `generateSkills()` continues to generate stack-specific *project* skills into
`projects/<name>/.github/…`. Different scope, no overlap.

### Compounding over time (the growth loop)

The OS is designed to **get richer the more it's used** — `/onboard` only *seeds* it; it
keeps learning afterward. This is the operational meaning of the **Alive** property.

```
/onboard  ── seeds context: who you are, what you do, how you work, current focus
   │
   ▼
day-to-day use  ── you work with the OS; it accumulates raw signal (sessions, decisions)
   │
   ▼
/level-up (periodic) ── re-interview: "what changed?" → updates context/*, promotes learnings
   │                     to brain/ (sanitized), evolves AGENTS.md
   ▼
/audit (periodic) ── reports staleness/drift/gaps → tells you WHAT to update next
   └────────────────────────────────────────────────────────────► loops back
```

- **`/onboard`** captures the seed identity ("who are you / what you do / how you work")
  but is explicitly framed as a *starting point*, not a one-time form.
- **`/level-up`** is the recurring re-interview that grows the OS: it asks *what changed*,
  rewrites the relevant `context/*` files, and promotes durable learnings into `brain/`.
- **`/audit`** detects when context has gone stale (e.g. `current-focus.md` > 14 days old) and
  *prompts* the next round of updates — so the loop is self-driving, not reliant on memory.
- **Ambient capture (decided):** beyond the rituals, the OS *passively notices* candidate
  facts during normal use (e.g. "you mentioned you switched to X — add to your profile?") and
  **queues them for one-tap confirmation** at the next `/level-up`. Nothing is stored until
  you confirm — expansion is continuous but never silent.

All growth respects the three-domain boundary: project-derived learnings only reach the
personal brain via the sanitized, audited promotion gate.

#### Ambient-capture mechanism

- **Candidate queue:** a pending-suggestions store (e.g. `brain/candidates.jsonl`,
  gitignored) holding unconfirmed observations, each tagged with its source domain
  (`personal` vs `project`) and the text that triggered it.
- **`suggest_profile_update` MCP tool** (new, in the engine): lets the assistant *propose* a
  candidate during a session. It only **appends to the queue** — it can never write directly
  to `context/*` or `brain/` (write authority stays with the confirmation gate). Project-domain
  candidates additionally carry an unresolved sanitization flag.
- **Confirmation at `/level-up`:** the ritual surfaces queued candidates, the user confirms /
  edits / rejects each, and only confirmed items are written (personal → `context/*` or
  `brain/`; project-derived → the sanitized promotion gate). Rejections are dropped from the queue.
- **Boundary safety:** because the tool only queues and the confirmation step enforces
  sanitization, ambient capture cannot leak company data — it can only *suggest*, never *store*.

---

## Encapsulation & promotion enforcement (engine changes)

- **`engine/src/types.ts`** — add `type MemoryDomain = 'project'|'personal'|'shared'`;
  add `personalBrainPath?` and `projectBoundary?: 'strict'|'permissive'` (default `strict`) to `AiOsConfig`.
- **`engine/src/mcp-server/memory.ts`** — extend `RepoMemoryEntry` with optional `domain`,
  defaulting to `'project'` in canonicalization. Leave `rememberRepoFact()` project-scoped.
- **`engine/src/mcp-server/sanitize.ts`** (new) — `detectSecretPatterns()` flags AWS keys,
  generic API keys, connection strings with creds, `.env`-style values (warns, does not block).
- **`engine/src/mcp-server/promotion.ts`** (new) — `promote_to_brain` handler: refuses unless
  `sanitized_confirmed === true`; runs the secret scan (warn); resolves the brain path from
  `AI_OS_PERSONAL_ROOT` / config; appends to `brain/memory.jsonl` via existing `writeTextAtomic()`;
  writes an audit line to `brain/memory-log.md`.
- **`engine/src/mcp-tools.ts` + `sdk-server.ts`** — register the `promote_to_brain` tool.
- **`engine/src/mcp-server/shared.ts`** — add `getPersonalBrainPath()` reading `AI_OS_PERSONAL_ROOT`.
- **`engine/src/actions/apply.ts`** — no cross-domain writes exist today (all paths are
  `path.join(cwd, …)`); document the invariant. Extend `ensureGitignoreEntry()` to ignore
  `brain/`/`context/` when running in a personal-OS root.
- **New action `--check-boundaries`** (`engine/src/actions/check-boundaries.ts` + args/dispatch)
  — scan a project's memory for non-`project` entries and verify required `.gitignore` rules.

**Engine integration contract:** rituals call `npx ai-os <flags>` (e.g. `--init`,
`--check-freshness --json`, `--check-drift`, `--compact-memory`, `--check-boundaries`,
`--refresh-existing`) with `--cwd <project>`. Every engine call is gated by a `node --version`
check; absent Node, the skill prints what was skipped and the manual command to run later.

---

## Deployment topology (optional, on top of local-first)

The local-first clone-and-go design is unchanged; a **personal server** is an *optional*
deployment that strengthens the **Sovereign** pillar (your hardware, your data, no cloud
vendor). Three levels, increasing ambition:

| Level | What runs on the server | Effort | Notes |
|---|---|---|---|
| **1 — Remote brain** | the existing zero-dep `engine/bundle/server.js` MCP server | Low (~80% exists) | Clients (Claude Code on any device) connect over MCP remote transport; `brain/`, memory, `context/` live server-side, always-on |
| **2 — Hosted workspace** | Claude Code headless (Agent SDK / scheduled runs) | Medium | Trigger remotely via chat UI / webhook / phone without your laptop on |
| **3 — Autonomous cadence** | scheduled/event-driven agent routines | High | The AIS-OS "Cadence" pillar — observes an event, produces output while you're away; needs kill switches + budget caps |

**Hard requirements once network-reachable:**
- **Auth + TLS** on the MCP/agent endpoint (no open brain).
- **Stricter Bounded model:** project/company instances should stay **off** any shared server,
  or be encrypted-at-rest and access-scoped — the earlier IP/NDA concern intensifies here.
- **API key + budget controls** for server-side autonomous runs (Levels 2–3 consume tokens).
- Server deployment is a **separate, later track** (post the 7 core phases) — it does not block
  the local-first OS.

- **Phase 0 — Structural setup:** create `engine/`, move source in, fix relative configs,
  add minimal root `package.json` for `bin` backward-compat, **all 642 tests green from `engine/`.**
- **Phase 1 — Root identity (SHARED):** new root `README.md`, `SETUP.md`, `references/*`,
  `CLAUDE.md` template, `context/.gitkeep`, `decisions/.gitkeep`, root `.gitignore`.
- **Phase 2 — Ritual skills (SHARED):** author `/onboard`, `/audit`, `/level-up` SKILL.md;
  manual end-to-end test in Claude Code.
- **Phase 3 — Three-domain model (engine):** `MemoryDomain`, `domain` on entries, `sanitize.ts`,
  `promotion.ts`, `promote_to_brain` registration, config keys + `AI_OS_PERSONAL_ROOT`; new
  tests `promotion.test.ts`, `sanitize.test.ts`.
- **Phase 4 — Personal brain + boundaries (engine):** `--personal-brain-path`,
  `getPersonalBrainPath()`, `--check-boundaries` action; tests `check-boundaries.test.ts`,
  `personal-brain.test.ts`; wire `/audit` to call it.
- **Phase 4b — Ambient capture:** `brain/candidates.jsonl` queue + `suggest_profile_update`
  MCP tool (append-only, domain-tagged); extend `/level-up` (Phase 2 skill) to surface and
  confirm queued candidates through the existing write/promotion gates; tests for queue append
  and "queue never writes directly to context/ or brain/".
- **Phase 5 — Init wizard:** "personal OS project?" question → `projectBoundary:'strict'` +
  `personalBrainPath`; persist in `config.json`; CLAUDE.md "Active Projects" / "Engine Status".
- **Phase 6 — Packaging/publish:** `engine/package.json` `files`, publish-from-`engine/`,
  update CI + release automation for the subtree.
- **Phase 7 — Docs:** update `engine/docs/architecture.md`, `engine/README.md`,
  `engine/docs/mcp-tools.md` (`promote_to_brain`), `references/getting-started.md`.

**Test migration:** content unchanged; verify `resolveTemplatesDir()` (URL-relative) and any
`__dirname`/`examples/`-relative paths after the move (Phase 0 gate).

---

## Risks & open questions

1. **Branding collision** with AIS-OS ("AI OS" vs "AIS-OS"). Mitigate: README states this is
   `ai-os` (engine) + a userland layer, distinct from `nateherkai/AIS-OS`; avoid its named concepts.
2. **Two audiences, one repo.** Root README's only job is the personal-OS identity + `/onboard`;
   developers reach `engine/README.md` via one link.
3. **Backward-compat for `npx` users** — root `bin` stub (see Migration). Highest-priority Phase 0 item.
4. **Framework name** "Alive · Bounded · Sovereign" — proposed, open to change.
5. **Root vs project instruction files** — both the personal-OS root and each project carry
   their own `AGENTS.md` (+ `CLAUDE.md` shim) with different purposes; the root file states the
   distinction explicitly.
6. **`/onboard` must not commit** the `context/`/`brain/` files it creates — skill copy says so
   (folders are gitignored regardless).
7. **GitHub repo owner/name** for `npx github:<user>/ai-os` must be confirmed before release.

---

## Open decisions to confirm before implementation
- Final framework name (keep "Alive · Bounded · Sovereign"?).
- Keep the product name `ai-os`, or rename to reduce AIS-OS confusion?
- `projects/` as in-repo subfolders vs. pointing at external project repos (or both)?
- Whether Phase 0 ships alone first (pure refactor, no behavior change) as a safety checkpoint.
- ~~Growth/capture mode~~ — **DECIDED: ambient capture** (queue + confirm at `/level-up`;
  new `suggest_profile_update` MCP tool that only appends to the candidate queue).
- **Gemini support:** ship a `GEMINI.md` shim alongside `CLAUDE.md`, or AGENTS.md + Claude only for now?
- **Data-free `AGENTS.md`:** `@context/*` imports vs. `/onboard`-generated filled file from a
  committed token template — pending per-tool import-support validation.
- **Server deployment target:** local-only, Level 1 (remote brain), Level 2 (hosted workspace),
  or Level 3 (autonomous cadence)? Determines whether an auth'd MCP transport + deployment track
  is in scope. Default: ship local-first first, treat server as a later track.
