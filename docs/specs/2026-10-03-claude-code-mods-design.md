# Design: what Cortex owes Claude Code mods and native `AGENTS.md` loading

- **Date:** 2026-10-03
- **Status:** Draft for review
- **Decided by:** the maintainer, in the brainstorm that followed 2.41.9 (the docs check that now
  reports unread pages)
- **Area:** `core/claude-code.js` (new rules), `index/lib/claude-setup.mjs` (new findings),
  `templates/` (two fence notes), `docs/adr/` (one new record). Scoped briefs:
  [`core/AGENTS.md`](../../core/AGENTS.md), [`index/AGENTS.md`](../../index/AGENTS.md).

## Destination

- Every claim Cortex makes about mods or about how `AGENTS.md` loads is a rule in
  `core/claude-code.js` with its sentence, so the daily docs check notices when Anthropic changes it.
- A repo that is itself a plugin with a mod gets structural findings about that mod, of the same
  kind Cortex already reports for settings hooks.
- A repo that keeps the `CLAUDE.md` → `@AGENTS.md` shim and has scoped `AGENTS.md` leaves is told
  that those leaves do not load on their own, and which setting changes that.
- The fences Cortex stamps say truthfully what an installed mod can override.
- Cortex ships no mod, and an ADR says why.

## Context

**Mods.** Claude Code v2.1.287 (blog post 2026-10-01) added mods: a plugin whose
`hooks/hooks.json` names a hooks module under `modules`, and whose module exports
`register(on, options)`. The handlers run inside Claude Code, unsandboxed, with the user's
permissions. The docs now call the older kind "settings hooks" and use "hook" for a mod's handler.
Sources: `plugins/mods/overview`, `plugins/mods/reference`, `plugins/mods/admin`.

**What Cortex has today.**
- `core/claude-code.js` holds 41 rules from nine pages. None comes from a mods page, and the two
  `claude-md.*` rules sourced from `memory` say nothing about `AGENTS.md`.
- `index/lib/claude-setup.mjs` has four hook findings (`settings-not-json`, `hook-script-missing`,
  `hook-script-not-executable`, `post-tool-use-exit-2`). `inspectHooks` reads settings files; it
  does not read a plugin's `hooks/hooks.json`.
- `/cortex-scaffold` writes `CLAUDE.md` and `GEMINI.md` as one line, `@AGENTS.md`, and `/cortex`
  appends `## Verifying your work` to `CLAUDE.md` (`index/lib/loop.mjs` reads that heading).
- `/cortex-brief` writes scoped `AGENTS.md` leaves and wires them into the root routing table.
- `/cortex` stamps `templates/loop/protected-paths.sh` as a `PreToolUse` hook, and the agent team's
  Tester carries `templates/team/test-paths.sh` the same way. `templates/team/README.md` lists what
  that fence cannot cover.
- The plugin ships no hooks. The `SessionStart` notice was considered and dropped on 2026-09-30.

**What the docs say that touches this.**
1. *Native `AGENTS.md`.* "By default, Claude reads `AGENTS.md` only when you have no `CLAUDE.md` in
   your working directory or above it." When none counts, a subdirectory's `AGENTS.md` loads "when
   Claude opens a file there with the Read tool". With Cortex's shim at the root, a `CLAUDE.md`
   counts, so the scoped leaves are not loaded automatically. They are reached only through the
   routing table.
2. *The shim is still valid.* "Keeping the import never makes Claude read `AGENTS.md` twice". The
   docs recommend keeping it when some sessions cannot load `AGENTS.md` directly: before v2.1.277,
   with the built-in `agents-md` plugin disabled, and some sessions before v2.1.281.
3. *The setting that loads both.* **Project instructions** = `claude-md-and-agents-md` reads each
   directory's `CLAUDE.md` and then its `AGENTS.md`. "Claude Code ignores it in project and local
   settings files", so a repo cannot set it for its team; each developer or a managed policy does.
4. *A mod can override a project fence.* "A user's mod that approves tool calls can approve a call
   that an `ask` rule would prompt for, or that a `PreToolUse` hook outside managed settings
   blocked." A `deny` rule holds only where the built-in guard loads (managed settings, or a Team or
   Enterprise sign-in).
5. *A mod's layout.* `hooks/hooks.json` holds "`modules`: an array with one path, relative to this
   file, to the hooks module". The module is "Named `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`,
   `.cts`, or `.tsx`."

**Why now.** 2.41.9 made the check able to see the mods pages. It recorded them as seen without
deciding anything about them. This spec is that decision.

## Decisions locked

1. **The shim stays.** `/cortex-scaffold` keeps writing `CLAUDE.md` as `@AGENTS.md`. It works on
   every Claude Code version, and `## Verifying your work` lives in it.
2. **Cortex reports the cost of the shim.** A line in the findings summary and in `cortex-next`
   appears when a repo has a root `CLAUDE.md` and at least one `AGENTS.md` below the root. It says
   the leaves load only by routing, and names `claude-md-and-agents-md` as the per-developer setting
   that loads them. It is not a finding, because no change to the repo fixes it.
3. **Mod findings are structural only.** Cortex checks what a file listing and a JSON parse can
   prove. It does not read a mod's code for API calls; `claude plugin validate` does that, and a
   regex copy of it would miss cases and disagree with the real one.
4. **One informational finding names the mod.** A repo that ships a mod is told the module runs
   unsandboxed and that `claude plugin validate <dir>` lists what it handles and calls.
5. **Cortex ships no mod.** Not a band for `/cortex-next`, not a port of `optimize-prompt`. A mod is
   unsandboxed code in every user's session, it does not load under `allowManagedModsOnly`, and the
   team at work is the audience most likely to run under that policy. Recorded as ADR 0021.
6. **Rule ids keep the `hook.` prefix; prose says "settings hook" where a mod could be meant.** The
   ids are referenced by findings and tests. Only user-facing text changes, and only where the two
   kinds could be confused.
7. **The fences state the mod limit.** `templates/team/README.md` and the note beside
   `protected-paths.sh` gain one line each: an installed mod that approves tool calls can approve a
   call these hooks blocked.

## Architecture

### Rules (`core/claude-code.js`)

Three new source constants: `MODS` (`plugins/mods/overview`), `MODS_REF` (`plugins/mods/reference`)
and `MODS_ADMIN` (`plugins/mods/admin`). `MEMORY` already exists. Each rule below enters only with
the sentence copied from the page.

| Rule id | Value | Source | Used by |
|---|---|---|---|
| `mod.min-version` | `"2.1.287"` | overview | finding text |
| `mod.not-sandboxed` | `true` | overview | `mod-present` finding |
| `mod.hooks-json.modules` | `"modules"` | reference (Files table) | `mod-module-missing`, `mod-modules-not-one` |
| `mod.module.extensions` | the eight extensions | reference (Files table) | `mod-module-extension` |
| `mod.approves-past-pretooluse` | `"PreToolUse"` | admin | the two template notes; no finding |
| `agents-md.default-needs-no-claude-md` | `"claude-md-or-agents-md"` | memory | `agents-md-leaves-not-loaded` |
| `agents-md.setting-loads-both` | `"claude-md-and-agents-md"` | memory | `agents-md-leaves-not-loaded` |
| `agents-md.import-not-read-twice` | `"@AGENTS.md"` | memory | `/cortex-scaffold` prose, ADR 0021 |
| `agents-md.min-version` | `"2.1.277"` | memory | finding text |

The checker fixture name is the last URL segment (`overview.md`, `reference.md`, `admin.md`). Three
mods pages share no basename with an existing source, but `overview` is a common name: see Risks.

### Findings (`index/lib/claude-setup.mjs`)

`gather` learns two things, both from files the walker already lists:

- **Mod manifests.** Every `hooks/hooks.json` whose directory has a sibling
  `.claude-plugin/plugin.json`. A `hooks.json` with no `modules` key is settings hooks only and is
  not a mod.
- **Leaf briefs.** Every `AGENTS.md` that is not at the root, and whether a root `CLAUDE.md`,
  `.claude/CLAUDE.md` or `CLAUDE.local.md` exists.

| Finding kind | Rule | Severity | Fires when |
|---|---|---|---|
| `mod-module-missing` | `mod.hooks-json.modules` | medium | a `modules` path, resolved from `hooks.json`, names no file |
| `mod-modules-not-one` | `mod.hooks-json.modules` | medium | `modules` is not an array of exactly one string |
| `mod-module-extension` | `mod.module.extensions` | medium | the module exists and its extension is not one of the eight |
| `mod-present` | `mod.not-sandboxed` | low | a mod parses and its module exists |

One more fact is reported outside this table, as a line in the findings summary and in `cortex-next` (see Risks for why it is not a finding): a root `CLAUDE.md` counts and at least one leaf `AGENTS.md` exists, so the leaves load only by routing. It cites `agents-md.default-needs-no-claude-md` and names the setting in `agents-md.setting-loads-both`.

A `hooks/hooks.json` that does not parse needs no mod finding: the checker already reads a
plugin's `hooks.json` as a settings file, so it is reported as `settings-not-json` (found while
building step 2; the draft of this spec listed a fifth finding for it).

Invariants this must not break, from the leaf briefs and `docs/changing-cortex.md`:

- **Determinism.** Findings come from the index and file reads, sorted, with no network and no
  model. Same repo, same report.
- **Ranking is control flow.** `analyse()`'s order drives the install wizard (ADR 0006). The two low
  findings carry no offer, so they add no step to the interview. The medium ones follow the existing
  hook findings and also carry no offer: Cortex does not write mods.
- **Cortex follows its own rules.** `tools/test/cortex-follows-its-own-rules.test.sh` runs these
  findings over this repo. Cortex has a root `CLAUDE.md` and four leaves, so
  the leaves fact is true here. That is why it is a report line and not a finding: see Risks.
- **Layering.** The rules live in `core/`; `index/` reads them. Nothing in `core/` reads a file.

### Templates and prose

- `templates/team/README.md`, under what the fence cannot cover: an installed mod.
- `templates/loop/`: the note that documents `protected-paths.sh` gains the same line. The template
  still ships the thing that refuses; the note says who can overrule it.
- `skills/cortex-scaffold/SKILL.md`: one sentence beside the shim rule, saying why it stays and that
  the import is never read twice. This skill is in `evals/skills.mjs` only if listed there; if it
  is, the body edit requires a re-measure (ADR 0018).
- `references/claude-code.md`: "What it covers today" gains mods and `AGENTS.md` loading.

### ADR 0021 — Cortex ships no mod, and keeps the shim

Records decisions 1 and 5 with their rejected alternatives: removing the shim (breaks sessions that
cannot load `AGENTS.md`, loses the home of the verification block), writing a `CLAUDE.md` into every
leaf directory (breaks `/cortex-brief`'s one-filename rule), shipping a `/cortex-next` band as a mod
(unsandboxed, blocked by the policy the work audience is likeliest to have).

## Risks & edges

- **Cortex fails its own check.** `agents-md-leaves-not-loaded` fires on this repo: a root
  `CLAUDE.md` and leaves in `core/`, `index/`, `mcp/` and `tools/`. The self-check
  (`tools/test/cortex-follows-its-own-rules.test.sh`) fails on **any** finding, on the principle
  that a finding in Cortex's repo is a defect. This one cannot be fixed in a repo, because the
  setting that fixes it is ignored in project settings. There were two ways out, and the maintainer
  chose the first on 2026-10-03:
  - *Chosen:* it is not a `claude-setup/` finding. It is a line in the findings report's
    summary and in `cortex-next`, stated as a fact about the repo with the setting to change. The
    self-check's principle stays whole: everything it reports, a repo can fix.
  - *Alternative:* keep it a finding and teach the self-check to pass findings marked
    `fixableIn: "user-settings"`. That adds a field every future finding must set correctly.
  Loosening the checker so this repo passes is ruled out by `docs/changing-cortex.md`.
- **Fixture name collisions.** `cortex-claude-docs.mjs --pages` reads `<dir>/<last segment>.md`.
  `overview` and `reference` are names other doc sections also use. If a later rule cites
  `agent-sdk/overview`, two sources would share one fixture. The fix is to key fixtures on the path
  under `/docs/en/` with `/` replaced; it belongs in step 1 because it is cheapest before the mods
  rules exist.
- **A false `mod-present`.** A plugin can keep settings hooks in `hooks/hooks.json` with no
  `modules`. Requiring the key keeps those out.
- **Monorepos with several plugins.** Each `hooks/hooks.json` beside a manifest is judged on its
  own; evidence lines name the path.
- **Docs drift.** The mods pages are days old and will be reworded. Each reworded sentence opens a
  `docs-drift` report the next morning. That is the system working, and it is also maintainer load
  for the first weeks.
- **Rollback.** Rules and findings are additive. Reverting the release removes them; no target repo
  holds state from this change.

## Not yet specified

- **Mods a repo installs but does not contain.** `enabledPlugins` in a repo's settings names
  plugins; whether one holds a mod is not knowable without fetching it. What Cortex should say about
  a repo that enables third-party plugins is not sharp yet.
- **Whether the leaves loading automatically changes outcomes.** The finding assumes automatic
  loading is worth having. Nothing has measured an agent with and without it on a repo with scoped
  briefs. An eval could, once the shape of that eval is clear.
- **`InstructionsLoaded`.** The docs say these hooks do not fire for an `AGENTS.md` read through the
  setting. Cortex stamps no such hook today; if it ever does, this matters.
- **The `optimize-prompt` hook.** It is a settings hook in this repo's own `.claude/`, not shipped.
  Whether its terminology or behaviour should change is unexamined.

## Out of scope

- A mod of any kind in the Cortex plugin.
- Reading a mod's source for mods API calls or event names.
- Removing or rewriting the `CLAUDE.md` shim in repos Cortex already stamped.
- Writing settings into `~/.claude/settings.json` to switch on `claude-md-and-agents-md`.
- Managed-settings advice for organisations (`allowManagedModsOnly`, `prependPlugins`).
