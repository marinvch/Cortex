# Cortex Vault — Operating Manual

The operating manual for a **Cortex vault**: a plain-markdown second brain that the Cortex rituals
read and write. Copy this file to the vault root as `AGENTS.md`, beside a `CLAUDE.md` containing
`@AGENTS.md`. `/personal-setup` and `tools/cortex-vault-extract.sh` both do that when it is missing.

A vault is **not** the Cortex repository. Cortex is the product — cloned, installed as a plugin and
pointed at codebases. A vault is one person's data, in its own private repo, and the Cortex MCP
server reaches it through `CORTEX_ROOT` (a server registered earlier with `AI_OS_ROOT` keeps
working; that name is still read).

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
`/set-profile` reports and sets it, and
[ADR 0015](https://github.com/marinvch/Cortex/blob/master/docs/adr/0015-a-profile-is-the-world-an-install-serves.md)
records why it is declared rather than detected. The MCP server's startup line prints it.

- **`home`** — a personal machine: personal projects, principles and knowledge only. Never write
  employer or client names · day-job projects, tickets, features or bugs · work deadlines, sprints
  or standups · colleague names · internal architecture, URLs, credentials or code. Role-level
  detail counts too ("back-end at a regional bank") — the aggregate is the leak, and gitignore
  is not a security boundary.
- **`work`** — the same rule read from the other side: this employer's work only, no personal side
  projects, and company code stays in the company's repos.
- **`lab`** — refuses nothing, and therefore publishes nothing.

**Where the other world's knowledge belongs:** a separate vault on the other machine (the two never
sync), or the repo's own committed context layer — `AGENTS.md`, `.cortex/memory/` — which a team
shares through that repo and which never enters a vault.

**What code refuses, and what is still the rituals' floor.** On `home`, two checks are code:

- **The employer denylist.** List the names that matter — `org: Example Corp`, `domain:
  corp.example`, `owner: example-corp`, `ticket: EXC-\d+`, `pattern: <regex>`, one per line — in
  `~/.cortex/employer-denylist` (or the file `CORTEX_DENYLIST` names). Every published write —
  `capture`, `remember`, `ask`, `answer`, a project file, a contract — whose text matches a line is
  refused, naming the line, never the text. Keep the file **outside** this vault and every other
  repository: it is a list of exactly what the firewall keeps out. With no file, nothing is checked
  and `cortex-preflight.mjs` says the denylist is empty.
- **Employer-shaped links in a project file** — a private-network host or a hosted work tool's
  tenant.

Everything else above is judgment: a client named in passing, a colleague, role-level detail, an
employer you never listed, a work repo on a public forge. Those pass the code and must be refused
by the rituals below. A write the code let through is not cleared.

**Enforcement — every ritual obeys this:**
- `/personal-setup` — asks which world first, and on `home` never asks for employer, client or day-job
  detail.
- `/quick-note`, `/daily-plan` — material from the other world: **refuse the write** and say where it
  belongs. Never "sanitize and file anyway."
- `/audit-notes`, in every mode — content from the other world is a **critical finding**, not a style
  nit. Move it out of the vault and report it.
- `/register-projects` — on `home`, personal repos only; never a repo under a work directory.

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
| `references/voice.md` | how you sound, so drafts read as you | filled by `/personal-setup` |
| `archives/` | old material | **move, never delete** |

The folders, `connections.md` and `references/voice.md` start from the skeleton in Cortex's
`templates/vault/`; `/personal-setup` and `tools/cortex-vault-extract.sh` copy in whatever is missing and
never overwrite. The frameworks — operating-principles, vault-architecture, codebase-design — ship
with Cortex in its `references/`, and the note starters in its `templates/`.

## How this brain thinks

Follow operating-principles: **Notice → Decide → Build.** Capture relentlessly so knowledge leaves
the user's head. Before automating, eliminate the waste first, then default to the lowest autonomy
that works. Build the boring, deterministic version and validate each step. The four layers you
maintain are in vault-architecture: Capture, Knowledge, Context, Cadence.
