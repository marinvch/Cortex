# 🧠 Cortex — a context manager for new and legacy codebases

**v2.41.7** · installable as a Claude plugin · docs at [marinvch.github.io/cortex-site](https://marinvch.github.io/cortex-site/) · see [CHANGELOG.md](CHANGELOG.md)

Point Cortex at a repository — new or legacy, yours alone or one a whole team shares — and it
builds real knowledge of it: what is there, how it is wired, where it is changing, and what is
missing. Then it writes the context layer every developer's agent reads.

![Cortex View — the Overview of this repository: vitals, the import graph as a particle cloud, next steps and timeline](docs/images/cortex-view.png)

**Three steps:**

```
/plugin marketplace add marinvch/Cortex
/plugin install cortex
/cortex          # inside the repo you want it to serve
```

Then turn on auto-update once — Claude Code leaves it off for third-party marketplaces like this
one, so without it no release reaches you. [Keep it current](#keep-it-current) has the two clicks.

**What lands in your repo:**

- **A findings report** — issues, gaps and recommendations, ranked. Nothing changes until you pick.
- **A small root `AGENTS.md`** with a routing table, scoped briefs where an area earns one, and
  shims so Claude, Gemini, Copilot and Cursor all read the same file.
- **A domain glossary and decision records** — `CONTEXT.md` and `docs/adr/`.
- **A committed team memory** — `.cortex/memory/`, so what one developer learned reaches the rest.

**Every conclusion is a proposal.** Indexing and reporting cannot modify your repository; a
separate, explicitly invoked skill applies what you choose. The user decides, not the AI.

**No build step, no engine** — plain markdown and a little Node, readable by any editor and by any
AI agent (Claude, Gemini, Copilot, Cursor).

Use it alone on your own repos, or on a team: the context layer is committed with the code, so
every developer's agent reads the same map and `.cortex/memory/` carries what one person learned to
the rest.

---

## Install as a Claude plugin ⭐

Cortex is a **context manager for new and legacy codebases**. Install it once, run it in any repo:

```
/plugin marketplace add marinvch/Cortex
/plugin install cortex
```

Then, inside the repo you want it to serve — a working project or an empty one:

```
/cortex
```

It indexes the codebase, writes **one findings report** — issues, gaps, recommendations, ranked —
works out which parts of the development loop the repo is missing (a verification block in
`CLAUDE.md`, a verifier subagent, `REVIEW.md`, a PR review workflow, hooks, an `intent/` home, evals,
control bands, [an agent team](#the-agent-team)), and then **stops and asks once**. Nothing in your repo is modified until you pick what to act on.
Indexing and reporting write only under `.cortex/` — plus three `.gitignore` lines on the first
run, after you agree — and a different skill applies changes.

### Keep it current

Claude Code does not update Cortex for you unless you turn that on. Its plugin docs
([install.md](https://code.claude.com/docs/en/plugins/install.md), as fetched on 2026-09-28) list
where auto-update is "Off by default: every other marketplace, including the community marketplace,
third-party marketplaces, and local development marketplaces." Cortex's marketplace is one of
those. Turn it on once: **`/plugin` → Marketplaces → select `cortex` → Enable auto-update**.

To update by hand, run both, in this order. The first refreshes the marketplace's copy, the second
installs from it; the first alone leaves the old version installed.

```
claude plugin marketplace update cortex
claude plugin update cortex@cortex
```

A session already running keeps the version it loaded and says *Run /reload-plugins to apply* — run
`/reload-plugins` or start a new session. `claude plugin list` shows the version you now have.

On a team this is not housekeeping. The loop files `/cortex` stamps are shared through
`.cortex/stamps.json`, and the plugin is per machine. When that record was written by a newer Cortex
than yours, `/cortex`, `/cortex-next` and `cortex-stamps.mjs` say so with these two commands, and
an older plugin refuses to rewrite any file a newer one stamped — it would put its own older
template back.

On a team's repo — your profile is `work`, or `/team-add` connected it to a team brain — `/cortex`
also offers to add Cortex to the repo's committed `.claude/settings.json`: the `cortex` marketplace
under `extraKnownMarketplaces` and `cortex@cortex` under `enabledPlugins`. It merges the two entries
in and changes nothing else. Once a teammate trusts the folder, Claude Code registers the marketplace
for them. It does not install the plugin: the docs still have each teammate run
`claude plugin install cortex@cortex --scope project` once.

Auto-update for the whole team is asked separately and is off unless you pick it
(`cortex-shared-plugin.mjs . --write --auto-update`). It writes `"autoUpdate": true` on the
committed `cortex` entry. The settings reference documents that key as "an optional `autoUpdate`
Boolean", and says it makes "Claude Code refresh that marketplace and update its installed plugins in
the background after startup". So every teammate's Claude Code pulls new Cortex releases on its own.
Whether a marketplace auto-updates "follows the first of these that is set", and an `autoUpdate` in
a settings file is first ([plugins/loading](https://code.claude.com/docs/en/plugins/loading.md)).
So the committed value comes before each teammate's own `/plugin` toggle. Cortex writes the key only
on a `cortex` entry it is adding. An entry already in the file keeps its `autoUpdate`, whether it is
`true`, `false` or unset, and the script's output says so.

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
| 1 | `/cortex` | index → findings → the loop → one confirmation → everything below, in one pass | never — this is the entry point |
| 2 | `/cortex-view` | the repo as one offline HTML page: overview, map, structure, files, areas, gaps | you would rather read the report |
| 3 | `/optimize-context` | slim the `AGENTS.md`/`CLAUDE.md`/`.cursorrules` that were already here | the repo had none |
| 4 | `/cortex-scaffold` | write the context layer you picked | — |
| 5 | `/cortex-brief <dir>` | a scoped `AGENTS.md` leaf per area that earns one | no area holds real invariants |
| 6 | `/cortex-skills` | skills proposed from what the index detected | — |
| 7 | `/cortex-enrich` | semantic summaries on top of the index (costs tokens) | you already know the repo |
| — | `/cortex-install` | the read half of step 1 alone: index, report, offer the context layer | you want the whole pass |
| 8 | `/dream` | end-of-day digest into the repo's committed `.cortex/memory/` | — |

**Step 3 goes before step 4, not after.** `/cortex-scaffold` is brownfield-safe and will not
clobber a curated `AGENTS.md` — which means you end up with your file *plus* an
`AGENTS.generated.md` and a merge to do by hand. Slimming first leaves one file.

And per change, which is a lookup rather than a sequence:

| When | Run |
|---|---|
| starting a risky feature | `/analyze-spec` |
| before touching files | `/cortex-impact <files>` |
| one agent or the team? | `/cortex-impact <files> --size` |
| before committing | `/cortex-review` |
| chasing a bug you cannot explain | `/diagnosing-bugs` |
| back after time away | `/catch-me-up` |

What lands in the target repo:

```
AGENTS.md          small root brief + a routing table
CLAUDE.md GEMINI.md   shims — CLAUDE.md also carries "Verifying your work"
CONTEXT.md         the domain glossary
docs/adr/          decisions, created lazily (adr/ when docs/ is a published site)
<area>/AGENTS.md   scoped leaves, only where you accepted one
REVIEW.md          what a review of this repo checks
intent/            where a change starts: intent → spec → plan
.claude/           the verifier or the agent team, hooks, skills that fit the stack
.github/workflows/ cortex-review.yml (advisory PR review) · agent-evals.yml
.cortex/
  index/           generated, gitignored
  findings/        generated, gitignored
  view/            generated, gitignored — the HTML graph
  memory/          COMMITTED — shared context, secrets refused at the gate
  stamps.json      COMMITTED — which loop files Cortex stamped, from which release, so a re-run
                   updates the untouched ones and asks about the ones your team edited
  sections.json    COMMITTED — a CLAUDE.md section your team edited and chose to keep, so it
                   is asked about once, and again only when a release changes its text
```

### The agent team

`/cortex` also offers a small team of agents, written into `.claude/agents/` and committed with the
code. Each one does one job, carries only the tools that job needs, and is filled in from this
repo's own commands, briefs and ADRs. Every claim one makes about the repo cites a `path:line`, an
ADR or a command's output.

| Agent | Its one job | Can edit |
|---|---|---|
| `architect` | turn a request into a plan: files, blast radius, the rules each must keep | no |
| `tester` | write the failing test first, then confirm it passes | test files only, fenced by a hook |
| `implementer` | make the agreed change, inside the planned files | yes |
| `reviewer` | check the change independently: run it, exercise what sits next to it, read the diff against `REVIEW.md` and the docs | no |
| `project-manager` | acceptance criteria and the task list, offered only where a plan folder exists | plan folders, by instruction; no hook enforces it |

You pick each role. An agent the repo already has is graded, matched to a role and offered concrete
edits, one agent at a time with the diff. A role it covers is never offered again. A repo with the
verifier is offered the upgrade to the Reviewer, and keeps the verifier if it says no.

A short section in `CLAUDE.md` puts the team to work. For each new task, your session runs
`/cortex-impact --size` on the files the task will touch, tells you whether it recommends one agent
or the team and why, and **asks you**. On "team" it loads the `team` skill. The Architect plans, and
the Tester and Reviewer object. An objection with no citation is dropped. After at most two rounds,
whatever is still open comes to you side by side, and you decide. Then comes a failing test, the
change and an independent review. Nothing is committed, pushed or merged unless you ask.

Claude Code's experimental agent teams can run the same agents as teammates. Cortex never turns that
mode on; the `team` skill says how. The fence has limits. It does not run until the folder is
trusted, or under `claude -p`. Bash can go around it. A teammate is not documented to carry it.
[ADR 0019](docs/adr/0019-the-agent-team-is-written-into-the-repo-and-run-by-the-main-session.md)
has the reasoning.

To remove the team, delete that section of `CLAUDE.md`, `.claude/skills/team/` and the agents.

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
and copies anywhere. Seven tabs:

- **Overview** — the state of the repo on one screen: whether the index is fresh, which profile is
  serving, how far team memory trails the code; files, import edges, test coverage, 30-day churn and
  findings by severity; the import graph as a slowly turning cloud (click a point to open the file);
  the next commands to run, one click to copy; and a timeline of memory entries and commits. A fact
  that could not be read says *not available* and why — never a zero.
- **Map** — a force graph of every code file, coloured by area, laid out by import depth so it
  reads top-down instead of as a hairball. Click an area in the legend to hide it; a red ring means
  no test was found. Markdown and config stay out of the Map on purpose: they have no imports to
  draw, and on this repo 171 of them buried the 98 files that do.
- **Structure** — what an agent is handed: root `AGENTS.md`, the docs beside it, every code area
  with its scoped brief, busiest files and tests, and what Cortex generates. Missing pieces are
  drawn dashed, with the command that writes them.
- **Files** — every file with who imports it and what it imports, both clickable.
- **Areas** — the top-level shape, and which areas already have a scoped brief.
- **Gaps** — orphans, import cycles, and the busiest code with no test found, ranked by commits.
- **Next steps** — the sequence above, with your repo's position marked.

It follows your OS theme, with a button to override it, and every word on it clears 7:1 contrast
at 13px or larger — computed in the tests, not tuned by eye.

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
node index/cortex-routes.mjs . --workspace  # which back-end handler serves each front-end call
node index/cortex-stamps.mjs .     # which files /cortex stamped are out of date; writes nothing
node index/cortex-section.mjs .    # whether CLAUDE.md's team section is an older release's text; writes nothing
node index/cortex-loop.mjs . --team architect,tester  # the team files, values and roster for those picks; writes nothing
node index/cortex-impact.mjs src/a.ts --size  # one agent or the team for a task on these files, and why
node index/cortex-shared-plugin.mjs .  # on a team repo: what --write would add to .claude/settings.json
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

An optional **personal vault** — notes, decisions, a daily log — is served by the same
rituals, and lives in its own private repo, never in this one. Those rituals ship in the same plugin
as the codebase ones. Their descriptions cost a codebase-only user about 720 tokens a session, and
[ADR 0020](docs/adr/0020-the-vault-rituals-stay-in-the-one-plugin.md) records why that is kept.

> One rule: capture first, organize later. Nothing lives only in your head.

Since v1.1.0 there is also an **optional** Node MCP server in `mcp/` that turns the vault into live
`recall`/`capture` tools for MCP-speaking agents. It is strictly additive: everything below works
without installing it, and nothing in the vault depends on it.

### Vault quick start (5 minutes)

**1. Get the vault** — its own folder, never the Cortex checkout
```bash
git clone https://github.com/marinvch/Cortex.git
mkdir ~/cortex-brain
cp -r Cortex/templates/vault/. ~/cortex-brain/       # the empty skeleton: folders, connections, voice
cp Cortex/templates/home.md ~/cortex-brain/home.md   # your personal map
```
The rituals come from the plugin (`/plugin install cortex`, above), so they are available in the
vault folder without copying anything else in.

**2. Teach the brain who you are** — in Claude Code / Cowork, from the vault folder, run:
```
/onboard
```
It interviews you and fills `context/` (about you, priorities, how you work), `connections.md` and
`references/voice.md`. It copies in any part of the skeleton the vault is missing, and the vault's
`AGENTS.md` manual, so step 1's `cp -r` is a head start rather than a requirement.

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

Plain `SKILL.md` files in `skills/`. Say "run my onboard skill" in Cowork/Claude Code, or run
`bash tools/cortex-sync-skills.sh` to expose them as `/slash` commands. Use the script rather than
`cp -r`: the mirror is gitignored, so nothing keeps it current, and a copy never removes anything
or refreshes a skill that changed. `--check` reports the drift without writing.

| Ritual | When | What it does |
|---|---|---|
| `/cortex-next` | whenever you are lost | Reads this repo off disk and names the **one** command to run now |
| `/cortex` | per repo — start here | Index, report, and set up the whole development loop in one pass, after one confirmation |
| `/cortex-view` | after install | Render the index as one offline HTML page — map, files, areas, gaps |
| `/onboard` | once | Interview you; fill `context/`, seed `home.md`, `connections.md` |
| `/capture` | anytime | One-line drop to the inbox |
| `/daily` | each morning | Today's note + priorities + due items |

**That is 6 of 45.** The complete table — every ritual, when to run it, and the notes on which
pairs are *not* interchangeable — lives in [`AGENTS.md`](AGENTS.md#the-rituals) and is the single
source of truth. This README used to carry a second table of 20 rows that read as the list. Ten
skills were missing from it and nothing caught that, because a partial copy and a complete one look
identical until you count them. A subset that says it is a subset cannot drift that way; one that
does not, always does.

When you do not know which ritual you want, that is `/cortex-next` — the whole reason it exists.

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

This repository is **data-free**: it holds the product and nothing else, because it is cloned,
forked and read by strangers. A vault (`context/`, `inbox/`, `daily/`, `notes/`, `projects/`,
`areas/`, `resources/`, `decisions/`, `archives/`) lives in **its own private repo** — move one out
with `tools/cortex-vault-extract.sh` — and the paths stay gitignored here as a backstop, not as the
boundary. **Archiving is not sanitizing.** The product's own history is its git log and
`CHANGELOG.md`.

On a team, what is shared is the target repo's context layer — `AGENTS.md`, `.cortex/memory/` —
committed with that code. `core/scrub.js` refuses any memory write carrying a credential.

### What Cortex runs, sends and fetches

- **The indexer, findings, View and every `index/` script** read the repo on disk and write only
  under its `.cortex/` (the first index run also appends three lines to `.gitignore`). They make no
  network calls and install nothing — Cortex has no runtime dependencies. Two things there are
  meant to be committed: `.cortex/memory/`; `.cortex/stamps.json`, the record of which files
  Cortex stamped into the repo and from which release; and `.cortex/sections.json`, which
  `CLAUDE.md` sections your team edited and kept. Three scripts write outside `.cortex/`, and
  `/cortex` runs each only on what you confirmed:
  - `cortex-stamps.mjs update` rewrites only a file Cortex stamped that nobody has touched since,
    and never when `.cortex/stamps.json` names a newer Cortex than the one running. That check
    compares the record with the plugin's own `VERSION` file; nothing is fetched to make it.
  - `cortex-shared-plugin.mjs --write` adds two entries to `.claude/settings.json`, creating the
    file if there is none, and leaves every other key as it was. It refuses a file that does not
    parse as JSON. `--auto-update`, a separate choice, also writes `"autoUpdate": true` on a
    `cortex` entry it adds, and never changes one already there.
  - `cortex-section.mjs --replace team` rewrites the `## Working as a team` section of `CLAUDE.md`,
    and only when it is an earlier release's text that nobody has changed. Every other line of the
    file stays as it was, and a section the team edited is never replaced.
- **Updates are Claude Code's, not Cortex's.** Cortex never checks for a newer release. With
  auto-update turned on, Claude Code fetches the marketplace itself; the manual update is the two
  `claude plugin` commands under [Keep it current](#keep-it-current).
- **The MCP server** (`mcp/server.js`, started as `node ${CLAUDE_PLUGIN_ROOT}/mcp/server.js`) runs
  `git` and nothing else that reaches a network, and only against a **team-brain** repository the
  user set up with `/team-init` or `/team-add`: it clones that repository once, `git pull`s it
  before a catch-up, and on a team `capture` commits the note and `git push`es it there. With no
  team brain connected it makes no network call at all. The note passes the secret gate before it
  is written, and the `home`/`work` profile decides which captures may leave the machine.
- **The rituals** are instructions Claude follows, and say before each step that touches the
  network — `gh` for pull requests, `git clone` of a public repo you name — so it runs only when
  you ask for it.
- **Stamped into your repo, not run by the plugin:** `/cortex` can write GitHub Actions workflows.
  `cortex-review.yml` clones this repository at a pinned release tag inside your CI to review each
  PR; `agent-evals.yml` installs Claude Code in your CI to run your eval cases. Both are files you
  read and commit. On a team's repo it can also add the `cortex` marketplace to
  `.claude/settings.json`. Then Claude Code, not Cortex, clones `github.com/marinvch/Cortex` on each
  teammate's machine once they trust the folder. The agent team is instructions too: agent files and
  a skill your own sessions follow. They run your repo's own commands. The one network step they
  name is the Project manager reading an issue with `gh issue view` when a task names one.
- **No telemetry.** Nothing is sent to the author or to any service Cortex runs.

### The vault firewall

**One vault holds exactly one world** — `home`, `work` or `lab`, set with `CORTEX_PROFILE`. A `home`
vault stores personal projects and knowledge only — never employer or client names, day-job
tickets, colleagues, or internal architecture. Even role-level detail counts ("front-end at a
telecom provider"): the aggregate is the leak. A `work` vault is the same rule from the other side.

Work knowledge a team shares belongs in the **work repo's own context layer**, which stays inside that
repo. Every ritual enforces this: `/capture` and `/daily` refuse the write, `/audit` and
`/cortex-audit` treat a breach as a critical finding, `/scan-projects` skips repos under a work
directory.

Full rule: [`templates/vault-AGENTS.md`](templates/vault-AGENTS.md) — the manual a vault carries as
its own `AGENTS.md`.

## No noise = no drift

`.cortexignore` is the single source of truth for what *isn't* knowledge (scaffolding, backups,
generated views, skills). Every generator reads it (via `tools/_cortex-lib.sh`), so the graph stays
clean and there's no per-script drift. `/audit` flags anything noisy that creeps in.

## Tools (`tools/`)

Every script here runs on a stock machine — no `npm install`,
no lockfile, no runtime dependency at all ([ADR 0004](docs/adr/0004-no-runtime-dependencies.md)).
That is the promise; "all bash" was the old shorthand for it, and it stopped being true the moment
`core/` and `index/` shipped.

**What is listed:** every script in `tools/` that a person, a ritual or cron runs directly. A file
that is only sourced by other scripts is a library, not a tool, and its name starts with `_`. `_cortex-lib.sh` holds the slug
rule, the clock, `knowledge_files()` and the root guard for `cortex.sh`, `cortex-rm.sh`,
`cortex-scan-projects.sh` and `cortex-sync-skills.sh`. `tools/test/` is the test harness, run through `bash tools/test/run.sh`.
`tools/test/tools-table.test.sh` fails when a script is missing from this table or a row names
none.

| Script | Does |
|---|---|
| `cortex-init.sh` | Install a codebase brain into any repo, with no Node and no clone needed |
| `cortex.sh` | Build/open `cortex.html` — the vault viewer |
| `cortex-rm.sh` | Remove a note safely (archive + de-link + refresh) |
| `cortex-scan-projects.sh` | Register your local git repos into the vault's `projects/`, metadata only |
| `cortex-sync-skills.sh` | Mirror `skills/` into `.claude/skills/`; `--check` reports drift |
| `cortex-vault-extract.sh` | Lift the personal-vault half out into its own repo; a dry run unless `--apply` |
| `cortex-capability.mjs` | What each ritual needs from the setup running it |
| `cortex-frontmatter.mjs` | Is every ritual's frontmatter readable by a router; `--check` fails on the first bad line, strictly |
| `cortex-version.mjs` | `--set X.Y.Z` — stamp the version at all seven sites, refuse without a changelog entry |
| `cortex-preflight.mjs` | Root, profile and index freshness — what every ritual asks before it writes |
| `cortex-plugin-check.mjs` | Which Cortex this session is actually running, and whether it is the one you edited |
| `cortex-skill-graph.mjs` | Which ritual reaches which; `--check` fails on one stranded in both directions |
| `cortex-skill-usage.mjs` | Which rituals your sessions have actually reached |
| `cortex-placeholders.mjs` | Did a file Cortex stamped keep a placeholder from its template; exit 1 if so |
| `cortex-claude-docs.mjs` | Are the Claude Code rules Cortex ships still stated on Anthropic's pages; `--check` exits 1 on a stale one |
| `cortex-site-facts.mjs` | The facts the public site states, read from source; `--check` names each one that drifted |
| `server/server-setup.sh` | Set up a team brain: the bare repo on a server, a clone on each machine, the cron lines |
| `server/cortex-cron.sh` | Run by cron on the server: pull the team brain, write a daily digest or weekly audit, push it |

Node also runs the codebase half (`core/`, `index/`), the optional MCP brain (`mcp/`), and the
prompt-gate hook in `.claude/hooks/`.

## License

MIT — see [LICENSE](LICENSE). Your notes are yours.
