# Cortex Vault — Operating Manual

The single source of truth for any AI agent working in this vault. Claude reads `CLAUDE.md`,
Gemini reads `GEMINI.md` — both are shims importing this file. Other tools read it natively.

## What this is

A **personal + business second brain**: a plain-markdown knowledge vault, Obsidian-style but
app-optional. No build step, no engine — just files you own, readable by any editor and by AI.
One folder holds two systems: a **knowledge layer** (capture → notes → maps) and an **operating
layer** (who you are, what you can reach, the rituals that keep it alive). The Node MCP brain in
`mcp/` adds live recall/capture and is **optional** — the vault works fully without it.

## The one rule (privacy)

Personal and business-sensitive content lives in **gitignored** folders: `context/`, `inbox/`,
`daily/`, `notes/`, `projects/`, `areas/`, `decisions/`, and all of `archives/`.
Committed files (`README`, this manual, `references/`, `templates/`) stay **data-free** so the vault
stays shareable/forkable. Never write personal facts into a committed file.

Archived personal content must land in a gitignored path. All of `archives/` is ignored except its
`README.md`, so anything moved there keeps the privacy it had. **Archiving is not sanitizing** —
confirm with `git check-ignore -v <path>`.

The product's own history is not personal content and lives in [`docs/history/`](docs/history/).
It used to sit in `archives/` alongside your vault's, which is why that folder's ignore rules
needed six lines and two negations to say which half was shareable.

## The employer firewall (hard rule — overrides convenience)

**One vault instance holds exactly one world**, and the **profile** says which — `home`, `work` or
`lab`, declared with `CORTEX_PROFILE` and defaulting to `home`. The rule below is what `home` means;
`work` is the same rule read from the other side, and `lab` refuses nothing and therefore publishes
nothing. `core/profile.js` owns it, `/cortex-profile` reports and sets it, and
[ADR 0015](docs/adr/0015-a-profile-is-the-world-an-install-serves.md) records why it is declared
rather than detected. The server's startup line prints it, so a mismatch is visible rather than
inferred.

This instance is `home` — the **personal machine**: personal projects, principles, and knowledge
only.

**Never write into this vault:** employer or client names · day-job projects, tickets, features, or
bugs · work deadlines, sprints, or standups · colleague names · internal architecture, URLs,
credentials, or code. This holds even for seemingly harmless role-level detail ("front-end at a
telecom provider") — the aggregate is the leak, and gitignore is not a security boundary.

**Where work knowledge belongs instead:** a separate vault instance on the work machine (the two
never sync), or the work repo's own `AGENTS.md` via `/install-project`, which stays in that repo.

**Enforcement — every ritual obeys this:**
- `/onboard` — on a personal install, never ask for employer, client, or day-job detail.
- `/capture`, `/daily` — day-job material: **refuse the write**, say where it belongs. Never
  "sanitize and file anyway."
- `/audit`, `/cortex-audit` — employer content is a **critical finding**, not a
  style nit. Archive to a gitignored path and report it.
- `/scan-projects` — personal repos only; never a repo under a work directory.

Applied 2026-08-03: prior day-job content was stripped into
`archives/work-content-removed-2026-08-03/` (gitignored, never committed).

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
| `references/` | the frameworks | [[operating-principles]], [[vault-architecture]], [[codebase-design]], voice |
| `templates/` | starters | copy to begin a new note |
| `archives/` | old stuff from your vault | **move, never delete**; gitignored in full |

## How this brain thinks

Follow [[operating-principles]]: **Notice → Decide → Build.** Capture relentlessly so knowledge
leaves the user's head. Before automating, eliminate the waste first, then default to the lowest
autonomy that works. Build the boring, deterministic version and validate each step. The four
layers you maintain are in [[vault-architecture]]: Capture, Knowledge, Context, Cadence.

## Prompt Optimization Protocol

Score each incoming prompt: under 10 words `+2`; no action verb `+1`; no component reference (path,
`` `backticked` `` token, `file.ext`, `#123`, URL) `+1`; no domain keyword `+1`.

**Score 4 or higher → run `/optimize-prompt` first.** Below 4, act on the prompt as written and say
nothing about scoring. Skip scoring entirely for steers (`yes`, `go ahead`), status checks (`is it
done`), slash commands, anything naming an exact file path, and anything very long.

Claude Code enforces this via a `UserPromptSubmit` hook; other agents apply it by judgment. The
exact word lists and bypass rules live in `skills/optimize-prompt/SKILL.md`. Set
`CORTEX_NO_OPTIMIZE=1` to disable it.

## The rituals

Each is a plain-markdown `SKILL.md` under `skills/` — the canonical copy. Expose them as `/slash`
commands with `bash tools/cortex-sync-skills.sh`, or just name a ritual to any AI tool. That
mirror is gitignored, so nothing keeps it current — `--check` reports drift, and a plain `cp -r`
never removes anything or refreshes a changed skill. An installed plugin loads `skills/` directly
and needs no mirror at all.

| Ritual | When | Does |
|---|---|---|
| `/onboard` | once | interview the user; fill `context/`, `home.md`, `connections.md` |
| `/capture` | anytime | one-line drop to `inbox/` or today's daily note |
| `/daily` | each day | open today's note; surface priorities + due items |
| `/weekly-review` | weekly | empty `inbox/`, update `projects/`, restamp `current-focus` |
| `/audit` | weekly | read-only four-layer health score + top gaps |
| `/level-up` | biweekly | Notice→Decide→Build interview; ship one artifact |
| `/reindex` | periodic | regenerate the navigator graph, nominate MOCs, fix dead links |
| `/cortex-audit` | periodic | find + fix orphans, dead links, stale/duplicate/misplaced files, privacy leaks |
| `/cortex-install` | per repo | index a codebase, report findings, scaffold only what the user picks |
| `/cortex-scaffold` | on request | write the context layer — root `AGENTS.md`, shims, `CONTEXT.md`, `docs/adr/` |
| `/cortex-enrich` | on request | add summaries/roles/tags on top of the index. Costs tokens; optional |
| `/cortex-brief` | per critical area | write scoped `AGENTS.md` leaves + wire the root routing table |
| `/cortex-skills` | after scaffold | propose + write skills that fit the detected stack |
| `/cortex-impact` | before a change | who depends on these files, and which of it no test covers |
| `/cortex-review` | before committing | judge a change against the repo's own docs, and spot the ones it made wrong |
| `/cortex-profile` | per machine | show or set which world this install serves — home · work · lab |

Run `node tools/cortex-capability.mjs` for what each ritual needs from the setup running it.
| `/dream` | end of day | consolidate the day into the repo's committed `.cortex/memory/` |
| `/handoff` | leaving work mid-flight | compact this conversation to the OS temp dir for the next agent |
| `/optimize-context` | per repo | audit + slim that repo's agent context files |
| `/writing-for-agents` | writing any agent-facing doc | the authoring discipline behind every file Cortex writes |
| `/install-project` | per repo | stamp a codebase brain into a repo — stays in that repo |
| `/domain-modeling` | per repo, ongoing | sharpen that repo's glossary — write its `CONTEXT.md` + ADRs |
| `/analyze-spec` | per risky feature | brainstorm → design spec → plan. **No code.** |
| `/migrate-engine` | per repo, once | move off the retired `.ai-os/` engine |
| `/resolving-merge-conflicts` | on conflict | resolve a stuck merge/rebase by intent, hunk by hunk. Never `--abort` |
| `/wizard` | on request | generate a script that walks a *human* through steps only they can do |
| `/scan-projects` | anytime | register personal repos into `projects/` — metadata only |
| `/connect-brain` | once per machine | register `mcp/server.js` at user scope for recall/capture |
| `/setup-plugins` | per machine | install the Cortex Core plugin bundle |
| `/team-init` | leader, once | create + seed the shared team-brain repo |
| `/team-add` | per product repo | clone the team-brain; drop `.cortex/connector.json` |
| `/catch-me-up` | after time away | brain notes + team-brain git history → what changed & why |
| `/grilling` | before committing to a plan | interview in rounds until the design tree has no unresolved branch |
| `/improve-codebase-architecture` | on request | find deepening opportunities in a repo, report them as HTML, work one |
| `/skill-creator` | on request | write a new `skills/<name>/SKILL.md` and wire it in |
| `/optimize-prompt` | automatic | the prompt gate (see the protocol above) |

**Picking the right ritual:**
- The three health rituals are not interchangeable — `/audit` scores *content* and writes nothing,
  `/cortex-audit` finds and fixes *structure*, `/reindex` rebuilds the *graph*.
- `/migrate-engine` **harvests the old memory store into `AGENTS.md` before deleting anything.**
  Harvest first, delete second — otherwise knowledge is lost across the breaking change.
- `/analyze-spec` is the heavyweight path; `/plan-feature` (written by `/install-project`) stays the
  lightweight one for routine tickets.
- `/scan-projects` and `/install-project` never let company code into this vault — that's the
  firewall above, not a style preference.
- `/cortex-brief` nests one filename (`AGENTS.md`), never a sprawl of per-topic files. Split only
  where a real invariant or gotcha lives.
- `/optimize-context` targets **other repos**; `/cortex-audit` targets this vault. It never deletes
  prose on its own authority. `/writing-for-agents` is its other half — the discipline for **writing**
  an agent-facing document, reached before authoring a brief or a skill, not after an audit calls it
  bloated.
- `/handoff`, `/dream` and `/catch-me-up` all move context across a gap and are **not**
  interchangeable. The cut is in-flight state versus durable knowledge: `/handoff` writes
  ephemerally to the OS temp dir for the *next agent right now*, `/dream` commits what a future
  reader of the codebase needs, `/catch-me-up` writes nothing and reads. Running `/handoff` alone on
  a day that taught you something loses the lesson.
- `/domain-modeling` writes a `CONTEXT.md` **in the target repo** — that repo's glossary of terms.
  It is *not* this vault's `context/` (who you are), and its ADRs are *not* `decisions/log.md`
  (your personal decisions). Same word, two different things; never merge them.
- `/wizard` output handles credentials, so it lands in the target repo's `scripts/` or the
  scratchpad — **never in this vault**, and never committed with values baked in.

**Changing Cortex itself** — the contributor invariants (version stamping, the capability floor,
the consent gate, the shell path guard, the two tests that matter) live in
[`docs/changing-cortex.md`](docs/changing-cortex.md). **Read it before editing anything in this
repository**, whichever package you are in. It is not optional background: several of those rules
exist because the mistake they prevent has already been made here once.

## The code layers

```
      core/          shared kernel — depends on nothing else in this repo
     /     \         paths (the root guard) · scrub (the secret gate) · memory · date
 index/    mcp/      leaves — depend on core, never on each other
```

### Where to look

Read this file, match your work to a row, then open **one** leaf. Do not read all three.

First, though: [`docs/changing-cortex.md`](docs/changing-cortex.md) holds the invariants that apply
to **every** row below — how versions are stamped, what a destructive shell tool must route
through, what a ritual must declare. Read it once before your first change here.

| Working in | Read first |
|---|---|
| `core/` — paths, scrub, memory, date | [`core/AGENTS.md`](core/AGENTS.md) |
| `index/` — indexer, findings, enrichment | [`index/AGENTS.md`](index/AGENTS.md) |
| `mcp/` — the live brain, the `ai-os` CLI | [`mcp/AGENTS.md`](mcp/AGENTS.md) |
| `skills/`, `templates/`, `references/` | this file is enough |

Domain terms are defined once in [`CONTEXT.md`](CONTEXT.md); decisions and their rejected
alternatives are in [`docs/adr/`](docs/adr/).

`core/test/architecture.test.js` enforces this: it fails if `core/` reaches upward, or if either
leaf imports the other. It exists because the rule was already broken once — `index/` was pulling
the secret scanner and a date helper straight out of `mcp/lib/`. Shared code goes in `core/`;
convenience imports across leaves are how two packages get welded into one.
- **Leaf-internal invariants live in the leaf, not here.** `mcp/AGENTS.md` owns the Vault door, the
  two server modes and the mode/audience seam; `index/AGENTS.md` owns determinism, regex import
  resolution, the three coverage signals, and why the walker asks git rather than `.cortexignore`.
  This file used to restate all five, and the copies drifted — the mode/audience bullet here still
  said *two questions* long after `profile` made it three. Read the leaf before changing behaviour
  it governs, and write the detail there.
- [[codebase-design]] is vocabulary, not a ritual — the words for *how code is shaped* (module,
  interface, depth, seam, adapter). [[operating-principles]] decides what to build; that decides
  what it looks like. `/analyze-spec` and `/cortex-brief` should both speak it.

The `cortex-auditor` subagent lives in **`agents/`** at the repo root — where an installed plugin
loads subagents from — and is invoked by `/cortex-audit`. `.claude/agents/` would work in this
checkout and ship to nobody.
