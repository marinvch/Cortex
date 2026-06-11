# Personal AI OS (Cortex) Fusion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fuse the `ai-os` engine (the kernel) with an AIS-OS-grade, clone-and-go userland branded **Cortex**, kept alive by the engine when a codebase is present — without breaking the existing 642-test engine or `npx` distribution.

**Architecture:** A "front-door reframe" — the existing engine source moves verbatim into a bounded `engine/` subtree, the repo root becomes the shareable Cortex userland (identity + ritual skills + canonical `AGENTS.md`), and the engine gains a three-domain data model (`project | personal | shared`) with a sanitized, audited `project → personal` promotion gate plus ambient capture. A minimal root `package.json` keeps `npx github:<user>/ai-os` working by pointing `bin` at `./engine/bundle/generate.js`.

**Tech Stack:** TypeScript (ES2022, NodeNext), Node ≥20, Vitest, ESLint (typescript-eslint), `@modelcontextprotocol/sdk`, `zod`, esbuild bundling. Userland layer is plain Markdown (no build).

**Decisions locked (2026-06-11):**
- Scope: **one full plan, all phases** (Phase 0 → 7).
- Userland product name: **Cortex** (npm engine package stays `ai-os`).
- Framework name: **Alive · Bounded · Sovereign** (kept).
- Instruction files: canonical `AGENTS.md` + thin `CLAUDE.md` **and** `GEMINI.md` shims.
- Server deployment (Levels 1–3): **out of scope** for this plan (later track).

**Source spec:** `docs/superpowers/specs/2026-06-10-personal-ai-os-fusion-design.md`

---

## File Structure (decomposition map)

### New files at repo root (SHARED userland — Phases 1–2)
| File | Responsibility |
|---|---|
| `README.md` (replaced) | Cortex identity landing page; one link to `engine/README.md` |
| `AGENTS.md` | Canonical operating manual (structure + `@context` imports, zero data) |
| `CLAUDE.md` | Thin shim → `@AGENTS.md` |
| `GEMINI.md` | Thin shim → `@AGENTS.md` |
| `SETUP.md` | clone → open Claude Code → `/onboard` |
| `.gitignore` (root) | Ignore `context/`, `decisions/`, `brain/`, `projects/`, engine build artifacts |
| `references/alive-os-framework.md` | Deep framework doc (Alive · Bounded · Sovereign) |
| `references/quick-reference.md` | Cheat sheet |
| `references/getting-started.md` | First-run walkthrough |
| `context/.gitkeep` | Personal layer placeholder (folder gitignored) |
| `decisions/.gitkeep` | Decision-log placeholder (folder gitignored) |
| `.claude/skills/onboard/SKILL.md` | `/onboard` ritual |
| `.claude/skills/audit/SKILL.md` | `/audit` ritual |
| `.claude/skills/level-up/SKILL.md` | `/level-up` ritual |

### Moved (Phase 0): `src/ bundle/ scripts/ docs/ examples/ skill-creator/ analyze/`, build configs, `Dockerfile`, `bootstrap.sh`, `install.sh`, `CHANGELOG.md`, old `README.md` → `engine/…` verbatim.

### Engine files created/modified (Phases 3–5)
| File | Responsibility |
|---|---|
| `engine/src/types.ts` (mod) | `MemoryDomain`; `personalBrainPath?`, `projectBoundary?` on `AiOsConfig` |
| `engine/src/mcp-server/memory.ts` (mod) | `domain?` on `RepoMemoryEntry`, canonicalized default `'project'` |
| `engine/src/mcp-server/shared.ts` (mod) | `getPersonalBrainPath()` from `AI_OS_PERSONAL_ROOT` |
| `engine/src/mcp-server/sanitize.ts` (new) | `detectSecretPatterns()` — warn-only secret scan |
| `engine/src/mcp-server/promotion.ts` (new) | `promoteToBrain()` handler (sanitized, audited) |
| `engine/src/mcp-server/candidates.ts` (new) | Ambient-capture queue append/read (`candidates.jsonl`) |
| `engine/src/mcp-tools.ts` (mod) | Register `promote_to_brain`, `suggest_profile_update` defs |
| `engine/src/mcp-server/sdk-server.ts` (mod) | Wire handlers for the two new tools |
| `engine/src/actions/check-boundaries.ts` (new) | `--check-boundaries` action |
| `engine/src/cli/args.ts` (mod) | Parse `--check-boundaries`, `--personal-brain-path` |
| `engine/src/cli/dispatch.ts` (mod) | Route `check-boundaries` |
| `engine/src/actions/apply.ts` (mod) | Personal-root gitignore entries; document invariant |
| `engine/src/actions/init.ts` (mod) | "Personal OS project?" wizard question |
| `engine/src/generators/context-docs.ts` (mod) | Persist `personalBrainPath`/`projectBoundary` |
| `engine/src/generators/multi-model.ts` (mod) | Emit canonical `AGENTS.md` + thin shims |

### Engine tests (new)
`engine/src/tests/sanitize.test.ts`, `promotion.test.ts`, `check-boundaries.test.ts`, `personal-brain.test.ts`, `candidates.test.ts`, plus additions to `init` and `multi-model` tests.

---

## Phase 0 — Structural refactor (pure move, zero behavior change)

**Goal of phase:** All current source under `engine/`, all 642 tests green from `engine/`, `npx` still resolves `bin`. No behavior change.

> ⚠️ This is the highest-risk, highest-value phase. Do it first and in isolation. Commit only when tests are green.

### Task 0.1: Snapshot the current green baseline

**Files:** none (verification only)

- [ ] **Step 1: Confirm tests pass before moving anything**

Run: `npm test`
Expected: all tests pass (the v0.24.0 baseline — ~642 tests). Record the exact pass count from the summary line for later comparison.

- [ ] **Step 2: Confirm the bundle builds**

Run: `npm run build && npm run bundle`
Expected: exits 0; `bundle/generate.js` and `bundle/server.js` exist.

- [ ] **Step 3: Record current bin resolution**

Run: `node -e "console.log(require('./package.json').bin)"`
Expected: `{ 'ai-os': './bundle/generate.js' }`. Note this — Task 0.4 must preserve an equivalent path.

### Task 0.2: Move source tree into `engine/` with git history preserved

**Files:**
- Move: `src/ bundle/ scripts/ docs/ examples/ skill-creator/ analyze/ dist/ coverage/` → `engine/…`
  - (Do **not** move `docs/superpowers/` — plans/specs stay at repo root. See Step 2.)
- Move: `tsconfig.json vitest.config.ts eslint.config.mjs Dockerfile bootstrap.sh install.sh CHANGELOG.md skills-lock.json .env.example .mcp.json` → `engine/…`
- Move: `package.json package-lock.json` → `engine/…` (root gets a new stub in Task 0.4)
- Move: `README.md` → `engine/README.md`

- [ ] **Step 1: Create the engine directory**

```bash
mkdir engine
```

- [ ] **Step 2: Move the engine subtree with `git mv` (preserves history)**

> `docs/` contains both engine docs and `docs/superpowers/{specs,plans}`. Move engine docs but keep `docs/superpowers/` at root. Easiest: move everything, then move `superpowers/` back.

```bash
git mv src bundle scripts examples skill-creator analyze engine/
git mv tsconfig.json vitest.config.ts eslint.config.mjs engine/
git mv Dockerfile bootstrap.sh install.sh CHANGELOG.md skills-lock.json engine/
git mv .env.example .mcp.json engine/
git mv package.json package-lock.json engine/
git mv README.md engine/README.md
git mv docs engine/docs
# Keep superpowers specs/plans at repo root:
mkdir -p docs
git mv engine/docs/superpowers docs/superpowers
```

> `dist/` and `coverage/` are build outputs (gitignored). Do not `git mv` them; delete and let them regenerate:
```bash
rm -rf dist coverage node_modules
```

- [ ] **Step 3: Verify the tree**

Run: `ls engine && echo "---" && ls`
Expected: `engine/` contains `src bundle scripts docs examples skill-creator analyze package.json tsconfig.json vitest.config.ts eslint.config.mjs …`. Repo root no longer has `src/`; root still has `docs/superpowers/`, `.git/`, `.github/`, `.claude/`, `node_modules` removed.

### Task 0.3: Fix engine build configs after the move

**Files:**
- Modify: `engine/tsconfig.json` (no change needed — paths are relative to its own location)
- Modify: `engine/vitest.config.ts` (no change — relative)
- Modify: `engine/eslint.config.mjs` (no change — relative)
- Verify: `engine/src/generators/utils.ts` `resolveTemplatesDir()` still resolves

- [ ] **Step 1: Reinstall dependencies inside `engine/`**

```bash
cd engine && npm install
```
Expected: `node_modules/` created under `engine/`; lockfile unchanged.

- [ ] **Step 2: Build from engine/**

Run (from `engine/`): `npm run build`
Expected: exits 0, `engine/dist/` produced. tsconfig `rootDir: ./src` and `include: src/**/*` are already relative, so no edits expected. If `tsc` errors on missing files, the move missed a path — fix the move, not the config.

- [ ] **Step 3: Verify template + examples path resolution survives the move**

`resolveTemplatesDir()` (`engine/src/generators/utils.ts`) tries candidates relative to its runtime dir; `engine/src/templates/` is now `../templates` from `engine/src/generators/` — already covered by the existing candidate list. `engine/src/tests/examples.test.ts` resolves `path.resolve(__dirname, '..', '..', 'examples')` → from `engine/src/tests/` that is `engine/examples/` ✓ (examples moved with src).

Run (from `engine/`): `npm test`
Expected: same pass count as Task 0.1 Step 1. If `examples.test.ts` or any template test fails with ENOENT, the relative traversal is off — fix the test's path constant, not the move.

- [ ] **Step 4: Rebuild the bundle from engine/**

Run (from `engine/`): `npm run bundle`
Expected: exits 0; `engine/bundle/generate.js` and `engine/bundle/server.js` exist.

### Task 0.4: Add minimal root `package.json` for `npx`/`bin` backward-compat

**Files:**
- Create: `package.json` (root)

- [ ] **Step 1: Write the root stub**

Create `package.json` at repo root:
```json
{
  "name": "ai-os",
  "version": "0.24.0",
  "description": "Cortex — a personal AI OS. Engine package lives in ./engine.",
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "bin": { "ai-os": "./engine/bundle/generate.js" },
  "files": ["engine/bundle", "engine/src/templates", "engine/README.md"]
}
```

> Keep `version` in lockstep with `engine/package.json`. Phase 6 wires release automation so both bump together.

- [ ] **Step 2: Verify bin resolves to the moved bundle**

Run: `node -e "console.log(require('./package.json').bin)"`
Expected: `{ 'ai-os': './engine/bundle/generate.js' }`.

- [ ] **Step 3: Smoke-test the CLI entrypoint end-to-end**

Run: `node ./engine/bundle/generate.js --help`
Expected: the CLI help text prints (the same as before the move). If it errors on a missing template/relative path, fix `resolveTemplatesDir()` candidates in `engine/src/generators/utils.ts` to include the bundle-relative `../src/templates` form and re-bundle.

### Task 0.5: Root `.gitignore` for personal layers + engine build outputs

**Files:**
- Create/Modify: `.gitignore` (root)

- [ ] **Step 1: Write root `.gitignore`**

Create `.gitignore` at repo root (this is the SHARED ignore contract — personal layers never get committed):
```gitignore
# ── Cortex personal layers (never committed) ───────────────────────────
context/
decisions/
brain/
projects/

# Keep folder placeholders tracked
!context/.gitkeep
!decisions/.gitkeep

# ── Engine build artifacts ─────────────────────────────────────────────
node_modules/
engine/node_modules/
engine/dist/
engine/coverage/
engine/bundle/generate.js
engine/bundle/server.js

# ── Local tool state ───────────────────────────────────────────────────
.env
.env.local
```

> Note: `engine/bundle/*.js` are build outputs. If the project currently commits the bundle (check `git ls-files engine/bundle`), keep that behavior instead — do not start ignoring a tracked artifact. Verify in Step 2.

- [ ] **Step 2: Verify ignore status is sane**

Run: `git status --short && git check-ignore -v context/ brain/ projects/ 2>&1 | head`
Expected: `context/`, `brain/`, `projects/` are ignored; `.gitkeep` files (created in Phase 1) will be force-tracked. Confirm no currently-tracked engine source got newly ignored: `git ls-files engine/bundle` should still list whatever was tracked before.

### Task 0.6: Commit Phase 0

- [ ] **Step 1: Stage and verify the move is recorded as renames**

Run: `git add -A && git status`
Expected: changes show as renames `src/… → engine/src/…` (history preserved), new root `package.json`, new root `.gitignore`, `README.md → engine/README.md`.

- [ ] **Step 2: Full verification before commit**

Run (from `engine/`): `npm run ci`
Expected: typecheck + lint + tests all green, same test count as baseline. (Per superpowers:verification-before-completion — do not commit on assumption; paste the passing summary.)

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: move engine into engine/ subtree; root becomes Cortex userland shell

Pure structural move (front-door reframe). Root package.json keeps npx/bin
backward-compat by pointing at ./engine/bundle/generate.js. No behavior change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 — Root identity (SHARED, no build)

**Goal of phase:** A clone-and-go Cortex userland: identity README, SETUP, framework references, instruction shims, gitkeeps. All static Markdown, zero personal data.

### Task 1.1: Framework reference docs

**Files:**
- Create: `references/alive-os-framework.md`
- Create: `references/quick-reference.md`
- Create: `references/getting-started.md`

- [ ] **Step 1: Write `references/alive-os-framework.md`**

```markdown
# The Cortex Framework: Alive · Bounded · Sovereign

Cortex is a personal AI OS. Three properties define it.

## Alive — the OS maintains itself
When a codebase is present, the `ai-os` engine re-scans your code, refreshes context,
reconciles memory, and flags drift. Cortex is not a static folder of notes; the rituals
call the engine to keep it current. Backed by: `rememberRepoFact()`, memory compaction,
freshness snapshots, `--check-drift`, `--compact-memory`.

## Bounded — nothing crosses a boundary without your consent
Cortex enforces a three-domain data model:

| Domain   | What lives there                              | Movement rule |
|----------|-----------------------------------------------|---------------|
| shared   | structure, framework, skills — ZERO real data | the only thing published |
| personal | your brain: your context + memory             | private, gitignored |
| project  | company/client data, encapsulated in its repo | never absorbed upward |

A fact can move in exactly ONE direction — `project → personal` — and only via an
explicit, audited, sanitized promotion. Never `project → shared`. Never `personal → project`.

## Sovereign — you own the whole stack
Plain files. MIT. Forkable. No cloud lock-in. Your hardware, your data.

See `quick-reference.md` for the cheat sheet and `getting-started.md` for first steps.
```

- [ ] **Step 2: Write `references/quick-reference.md`**

```markdown
# Cortex Quick Reference

## The three pillars
- **Alive** — the OS maintains itself (engine-backed).
- **Bounded** — nothing crosses a boundary without consent (three-domain model).
- **Sovereign** — you own the whole stack (local, forkable, MIT).

## The three rituals
| Ritual      | Cadence  | Does |
|-------------|----------|------|
| `/onboard`  | once     | Seed identity into `context/*`; init `brain/`; optionally init projects. |
| `/audit`    | weekly   | Read-only health + boundary report. Never auto-fixes. |
| `/level-up` | biweekly | Re-interview, promote learnings (sanitized), evolve `AGENTS.md`. |

## The data boundary (memorize this)
`project → personal` ONLY, and only via sanitized promotion.
Never `project → shared`. Never `personal → project`.

## Folders
- `context/` — who you are / how you work / values / current focus (gitignored)
- `brain/` — memory.jsonl, memory-log.md, sessions/ (gitignored)
- `projects/` — per-project encapsulation (gitignored)
- `references/` — this framework (shared, committed)
- `engine/` — the `ai-os` kernel (shared, committed)
```

- [ ] **Step 3: Write `references/getting-started.md`**

```markdown
# Getting Started with Cortex

1. **Clone** this repo and open it in Claude Code.
2. **Run `/onboard`** — it interviews you and seeds `context/*`. No Node required for the
   personal layer; engine steps are skipped gracefully if Node is absent.
3. **Work day-to-day.** Cortex passively notices candidate facts and queues them.
4. **Run `/audit` weekly** — a read-only health and boundary report.
5. **Run `/level-up` biweekly** — confirm queued candidates, promote durable learnings.

If you have code projects, point Cortex at them under `projects/` (or keep them as external
repos). When Node + a codebase are present, the engine lights up: `npx ai-os --init` inside a
project wires its `.github/ai-os/` context.

Your personal data (`context/`, `brain/`, `decisions/`, `projects/`) is gitignored and never
published. Only the shared template (structure, framework, skills) is.
```

- [ ] **Step 4: Commit**

```bash
git add references/
git commit -m "docs(cortex): add Alive/Bounded/Sovereign framework references"
```

### Task 1.2: Canonical `AGENTS.md` + thin `CLAUDE.md`/`GEMINI.md` shims (root)

**Files:**
- Create: `AGENTS.md`
- Create: `CLAUDE.md`
- Create: `GEMINI.md`

> **Import-support decision:** The spec leaves open whether `@context/*` imports resolve across all tools. Decision for this plan: the **committed root `AGENTS.md` carries ZERO personal data** and references the personal context via a documented convention; `/onboard` (Phase 2) writes the actual personal context into gitignored `context/*.md`. Claude Code resolves `@imports`; for non-Claude tools the personal context is referenced as a relative path the agent reads on demand. We do **not** rely on non-Claude import resolution for correctness — the personal facts are additive context, not required structure.

- [ ] **Step 1: Write canonical `AGENTS.md` (zero personal data)**

```markdown
# Cortex — Operating Manual (canonical, cross-tool)

This is the single source of truth for AI agents working in this personal AI OS.
Claude Code reads `CLAUDE.md` (a shim importing this file); Gemini reads `GEMINI.md`
(same). Codex / Copilot / Cursor / Windsurf / Amp / Devin read this file natively.

## What this repo is
Cortex: a personal AI OS. The repo root is the shareable userland; `engine/` is the
`ai-os` kernel (an npm package) that lights up when a codebase + Node are present.

## The three pillars
Alive (self-maintaining via the engine) · Bounded (three-domain data model) ·
Sovereign (you own the stack). Full text: `references/alive-os-framework.md`.

## The data boundary — NON-NEGOTIABLE
- `shared` = committed template files + `engine/src/templates/` — ZERO real data.
- `personal` = `context/`, `brain/`, `decisions/` — gitignored, private.
- `project` = anything under a project's `.github/ai-os/` — encapsulated in that repo.
- A fact moves ONLY `project → personal`, ONLY via the sanitized `promote_to_brain` gate.
- NEVER write project/company data into `shared` or into `context/`/`brain/` directly.

## Personal context (gitignored; created by /onboard)
When present, read these for who the user is and how they work:
`context/about-me.md`, `context/how-i-work.md`, `context/values.md`, `context/current-focus.md`.
If they do not exist yet, the OS has not been onboarded — suggest running `/onboard`.

## The rituals (Claude Code skills)
- `/onboard` (once) — seed identity, init `brain/`, optionally init code projects.
- `/audit` (weekly) — read-only health + boundary report.
- `/level-up` (biweekly) — re-interview, sanitized promotion, evolve this manual.

## Engine integration (only when Node + code present)
Rituals call `npx ai-os <flags> --cwd <project>`: `--init`, `--check-freshness --json`,
`--check-drift`, `--compact-memory`, `--check-boundaries`, `--refresh-existing`.
Every engine call is gated by a `node --version` check; if Node is absent, skip and print
the manual command. Engine docs: `engine/README.md`, `engine/docs/`.

## Style
Plain files. No build for the personal layer. Match existing file conventions. Keep the
shared template data-free.
```

- [ ] **Step 2: Write `CLAUDE.md` shim**

```markdown
@AGENTS.md
```

- [ ] **Step 3: Write `GEMINI.md` shim**

```markdown
@AGENTS.md
```

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md CLAUDE.md GEMINI.md
git commit -m "docs(cortex): canonical AGENTS.md + thin CLAUDE.md/GEMINI.md shims"
```

### Task 1.3: Root `README.md` (Cortex identity) + `SETUP.md`

**Files:**
- Create: `README.md` (root — the old one is now `engine/README.md`)
- Create: `SETUP.md`

- [ ] **Step 1: Write the Cortex `README.md`**

```markdown
# Cortex — your personal AI brain

Cortex is a personal AI operating system. Clone it, open it in Claude Code, run `/onboard`.
It learns who you are and how you work, then **keeps itself alive** — when you point it at
code, the `ai-os` engine re-scans, refreshes context, and reconciles memory for you.

> Not affiliated with `nateherkai/AIS-OS`. Cortex is the `ai-os` engine (kernel) plus a
> clone-and-go userland.

## Why Cortex
- **Alive** — it maintains itself (engine-backed), not a static folder of notes.
- **Bounded** — a strict three-domain data model; company/client data never leaks upward.
- **Sovereign** — plain files, MIT, forkable, no cloud lock-in.

## Quick start
1. Clone and open in Claude Code.
2. Run `/onboard`. (No Node needed for the personal layer.)
3. Use `/audit` weekly and `/level-up` biweekly to grow it.

See `SETUP.md` to begin and `references/getting-started.md` for the walkthrough.

## For developers
The kernel is a TypeScript engine that scans any repo and generates AI-context artifacts.
Its full docs and source live in [`engine/`](./engine/README.md).

## License
MIT — covers both the userland and the engine.
```

- [ ] **Step 2: Write `SETUP.md`**

```markdown
# Setup

## Requirements
- **Personal layer:** none. Just Claude Code (or any AGENTS.md-aware agent).
- **Engine (optional):** Node ≥ 20, for when you point Cortex at code.

## Steps
1. **Clone** this repo:
   ```bash
   git clone https://github.com/<user>/ai-os.git cortex && cd cortex
   ```
2. **Open in Claude Code.**
3. **Run `/onboard`.** It interviews you and writes `context/*` (gitignored — never committed).
4. **(Optional) Enable the engine** for a code project:
   ```bash
   npx ai-os --init --cwd projects/<name>
   ```

## What gets created
- `context/` — your identity (gitignored)
- `brain/` — your memory (gitignored)
- `decisions/` — your decision log (gitignored)

None of these are ever committed or published. Only the shared template is.
```

- [ ] **Step 3: Commit**

```bash
git add README.md SETUP.md
git commit -m "docs(cortex): root README identity + SETUP"
```

### Task 1.4: Personal-layer placeholders

**Files:**
- Create: `context/.gitkeep`
- Create: `decisions/.gitkeep`

- [ ] **Step 1: Create the gitkeeps**

```bash
mkdir -p context decisions
printf '' > context/.gitkeep
printf '' > decisions/.gitkeep
```

- [ ] **Step 2: Force-add despite folder ignore, then verify**

Run: `git add -f context/.gitkeep decisions/.gitkeep && git status --short`
Expected: both `.gitkeep` files staged; the folders themselves remain ignored (so future `context/about-me.md` won't be tracked).

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(cortex): add gitkeep placeholders for gitignored personal folders"
```

---

## Phase 2 — Ritual skills (SHARED, static committed files)

**Goal of phase:** Author `/onboard`, `/audit`, `/level-up` as Claude Code SKILL.md files. Engine-aware (gated behind `node --version`) and boundary-aware. These are static — NOT engine-generated.

> These skills are authored by hand. Use superpowers:writing-skills conventions for SKILL.md frontmatter. After writing, the verification is a **manual end-to-end test in Claude Code** (documented at the end of the phase) — there is no unit test harness for skill prose.

### Task 2.1: `/onboard` skill

**Files:**
- Create: `.claude/skills/onboard/SKILL.md`

- [ ] **Step 1: Write the onboard SKILL.md**

```markdown
---
name: onboard
description: One-time Cortex onboarding — seeds your identity into context/, initializes brain/, and optionally lights up the engine for code projects. Use the first time you set up Cortex.
---

# /onboard — seed your personal AI OS

You are onboarding the user into Cortex. This is a **starting point**, not a one-time form —
`/level-up` will keep growing it. Be warm and brief. Write ONLY to the personal layer.

## Boundary rules (enforce strictly)
- Steps 1–5 write ONLY to `context/*` (personal). Never to `engine/` or any project.
- Project init (Step 7) writes ONLY inside that project's folder.
- Never commit `context/`, `brain/`, or `decisions/` — they are gitignored. Tell the user so.

## Steps
1. **Identity** — ask who they are (role, domain, experience). Write `context/about-me.md`.
2. **Working style** — how they like to work, tools, communication. Write `context/how-i-work.md`.
3. **Values** — what they optimize for, non-negotiables. Write `context/values.md`.
4. **Current focus** — what they're working on now (this file goes stale fast; `/audit`
   tracks its age). Write `context/current-focus.md`. Stamp today's date at the top.
5. **Confirm** the four files back to the user in one summary.
6. **Initialize `brain/`** — create `brain/` with empty `memory.jsonl`, a `memory-log.md`
   header, and `sessions/`. (These are gitignored.)
7. **Engine check + project init (gated):**
   - Run `node --version`. If it fails, print "Engine not available — skipping project
     setup. Install Node ≥20 and run `npx ai-os --init --cwd projects/<name>` later." and
     continue.
   - If Node is present, for each code project the user names, optionally run
     `npx ai-os --init --cwd projects/<name>` (writes only inside that project).
8. **Personalize `CLAUDE.md`** — leave the shim as `@AGENTS.md`; do NOT inline personal data
   into committed files. Confirm `context/*` exist so AGENTS.md's personal-context section resolves.

## Done
Tell the user: onboarding seeds the OS; `/audit` checks health weekly, `/level-up` grows it
biweekly. Remind them their personal files are gitignored and were not committed.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/onboard/SKILL.md
git commit -m "feat(cortex): /onboard ritual skill"
```

### Task 2.2: `/audit` skill

**Files:**
- Create: `.claude/skills/audit/SKILL.md`

- [ ] **Step 1: Write the audit SKILL.md**

```markdown
---
name: audit
description: Weekly read-only Cortex health report — personal-layer freshness, boundary audit, per-project drift/freshness when the engine is present, memory hygiene. Never auto-fixes.
---

# /audit — read-only health report

Produce a health report. **Never auto-fix** — auditability requires that you only report.

## Steps
1. **Personal-layer freshness** — check the mtime/date stamp of `context/current-focus.md`.
   If older than 14 days, flag: "current-focus is N days old — consider `/level-up`."
   Note any missing `context/*` file.
2. **Boundary audit (gated):** run `node --version`. If present, for each project run
   `npx ai-os --check-boundaries --cwd projects/<name>` and report any leaks (non-`project`
   memory entries, missing `.gitignore` rules). If Node is absent, print the skipped command.
3. **Per-project drift/freshness (gated):** when the engine is present, for each project run
   `npx ai-os --check-freshness --json --cwd projects/<name>` and `npx ai-os --check-drift
   --cwd projects/<name>`. Summarize status (fresh / drifted / stale).
4. **Memory hygiene:** report `brain/memory.jsonl` entry count and stale-entry count if the
   file exists; suggest `--compact-memory` (do not run it).
5. **Decision-log nudge:** if `decisions/log.md` hasn't been touched in 30+ days, nudge.

## Output
A single tidy report with sections for each step. End with a prioritized "what to update
next" list. Report leaks loudly; never modify anything.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/audit/SKILL.md
git commit -m "feat(cortex): /audit ritual skill"
```

### Task 2.3: `/level-up` skill (includes ambient-capture confirmation — depends on Phase 4b tool)

**Files:**
- Create: `.claude/skills/level-up/SKILL.md`

> This skill references the `suggest_profile_update` candidate queue (`brain/candidates.jsonl`)
> and the `promote_to_brain` gate, both delivered in Phases 3 & 4b. The skill prose is written
> now; the queue-surfacing step degrades gracefully if the file is absent (engine not yet run).

- [ ] **Step 1: Write the level-up SKILL.md**

```markdown
---
name: level-up
description: Biweekly Cortex growth ritual — re-interview what changed, surface queued ambient-capture candidates for confirmation, sanitized promotion of project learnings into brain/, evolve AGENTS.md.
---

# /level-up — grow your OS

Cortex gets richer the more it's used. This is the recurring re-interview. Respect the
data boundary: project-derived learnings reach `brain/` ONLY via sanitized promotion.

## Steps
1. **What changed?** Re-interview briefly. Update the relevant `context/*` files. Re-stamp
   `context/current-focus.md` with today's date.
2. **Surface ambient-capture candidates:** if `brain/candidates.jsonl` exists, read each
   queued candidate (each tagged with source domain `personal`/`project` + trigger text).
   For each: show it, let the user **confirm / edit / reject**.
   - Confirmed `personal` candidates → write to `context/*` or `brain/` (via the normal
     memory path).
   - Confirmed `project`-domain candidates → MUST go through the sanitized promotion gate
     (Step 3). Never write project-derived text directly into `context/`/`brain/`.
   - Rejected candidates → drop from the queue.
   - Nothing is stored until the user confirms.
3. **Promotion interview (per project, gated):** for each code project, ask what durable,
   non-sensitive learning is worth promoting. For each approved item call the
   `promote_to_brain` MCP tool with `sanitized_confirmed: true` ONLY after the user confirms
   the secret-pattern warnings. The tool appends to `brain/memory.jsonl` and logs to
   `brain/memory-log.md`. If the engine/MCP server isn't running, print the skipped action.
4. **Optional compaction:** offer `npx ai-os --compact-memory --cwd projects/<name>` (gated).
5. **Evolve `AGENTS.md`:** if structure/operating conventions changed, update the canonical
   `AGENTS.md` — but keep it DATA-FREE. Personal facts stay in `context/*`.
6. **Capture decisions:** append any decisions made to `decisions/log.md`.

## Boundary reminder
`project → personal` only, sanitized. Never `project → shared`. Never `personal → project`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/level-up/SKILL.md
git commit -m "feat(cortex): /level-up ritual skill"
```

### Task 2.4: Manual end-to-end verification of rituals

**Files:** none (manual test; record results in the PR description)

- [ ] **Step 1: Dry-run `/onboard` in Claude Code**

Open the repo in Claude Code, run `/onboard`, answer the prompts. Verify: four `context/*`
files created; `brain/` initialized; `git status` shows them **untracked/ignored** (NOT staged);
the Node-absent path prints a graceful skip if Node is removed from PATH.

- [ ] **Step 2: Dry-run `/audit`**

Run `/audit`. Verify it produces a read-only report and modifies nothing (`git status` clean
apart from anything you intentionally changed).

- [ ] **Step 3: Dry-run `/level-up`**

Run `/level-up`. Verify the candidate-queue step degrades gracefully when
`brain/candidates.jsonl` is absent, and that it never writes project text directly to `context/`.

- [ ] **Step 4: Record results**

Note pass/fail for each ritual in the eventual PR description (no code commit for this task).

---

## Phase 3 — Three-domain data model (engine)

**Goal of phase:** Add `MemoryDomain`, a `domain` field on memory entries (default `'project'`), a warn-only secret scanner, the `promote_to_brain` gate, and the `getPersonalBrainPath()` resolver — all under `engine/`, fully TDD'd.

> All paths below are under `engine/`. Run all commands from `engine/`.

### Task 3.1: `MemoryDomain` type + config fields

**Files:**
- Modify: `engine/src/types.ts` (after `InstallProfile`, ~line 92; `AiOsConfig` ~lines 95–188)

- [ ] **Step 1: Add the `MemoryDomain` type and config fields**

In `engine/src/types.ts`, add near `InstallProfile`:
```typescript
/** Which data domain a memory entry / config belongs to (encapsulation model). */
export type MemoryDomain = 'project' | 'personal' | 'shared';
```

Inside the `AiOsConfig` interface, add (after `editorTargets?`):
```typescript
  /** Absolute path to the personal brain root (personal-OS installs only). */
  personalBrainPath?: string;
  /** Cross-domain boundary strictness for this project (default: 'strict'). */
  projectBoundary?: 'strict' | 'permissive';
```

- [ ] **Step 2: Typecheck**

Run (from `engine/`): `npm run typecheck`
Expected: exits 0 (additive optional fields don't break existing code).

- [ ] **Step 3: Commit**

```bash
git add engine/src/types.ts
git commit -m "feat(engine): add MemoryDomain type and personalBrainPath/projectBoundary config"
```

### Task 3.2: `domain` field on `RepoMemoryEntry` (default `'project'`)

**Files:**
- Modify: `engine/src/mcp-server/memory.ts` (`RepoMemoryEntry` ~lines 18–31; `canonicalizeEntry` ~lines 132–165)
- Test: `engine/src/tests/memory-domain.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `engine/src/tests/memory-domain.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-domain-'));
  process.env['AI_OS_ROOT'] = tmp;
  fs.mkdirSync(path.join(tmp, '.github', 'ai-os', 'memory'), { recursive: true });
});
afterEach(() => {
  delete process.env['AI_OS_ROOT'];
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('memory entry domain', () => {
  it('defaults stored facts to the project domain', async () => {
    const { rememberRepoFact } = await import('../mcp-server/memory.js');
    rememberRepoFact('Uses pnpm', 'The project uses pnpm as its package manager.');
    const file = path.join(tmp, '.github', 'ai-os', 'memory', 'memory.jsonl');
    const line = fs.readFileSync(file, 'utf-8').trim().split('\n')[0];
    const entry = JSON.parse(line);
    expect(entry.domain).toBe('project');
  });
});
```

> Note: `memory.ts` reads `ROOT` from `AI_OS_ROOT` at import time via `shared.ts`. Use dynamic
> `import()` inside the test (after setting the env var) so the module picks up the temp root.
> If `shared.ts` caches `ROOT` as a module-level const, add `vi.resetModules()` in `beforeEach`
> and keep the dynamic import — verify by running the test.

- [ ] **Step 2: Run the test to verify it fails**

Run (from `engine/`): `npx vitest run src/tests/memory-domain.test.ts`
Expected: FAIL — `entry.domain` is `undefined`.

- [ ] **Step 3: Add `domain` to the type and canonicalization**

In `engine/src/mcp-server/memory.ts`, extend `RepoMemoryEntry` (add after `conflictWithId?`):
```typescript
  domain?: 'project' | 'personal' | 'shared';
```

In `canonicalizeEntry()`, add to the returned object (after `conflictWithId`):
```typescript
    domain: raw.domain === 'personal' || raw.domain === 'shared' ? raw.domain : 'project',
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `engine/`): `npx vitest run src/tests/memory-domain.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite (no regressions)**

Run (from `engine/`): `npm test`
Expected: baseline count + 1 new test, all green.

- [ ] **Step 6: Commit**

```bash
git add engine/src/mcp-server/memory.ts engine/src/tests/memory-domain.test.ts
git commit -m "feat(engine): add domain field to memory entries (defaults to project)"
```

### Task 3.3: `getPersonalBrainPath()` resolver

**Files:**
- Modify: `engine/src/mcp-server/shared.ts` (alongside `getMemoryFilePath()` etc.)
- Test: `engine/src/tests/personal-brain.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `engine/src/tests/personal-brain.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';

afterEach(() => { delete process.env['AI_OS_PERSONAL_ROOT']; });

describe('getPersonalBrainPath', () => {
  it('uses AI_OS_PERSONAL_ROOT when set', async () => {
    process.env['AI_OS_PERSONAL_ROOT'] = '/tmp/my-brain';
    const { getPersonalBrainPath } = await import('../mcp-server/shared.js');
    expect(getPersonalBrainPath()).toBe('/tmp/my-brain');
  });

  it('returns empty string when unset (caller must resolve from config)', async () => {
    delete process.env['AI_OS_PERSONAL_ROOT'];
    const { getPersonalBrainPath } = await import('../mcp-server/shared.js');
    expect(getPersonalBrainPath()).toBe('');
  });
});
```

> The spec resolves the brain path from `AI_OS_PERSONAL_ROOT` / config — no HOME-dir guessing.
> Returning `''` when unset forces the caller (promotion handler) to require an explicit config
> path and fail loudly rather than silently writing to a guessed home dir.

- [ ] **Step 2: Run to verify it fails**

Run (from `engine/`): `npx vitest run src/tests/personal-brain.test.ts`
Expected: FAIL — `getPersonalBrainPath` is not exported.

- [ ] **Step 3: Implement**

In `engine/src/mcp-server/shared.ts`, add:
```typescript
/**
 * Resolve the personal brain root. Reads AI_OS_PERSONAL_ROOT; returns '' when unset so the
 * caller must resolve from config and fail loudly rather than guessing a home directory.
 */
export function getPersonalBrainPath(): string {
  return process.env['AI_OS_PERSONAL_ROOT'] ?? '';
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `engine/`): `npx vitest run src/tests/personal-brain.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add engine/src/mcp-server/shared.ts engine/src/tests/personal-brain.test.ts
git commit -m "feat(engine): add getPersonalBrainPath() resolver (AI_OS_PERSONAL_ROOT)"
```

### Task 3.4: Secret-pattern scanner (warn-only)

**Files:**
- Create: `engine/src/mcp-server/sanitize.ts`
- Test: `engine/src/tests/sanitize.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `engine/src/tests/sanitize.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { detectSecretPatterns } from '../mcp-server/sanitize.js';

describe('detectSecretPatterns', () => {
  it('flags AWS access keys', () => {
    const hits = detectSecretPatterns('key is AKIAIOSFODNN7EXAMPLE here');
    expect(hits.some(h => h.kind === 'aws-access-key')).toBe(true);
  });

  it('flags connection strings with credentials', () => {
    const hits = detectSecretPatterns('postgres://user:p4ss@db.example.com:5432/app');
    expect(hits.some(h => h.kind === 'connection-string')).toBe(true);
  });

  it('flags .env-style secret assignments', () => {
    const hits = detectSecretPatterns('API_SECRET=sk_live_abc123def456ghi789');
    expect(hits.some(h => h.kind === 'env-secret')).toBe(true);
  });

  it('returns no hits for clean text', () => {
    expect(detectSecretPatterns('The project uses pnpm and Vitest.')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `engine/`): `npx vitest run src/tests/sanitize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sanitize.ts`**

Create `engine/src/mcp-server/sanitize.ts`:
```typescript
/** A flagged potential secret. Warn-only — never blocks. */
export interface SecretHit {
  kind: 'aws-access-key' | 'connection-string' | 'env-secret' | 'generic-api-key';
  match: string;
}

const PATTERNS: Array<{ kind: SecretHit['kind']; re: RegExp }> = [
  { kind: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'connection-string', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@[^\s/]+/gi },
  { kind: 'env-secret', re: /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API[_-]?KEY)[A-Z0-9_]*\s*[=:]\s*\S{8,}/g },
  { kind: 'generic-api-key', re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/g },
];

/**
 * Scan text for likely secrets. Returns all hits (deduped by match). Warn-only: callers
 * surface these as warnings; they MUST NOT block the action on their own.
 */
export function detectSecretPatterns(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const seen = new Set<string>();
  for (const { kind, re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const key = `${kind}:${m[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ kind, match: m[0] });
    }
  }
  return hits;
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `engine/`): `npx vitest run src/tests/sanitize.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add engine/src/mcp-server/sanitize.ts engine/src/tests/sanitize.test.ts
git commit -m "feat(engine): add warn-only secret-pattern scanner (sanitize.ts)"
```

### Task 3.5: `promote_to_brain` handler (sanitized, audited)

**Files:**
- Create: `engine/src/mcp-server/promotion.ts`
- Test: `engine/src/tests/promotion.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `engine/src/tests/promotion.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let brain: string;
beforeEach(() => {
  brain = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-brain-'));
  process.env['AI_OS_PERSONAL_ROOT'] = brain;
});
afterEach(() => {
  delete process.env['AI_OS_PERSONAL_ROOT'];
  fs.rmSync(brain, { recursive: true, force: true });
});

describe('promoteToBrain', () => {
  it('refuses unless sanitized_confirmed is true', async () => {
    const { promoteToBrain } = await import('../mcp-server/promotion.js');
    const out = promoteToBrain({ title: 'X', content: 'Y', sanitized_confirmed: false });
    expect(out).toMatch(/sanitiz/i);
    expect(fs.existsSync(path.join(brain, 'brain', 'memory.jsonl'))).toBe(false);
  });

  it('appends to brain/memory.jsonl and writes an audit log when confirmed', async () => {
    const { promoteToBrain } = await import('../mcp-server/promotion.js');
    const out = promoteToBrain({ title: 'Prefers tabs', content: 'User prefers tabs.', sanitized_confirmed: true });
    expect(out).toMatch(/promoted/i);
    const jsonl = fs.readFileSync(path.join(brain, 'brain', 'memory.jsonl'), 'utf-8').trim();
    const entry = JSON.parse(jsonl.split('\n').pop()!);
    expect(entry.domain).toBe('personal');
    expect(entry.title).toBe('Prefers tabs');
    const log = fs.readFileSync(path.join(brain, 'brain', 'memory-log.md'), 'utf-8');
    expect(log).toMatch(/Prefers tabs/);
  });

  it('refuses when no personal brain path is configured', async () => {
    delete process.env['AI_OS_PERSONAL_ROOT'];
    const { promoteToBrain } = await import('../mcp-server/promotion.js');
    const out = promoteToBrain({ title: 'X', content: 'Y', sanitized_confirmed: true });
    expect(out).toMatch(/no personal brain/i);
  });

  it('includes a secret warning in the result but still promotes (warn-only)', async () => {
    const { promoteToBrain } = await import('../mcp-server/promotion.js');
    const out = promoteToBrain({ title: 'Key', content: 'AKIAIOSFODNN7EXAMPLE', sanitized_confirmed: true });
    expect(out).toMatch(/warning/i);
    expect(out).toMatch(/promoted/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `engine/`): `npx vitest run src/tests/promotion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `promotion.ts`**

Create `engine/src/mcp-server/promotion.ts`:
```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getPersonalBrainPath, writeTextAtomic } from './shared.js';
import { detectSecretPatterns } from './sanitize.js';

export interface PromoteArgs {
  title: string;
  content: string;
  sanitized_confirmed: boolean;
  category?: string;
  tags?: string;
}

/**
 * Promote a fact into the personal brain. The ONLY sanctioned project -> personal path.
 * - Refuses unless sanitized_confirmed === true.
 * - Refuses when no personal brain path is configured (AI_OS_PERSONAL_ROOT).
 * - Runs a warn-only secret scan (never blocks).
 * - Appends to brain/memory.jsonl (domain: 'personal') and writes an audit line to memory-log.md.
 */
export function promoteToBrain(args: PromoteArgs): string {
  const title = (args.title ?? '').trim();
  const content = (args.content ?? '').trim();
  if (!title || !content) return 'Both title and content are required to promote a fact.';
  if (args.sanitized_confirmed !== true) {
    return 'Refused: promotion requires sanitized_confirmed=true. Review the fact for company/client data first.';
  }

  const root = getPersonalBrainPath();
  if (!root) {
    return 'Refused: no personal brain path configured. Set AI_OS_PERSONAL_ROOT or personalBrainPath in config.';
  }

  const brainDir = path.join(root, 'brain');
  fs.mkdirSync(brainDir, { recursive: true });
  const jsonlPath = path.join(brainDir, 'memory.jsonl');
  const logPath = path.join(brainDir, 'memory-log.md');

  const now = new Date().toISOString();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    title,
    content,
    category: (args.category ?? 'promoted').trim() || 'promoted',
    tags: (args.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    status: 'active' as const,
    domain: 'personal' as const,
  };

  const existing = fs.existsSync(jsonlPath) ? fs.readFileSync(jsonlPath, 'utf-8') : '';
  const next = `${existing.replace(/\s*$/, '')}${existing ? '\n' : ''}${JSON.stringify(entry)}\n`;
  writeTextAtomic(jsonlPath, next);

  const auditHeader = fs.existsSync(logPath) ? '' : '# Personal Brain — Promotion Audit Log\n\n';
  const auditLine = `- ${now} — promoted "${title}" (category: ${entry.category})\n`;
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
  writeTextAtomic(logPath, `${auditHeader}${log}${auditLine}`);

  const secrets = detectSecretPatterns(content);
  const warning = secrets.length
    ? ` ⚠️  Warning: possible secret(s) detected (${secrets.map((s) => s.kind).join(', ')}) — review brain/memory.jsonl.`
    : '';

  return `Promoted "${title}" to personal brain.${warning}`;
}
```

> Date.now()/Math.random() are fine in engine runtime code (the no-Date rule applies only to
> Workflow scripts, not the engine). The existing `rememberRepoFact()` uses the same pattern.

- [ ] **Step 4: Run to verify it passes**

Run (from `engine/`): `npx vitest run src/tests/promotion.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Run the full suite**

Run (from `engine/`): `npm test`
Expected: green, baseline + new tests.

- [ ] **Step 6: Commit**

```bash
git add engine/src/mcp-server/promotion.ts engine/src/tests/promotion.test.ts
git commit -m "feat(engine): add promote_to_brain handler (sanitized, audited)"
```

### Task 3.6: Register `promote_to_brain` MCP tool

**Files:**
- Modify: `engine/src/mcp-tools.ts` (tool definitions array; uses `condition: always` + `McpToolDefinition`)
- Modify: `engine/src/mcp-server/sdk-server.ts` (registerTool wiring + `wrap()`)
- Test: `engine/src/tests/mcp-tools.test.ts` (extend existing, or new assertion)

- [ ] **Step 1: Write a failing registration test**

Add to `engine/src/tests/mcp-tools.test.ts` (create the file if it doesn't exist):
```typescript
import { describe, it, expect } from 'vitest';
import { MCP_TOOL_DEFINITIONS } from '../mcp-tools.js';

describe('promote_to_brain tool registration', () => {
  it('is present in MCP_TOOL_DEFINITIONS with required title/content/sanitized_confirmed', () => {
    const def = MCP_TOOL_DEFINITIONS.find((t) => t.name === 'promote_to_brain');
    expect(def).toBeTruthy();
    expect(def!.inputSchema.required).toEqual(
      expect.arrayContaining(['title', 'content', 'sanitized_confirmed']),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `engine/`): `npx vitest run src/tests/mcp-tools.test.ts`
Expected: FAIL — `promote_to_brain` not found.

- [ ] **Step 3: Add the tool definition**

In `engine/src/mcp-tools.ts`, add to the `MCP_TOOL_DEFINITIONS` array (mirror the existing
`search_codebase` shape; reuse the existing `always` condition import):
```typescript
  {
    name: 'promote_to_brain',
    description: 'Promote a fact from project memory into the personal brain. The ONLY sanctioned project→personal path. Requires sanitized_confirmed=true after reviewing for company/client data.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title for the fact' },
        content: { type: 'string', description: 'The fact to promote (review for sensitive data first)' },
        sanitized_confirmed: { type: 'boolean', description: 'Must be true; confirms the user reviewed for company/client data' },
        category: { type: 'string', description: 'Optional category (default: promoted)' },
        tags: { type: 'string', description: 'Optional comma-separated tags' },
      },
      required: ['title', 'content', 'sanitized_confirmed'],
    },
    condition: always,
  },
```

- [ ] **Step 4: Wire the handler in `sdk-server.ts`**

In `engine/src/mcp-server/sdk-server.ts`, add the import:
```typescript
import { promoteToBrain } from './promotion.js';
```
And register (mirror the `search_codebase` registration + `wrap`):
```typescript
server.registerTool(
  'promote_to_brain',
  {
    description: 'Promote a fact from project memory into the personal brain (sanitized, audited).',
    inputSchema: {
      title: z.string().describe('Short title for the fact'),
      content: z.string().describe('The fact to promote'),
      sanitized_confirmed: z.boolean().describe('Must be true; confirms review for company/client data'),
      category: z.string().optional().describe('Optional category'),
      tags: z.string().optional().describe('Optional comma-separated tags'),
    },
  },
  wrap('promote_to_brain', ({ title, content, sanitized_confirmed, category, tags }) =>
    promoteToBrain({
      title: title as string,
      content: content as string,
      sanitized_confirmed: sanitized_confirmed as boolean,
      category: category as string | undefined,
      tags: tags as string | undefined,
    })),
);
```

- [ ] **Step 5: Run to verify tests pass**

Run (from `engine/`): `npx vitest run src/tests/mcp-tools.test.ts && npm run typecheck`
Expected: PASS + typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add engine/src/mcp-tools.ts engine/src/mcp-server/sdk-server.ts engine/src/tests/mcp-tools.test.ts
git commit -m "feat(engine): register promote_to_brain MCP tool"
```

---

## Phase 4 — Personal brain path + boundary checker (engine)

**Goal of phase:** Add the `--personal-brain-path` flag, the `--check-boundaries` action that scans a project's memory for non-`project` entries and verifies required `.gitignore` rules, and wire `/audit` to call it.

### Task 4.1: `--check-boundaries` action (core logic, TDD)

**Files:**
- Create: `engine/src/actions/check-boundaries.ts`
- Test: `engine/src/tests/check-boundaries.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `engine/src/tests/check-boundaries.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { computeBoundaryReport } from '../actions/check-boundaries.js';

let cwd: string;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-bound-'));
  fs.mkdirSync(path.join(cwd, '.github', 'ai-os', 'memory'), { recursive: true });
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

function writeMem(lines: object[]) {
  fs.writeFileSync(
    path.join(cwd, '.github', 'ai-os', 'memory', 'memory.jsonl'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

describe('computeBoundaryReport', () => {
  it('reports clean when all entries are project-domain and gitignore is set', () => {
    writeMem([{ id: '1', title: 'a', content: 'b', domain: 'project' }]);
    fs.writeFileSync(path.join(cwd, '.gitignore'), '.github/ai-os/memory/\n');
    const r = computeBoundaryReport(cwd);
    expect(r.leaks).toEqual([]);
    expect(r.status).toBe('clean');
  });

  it('flags non-project domain entries as leaks', () => {
    writeMem([
      { id: '1', title: 'a', content: 'b', domain: 'project' },
      { id: '2', title: 'leaked', content: 'personal thing', domain: 'personal' },
    ]);
    fs.writeFileSync(path.join(cwd, '.gitignore'), '.github/ai-os/memory/\n');
    const r = computeBoundaryReport(cwd);
    expect(r.leaks.map((l) => l.id)).toContain('2');
    expect(r.status).toBe('leaks-found');
  });

  it('flags a missing gitignore rule for the memory dir', () => {
    writeMem([{ id: '1', title: 'a', content: 'b', domain: 'project' }]);
    fs.writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n');
    const r = computeBoundaryReport(cwd);
    expect(r.missingGitignore).toContain('.github/ai-os/memory/');
    expect(r.status).toBe('leaks-found');
  });

  it('treats entries without a domain as project (back-compat, no leak)', () => {
    writeMem([{ id: '1', title: 'a', content: 'b' }]);
    fs.writeFileSync(path.join(cwd, '.gitignore'), '.github/ai-os/memory/\n');
    const r = computeBoundaryReport(cwd);
    expect(r.leaks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `engine/`): `npx vitest run src/tests/check-boundaries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `check-boundaries.ts`**

Create `engine/src/actions/check-boundaries.ts`:
```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BoundaryLeak { id: string; title: string; domain: string; }
export interface BoundaryReport {
  status: 'clean' | 'leaks-found' | 'no-memory';
  leaks: BoundaryLeak[];
  missingGitignore: string[];
  scannedEntries: number;
}

const REQUIRED_GITIGNORE = ['.github/ai-os/memory/'];

export function computeBoundaryReport(cwd: string): BoundaryReport {
  const memPath = path.join(cwd, '.github', 'ai-os', 'memory', 'memory.jsonl');
  const leaks: BoundaryLeak[] = [];
  let scannedEntries = 0;

  if (fs.existsSync(memPath)) {
    const lines = fs.readFileSync(memPath, 'utf-8').split('\n').filter((l) => l.trim());
    for (const line of lines) {
      let entry: { id?: string; title?: string; domain?: string };
      try { entry = JSON.parse(line); } catch { continue; }
      scannedEntries++;
      const domain = entry.domain ?? 'project';
      if (domain !== 'project') {
        leaks.push({ id: entry.id ?? '(no id)', title: entry.title ?? '(no title)', domain });
      }
    }
  }

  const gitignorePath = path.join(cwd, '.gitignore');
  const gitignore = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
  const present = new Set(gitignore.split(/\r?\n/).map((l) => l.trim()));
  const missingGitignore = REQUIRED_GITIGNORE.filter((rule) => !present.has(rule));

  const hasIssues = leaks.length > 0 || missingGitignore.length > 0;
  const status: BoundaryReport['status'] =
    !fs.existsSync(memPath) && missingGitignore.length === 0 ? 'no-memory'
    : hasIssues ? 'leaks-found'
    : 'clean';

  return { status, leaks, missingGitignore, scannedEntries };
}

export function runCheckBoundariesAction(cwd: string, json = false): void {
  const report = computeBoundaryReport(cwd);
  if (json) {
    console.log(JSON.stringify({ action: 'check-boundaries', ...report }));
    const isCi = process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true';
    if (report.status === 'leaks-found' && isCi) process.exit(1);
    return;
  }
  console.log(`  🔒 Boundary check: ${cwd}\n`);
  console.log(`  Scanned ${report.scannedEntries} memory entr${report.scannedEntries === 1 ? 'y' : 'ies'}.`);
  if (report.leaks.length) {
    console.log(`  ❌ ${report.leaks.length} non-project entr${report.leaks.length === 1 ? 'y' : 'ies'} found (boundary leak):`);
    for (const l of report.leaks) console.log(`     - [${l.domain}] ${l.title} (id: ${l.id})`);
  }
  if (report.missingGitignore.length) {
    console.log(`  ⚠️  Missing .gitignore rules: ${report.missingGitignore.join(', ')}`);
  }
  if (report.status === 'clean') console.log('  ✅ No boundary leaks.');
  console.log('');
  const isCi = process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true';
  if (report.status === 'leaks-found' && isCi) process.exit(1);
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `engine/`): `npx vitest run src/tests/check-boundaries.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add engine/src/actions/check-boundaries.ts engine/src/tests/check-boundaries.test.ts
git commit -m "feat(engine): add --check-boundaries action logic (boundary leak + gitignore scan)"
```

### Task 4.2: Wire `--check-boundaries` and `--personal-brain-path` into CLI

**Files:**
- Modify: `engine/src/cli/args.ts` (`GenerateAction` union ~line 8; flag-parsing loop; args result type)
- Modify: `engine/src/cli/dispatch.ts` (action routing)
- Test: `engine/src/tests/cli-args.test.ts` (extend or create)

- [ ] **Step 1: Write the failing arg-parse test**

Add to `engine/src/tests/cli-args.test.ts` (create if absent):
```typescript
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../cli/args.js';

describe('parseArgs — boundaries + personal brain', () => {
  it('parses --check-boundaries into the action', () => {
    const r = parseArgs(['--check-boundaries']);
    expect(r.action).toBe('check-boundaries');
  });
  it('parses --personal-brain-path <path>', () => {
    const r = parseArgs(['--init', '--personal-brain-path', '/tmp/brain']);
    expect(r.personalBrainPath).toBe('/tmp/brain');
  });
});
```

> Confirm `parseArgs`'s exact return shape first by reading `engine/src/cli/args.ts`. If it
> exposes parsed flags under a different property name, adjust the assertions to match the real
> field (e.g. `r.json`, `r.cwd` already exist). Keep the new field name `personalBrainPath`.

- [ ] **Step 2: Run to verify it fails**

Run (from `engine/`): `npx vitest run src/tests/cli-args.test.ts`
Expected: FAIL — action not recognized / `personalBrainPath` undefined.

- [ ] **Step 3: Add parsing**

In `engine/src/cli/args.ts`:
- Add `'check-boundaries'` to the `GenerateAction` union (line ~8).
- Add to the returned args interface: `personalBrainPath?: string;`
- In the flag loop, add:
```typescript
} else if (args[i] === '--check-boundaries') {
  action = 'check-boundaries';
} else if (args[i] === '--personal-brain-path') {
  personalBrainPath = args[++i];
}
```
- Declare `let personalBrainPath: string | undefined;` near the other flag locals and include
  it in the returned object.

- [ ] **Step 4: Add dispatch routing**

In `engine/src/cli/dispatch.ts`, import and route (mirror `check-freshness`):
```typescript
import { runCheckBoundariesAction } from '../actions/check-boundaries.js';
// ...
if (action === 'check-boundaries') {
  runCheckBoundariesAction(cwd, args.json);
  return;
}
```

- [ ] **Step 5: Run to verify it passes + typecheck**

Run (from `engine/`): `npx vitest run src/tests/cli-args.test.ts && npm run typecheck`
Expected: PASS + clean.

- [ ] **Step 6: End-to-end smoke**

Run (from `engine/`): `npx tsx src/generate.ts --check-boundaries --cwd .`
Expected: prints a boundary report (likely "no-memory" / clean for the engine dir itself).

- [ ] **Step 7: Commit**

```bash
git add engine/src/cli/args.ts engine/src/cli/dispatch.ts engine/src/tests/cli-args.test.ts
git commit -m "feat(engine): wire --check-boundaries and --personal-brain-path CLI flags"
```

### Task 4.3: Personal-root gitignore entries in `apply`

**Files:**
- Modify: `engine/src/actions/apply.ts` (`ensureGitignoreEntry` ~lines 89–103; document the no-cross-domain invariant)
- Test: `engine/src/tests/apply-gitignore.test.ts` (extend or create)

- [ ] **Step 1: Write the failing test**

Add to `engine/src/tests/apply-gitignore.test.ts` (create if absent):
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensurePersonalRootGitignore } from '../actions/apply.js';

let cwd: string;
beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-apply-')); });
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

describe('ensurePersonalRootGitignore', () => {
  it('adds brain/ and context/ entries idempotently', () => {
    ensurePersonalRootGitignore(cwd);
    ensurePersonalRootGitignore(cwd);
    const gi = fs.readFileSync(path.join(cwd, '.gitignore'), 'utf-8');
    expect(gi.match(/^brain\/$/m)).toBeTruthy();
    expect(gi.match(/^context\/$/m)).toBeTruthy();
    // idempotent — only one occurrence each
    expect(gi.split('\n').filter((l) => l === 'brain/')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `engine/`): `npx vitest run src/tests/apply-gitignore.test.ts`
Expected: FAIL — `ensurePersonalRootGitignore` not exported.

- [ ] **Step 3: Implement**

In `engine/src/actions/apply.ts`, add (reusing the existing `ensureGitignoreEntry`):
```typescript
/**
 * Personal-OS root gitignore guarantees. The engine NEVER writes across domains — all writes
 * use path.join(cwd, ...). This only ensures the personal layers stay uncommitted.
 */
export function ensurePersonalRootGitignore(cwd: string): void {
  for (const entry of ['brain/', 'context/', 'decisions/', 'projects/']) {
    ensureGitignoreEntry(cwd, entry);
  }
}
```
Also add a one-line comment above the file's write helpers documenting the invariant:
"// Invariant: all writes are path.join(cwd, …) — no cross-domain writes exist."

- [ ] **Step 4: Run to verify it passes**

Run (from `engine/`): `npx vitest run src/tests/apply-gitignore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/src/actions/apply.ts engine/src/tests/apply-gitignore.test.ts
git commit -m "feat(engine): ensurePersonalRootGitignore for personal-OS layers"
```

---

## Phase 4b — Ambient capture (candidate queue + suggest_profile_update)

**Goal of phase:** A gitignored `brain/candidates.jsonl` queue, an append-only `suggest_profile_update` MCP tool that can NEVER write to `context/`/`brain/` directly, and the `/level-up` confirmation step (already written in Phase 2.3) consumes it.

### Task 4b.1: Candidate queue (append-only, domain-tagged)

**Files:**
- Create: `engine/src/mcp-server/candidates.ts`
- Test: `engine/src/tests/candidates.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `engine/src/tests/candidates.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let brain: string;
beforeEach(() => {
  brain = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-cand-'));
  process.env['AI_OS_PERSONAL_ROOT'] = brain;
});
afterEach(() => {
  delete process.env['AI_OS_PERSONAL_ROOT'];
  fs.rmSync(brain, { recursive: true, force: true });
});

describe('candidate queue', () => {
  it('appends a domain-tagged candidate to brain/candidates.jsonl', async () => {
    const { appendCandidate, readCandidates } = await import('../mcp-server/candidates.js');
    appendCandidate({ text: 'User switched to Bun', domain: 'personal', trigger: 'you mentioned Bun' });
    const all = readCandidates();
    expect(all).toHaveLength(1);
    expect(all[0].domain).toBe('personal');
    expect(all[0].text).toMatch(/Bun/);
  });

  it('marks project-domain candidates as needing sanitization', async () => {
    const { appendCandidate, readCandidates } = await import('../mcp-server/candidates.js');
    appendCandidate({ text: 'AcmeCorp uses X', domain: 'project', trigger: '...' });
    expect(readCandidates()[0].needsSanitization).toBe(true);
  });

  it('NEVER writes to context/ or brain/memory.jsonl — only candidates.jsonl', async () => {
    const { appendCandidate } = await import('../mcp-server/candidates.js');
    appendCandidate({ text: 'x', domain: 'personal', trigger: 't' });
    expect(fs.existsSync(path.join(brain, 'brain', 'memory.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(brain, 'context'))).toBe(false);
    expect(fs.existsSync(path.join(brain, 'brain', 'candidates.jsonl'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `engine/`): `npx vitest run src/tests/candidates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `candidates.ts`**

Create `engine/src/mcp-server/candidates.ts`:
```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getPersonalBrainPath, writeTextAtomic } from './shared.js';

export interface Candidate {
  id: string;
  createdAt: string;
  text: string;
  domain: 'personal' | 'project';
  trigger: string;
  needsSanitization: boolean;
}
export interface AppendCandidateArgs {
  text: string;
  domain: 'personal' | 'project';
  trigger: string;
}

function candidatesPath(): string {
  const root = getPersonalBrainPath();
  if (!root) throw new Error('No personal brain path configured (AI_OS_PERSONAL_ROOT).');
  return path.join(root, 'brain', 'candidates.jsonl');
}

/** Append-only. This is the ONLY thing the ambient-capture tool can do — never writes
 *  context/* or brain/memory.jsonl. The /level-up confirmation gate decides storage. */
export function appendCandidate(args: AppendCandidateArgs): Candidate {
  const file = candidatesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const candidate: Candidate = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    text: args.text.trim(),
    domain: args.domain,
    trigger: args.trigger.trim(),
    needsSanitization: args.domain === 'project',
  };
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  writeTextAtomic(file, `${existing.replace(/\s*$/, '')}${existing ? '\n' : ''}${JSON.stringify(candidate)}\n`);
  return candidate;
}

export function readCandidates(): Candidate[] {
  const file = candidatesPath();
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Candidate);
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `engine/`): `npx vitest run src/tests/candidates.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add engine/src/mcp-server/candidates.ts engine/src/tests/candidates.test.ts
git commit -m "feat(engine): append-only ambient-capture candidate queue"
```

### Task 4b.2: Register `suggest_profile_update` MCP tool

**Files:**
- Modify: `engine/src/mcp-tools.ts`
- Modify: `engine/src/mcp-server/sdk-server.ts`
- Test: extend `engine/src/tests/mcp-tools.test.ts`

- [ ] **Step 1: Write the failing registration test**

Add to `engine/src/tests/mcp-tools.test.ts`:
```typescript
describe('suggest_profile_update tool registration', () => {
  it('is present with required text and domain', async () => {
    const { MCP_TOOL_DEFINITIONS } = await import('../mcp-tools.js');
    const def = MCP_TOOL_DEFINITIONS.find((t) => t.name === 'suggest_profile_update');
    expect(def).toBeTruthy();
    expect(def!.inputSchema.required).toEqual(expect.arrayContaining(['text', 'domain']));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `engine/`): `npx vitest run src/tests/mcp-tools.test.ts`
Expected: FAIL — tool not found.

- [ ] **Step 3: Add the tool definition**

In `engine/src/mcp-tools.ts`, add to `MCP_TOOL_DEFINITIONS`:
```typescript
  {
    name: 'suggest_profile_update',
    description: 'Propose a candidate profile/context fact noticed during a session. APPEND-ONLY: queues to brain/candidates.jsonl for confirmation at /level-up. Cannot write context/ or brain/memory directly. Project-domain candidates are flagged for sanitization.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The candidate fact to queue' },
        domain: { type: 'string', enum: ['personal', 'project'], description: 'Source domain of the observation' },
        trigger: { type: 'string', description: 'The text/context that triggered this suggestion' },
      },
      required: ['text', 'domain'],
    },
    condition: always,
  },
```

- [ ] **Step 4: Wire the handler in `sdk-server.ts`**

Add import:
```typescript
import { appendCandidate } from './candidates.js';
```
Register:
```typescript
server.registerTool(
  'suggest_profile_update',
  {
    description: 'Queue a candidate profile/context fact for confirmation at /level-up (append-only).',
    inputSchema: {
      text: z.string().describe('The candidate fact to queue'),
      domain: z.enum(['personal', 'project']).describe('Source domain'),
      trigger: z.string().optional().describe('What triggered this suggestion'),
    },
  },
  wrap('suggest_profile_update', ({ text, domain, trigger }) => {
    const c = appendCandidate({
      text: text as string,
      domain: domain as 'personal' | 'project',
      trigger: (trigger as string | undefined) ?? '',
    });
    return `Queued candidate (${c.domain}${c.needsSanitization ? ', needs sanitization' : ''}) for /level-up confirmation.`;
  }),
);
```

- [ ] **Step 5: Run tests + typecheck**

Run (from `engine/`): `npx vitest run src/tests/mcp-tools.test.ts && npm run typecheck`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add engine/src/mcp-tools.ts engine/src/mcp-server/sdk-server.ts engine/src/tests/mcp-tools.test.ts
git commit -m "feat(engine): register append-only suggest_profile_update MCP tool"
```

---

## Phase 5 — Init wizard (personal-OS awareness)

**Goal of phase:** Add a "personal OS project?" question to the init wizard that sets `projectBoundary: 'strict'` + `personalBrainPath`, persists them in `config.json`, and surfaces "Active Projects"/"Engine Status" context.

### Task 5.1: Wizard question + `InitResult` fields

**Files:**
- Modify: `engine/src/actions/init.ts` (`runWizardLogic` ~lines 53–127; `InitResult` interface)
- Test: `engine/src/tests/init.test.ts` (extend existing)

- [ ] **Step 1: Write the failing test**

Add to `engine/src/tests/init.test.ts` (the existing init tests use a scripted `AskFn`):
```typescript
import { describe, it, expect } from 'vitest';
import { runWizardLogic } from '../actions/init.js';
// reuse the existing test's DetectedStack fixture/helper if present

describe('wizard — personal OS question', () => {
  it('captures personalBrainPath when the user answers yes', async () => {
    const answers = ['', 'standard', 'copilot', 'y', '/tmp/brain', 'y'];
    let i = 0;
    const ask = async () => answers[i++];
    const result = await runWizardLogic(/* stack fixture */ makeStack(), ask);
    expect(result.projectBoundary).toBe('strict');
    expect(result.personalBrainPath).toBe('/tmp/brain');
  });

  it('defaults to no personal brain (project stays standalone)', async () => {
    const answers = ['', 'standard', 'copilot', 'n', 'y'];
    let i = 0;
    const ask = async () => answers[i++];
    const result = await runWizardLogic(makeStack(), ask);
    expect(result.personalBrainPath).toBeUndefined();
  });
});
```

> Read the existing `init.test.ts` first to reuse its `DetectedStack` fixture/`makeStack()` helper
> and to confirm the exact answer-sequence the wizard expects (stack confirm → profile → model →
> [new] personal OS → confirm). Adjust the `answers` arrays to match the real prompt order.

- [ ] **Step 2: Run to verify it fails**

Run (from `engine/`): `npx vitest run src/tests/init.test.ts`
Expected: FAIL — `projectBoundary`/`personalBrainPath` not on `InitResult`.

- [ ] **Step 3: Extend `InitResult` and add the question**

In `engine/src/actions/init.ts`, extend the `InitResult` interface:
```typescript
  projectBoundary?: 'strict' | 'permissive';
  personalBrainPath?: string;
```
In `runWizardLogic`, after the model-selection block and before the final confirmation, add:
```typescript
  // ── Personal OS linkage ───────────────────────────────────────────────
  console.log('\n  🧠 Is this project part of your personal AI OS (Cortex)?\n');
  console.log('     Links it to your personal brain for sanitized promotion of learnings.');
  console.log('');
  let projectBoundary: 'strict' | 'permissive' | undefined;
  let personalBrainPath: string | undefined;
  const isPersonalOs = (await ask('  Personal OS project? [y/N]: ')).trim().toLowerCase();
  if (isPersonalOs === 'y' || isPersonalOs === 'yes') {
    projectBoundary = 'strict';
    const bp = (await ask('  Personal brain path (absolute, blank to skip): ')).trim();
    if (bp) personalBrainPath = bp;
  }
```
Include both in the returned `InitResult` (both `proceed: true` and `proceed: false` returns).

- [ ] **Step 4: Run to verify it passes**

Run (from `engine/`): `npx vitest run src/tests/init.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/src/actions/init.ts engine/src/tests/init.test.ts
git commit -m "feat(engine): wizard asks 'personal OS project?' → strict boundary + brain path"
```

### Task 5.2: Persist `projectBoundary`/`personalBrainPath` to `config.json`

**Files:**
- Modify: `engine/src/generators/context-docs.ts` (`generateContextDocs` config build; `readAiOsConfig` ~lines 26–38)
- Modify: the call site that passes init results into generation (likely `engine/src/cli/dispatch.ts` or `engine/src/generate.ts` — trace from where `runWizardLogic`'s result flows)
- Test: `engine/src/tests/context-docs.test.ts` (extend) or a focused config-persist test

- [ ] **Step 1: Write the failing test**

Add to `engine/src/tests/context-docs.test.ts` (or create `config-persist.test.ts`):
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateContextDocs } from '../generators/context-docs.js';
// reuse existing DetectedStack fixture

let cwd: string;
beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-cfg-')); });
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

describe('config persists personal-OS fields', () => {
  it('writes projectBoundary and personalBrainPath into config.json', () => {
    generateContextDocs(makeStack(), cwd, { projectBoundary: 'strict', personalBrainPath: '/tmp/brain' });
    const cfg = JSON.parse(fs.readFileSync(path.join(cwd, '.github', 'ai-os', 'config.json'), 'utf-8'));
    expect(cfg.projectBoundary).toBe('strict');
    expect(cfg.personalBrainPath).toBe('/tmp/brain');
  });
});
```

> Confirm `generateContextDocs`'s options object shape (`GenerateContextDocsOptions`) and add the
> two fields to it. Reuse the existing test's `makeStack()` helper.

- [ ] **Step 2: Run to verify it fails**

Run (from `engine/`): `npx vitest run src/tests/context-docs.test.ts`
Expected: FAIL — fields not written.

- [ ] **Step 3: Thread the fields through**

In `engine/src/generators/context-docs.ts`:
- Extend `GenerateContextDocsOptions`:
```typescript
  projectBoundary?: 'strict' | 'permissive';
  personalBrainPath?: string;
```
- In the `config` object build, add (preserving existing on refresh):
```typescript
    projectBoundary: options?.projectBoundary ?? existingConfig?.projectBoundary,
    personalBrainPath: options?.personalBrainPath ?? existingConfig?.personalBrainPath,
```
- At the dispatch/generate call site, pass the wizard's `result.projectBoundary` /
  `result.personalBrainPath` (and the CLI `--personal-brain-path` flag from Task 4.2) into the
  options object.

- [ ] **Step 4: Run to verify it passes**

Run (from `engine/`): `npx vitest run src/tests/context-docs.test.ts && npm run typecheck`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add engine/src/generators/context-docs.ts engine/src/cli/dispatch.ts engine/src/tests/context-docs.test.ts
git commit -m "feat(engine): persist projectBoundary/personalBrainPath into config.json"
```

### Task 5.3: Refactor `multi-model.ts` to emit canonical `AGENTS.md` + thin shims

**Files:**
- Modify: `engine/src/generators/multi-model.ts` (`getModelOutputPath` ~159–167; `generateClaudeCodeMd` ~125–138; add `generateAgentsShim`)
- Test: `engine/src/tests/multi-model.test.ts` (extend existing)

> Per spec: `copilot`/`codex`/`cursor` resolve to "ensure `AGENTS.md`"; `claude`/`gemini`
> additionally "ensure shim" (one-line `@AGENTS.md` import). This is the per-project generation;
> the root userland files were authored by hand in Phase 1.

- [ ] **Step 1: Write the failing test**

Add to `engine/src/tests/multi-model.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { generateAgentsShim } from '../generators/multi-model.js';

describe('generateAgentsShim', () => {
  it('produces a one-line @AGENTS.md import for claude', () => {
    expect(generateAgentsShim('claude').trim()).toBe('@AGENTS.md');
  });
  it('produces a one-line @AGENTS.md import for gemini', () => {
    expect(generateAgentsShim('gemini').trim()).toBe('@AGENTS.md');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `engine/`): `npx vitest run src/tests/multi-model.test.ts`
Expected: FAIL — `generateAgentsShim` not exported.

- [ ] **Step 3: Implement the shim generator**

In `engine/src/generators/multi-model.ts`, add:
```typescript
/** Thin per-tool shim that imports the canonical AGENTS.md. Used for claude/gemini, which
 *  do not read AGENTS.md natively. Codex/Copilot/Cursor read AGENTS.md directly — no shim. */
export function generateAgentsShim(_model: 'claude' | 'gemini'): string {
  return '@AGENTS.md\n';
}
```

> The broader refactor (making the apply pipeline emit one `AGENTS.md` + shims instead of N full
> files) is wired where `getModelOutputPath`/`adaptInstructionsForModel` are consumed in the apply
> path. Keep this task's change minimal and test-backed (the shim generator); a follow-up task can
> migrate the emission pipeline once the shim primitive exists. Add a `// TODO(agents-canonical)`
> note at the `getModelOutputPath` call site rather than rewriting emission blindly.

- [ ] **Step 4: Run to verify it passes**

Run (from `engine/`): `npx vitest run src/tests/multi-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/src/generators/multi-model.ts engine/src/tests/multi-model.test.ts
git commit -m "feat(engine): add AGENTS.md shim generator for claude/gemini"
```

### Task 5.4: Full engine regression gate

- [ ] **Step 1: Run the whole engine CI**

Run (from `engine/`): `npm run ci`
Expected: typecheck + lint + all tests green (baseline 642 + all new Phase 3–5 tests). Paste the
summary. If lint flags the new files (e.g. `no-console` in an action), confirm the file is in the
allowed `src/cli/**`/action surface or adjust per the existing eslint config in Task pre-reqs.

- [ ] **Step 2: Commit any lint fixes**

```bash
git add -A && git commit -m "chore(engine): lint fixes after Phase 3-5"
```
(Skip if nothing to fix.)

---

## Phase 6 — Packaging / publish from `engine/`

**Goal of phase:** Make `npm publish` run from `engine/` with correct `files`, keep root/engine versions in lockstep, and update CI + release automation for the subtree.

### Task 6.1: `engine/package.json` publish config

**Files:**
- Modify: `engine/package.json`

- [ ] **Step 1: Add/verify `files` and publish metadata**

In `engine/package.json`, ensure a `files` array publishes only what's needed:
```json
  "files": ["bundle/generate.js", "bundle/server.js", "src/templates", "README.md"],
```
Keep `bin` pointing at `./bundle/generate.js` (relative to the engine package, which is what gets
published). Confirm `name` is still `ai-os` and `version` matches the root stub.

- [ ] **Step 2: Dry-run the pack**

Run (from `engine/`): `npm pack --dry-run`
Expected: the tarball contents list `bundle/generate.js`, `bundle/server.js`, `src/templates/**`,
`README.md`, `package.json` — and NOT `src/tests`, `dist`, `coverage`.

- [ ] **Step 3: Commit**

```bash
git add engine/package.json
git commit -m "build(engine): publish config (files allowlist) for subtree publish"
```

### Task 6.2: Update CI + release automation for the subtree

**Files:**
- Modify: `.github/workflows/*.yml` (whichever run build/test/release — inspect first)
- Modify: any release script under `engine/scripts/` referenced by CI

- [ ] **Step 1: Inspect current CI**

Run: `git ls-files .github/workflows engine/scripts | head -50`
Then read each workflow that runs `npm ci`/`npm test`/`npm publish`.

- [ ] **Step 2: Point CI steps at `engine/`**

For each workflow job that builds/tests/publishes, set the working directory to `engine/` (add
`defaults: { run: { working-directory: engine } }` at the job level, or `cd engine` before each
step). Publish step runs `npm publish` from `engine/`.

- [ ] **Step 3: Keep versions in lockstep**

Add a CI check (or release-script step) that fails if root `package.json` `version` ≠
`engine/package.json` `version`:
```bash
node -e "const r=require('./package.json').version,e=require('./engine/package.json').version; if(r!==e){console.error('version mismatch root='+r+' engine='+e);process.exit(1)}"
```

- [ ] **Step 4: Verify locally**

Run: `node -e "const r=require('./package.json').version,e=require('./engine/package.json').version; if(r!==e)process.exit(1); console.log('versions match: '+r)"`
Expected: `versions match: 0.24.0`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows engine/scripts
git commit -m "ci: run build/test/publish from engine/ subtree; enforce version lockstep"
```

---

## Phase 7 — Docs

**Goal of phase:** Update engine docs for the new architecture, the `promote_to_brain` tool, and the boundary model; cross-link userland references.

### Task 7.1: Engine architecture + README + MCP-tools docs

**Files:**
- Modify: `engine/docs/architecture.md`
- Modify: `engine/README.md`
- Modify: `engine/docs/mcp-tools.md` (or regenerate via `npm run gen-mcp-docs`)

- [ ] **Step 1: Update `engine/docs/architecture.md`**

Add a section describing the front-door reframe (engine as kernel under `engine/`, root as Cortex
userland), the three-domain data model, and the boundary invariant (`project → personal` only,
sanitized). Reference `references/alive-os-framework.md`.

- [ ] **Step 2: Update `engine/README.md`**

Add a top note: "This is the `ai-os` engine (kernel). The repo root is Cortex, a personal AI OS
userland. See ../README.md." Document the new flags `--check-boundaries` and `--personal-brain-path`
in the CLI reference section.

- [ ] **Step 3: Regenerate / update MCP-tools docs**

Run (from `engine/`): `npm run gen-mcp-docs`
Expected: `engine/docs/mcp-tools.md` regenerates and now includes `promote_to_brain` and
`suggest_profile_update`. If the generator doesn't auto-discover them, add their entries by hand
mirroring the existing tool doc format.

- [ ] **Step 4: Update `references/getting-started.md` cross-links**

Add a "When the engine lights up" subsection pointing to `engine/README.md` CLI flags and the
boundary model.

- [ ] **Step 5: Commit**

```bash
git add engine/docs engine/README.md references/getting-started.md
git commit -m "docs: architecture + README + MCP-tools for fusion (boundaries, promote_to_brain)"
```

### Task 7.2: Final full verification

- [ ] **Step 1: Engine CI green**

Run (from `engine/`): `npm run ci`
Expected: all green; paste the summary.

- [ ] **Step 2: CLI smoke from root (npx path)**

Run: `node ./engine/bundle/generate.js --check-boundaries --cwd .`
Expected: a boundary report prints (validates the root `bin` → moved bundle path still works).

- [ ] **Step 3: Confirm personal layers are ignored**

Run: `git check-ignore -v brain/ context/ projects/ decisions/`
Expected: all four match root `.gitignore` rules.

- [ ] **Step 4: Use superpowers:finishing-a-development-branch**

Invoke the finishing-a-development-branch skill to choose merge/PR/cleanup for
`feat/personal-brain-extension`.

---

## Self-Review (against the spec)

**Spec coverage check:**
- Three-domain data model & boundary invariant → Phase 3 (Tasks 3.1–3.2), Phase 4 (4.1–4.3). ✓
- `MemoryDomain`, config fields → Task 3.1. ✓
- `domain` on entries default `project` → Task 3.2. ✓
- `sanitize.ts` / `detectSecretPatterns()` → Task 3.4. ✓
- `promotion.ts` / `promote_to_brain` (refuses unless `sanitized_confirmed`, secret scan, audit log) → Tasks 3.5–3.6. ✓
- `getPersonalBrainPath()` / `AI_OS_PERSONAL_ROOT` → Task 3.3. ✓
- `--check-boundaries` action → Tasks 4.1–4.2. ✓
- `ensureGitignoreEntry` for personal layers → Task 4.3. ✓
- Ambient capture: `candidates.jsonl` + `suggest_profile_update` (append-only, domain-tagged, never writes directly) → Phase 4b. ✓
- `/level-up` surfaces & confirms candidates → Task 2.3. ✓
- Init wizard "personal OS project?" → strict boundary + brain path; persist in config → Tasks 5.1–5.2. ✓
- Canonical `AGENTS.md` + thin `CLAUDE.md`/`GEMINI.md` shims (root authored + per-project shim generator) → Tasks 1.2, 5.3. ✓
- Front-door reframe / `engine/` move / root `bin` stub → Phase 0. ✓
- Root identity (README, SETUP, references, gitkeeps, .gitignore) → Phase 1. ✓
- Rituals (`/onboard`, `/audit`, `/level-up`) static committed skills → Phase 2. ✓
- Packaging/publish from `engine/` + version lockstep → Phase 6. ✓
- Docs (architecture, README, mcp-tools, getting-started) → Phase 7. ✓
- Server deployment (Levels 1–3) → **intentionally out of scope** (later track, per locked decision). ✓

**Decisions threaded:** name **Cortex** (README/SETUP/AGENTS/skills), framework **Alive · Bounded · Sovereign** (references/AGENTS), **GEMINI.md** shim included (Tasks 1.2, 5.3). ✓

**Known follow-ups deliberately deferred (not gaps):**
- Full migration of the apply emission pipeline to AGENTS.md+shims (Task 5.3 ships the primitive + TODO marker; full emission migration is a scoped follow-up to avoid rewriting the generator blindly).
- Server deployment track.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-11-personal-ai-os-fusion.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best given Phase 0's risk profile (each task is independently verifiable).
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
