# Cortex Vault — Operating Manual

The single source of truth for any AI agent working in this vault. Claude reads `CLAUDE.md`
(a shim importing this file); Gemini reads `GEMINI.md` (same). Other tools read this file natively.

## What this is

A **personal + business second brain** — a plain-markdown knowledge vault, Obsidian-style but
app-optional. No build step, no engine, no Node. Just files you own, readable by any editor and
by AI. Two systems share one folder: a **knowledge layer** (capture → notes → maps) and an
**operating layer** (who you are, what you can reach, and the rituals that keep it alive).

## The one rule (privacy)

Personal and business-sensitive content lives in **gitignored** folders: `context/`, `inbox/`,
`daily/`, `notes/`, `projects/`, `areas/`, `decisions/`. Committed files (`README`, this manual,
`references/` frameworks, `templates/`) stay **data-free** so the vault stays shareable/forkable.
Never write personal facts into committed template files.

## How the vault is organized

- `home.md` — the Map of Content. Entry point. Start here.
- `inbox/` — capture zone. Everything lands here first.
- `daily/` — one note per day (`YYYY-MM-DD.md`). Log + journal.
- `notes/` — permanent, atomic, `[[wikilinked]]` notes. The actual knowledge graph.
- `projects/` — outcome + deadline (personal or business). `areas/` — ongoing responsibilities.
  `resources/` — topic reference material. (PARA.)
- `context/` — about-me, about-business, priorities, how-i-work, values, current-focus.
- `connections.md` — every tool/data source the vault can reach.
- `decisions/log.md` — append-only "what I decided and why."
- `references/` — the frameworks ([[operating-principles]], [[vault-architecture]]), voice.
- `templates/` — copy these to start new notes. `archives/` — old stuff; move, don't delete.

## How this brain thinks

Follow [[operating-principles]]: **Notice → Decide → Build.** Capture relentlessly (knowledge
leaves the user's head). Before automating, eliminate waste first, then default to the lowest
autonomy that works. Build the boring, deterministic version and validate each step. The four
layers you're maintaining are in [[vault-architecture]]: Capture, Knowledge, Context, Cadence.

## The rituals (canonical in `skills/`; copy to `.claude/skills/` for `/slash` commands)

- `/onboard` (once) — interview the user, fill `context/`, seed `home.md`, populate `connections.md`.
- `/capture` (anytime) — one-line drop to `inbox/` or today's daily note.
- `/daily` (each day) — start today's daily note from the template; surface priorities + due items.
- `/weekly-review` (weekly) — empty `inbox/`, update `projects/`, restamp `current-focus`, archive stale.
- `/audit` (weekly) — read-only Four-Layer health score with the top gaps to close.
- `/level-up` (biweekly) — Notice→Decide→Build interview; surface one piece of leverage; ship one artifact.

Each ritual is a plain `SKILL.md` (no engine, no Node). They live in `skills/` (committed,
shareable); run `cp -r skills/* .claude/skills/` to expose them as Claude Code `/slash` commands.

## Working style (defaults until `context/how-i-work.md` says otherwise)

- Be direct and concise. Lead with what needs action. Answer the question asked.
- When the user decides something, offer to log it in `decisions/log.md`.
- When the user repeats a manual task 3+ times, flag it for `/level-up`.
- Draft in the user's voice (`references/voice.md`); never publish external content without a draft first.
- Match existing file conventions. Use `[[wikilinks]]` to connect notes. Keep templates data-free.

## Note conventions

- YAML frontmatter on every note: at least `type`, `title`, `tags`. Daily/notes add `date`/`created`.
- One idea per note in `notes/`. If the title needs "and", split it.
- Link generously — a note with no links is a dead end.

## Legacy

An earlier engine-based system (`engine/`, three-domain data boundary) was retired in favor of
plain files. `engine/` may still exist on disk but is **not part of the active path** — ignore it
unless explicitly asked. The active frameworks are [[operating-principles]] and [[vault-architecture]].
