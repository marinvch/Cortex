# Changelog

All notable changes to Cortex. Format based on [Keep a Changelog](https://keepachangelog.com);
this project now versions independently of any package manager (see `VERSION`).

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
  use the `dir/*` form. The `inbox/`, `projects/`, `areas/` and `resources/` READMEs the rule
  promised are committed, so a fresh clone has the vault skeleton.
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

[1.1.0]: https://github.com/marinvch/ai-os/releases/tag/v1.1.0
[1.0.0]: https://github.com/marinvch/ai-os/releases/tag/v1.0.0
