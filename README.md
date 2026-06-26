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

## Skills (rituals)

Plain `SKILL.md` files in `skills/`. Say "run my onboard skill" in Cowork/Claude Code, or copy
them into `.claude/skills/` to use as `/slash` commands (`cp -r skills/* .claude/skills/`).

## What changed from the old setup

This folder was previously an engine-based AIOS ("Cortex"). It was rebuilt into this plain-files
second brain — see `00-AUDIT-AND-PLAN.md` for the full audit and rationale. The old `engine/`
remains on disk but is retired and not part of the active path.

## License

MIT. Your notes are yours.
