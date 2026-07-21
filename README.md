# 🧠 Cortex — your personal + business second brain (and a brain for every repo)

**v1.0.0** · plain-files, bash-only · see [CHANGELOG.md](CHANGELOG.md)

A plain-markdown knowledge vault, Obsidian-style but **app-optional**. **No build step, no engine,
no Node, no Python** — just files you own, readable by any editor and by any AI agent (Claude,
Gemini, Copilot, Cursor). The only tooling is a few **bash** scripts.

Two systems share one folder:
- a **personal brain** — who you are, what you're working on, your notes and decisions; and
- a **codebase-brain installer** — drop an `AGENTS.md` (+ agent shims + dev-cycle skills) into any
  repo so every AI tool understands that project the same way.

> One rule: capture first, organize later. Nothing lives only in your head.

---

## Quick start (5 minutes)

**1. Get the vault**
```bash
git clone https://github.com/marinvch/ai-os.git
cd ai-os
cp home.example.md home.md           # your personal map (gitignored)
cp -r skills/* .claude/skills/        # expose the rituals as /slash commands
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
cd /path/to/ai-os/mcp && npm install   # once, installs the server's deps
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

**Working in a critical area?** Run `/scope-area <dir>` to give it a deep, scoped `AGENTS.md` leaf
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
| `/scope-area` | per critical part | Deep scoped `AGENTS.md` leaf + routing table |
| `/analyze-spec` | per feature | Spec-Driven Development grounded by the brain |
| `/scan-projects` | anytime | Register which local repos have a brain (metadata only) |
| `/connect-brain` | once per machine | Register the live MCP brain (recall/capture) at user scope |
| `/setup-plugins` | per machine/team | Install the Core plugin bundle; offer optional tiers by role |
| `/team-init` | leader, once | Create + seed the shared team-brain repo and push |
| `/team-add` | member, per repo | Clone the team-brain + drop a generic connector into the product repo |
| `/catch-me-up` | after time away | Summarize what changed on a project since a date |
| `/skill-creator` | on request | Create a tailored new ritual and wire it in |
| `/cortex-doctor` | periodic | Find & fix orphan/stale/redundant/misplaced files + dead links (structure) |
| `/cortex-audit` | on request | Dispatch the read-only `cortex-auditor` subagent to scan the whole vault (structure + content signal), then apply safe fixes — the superset of `/audit` + `/cortex-doctor` |

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
`resources/`, `decisions/`) is **gitignored** — it never leaves your machine. The committed files
(this README, `AGENTS.md`, `references/`, `templates/`) are data-free, so the vault stays
shareable/forkable. When you install a brain into a work repo, **company code never enters this
vault** — only opt-in, metadata-only registration.

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
| `_cortex-lib.sh` | Shared `knowledge_files()` (reads `.cortexignore`) |

> The original Node installer is retired at `archives/cortex-init.mjs.legacy`. Everything is bash now.

## License

MIT. Your notes are yours.
