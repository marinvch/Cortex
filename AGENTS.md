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
`daily/`, `notes/`, `projects/`, `areas/`, `decisions/`, plus every dated folder under `archives/`.
Committed files (`README`, this manual, `references/`, `templates/`) stay **data-free** so the vault
stays shareable/forkable. Never write personal facts into a committed file.

Archived personal content must land in a gitignored path — `archives/removed/` or a dated
`archives/<name>-YYYY-MM-DD/` folder. **Archiving is not sanitizing.**

## The employer firewall (hard rule — overrides convenience)

**One vault instance holds exactly one world.** This instance is the **personal machine**: personal
projects, principles, and knowledge only.

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
- `/audit`, `/cortex-doctor`, `/cortex-audit` — employer content is a **critical finding**, not a
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
| `archives/` | old stuff | **move, never delete** |

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
| `/cortex-doctor` | periodic | find + fix orphans, dead links, stale/duplicate/misplaced files |
| `/cortex-audit` | on request | dispatch the `cortex-auditor` subagent, then apply its fixes |
| `/cortex-install` | per repo | index a codebase, report findings, scaffold only what the user picks |
| `/cortex-scaffold` | on request | write the context layer — root `AGENTS.md`, shims, `CONTEXT.md`, `docs/adr/` |
| `/cortex-enrich` | on request | add summaries/roles/tags on top of the index. Costs tokens; optional |
| `/cortex-brief` | per critical area | propose scoped `AGENTS.md` leaves from the index + wire the routing table |
| `/dream` | end of day | consolidate the day into the repo's committed `.cortex/memory/` |
| `/handoff` | leaving work mid-flight | compact this conversation to the OS temp dir for the next agent |
| `/optimize-context` | per repo | audit + slim that repo's agent context files |
| `/writing-for-agents` | writing any agent-facing doc | the authoring discipline behind every file Cortex writes |
| `/install-project` | per repo | stamp a codebase brain into a repo — stays in that repo |
| `/scope-area` | per critical dir | give it a scoped `AGENTS.md` leaf + a routing table in root |
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

**Gotchas worth knowing before you pick one:**
- The three health rituals are not interchangeable — `/audit` scores *content*, `/cortex-doctor`
  fixes *structure*, `/reindex` rebuilds the *graph*. `/cortex-audit` is the subagent-driven
  superset; reach for it when you want "check everything and clean it up" in one step.
- `/migrate-engine` **harvests the old memory store into `AGENTS.md` before deleting anything.**
  Harvest first, delete second — otherwise knowledge is lost across the breaking change.
- `/analyze-spec` is the heavyweight path; `/plan-feature` (written by `/install-project`) stays the
  lightweight one for routine tickets.
- `/scan-projects` and `/install-project` never let company code into this vault — that's the
  firewall above, not a style preference.
- `/scope-area` nests one filename (`AGENTS.md`), never a sprawl of per-topic files. Split only
  where a real invariant or gotcha lives.
- `/optimize-context` targets **other repos**; `/cortex-doctor` targets this vault. Same instinct,
  different subject. It never deletes prose on its own authority.
- `/writing-for-agents` and `/optimize-context` are the two halves of one job: the first is how to
  **write** an agent-facing document, the second **audits** one already written. Reach for the
  discipline before authoring a brief or a skill, not after the audit says it is bloated.
- `/handoff`, `/dream` and `/catch-me-up` all move context across a gap and are **not**
  interchangeable. The cut is in-flight state versus durable knowledge: `/handoff` writes
  ephemerally to the OS temp dir for the *next agent right now*; `/dream` commits what a future
  reader of the codebase needs; `/catch-me-up` writes nothing and reads. A session that produced
  both wants both — running `/handoff` alone on a day that taught you something loses the lesson.
- `/domain-modeling` writes a `CONTEXT.md` **in the target repo** — that repo's glossary of terms.
  It is *not* this vault's `context/` (who you are), and its ADRs are *not* `decisions/log.md`
  (your personal decisions). Same word, two different things; never merge them.
- `/wizard` output handles credentials, so it lands in the target repo's `scripts/` or the
  scratchpad — **never in this vault**, and never committed with values baked in.
- `/onboard`, `/migrate-engine`, `/team-init` and `/connect-brain` carry
  `disable-model-invocation: true` — they are once-only or destructive, so an agent may never
  auto-fire them. The user invokes them by name. Keep the flag when editing their frontmatter.
- `/cortex-install` **never modifies a target repo before the user chooses.** Indexing and the
  findings report are read-only by construction — `/cortex-scaffold` is the separate skill that
  applies changes. If you are editing source before the user picked something, you have left the
  skill.
- The MCP server has **two modes, decided by the root it is given**: point it at a repo's
  `.cortex/` and it serves `recall` · `remember` · `recall_memory`; point it at a personal vault
  and it serves the original `capture` · `catch_me_up` · project tools. The vault tools are hidden
  in repo mode on purpose — offering them would invite an agent to write `inbox/` and `daily/`
  into someone's product repository.
- `.cortex/index/` and `.cortex/findings/` are generated and gitignored in a target repo.
  `.cortex/memory/` is **committed** — that is how several developers share one context. The
  asymmetry is deliberate, and it makes the privacy rule a hard requirement: `mcp/lib/scrub.js`
  refuses any memory write carrying a credential, and never sanitises silently.
- The indexer (`index/`) asks **git** what belongs to a repo, not `.cortexignore`. Those answer
  different questions — `.cortexignore` says what is not *knowledge in a vault*, which would drop
  a repo's own `tools/` and `skills/` from its index.
- Enrichment is **additive and optional**. `index.json` stays the source of truth for structure;
  `enriched.json` only attaches prose. A missing or stale enrichment degrades Cortex to
  deterministic behaviour — it must never break it, and must never edit `index.json`.

## The code layers

```
      core/          shared kernel — depends on nothing else in this repo
     /     \         paths (the root guard) · scrub (the secret gate) · memory · date
 index/    mcp/      leaves — depend on core, never on each other
```

### Where to look

Read this file, match your work to a row, then open **one** leaf. Do not read all three.

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
- [[codebase-design]] is vocabulary, not a ritual — the words for *how code is shaped* (module,
  interface, depth, seam, adapter). [[operating-principles]] decides what to build; that decides
  what it looks like. `/analyze-spec` and `/scope-area` should both speak it.

The `cortex-auditor` subagent lives in **`agents/`** at the repo root — where an installed plugin
loads subagents from — and is invoked by `/cortex-audit`. `.claude/agents/` would work in this
checkout and ship to nobody.
