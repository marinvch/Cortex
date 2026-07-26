# Cortex — Capability Layer — Design

**Date:** 2026-07-26 · **Status:** approved · **Supersedes nothing; extends [SPEC.md](../../../SPEC.md)**

---

## Context

Cortex today ships **knowledge**: `AGENTS.md` (what this project is) and `.cortex/memory/` (what we
learned, guarded and committed). What it does not ship is **capability** — knowing how to plan before
coding, how to navigate a large codebase, how to grow the brain when a developer needs something new.
An agent with perfect context and no method still flails.

The question that started this was "can we make some Claude Code plugins a core part of Cortex?"
Working through it, the answer turned out to be **mostly no — build them, don't bundle them** — but
for narrower reasons than first assumed, and with one significant correction recorded below.

**Intended outcome:** a repo that has run `cortex-init` gives an agent four things — what the project
is, what the team has learned, where everything lives, and the ability to extend itself — with no
third-party runtime dependency and no network egress.

---

## Decisions and why

### Owned: capability authoring

A skill that creates skills is itself just a skill. Cortex needs no code to author capabilities —
only markdown that teaches an agent to write them into *this* repo. Four meta-skills, zero
dependencies, and they work the moment they are written.

This also delivers the behaviour requested directly: the developer needs a skill, they ask, Cortex
creates it. No install step, no going to a marketplace.

### Owned: code intelligence, but not serena's shape

`serena` is a one-file shim that runs `uvx --from git+https://github.com/oraios/serena`. Enabling it
makes every developer's machine fetch and execute third-party Python at runtime and requires `uv`.
For a tool whose pitch is "safe inside a company's repo," that is disqualifying — on supply-chain
grounds, not on capability grounds.

Cloning serena is also the wrong target. Serena is **live**: it answers "where is this symbol?" by
querying an LSP at runtime. Cortex's differentiator is **durable**: a file committed to the repo,
reviewed in PRs, inherited on clone, readable by every agent including ones with no tooling. So
Cortex ships a committed structural map, not a live query engine.

### Recommended, not owned: process discipline

**Correction on record.** The original argument for owning process discipline was that plugins are
Claude Code-only, leaving a mixed team unevenly equipped. That is false. `superpowers`
(github.com/obra/superpowers) ships to eleven platforms — Claude Code, GitHub Copilot CLI, Gemini
CLI, Cursor, Codex App and CLI, Antigravity, Factory Droid, Kimi Code, OpenCode, Pi — each through
its native plugin system. The reach argument does not hold, and the decision was revised.

What remains is narrower: superpowers requires a per-developer, per-tool install, whereas `AGENTS.md`
is inherited on clone with zero steps. So Cortex owns the **floor** — the repo-specific
non-negotiables that no generic plugin could state ("never touch billing without a written plan") —
and recommends superpowers for the **ceiling**, the deep generic workflow. Cortex maintains nothing
generic and duplicates nothing.

### Excluded

| Plugin | Reason |
|--------|--------|
| `serena` | Third-party Python fetched at runtime; superseded by the owned map |
| `context7` | Requires network egress and a live docs corpus. Cortex structurally cannot own it; it contradicts the zero-egress guarantee. Offered as a labeled optional, never core. |
| `claude-md-management` | Audits and enriches `CLAUDE.md`. Cortex's thesis is that `CLAUDE.md` is a one-line shim and `AGENTS.md` is canonical, because content in two places drifts and agents act confidently on the stale copy. Good plugin, wrong direction for this architecture. |
| `remember` | Continuous memory with tiered logs — functionally `.cortex/memory/`, but user-scoped and with **no secret guard**. Memory here is committed and ungated, which makes the guard load-bearing; a second unguarded memory system beside it is how a credential reaches disk. |

`skill-creator`, `plugin-dev`, `mcp-server-dev`, `hookify` and `claude-code-setup` are superseded in
target repos by the owned meta-skills. They remain useful for developing Cortex itself and may be
recommended in this repo's own settings, which is out of scope here.

---

## Architecture

```
AGENTS.md                     knowledge + repo-specific rules   [built]
.cortex/
  map.md                      where things are                  [new]
  memory/gotchas.md           what we learned                   [built]
  memory/decisions.md         why we chose                      [built]
  plugins.json                recommended capabilities          [new]
  config.json                 version, settings                 [built]
  lib/                        vendored guard + map generator    [extend]
.claude/
  skills/cortex-skill/        create a repo-scoped skill        [new]
  skills/cortex-agent/        create a subagent                 [new]
  skills/cortex-hook/         create a hook                     [new]
  skills/cortex-mcp/          scaffold an MCP server            [new]
  hooks/cortex-reflect.mjs    session harvest                   [built]
```

Four layers: **knowledge**, **memory**, **map**, **capability**.

### Change to `AGENTS.md` rendering

The generated block gains a **`## Capabilities`** section listing the meta-skills and pointing at
`.cortex/map.md`, so an agent reading only `AGENTS.md` discovers what it can do and where the map is.
This sits inside the `cortex:generated` markers, so `--refresh` maintains it and hand-written prose is
still preserved. The meta-skills append to this list when they create something new.

### Vendoring

`src/map.mjs` is vendored into `.cortex/lib/` alongside the guard, because the `SessionEnd` hook
regenerates the map long after `npx` is gone and teammates who clone never run the installer at all.

---

## Components

### `src/map.mjs` — structural map generator

Zero-dependency heuristic extraction. No parser, no native bindings, no change to the install weight.

Extracts:

- **Entry points** — `package.json` `bin`/`main`/`scripts`, plus framework conventions
- **Module graph** — `import` / `require` / `from` statements via regex, which is reliable for this
- **Exported surface** — `export function|const|class|default` per file
- **Routes** — framework-aware (`app/**/route.ts`, `pages/api/**`, `routes/`)
- **Data layer** — `prisma/schema.prisma`, `models/`, `migrations/`
- **Size signal** — line counts, to surface files that are doing too much

**Output is markdown, not JSON.** The consumer is an LLM reading a file — including a Copilot user
with no tooling — and it must diff readably in review. JSON would be machine-friendlier and worse for
the actual reader.

**Fidelity is stated, not implied.** Extraction is strong on JS/TS and degrades on languages with
different import syntax. The map declares which languages it read and which it could only list, so a
reader is never misled about coverage.

**Language scope: JS/TS first.** Other languages get file listing and directory structure only, and
the map says so. The extractor is shaped as a per-language module (`{ match, extract }`) so adding a
language later is additive rather than a rewrite — but no second language ships until JS/TS fidelity
is measured against fixtures.

**Generated by default**, since the map is core value rather than an add-on. `--no-map` opts out for
repos that would rather not carry it.

**File cap: 2000 files scanned**, largest-first by directory relevance. On hitting the cap the map
records the count scanned, the total found, and that the list is partial.

### Staleness control

A committed map that drifts is worse than none, because agents trust it. `map.md` carries a content
hash of its inputs. The `SessionEnd` hook compares and regenerates on drift.

Diff noise is naturally bounded: the map is derived from *structure*, so renaming a local variable
changes nothing and adding a route changes one line.

### Meta-skills

Each instructs the agent to: ask intent → write the file with correct frontmatter → register it in
the `AGENTS.md` capability list → refuse to duplicate an existing one.

| Skill | Writes |
|-------|--------|
| `cortex-skill` | `.claude/skills/<name>/SKILL.md` |
| `cortex-agent` | `.claude/agents/<name>.md` |
| `cortex-hook`  | `.claude/hooks/<name>.mjs` + merged `settings.json` entry |
| `cortex-mcp`   | `.mcp.json` entry + server scaffold |

They are repo-scoped: a generated skill knows this codebase, which is the thing a generic marketplace
skill cannot be.

### `.cortex/plugins.json` — declare, never install

`cortex-init` writes the manifest and prints the install command. Writing `enabledPlugins` into the
target repo requires an explicit `--with-plugins`. A developer at a bank gets a recommendation, not a
mutation of their environment.

---

## Error handling

- **Map generation never fails the install.** On error it degrades to a partial map with a note
  naming what it skipped and why.
- **Respects `.gitignore` and `.cortexignore`.**
- **Caps files scanned at 2000 and records it in the map.** Silent truncation reads as "this is
  everything," which is the failure mode that makes a map dangerous.
- All writes continue to route through `resolveInRepo`, so nothing escapes the target repo.
- Nothing in this layer adds a network call; `npm run check:egress` continues to gate that in CI.

## Testing

| Check | How |
|-------|-----|
| Map extraction | Fixture repos per stack, asserting extracted entry points, graph edges, routes |
| Map degradation | A fixture with unreadable/unknown-language files — assert the map says so rather than omitting silently |
| Staleness | Mutate a fixture's structure, assert the hash changes and regeneration triggers |
| Install | New files written; `AGENTS.md` capability list references each meta-skill |
| `plugins.json` | Schema test; assert `enabledPlugins` is **not** written without `--with-plugins` |
| Regression | Existing guard, paths and install suites stay green |

---

## Out of scope

- Live symbol queries / LSP integration. Explicitly rejected above.
- Owning a documentation corpus (the `context7` capability).
- Recommending a plugin set for developing Cortex itself.

## Suggested sequencing

The pieces are independent enough to land separately, in increasing order of risk:

1. **Meta-skills + `AGENTS.md` capability section** — pure markdown templates, no new code paths
2. **`.cortex/plugins.json`** — small, and gates the `--with-plugins` behaviour
3. **Map generator** — the only real engineering, and the only piece that can disappoint

## Known gaps, carried forward

Not addressed by this design and still open from [SPEC.md](../../../SPEC.md): the package is not
published to npm, `gotchas.md` conflicts across parallel branches have no merge strategy, and there
are no non-JS install fixtures.
