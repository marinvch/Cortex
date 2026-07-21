# Cortex Vault — Operating Manual

The single source of truth for any AI agent working in this vault. Claude reads `CLAUDE.md`
(a shim importing this file); Gemini reads `GEMINI.md` (same). Other tools read this file natively.

## What this is

A **personal + business second brain** — a plain-markdown knowledge vault, Obsidian-style but
app-optional. No build step, no engine — the core is just files you own, readable by any editor and
by AI. (An **optional** Node MCP "brain" in `mcp/` adds live recall/capture; the vault works fully without it.) Two systems share one folder: a **knowledge layer** (capture → notes → maps) and an
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

## Prompt Optimization Protocol

Before acting on a prompt, score it: under 10 words `+2`; no action verb `+1`; no component
reference `+1`; no domain keyword `+1`. **Score 3 or higher → run [[optimize-prompt]] first** — ask
at most 2 questions grounded in this repo's real names, synthesize one precise prompt, confirm it,
save it to `docs/prompts/`, then route to the named ritual. Below 3, act on the prompt as written
and say nothing about scoring.

Skip entirely for slash commands, confirmations ("yes", "continue"), prompts naming an exact file,
and prompts saying "just" or "quickly". In Claude Code a `UserPromptSubmit` hook enforces this
automatically; every other agent applies it from this section.

## The rituals (canonical in `skills/`; copy to `.claude/skills/` for `/slash` commands)

- `/onboard` (once) — interview the user, fill `context/`, seed `home.md`, populate `connections.md`.
- `/capture` (anytime) — one-line drop to `inbox/` or today's daily note.
- `/daily` (each day) — start today's daily note from the template; surface priorities + due items.
- `/weekly-review` (weekly) — empty `inbox/`, update `projects/`, restamp `current-focus`, archive stale.
- `/audit` (weekly) — read-only Four-Layer health score with the top gaps to close.
- `/level-up` (biweekly) — Notice→Decide→Build interview; surface one piece of leverage; ship one artifact.
- `/install-project` (per repo) — stamp a *codebase brain* into a specific repo: scans the code and
  writes a project `AGENTS.md` + scoped `/plan-feature` and `/investigate-bug` skills. Isolated to
  that repo — company code never enters this personal vault.
- `/scan-projects` (anytime) — opt-in, metadata-only bridge: list which repos on your machine have a
  codebase brain and register the missing ones into `projects/` (name/path/URL/stack only — no code).
  Pairs with `cortex-init --register-to-vault`. Keeps the privacy firewall intact.
- `/migrate-engine` (per repo, once) — migrate a repo off the OLD engine-based AI OS (`.ai-os/` +
  `.github/ai-os/` MCP system) onto the plain-files brain. **Harvests the engine's memory store into
  `AGENTS.md` first, then removes the old files** so no knowledge is lost across the breaking change.
- `/analyze-spec` (per feature) — Spec-Driven Development grounded by the repo brain: brainstorm →
  design spec → plan, **no code**. Bridges Cortex (context) with Superpowers (workflow). Use for
  risky/critical changes; `/plan-feature` stays the lightweight path for routine tickets.
- `/scope-area` (per critical part) — give a critical directory its own deep **scoped `AGENTS.md`
  leaf** + a routing table in root, so agents load narrow, high-signal context (faster, cheaper,
  less drift). One filename (`AGENTS.md`), nested — not a sprawl of per-topic files. Split only
  where there's a real invariant/gotcha.
- `/reindex` (periodic) — keep the vault navigable as it grows: regenerate the visual **navigator**
  (`tools/cortex.sh` → `cortex.html`, an Obsidian-style force graph + search), nominate
  topics that need a **Map of Content**, and resolve genuine dead links. Navigate by MOCs + links,
  not folder depth.
- `/connect-brain` (once per machine) — register the live **MCP brain** (`mcp/server.js`) at user scope
  so every project on this machine can `recall`/`capture` against the vault with zero per-project setup.
- `/setup-plugins` (per machine/team) — install the **Cortex Core plugin bundle** out-of-the-box
  (analysis + skill/plugin creation) via `ai-os setup-plugins`; offer the optional tiers by role.
- `/team-init` (leader, once) — create + seed the shared **team-brain** repo (one folder per project) and push.
- `/team-add` (member, per product repo) — clone the team-brain locally + drop a generic `.cortex/connector.json`
  so teammates inherit the wiring on clone. Never auto-commits the product repo.
- `/catch-me-up` (after time away) — assemble brain notes + team-brain git history since a date via
  `catch_me_up`, then summarize *what changed & why*.
- `/skill-creator` (on request) — create a tailored new ritual: ask intent, write a plain
  `skills/<name>/SKILL.md`, and wire it into `AGENTS.md` + README + `.claude/skills/`. Cortex grows
  its own skills on demand. (Adapted from Anthropic's skill-creator; deeper rigor via `superpowers:writing-skills`.)
- `/cortex-doctor` (periodic) — the **vault architecture doctor**: scans *every* file for orphan
  (non-connected) files, dead links, stale/old files, redundant duplicates, and misplaced/malformed
  files, then fixes them (wire in, archive, move — never delete) so Cortex stays structurally optimal.
  Structural health, distinct from `/audit` (content-layer scoring) and `/reindex` (graph regen).
- `/cortex-audit` (on request) — the **one-shot meta-audit**: dispatches the read-only
  `cortex-auditor` subagent (`.claude/agents/cortex-auditor.md`) to scan the whole vault in an
  isolated context — structure *and* a four-layer content-health signal — then applies the safe
  fixes and surfaces the judgment calls. The subagent-driven superset of `/audit` + `/cortex-doctor`;
  reach for it when you want "check everything and clean it up" in a single step.
- `/optimize-prompt` (automatic) — the **prompt gate**: scores each incoming prompt and, when it's
  vague, asks up to two grounded questions, synthesizes one precise prompt for confirmation, saves it
  to `docs/prompts/` (gitignored), and routes the work to the right ritual. Enforced by a
  `UserPromptSubmit` hook in Claude Code; by the protocol section above everywhere else.

Each ritual is a plain-markdown `SKILL.md` under `skills/` (the canonical copy). Expose them as
`/slash` commands with `cp -r skills/* .claude/skills/`, or just say a ritual's name to any AI tool.
The `cortex-auditor` custom subagent lives in `.claude/agents/` and is invoked by `/cortex-audit`.
