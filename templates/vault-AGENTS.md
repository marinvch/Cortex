# Cortex Vault — Operating Manual

The operating manual for a **Cortex vault**: a plain-markdown second brain that the Cortex rituals
read and write. Copy this file to the vault root as `AGENTS.md`, beside a `CLAUDE.md` containing
`@AGENTS.md`. `/onboard` and `tools/cortex-vault-extract.sh` both do that when it is missing.

A vault is **not** the Cortex repository. Cortex is the product — cloned, installed as a plugin and
pointed at codebases. A vault is one person's data, in its own private repo, and the `ai-os` MCP
server reaches it through `AI_OS_ROOT`.

## What this is

A plain-markdown knowledge vault, Obsidian-style but app-optional. One folder holds two systems: a
**knowledge layer** (capture → notes → maps) and an **operating layer** (who you are, what you can
reach, the rituals that keep it alive). No build step and no engine — the MCP brain adds live
recall and capture, and the vault works fully without it.

## The one rule (privacy)

Everything here is private. Keep the vault in its own repository with a **private** remote, and
never copy its content into a repository that is shared — the Cortex source included.

Archived content must stay private: **archiving is not sanitizing.** Move, never delete, and when a
file is moved anywhere a shared repo can see, confirm with `git check-ignore -v <path>`.

## The firewall (hard rule — overrides convenience)

**One vault holds exactly one world**, and the **profile** says which — `home`, `work` or `lab`,
declared with `CORTEX_PROFILE` and defaulting to `home`. `core/profile.js` owns the policy,
`/cortex-profile` reports and sets it, and
[ADR 0015](https://github.com/marinvch/Cortex/blob/master/docs/adr/0015-a-profile-is-the-world-an-install-serves.md)
records why it is declared rather than detected. The MCP server's startup line prints it.

- **`home`** — a personal machine: personal projects, principles and knowledge only. Never write
  employer or client names · day-job projects, tickets, features or bugs · work deadlines, sprints
  or standups · colleague names · internal architecture, URLs, credentials or code. Role-level
  detail counts too ("front-end at a telecom provider") — the aggregate is the leak, and gitignore
  is not a security boundary.
- **`work`** — the same rule read from the other side: this employer's work only, no personal side
  projects, and company code stays in the company's repos.
- **`lab`** — refuses nothing, and therefore publishes nothing.

**Where the other world's knowledge belongs:** a separate vault on the other machine (the two never
sync), or the repo's own committed context layer — `AGENTS.md`, `.cortex/memory/` — which a team
shares through that repo and which never enters a vault.

**Enforcement — every ritual obeys this:**
- `/onboard` — asks which world first, and on `home` never asks for employer, client or day-job
  detail.
- `/capture`, `/daily` — material from the other world: **refuse the write** and say where it
  belongs. Never "sanitize and file anyway."
- `/audit`, `/cortex-audit` — content from the other world is a **critical finding**, not a style
  nit. Move it out of the vault and report it.
- `/scan-projects` — on `home`, personal repos only; never a repo under a work directory.

## How the vault is organized

`home.md` is the entry point — a Map of Content linking out to everything that matters.

| Path | Holds | Note |
|---|---|---|
| `inbox/` | raw capture | everything lands here first; empty it weekly |
| `daily/` | one note per day | `YYYY-MM-DD.md`; log + journal |
| `notes/` | the knowledge graph | permanent, atomic, wikilinked |
| `projects/` | outcome + deadline | PARA |
| `areas/` | ongoing responsibility, no end date | PARA |
| `resources/` | topic reference material | PARA |
| `context/` | who the user is | about-me, priorities, how-i-work, values, current-focus |
| `connections.md` | every tool/data source the vault can reach | |
| `decisions/log.md` | append-only "what I decided and why" | |
| `archives/` | old material | **move, never delete** |

The frameworks — operating-principles, vault-architecture, codebase-design, voice — ship with Cortex
in its `references/`, and the note starters in its `templates/`.

## How this brain thinks

Follow operating-principles: **Notice → Decide → Build.** Capture relentlessly so knowledge leaves
the user's head. Before automating, eliminate the waste first, then default to the lowest autonomy
that works. Build the boring, deterministic version and validate each step. The four layers you
maintain are in vault-architecture: Capture, Knowledge, Context, Cadence.
