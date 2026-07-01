---
title: MCP Brain + Team Context Engine + Cortex Core Plugin Bundle
date: 2026-07-01
status: approved (brainstorm) — pending implementation
issues: [305, 306]
supersedes: none
branch: feat/mcp-brain-team-engine
---

# MCP Brain + Team Context Engine + Cortex Core Plugin Bundle

## Summary

Turn Cortex from a per-project static file stamp into a **live second brain** any AI agent
can `recall` from and `capture` into, extend it into a **team context engine** synced through a
dedicated team-brain git repo, and make every Cortex install ship a curated **Core Plugin Bundle**
so a fresh project/team/PC gets project-analysis + skill/plugin-creation power by default.

This resolves **#305** (Phase 0 — local MCP brain) and **#306** (the 4-phase team-context-engine
epic, of which #305 is Phase 0), plus a new **Cortex Core Plugin Bundle** capability requested
during brainstorming.

The plain-files core is untouched and still works with zero runtime deps. Node appears **only** in
`mcp/`, where an MCP stdio server genuinely requires it. Everything else (team init/add, connect,
catch-up, plugin setup) ships as **skills + small bash helpers**, matching the vault's ethos.

## Goals

- One-time, one-line connection: register a user-scope MCP server once per laptop; every project
  on that machine can then `recall`/`capture` against the local vault with **zero** per-project setup.
- Team tier: captures + git/PR digests flow into a shared team-brain repo; teammates `recall`
  everyone's knowledge and `catch_me_up` after time away.
- Out-of-the-box value: installing Cortex provisions a curated Core plugin set (analysis + skill
  creation), with heavier/platform tiers offered by role.
- The tool contract (`recall`, `get_project_context`, `list_projects`, `capture`, `catch_me_up`)
  is **stable across versions** — internals (e.g. lexical → semantic) can change without touching
  the connection snippet.

## Non-goals (v1 — YAGNI)

- No embeddings/semantic recall (the interface is swap-ready only; v1 is lexical).
- No auto-capture — `capture` is always an explicit tool call / workflow step.
- No web UI (the `cortex.html` graph viewer is separate and unchanged).
- No cloud/multi-user hosting beyond a private git repo; no server daemon, no DB, no network calls
  from the MCP server.
- The MCP server never runs an LLM itself — `catch_me_up` returns raw material; the **agent** summarizes.

## The bright line vs the old engine (non-negotiable guardrails)

The old `.ai-os/` engine was killed because it auto-committed, regenerated `CLAUDE.md`, and tangled
into repos. This design keeps **none** of that:

- The team-brain repo is cloned **inside** `AI_OS_ROOT` (at `AI_OS_ROOT/team/<team-name>/`), so the
  server's **only** writable root is `AI_OS_ROOT`. Any path resolving outside it is hard-refused
  (single path-jail; `..` and symlink escapes rejected). This keeps one jail covering personal + team writes.
- It **never** runs git against, or writes into, the current project / CWD. Auto-commit+push targets
  **only** the team-brain repo.
- It **never** rewrites `CLAUDE.md` / `AGENTS.md`.
- `capture` is explicit; nothing is silently logged.
- Plain files, killable stdio process, fully transparent.

## Architecture — three tiers + plugin bundle

```
┌─ Product repo (UNIS, etc.) ──────────────┐     committed connector: slug + team-brain URL
│  agent ⇄ MCP (user scope)                │     (generic, no personal paths)
└──────────────┬───────────────────────────┘
               │ stdio (recall/capture/…)
        ┌──────▼───────────────┐   reads/writes markdown       ┌───────────────────────┐
        │  ai-os-mcp (Node)     │ ────────────────────────────▶ │  Personal vault        │
        │  mcp/server.js        │                               │  (AI_OS_ROOT)          │
        │  path-jail + tools    │ ──── auto commit+push ───────▶ │  Team-brain clone      │
        └───────────────────────┘   (team-brain repo ONLY)      │  (one folder/project)  │
                                                                └───────────┬───────────┘
                                                                            │ git push/pull
                                                                 ┌──────────▼──────────┐
                                                                 │ team-brain GitHub    │
                                                                 │ repo (private)       │
                                                                 └──────────────────────┘
```

## Components

### 1. `mcp/` — the Node MCP server (Phase 0, #305)

- `mcp/package.json` — deps: `@modelcontextprotocol/sdk` only. Test script uses built-in
  `node:test` + `node:assert` (no jest/vitest). `"type": "module"`, Node >=20.
- `mcp/server.js` — stdio MCP server; registers the tools; single config input `AI_OS_ROOT`.
- `mcp/lib/paths.js` — **path-jail**: `resolveInRoot(root, relPath)` returns an absolute path only
  if it stays within `root` (realpath-based); throws `OutsideRootError` otherwise. Shared by every write.
- `mcp/lib/recall.js` — lexical search over vault markdown (personal + team-brain), ranking +
  snippet extraction, `project` slug filter, `limit`. Pure function over a file list → swap-ready.
- `mcp/lib/capture.js` — resolve destination + append note; returns the written path.
- `mcp/lib/projects.js` — `list_projects()` / `get_project_context(project)` over `projects/`.
- `mcp/lib/catchup.js` — `catch_me_up`: assemble notes-since + git-log-since material (no summarizing).
- `mcp/lib/gitsync.js` — team-brain clone helpers: `pull()`, `commitAndPush(paths, msg)`. Refuses to
  operate on any repo other than the configured team-brain clone.

#### Tool contract (stable)

| Tool | Input | Behavior / Output |
|---|---|---|
| `recall` | `query, project?, limit?=8` | Lexical search over vault markdown; ranked snippets **with file paths**. `project` filters by slug. Searches personal vault + team-brain clone. |
| `get_project_context` | `project` | Returns that project's stub/brief markdown. |
| `list_projects` | — | Projects registered in the brain (personal + team). |
| `capture` | `content, project?, tags?` | Appends a note; team mode → append-only one-file-per-note under team-brain `projects/<slug>/`, else `projects/<slug>.md`, else `inbox/<date>.md`. Auto commit+push to team-brain when in team mode. Returns path. |
| `catch_me_up` | `project, since` | Returns notes + git history added since `since` as **raw material** for the agent to summarize. Never calls an LLM. |

### 2. Team-brain repo + sync (Phase 1)

- **Team-brain repo**: one private GitHub repo, one folder per project, cloned on each member's
  laptop at a configured path. Git is the sync layer and the audit log.
- **Roles**:
  - Team leader → `/team-init` skill (+ `tools/cortex-team.sh init`): create/configure the
    team-brain repo, seed per-project folders, write team config (members, projects).
  - Member → `/team-add` skill (+ `tools/cortex-team.sh add`), run inside a product repo: drop the
    generic connector, clone the team-brain locally, register the user-scope MCP server. One step, once.
- **Connector** (D6, approved): `.cortex/connector.json`, committed into the product repo, declaring
  `slug` + team-brain repo URL only — no personal/machine paths → safe to commit; teammates inherit on
  clone. Local, machine-specific state (`AI_OS_ROOT`, team clone path) lives in user-scope config only,
  never in the product repo.
- **Sync flow**: `capture` → write note into local team-brain clone → auto commit+push to team-brain
  (never the product repo). Session start / on demand → `pull` → `recall` sees everyone's updates.

### 3. Capture sources (Phase 2)

- Workflow notes (the *why*): agents call `capture` as a natural end-of-task/PR step.
- Git/PR digest (the *what changed*): `tools/cortex-digest.sh <product-repo>` summarizes the repo's
  recent commits/PRs into brain notes (append-only) in the team-brain clone. Reads the product repo's
  git **read-only**; writes only into the team-brain clone.

### 4. Holiday catch-up (Phase 3)

- `catch_me_up(project, since)` MCP tool → assembles brain notes + git history since `since`; the
  agent produces the human summary. `/catch-me-up` skill wraps it as a ritual.

### 5. Cortex Core Plugin Bundle

Provisions a curated set of Claude Code plugins out-of-the-box. Verified against Claude Code docs:
declarative project settings **prompt** (guided, not silent); the CLI script is the zero-friction path.
Ship **both**.

- **Manifest (committed source of truth)**: `references/cortex-plugins.md` (human) lists tiers, and
  `plugins/cortex-core-plugins.json` (machine-readable) drives the setup script.
- **Declarative**: `cortex-init` stamps `.claude/settings.json` with `extraKnownMarketplaces`
  (`claude-plugins-official`) + `enabledPlugins` for the **Core tier**. On trust, Claude Code prompts
  the teammate to install/enable — team-shared via git.
- **Scripted**: `tools/cortex-plugins.sh` + `/setup-plugins` skill run
  `claude plugin marketplace add anthropics/claude-plugins-official` and
  `claude plugin install <p>@claude-plugins-official` for the Core tier; then **offer the optional
  tiers by role** (Dev tools, Browser/QA, Platform). Idempotent; safe to re-run.

**Core tier (out-of-the-box):** `superpowers`, `skill-creator`, `claude-md-management`,
`claude-code-setup`, `feature-dev`, `code-review`, `code-simplifier`, `context7`.

**Optional tiers (offered by role, not auto-installed):**
- Dev tools: `typescript-lsp`, `github`
- Browser/QA: `playwright`, `chrome-devtools-mcp`
- Platform/extras: `vercel`, `cloudflare`, `andrej-karpathy-skills`

Honest limitation: there is **no headless auto-install** — the declarative route needs one trust +
install confirmation; the script route needs the user to run one command (or the ritual). "Out of the
box" therefore means *at most one confirmation*.

### 6. Skills wired into `AGENTS.md`

New rituals added to the manual's ritual list and `skills/` (copied to `.claude/skills/`):

- `/connect-brain` — print/run the one-line user-scope MCP registration for this machine.
- `/team-init` — leader: create + seed the team-brain repo and config.
- `/team-add` — member: connector + clone + register, inside a product repo.
- `/catch-me-up` — run `catch_me_up` and summarize what changed since last sync.
- `/setup-plugins` — provision the Core plugin bundle; offer optional tiers by role.

## Data flow examples

- Any project: `recall("how did we wire PingID auth")` → server greps personal vault + team clone →
  snippets + paths.
- Agent learns something → `capture("UNIS uses PingID session cookies, no client JWT", project="unis")`
  → appended into team-brain clone → auto commit+push → recallable from every project thereafter.
- Returning from leave → `catch_me_up("unis", since="2026-06-15")` → notes + commit digest since that
  date → agent writes the human catch-up.

## Error handling

- **Path-jail violation** → tool returns a structured error (`code: "outside_root"`), no write performed.
- **Missing `AI_OS_ROOT`** → server fails fast on startup with a clear message.
- **Team-brain clone missing / not a git repo** → sync helpers no-op with a warning; `capture` falls
  back to personal vault so knowledge is never lost.
- **Push failure (offline / auth)** → capture is still written locally + committed; push retried on next
  sync; tool reports "captured locally, push pending."
- **`claude` CLI absent** in `/setup-plugins` → skill prints the exact commands + the declarative
  settings block for manual/guided setup instead of failing.

## Testing & CI

- **Unit (`node:test`)**: recall ranking + snippet + project filter; capture path resolution (all three
  destinations); **security: write outside `AI_OS_ROOT` / team clone is rejected** (`..` and symlink);
  `list_projects`/`get_project_context`; `catch_me_up` material assembly; gitsync refuses non-team repos.
- **Smoke**: server starts and answers MCP `tools/list`.
- **CI**: new `.github/workflows/mcp-test.yml` (Node 20/22 matrix: `npm ci` → `npm test` → smoke).
  Existing `.github/workflows/cortex-init-test.yml` (bash smoke) must stay green; extend it to assert the
  stamped `.claude/settings.json` contains the Core `enabledPlugins`.
- **Manual acceptance**: register at user scope; open two different repos; confirm `recall` + `capture`
  work in both; run `/setup-plugins` and confirm Core plugins install.

## Phased delivery (one branch, phased commits)

- Phase 0 (#305): `mcp/` server + tools + path-jail + tests + `/connect-brain` + README snippet.
- Phase 1: team-brain repo + sync + connector + `/team-init` / `/team-add`.
- Phase 2: capture sources — workflow `capture` + `tools/cortex-digest.sh`.
- Phase 3: `catch_me_up` + `/catch-me-up`.
- Plugin bundle: manifest + `.claude/settings.json` stamping + `tools/cortex-plugins.sh` + `/setup-plugins`.
- Wire all skills into `AGENTS.md`; add CI; update `CHANGELOG.md`, bump `VERSION` (1.1.0).

## Resolved decisions

| # | Decision | Resolution |
|---|---|---|
| D1 | Runtime | Node (ESM), `@modelcontextprotocol/sdk`, built-in `node:test`. |
| D2 | Tooling shape | Node MCP server only; team/connect/catch-up/plugins as skills + bash. |
| D3 | Recall | Lexical v1; interface swap-ready for semantic later. |
| D4 | `capture` default | team → one-file-per-note; else `projects/<slug>.md`; else `inbox/<date>.md`. |
| D5 | Sync cadence | Push on every capture (append-only); pull on demand + optional session-start. |
| D6 | Connector privacy | Commit a **generic** connector (slug + team-brain URL, no personal paths). |
| D7 | Personal tier | Keep the personal vault alongside the team tier (two-tier recall). |
| P1 | Plugin default | Core tier out-of-the-box; optional tiers offered by role, not auto-installed. |
| P2 | Plugin mechanism | Ship both declarative (`.claude/settings.json`) and scripted (`/setup-plugins`). |

## New core skill to file as a fresh issue

**`/brain-doctor`** — a diagnostic + self-heal ritual that verifies the whole brain is wired: MCP
server reachable, `AI_OS_ROOT` set, team-brain clone healthy/synced, `tools/list` responds, connector
valid, Core plugins present. With this many moving parts, a one-command health check is a natural
"nice to have in core." To be filed as a new GitHub issue (not built in this branch).

## Release plan

Implement on `feat/mcp-brain-team-engine` (TDD) → merge to `dev` → verify CI green → PR `dev → master`
→ tag release `v1.1.0` with a changelog covering #305, #306, and the Core Plugin Bundle.
(Repo constraints: commits use `SKIP_SIMPLE_GIT_HOOKS=1`; changes reach `master` via PR only.)
