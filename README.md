# 🧠 Cortex — a context manager for new and legacy codebases

**v2.29.0** · installable as a Claude plugin · see [CHANGELOG.md](CHANGELOG.md)

Point Cortex at a repository and it builds real knowledge of it: what is there, how it is wired,
where it is changing, and what is missing. Then it writes a context layer — a small root
`AGENTS.md` with a routing table, scoped briefs where they are earned, a domain glossary, and a
committed memory the whole team shares.

**Every conclusion is a proposal.** Indexing and reporting cannot modify your repository; a
separate, explicitly invoked skill applies what you choose. The user decides, not the AI.

**No build step, no engine** — plain markdown and a little Node, readable by any editor and by any
AI agent (Claude, Gemini, Copilot, Cursor).

Since v1.1.0 there is also an **optional** Node MCP server in `mcp/` that turns the vault into live
`recall`/`capture` tools for MCP-speaking agents. It is strictly additive: everything below works
without installing it, and nothing in the vault depends on it.

Two systems share one folder:
- a **personal brain** — who you are, what you're working on, your notes and decisions; and
- a **codebase-brain installer** — drop an `AGENTS.md` (+ agent shims + dev-cycle skills) into any
  repo so every AI tool understands that project the same way.

> One rule: capture first, organize later. Nothing lives only in your head.

---

## Install as a Claude plugin ⭐

Cortex is a **context manager for new and legacy codebases**. Install it once, run it in any repo:

```
/plugin marketplace add marinvch/Cortex
/plugin install cortex
```

Then, inside the repo you want it to understand:

```
/cortex-install
```

It indexes the codebase, writes **one findings report** — issues, gaps, recommendations, ranked —
and then **stops and asks**. Nothing in your repo is modified until you pick what to act on.
Indexing and reporting are read-only by construction: a different skill applies changes.

### The order, and how to stop guessing at it

A list of commands is a menu, not an answer. **`/cortex-next` reads the repo you are standing in
and tells you the one command to run now** — every ✓ traced to a file on disk, never to something
a model thinks it did last session:

```
/cortex-next
```

```
  ✓ Index the codebase              .cortex/index/index.json is present
  ✓ Read the ranked findings        .cortex/findings/2026-08-23.md
  · See the repo as a graph         (optional)  see below
  → Write the context layer         root AGENTS.md, the shims, CONTEXT.md, docs/adr/
                                    /cortex-scaffold
    Give critical areas a brief     /cortex-brief <dir>
    Add skills that fit this stack  /cortex-skills
```

Every CLI prints that same `Next →` line when it finishes, so the sequence is never something you
have to come back here to look up. The full sequence, in order:

| # | Command | Does | Skip it when |
|---|---|---|---|
| 0 | `/migrate-engine` | harvest a retired `.ai-os/` engine's memory first | there is no `.ai-os/` |
| 1 | `/cortex-install` | index → ranked findings report → you choose → scaffold | never — this is the entry point |
| 2 | `/cortex-view` | the repo as one offline HTML page: map, files, areas, gaps | you would rather read the report |
| 3 | `/optimize-context` | slim the `AGENTS.md`/`CLAUDE.md`/`.cursorrules` that were already here | the repo had none |
| 4 | `/cortex-scaffold` | write the context layer you picked | — |
| 5 | `/cortex-brief <dir>` | a scoped `AGENTS.md` leaf per area that earns one | no area holds real invariants |
| 6 | `/cortex-skills` | skills proposed from what the index detected | — |
| 7 | `/cortex-enrich` | semantic summaries on top of the index (costs tokens) | you already know the repo |
| 8 | `/dream` | end-of-day digest into the repo's committed `.cortex/memory/` | — |

**Step 3 goes before step 4, not after.** `/cortex-scaffold` is brownfield-safe and will not
clobber a curated `AGENTS.md` — which means you end up with your file *plus* an
`AGENTS.generated.md` and a merge to do by hand. Slimming first leaves one file.

And per change, which is a lookup rather than a sequence:

| When | Run |
|---|---|
| starting a risky feature | `/analyze-spec` |
| before touching files | `/cortex-impact <files>` |
| before committing | `/cortex-review` |
| chasing a bug you cannot explain | `/diagnosing-bugs` |
| back after time away | `/catch-me-up` |

What lands in the target repo:

```
AGENTS.md          small root brief + a routing table
CLAUDE.md GEMINI.md   one-line shims
CONTEXT.md         the domain glossary
docs/adr/          decisions, created lazily
<area>/AGENTS.md   scoped leaves, only where you accepted one
.cortex/
  index/           generated, gitignored
  findings/        generated, gitignored
  view/            generated, gitignored — the HTML graph
  memory/          COMMITTED — shared context, secrets refused at the gate
```

### See the repo, don't read about it

```
/cortex-view
```

That is the whole command, in any repo where the plugin is installed. It is a skill rather than a
node line because `${CLAUDE_PLUGIN_ROOT}` is only set *inside* a skill — typed in your own terminal
it expands to nothing, and the real path underneath it is pinned to the installed version, so it
breaks on the next update. From a clone of this repo, `node index/cortex-view.mjs .` is the same
thing.

One self-contained page — no server, no CDN, no runtime. The data is inlined, so it works offline
and copies anywhere. Five tabs:

- **Next steps** — the sequence above, with your repo's position marked.
- **Map** — a force graph of every code file, coloured by area, laid out by import depth so it
  reads top-down instead of as a hairball. Click an area in the legend to hide it; a red ring means
  no test was found. Markdown and config stay out of the Map on purpose: they have no imports to
  draw, and on this repo 171 of them buried the 98 files that do.
- **Files** — every file with who imports it and what it imports, both clickable.
- **Areas** — the top-level shape, and which areas already have a scoped brief.
- **Gaps** — orphans, import cycles, and the busiest code with no test found, ranked by commits.

Orphans are stated as questions, never as a delete list: import resolution is regex-based
(ADR 0004 — a plugin install runs no build, so there is no parser), which makes dynamic imports
invisible. Same for coverage — a file exercised only through a subprocess reads as untested, which
is the safe direction to be wrong in.

Run `/cortex-enrich` first and each file card also carries what that file *does*.

The indexer is deterministic and offline — it asks git what belongs to the repo, resolves imports,
finds hot spots from history. **From a clone of this repo** you can run the CLIs directly — inside a
skill, prefix each with `${CLAUDE_PLUGIN_ROOT}/`:

```bash
node index/cortex-next.mjs .       # where this repo is; writes nothing at all
node index/cortex-index.mjs .      # writes .cortex/index/index.json
node index/cortex-findings.mjs .   # writes .cortex/findings/<date>.md
node index/cortex-view.mjs .       # writes .cortex/view/repo.html and opens it
node index/cortex-enrich.mjs plan . # optional: plan the semantic enrichment pass
```

---

---

## The personal vault (the other half)

Cortex began as a personal second brain, and that half still works — the rituals below manage a
markdown vault of your own notes, projects and daily logs.

It is **being extracted into its own private repo**, so that this one is purely the shippable
context manager. Everything from here down describes that half:

```bash
bash tools/cortex-vault-extract.sh --to ~/cortex-brain          # preview, changes nothing
bash tools/cortex-vault-extract.sh --to ~/cortex-brain --apply  # copy it out
```

### Vault quick start (5 minutes)

**1. Get the vault**
```bash
git clone https://github.com/marinvch/ai-os.git
cd ai-os
cp templates/home.md home.md          # your personal map (gitignored)
bash tools/cortex-sync-skills.sh      # expose the rituals as /slash commands
```

**2. Teach the brain who you are** — in Claude Code / Cowork, run:
```
/onboard
```
It interviews you and fills `context/` (about you, priorities, how you work, voice).

**3. Use it daily**
```
/capture        # drop any thought into the inbox (anytime)
/daily          # start today's note; see priorities + what's due (each morning)
/weekly-review  # empty the inbox, update projects, archive stale (Fridays)
```

**4. See your whole brain**
```bash
bash tools/cortex.sh                  # builds cortex.html and opens it
```
One page, four tabs: **Map** (an Obsidian-style force graph — click a node to read it),
**Notes** (rendered markdown; click `[[wikilinks]]` to navigate; 🗑 to remove a note),
**Repos** (your registered codebases), **Gaps** (orphan notes + dead links to fix).

---

## Connect the live brain (MCP)

The skills above work by editing plain files. If your agent speaks **MCP** (Claude Code, Cursor,
etc.), you can also wire the vault up as a live server so `recall`/`capture` become real tools —
available in **every project on this machine**, not just this repo. One-time, user scope:

```bash
# no install step — the server has no dependencies
claude mcp add --scope user ai-os --env AI_OS_ROOT=/path/to/ai-os -- node /path/to/ai-os/mcp/server.js
```

**Cursor / other MCP agents** — add to the agent's `mcpServers` config:
```json
{ "ai-os": { "command": "node", "args": ["/path/to/ai-os/mcp/server.js"], "env": { "AI_OS_ROOT": "/path/to/ai-os" } } }
```

`AI_OS_ROOT` (this vault's path) is the only configuration — nothing else to set. Say "connect the
brain" (or run `/connect-brain`) to have your agent do this for you.

---

## Use it on your other projects ⭐

This is the part that makes any AI coding agent faster and safer on a specific codebase.

**Step 1 — open the project repo** (in Claude Code / Cowork, or a terminal).

**Step 2 — give it a brain.** Two options:

- **Deep (recommended), AI-driven** — in Claude Code / Cowork, run:
  ```
  /install-project
  ```
  It reads the actual code and writes a real `AGENTS.md` (stack, architecture, conventions,
  gotchas) + agent shims + `/plan-feature` and `/investigate-bug` skills.

- **Fast, deterministic** — from a terminal inside the repo:
  ```bash
  bash /path/to/ai-os/tools/cortex-init.sh
  ```
  Detects the stack (package manager, framework, language, scripts, tsconfig, lint/CI, source dirs),
  scaffolds `AGENTS.md` + shims + skills, and **suggests relevant skills** for your stack.

**Step 3 — if the repo has an OLD engine** (`.ai-os/`, `.github/ai-os/`): both paths detect it and
tell you to run **`/migrate-engine`** first — it harvests the old memory into `AGENTS.md`, then
removes the cruft, so no knowledge is lost.

**Step 4 — register it with your vault** (optional, metadata only — no code leaves the repo):
```bash
bash /path/to/ai-os/tools/cortex-init.sh --register-to-vault /path/to/ai-os
```
Now the repo shows up in the **Repos** tab of `cortex.html`.

**Step 5 — commit the brain** (`AGENTS.md` + shims) so your whole team's agents share it.

**Working in a critical area?** Run `/cortex-brief <dir>` to give it a deep, scoped `AGENTS.md` leaf
(auth, billing, a pipeline) so agents load narrow context — faster and less drift. Starting a risky
feature? `/analyze-spec` runs a brainstorm → spec → plan grounded by the brain.

> **Brownfield-safe:** a curated `AGENTS.md`/`CLAUDE.md` is never clobbered (you get
> `AGENTS.generated.md` to diff), existing files back up to `*.bak`, and it warns if a generated
> file is gitignored. Run `bash tools/cortex-init.sh --help` for all flags.

---

## The rituals (skills)

Plain `SKILL.md` files in `skills/`. Say "run my onboard skill" in Cowork/Claude Code, or `cp -r
skills/* .claude/skills/` to use them as `/slash` commands.

| Ritual | When | What it does |
|---|---|---|
| `/onboard` | once | Interview you; fill `context/`, seed `home.md`, `connections.md` |
| `/capture` | anytime | One-line drop to the inbox |
| `/daily` | each morning | Today's note + priorities + due items |
| `/weekly-review` | weekly | Empty inbox, update projects, archive stale |
| `/audit` | weekly | Four-layer health score + **noise check** (drift control) |
| `/level-up` | biweekly | Find one piece of leverage; ship one artifact |
| `/reindex` | periodic | Rebuild `cortex.html`; nominate MOCs; fix dead links |
| `/install-project` | per repo | Give a repo a codebase brain (AI-driven, deep) |
| `/migrate-engine` | per repo, once | Move a repo off the old engine without losing memory |
| `/analyze-spec` | per feature | Spec-Driven Development grounded by the brain |
| `/scan-projects` | anytime | Register which local repos have a brain (metadata only) |
| `/connect-brain` | once per machine | Register the live MCP brain (recall/capture) at user scope |
| `/setup-plugins` | per machine/team | Install the Core plugin bundle; offer optional tiers by role |
| `/team-init` | leader, once | Create + seed the shared team-brain repo and push |
| `/team-add` | member, per repo | Clone the team-brain + drop a generic connector into the product repo |
| `/catch-me-up` | after time away | Summarize what changed on a project since a date |
| `/skill-creator` | on request | Create a tailored new ritual and wire it in |
| `/cortex-audit` | periodic | Dispatch the read-only `cortex-auditor` subagent to scan the whole vault for orphan/stale/redundant/misplaced files, dead links, wiring drift and privacy leaks — then apply the safe fixes (structure) |
| `/optimize-context` | per repo | Audit + slim a repo's agent context (AGENTS.md, shims, rules files) |
| `/optimize-prompt` | automatic | Score each prompt; sharpen vague ones into a confirmed precise prompt, save to `docs/prompts/`, route to the right ritual |

---

## How it's organized

| Layer | Folder(s) | Job |
|---|---|---|
| **Capture** | `inbox/`, `daily/` | Nothing is lost |
| **Knowledge** | `notes/`, `projects/`, `areas/`, `resources/` | Ideas connect into a graph |
| **Context** | `context/`, `connections.md` | The brain knows you and your tools |
| **Cadence** | `skills/` | It runs without being asked |

Navigate by **Maps of Content** (a `templates/moc.md` index note per topic, linked from `home.md`),
not deep folders — folders fight `[[wikilinks]]`. How the brain thinks:
`references/operating-principles.md` (Notice → Decide → Build) and `references/vault-architecture.md`.

## Privacy

Personal/business content (`context/`, `inbox/`, `daily/`, `notes/`, `projects/`, `areas/`,
`resources/`, `decisions/`, and all of `archives/`) is **gitignored** — it never
leaves your machine. The committed files (this README, `AGENTS.md`, `references/`, `templates/`)
are data-free, so the vault stays shareable/forkable.

Archived personal content must land in a gitignored path — all of `archives/` is, except its
`README.md`. **Archiving is not sanitizing.** The product's own retired pieces are not personal
content and live in `docs/history/`.

### The employer firewall

**One vault instance holds exactly one world.** A personal vault stores personal projects and
knowledge only — never employer or client names, day-job tickets, colleagues, or internal
architecture. Even role-level detail counts ("front-end at a telecom provider"): the aggregate is
the leak, and gitignore is not a security boundary.

Work knowledge belongs in a **separate vault instance on the work machine** (the two never sync),
or in the **work repo's own `AGENTS.md`** via `/install-project`, which stays inside that repo.
Every ritual enforces this: `/capture` and `/daily` refuse the write, `/audit` and `/cortex-audit`
treat a breach as a critical finding, `/scan-projects` skips repos under a work directory.

Full rule: [`AGENTS.md`](AGENTS.md#the-employer-firewall-hard-rule--overrides-convenience).

## No noise = no drift

`.cortexignore` is the single source of truth for what *isn't* knowledge (scaffolding, backups,
generated views, skills). Every generator reads it (via `tools/_cortex-lib.sh`), so the graph stays
clean and there's no per-script drift. `/audit` flags anything noisy that creeps in.

## Tools (`tools/`, all bash, zero deps)

| Script | Does |
|---|---|
| `cortex-init.sh` | Install a codebase brain into any repo |
| `cortex.sh` | Build/open `cortex.html` — the viewer app |
| `cortex-rm.sh` | Remove a note safely (archive + de-link + refresh) |
| `cortex-scan-projects.sh` | List which local repos already have a codebase brain |
| `_cortex-lib.sh` | Shared `knowledge_files()` (reads `.cortexignore`) |

> The original Node installer is retired at `docs/history/cortex-init.mjs.legacy` — installing and
> using the vault needs nothing but bash. The only Node in the repo is the **optional** MCP brain
> under `mcp/`, which you can skip entirely.

## License

MIT — see [LICENSE](LICENSE). Your notes are yours.
