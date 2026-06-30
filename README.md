# 🧠 Cortex Vault — your personal + business second brain

A plain-markdown knowledge vault, Obsidian-style but **app-optional**. No build step, no engine,
no Node — just files you own, readable by any editor and by AI (Claude, etc.). It combines a
**knowledge layer** (capture → atomic notes → maps of content) with an **operating layer** (who
you are, what the brain can reach, and the rituals that keep it alive).

> One rule: capture first, organize later. Nothing lives only in your head.

## Start here

1. Open `home.md` — the map of the whole vault.
2. Run the **`onboard`** ritual (`skills/onboard/`) so the brain learns who you are.
3. Each morning run **`daily`**; capture freely with **`capture`**; on Fridays run **`weekly-review`**.
4. Weekly **`audit`** scores the vault; biweekly **`level-up`** finds one piece of leverage to ship.

## The layers (see `references/vault-architecture.md`)

| Layer | Folder(s) | Job |
|---|---|---|
| **Capture** | `inbox/`, `daily/` | Nothing is lost |
| **Knowledge** | `notes/`, `projects/`, `areas/`, `resources/` | Ideas connect into a graph |
| **Context** | `context/`, `connections.md` | The brain knows you and your tools |
| **Cadence** | `skills/`, scheduled tasks | It runs without being asked |

How the brain thinks: `references/operating-principles.md` (Notice → Decide → Build).

## Privacy

Personal and business content (`context/`, `inbox/`, `daily/`, `notes/`, `projects/`, `areas/`,
`resources/`, `decisions/`) is **gitignored** — it never leaves your machine. The committed files
(this README, `AGENTS.md`, `references/` frameworks, `templates/`) are data-free, so the vault
itself stays shareable and forkable.

## Give any repo a codebase brain (one-liner)

Run this **inside any project repo** — it detects the stack (package manager, framework, language),
scripts, `tsconfig`, lint/CI, and route/source directories, then **scaffolds** an `AGENTS.md` +
agent shims (Claude/Gemini/Copilot/Cursor) + dev-cycle skills into that repo. Works in any shell
(bash, zsh, gitbash, PowerShell) and under either runtime:

```bash
npx  github:marinvch/ai-os     # Node
bunx github:marinvch/ai-os     # Bun
```

> It scaffolds from what it can detect, leaving `<…>` blanks for prose it can't infer. For a deep,
> **AI-driven** pass that fills Architecture / Conventions / Gotchas from the actual code, open the
> repo in Claude Code and run **`/install-project`**.

Non-interactive (CI, scripts, agents)? Use flags, pipe the four answers, or take all defaults:

```bash
npx github:marinvch/ai-os --yes
npx github:marinvch/ai-os --name=App --purpose="..." --agents=claude,gemini
printf 'MyApp\nWhat it does\nKey rule\nall\n' | npx github:marinvch/ai-os
```

It's **brownfield-safe**: a curated `AGENTS.md`/`CLAUDE.md` is never clobbered (you get
`AGENTS.generated.md` to diff instead), existing files back up to `*.bak`, and it warns if a
generated file is gitignored. `--additive` refreshes only the skills. Optionally register the repo
with your personal vault (metadata only, opt-in): `--register-to-vault ~/vault`. Run `--help` for
all flags. Source: `tools/cortex-init.mjs`.

## Skills (rituals)

Plain `SKILL.md` files in `skills/`. Say "run my onboard skill" in Cowork/Claude Code, or copy
them into `.claude/skills/` to use as `/slash` commands (`cp -r skills/* .claude/skills/`).

Includes `/scan-projects` — an opt-in, metadata-only bridge that lets the vault learn which repos
on your machine have a codebase brain (no code ever leaves the repo). It pairs with
`cortex-init --register-to-vault`.

### Migrating off the old engine

If you install on a repo that still has the **old engine-based AI OS** (`.ai-os/`,
`.github/ai-os/`, an `ai-os` MCP entry), both `cortex-init` and `/install-project` **detect it and
prompt you to run `/migrate-engine` first**. That ritual harvests the engine's memory store into
`AGENTS.md` (so accumulated knowledge isn't lost), logs the change in `docs/decisions.md`, backs
everything up, then removes the old files. Harvest before delete — always.

## What changed from the old setup

This folder was previously an engine-based AIOS ("Cortex"). It was rebuilt into this plain-files
second brain — see `00-AUDIT-AND-PLAN.md` for the full audit and rationale. The old `engine/`
remains on disk but is retired and not part of the active path.

## License

MIT. Your notes are yours.
