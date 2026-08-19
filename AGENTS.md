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
| `/cortex-profile` | per machine | show or set which world this install serves — home · work · lab |
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

**Gotchas worth knowing before you pick one:**
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
- `/optimize-context` targets **other repos**; `/cortex-audit` targets this vault. Same instinct,
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
- `/cortex-install` is **model-invocable on purpose** — an agent may start the sequence when a repo
  plainly needs it. What protects the repo is the **consent gate**, not an invocation flag: with no
  `.cortex/` yet, it asks before the first write; once `.cortex/` exists, re-indexing is free.
  Do not re-add `disable-model-invocation` to it for consistency with the eight below — that flag
  marks *once-only or destructive*, not *read-only*. See
  [ADR 0005](docs/adr/0005-the-install-sequence-may-start-itself.md).
- Eight rituals carry `disable-model-invocation: true` — `/onboard`, `/migrate-engine`,
  `/team-init`, `/connect-brain`, `/handoff`, `/skill-creator`, `/writing-for-agents` and
  `/improve-codebase-architecture`. They are once-only, destructive, or reference an agent reaches
  by name, so none may auto-fire. `grep -l disable-model-invocation skills/*/SKILL.md` is the list
  of record; keep the flag when editing their frontmatter.
- `/cortex-install` **never modifies a target repo before the user chooses.** Indexing and the
  findings report are read-only by construction — `/cortex-scaffold` is the separate skill that
  applies changes. If you are editing source before the user picked something, you have left the
  skill.
- **The findings report is `/cortex-install`'s script, so `analyse()`'s ranking is control flow.**
  The wizard walks `offers()` top-down — severity decides which question a user is asked first.
  Re-rank a finding and you change the interview, not just a document. Offers also collapse by
  action, which is what keeps a thirty-finding report from becoming a thirty-question interview; and
  severity never implies an offer (*no test files found* is high, and Cortex has no action for it).
  Read the worklist with `cortex-findings.mjs --offers`, which writes nothing. See
  [ADR 0006](docs/adr/0006-the-report-is-the-wizards-script.md).
- **A destructive shell tool must route its target through `resolve_in_root` (`tools/_cortex-lib.sh`).**
  It is the shell counterpart of `core/paths.js`, and it lives in the shared lib so the next tool
  inherits it instead of re-deriving it. `cortex-rm.sh` would otherwise archive a file from outside
  the vault — breaking the one promise it makes, since it cannot recover a file whose original path
  it just erased. Not a string-prefix check: a symlink out of the root passes any prefix comparison.
  `cortex-vault-extract.sh` and `cortex-scan-projects.sh` were checked and do not need it. See
  [ADR 0010](docs/adr/0010-the-shell-half-gets-the-guard-too.md).
- **Never hand-edit a version. Run `node tools/cortex-version.mjs --set <x.y.z>`.** `VERSION` is the
  interface; the seven sites holding a copy are implementation, and both the writer and the drift
  check read one `SITES` list. Hand-editing is how `core/package.json` sat six releases behind while
  four other sites were verified. The `## [x.y.z]` changelog entry is the one thing the tool will
  not write — it refuses until you have, because a release entry says what changed and why. See
  [ADR 0013](docs/adr/0013-the-version-has-one-home.md), and
  [ADR 0014](docs/adr/0014-the-package-split-stays-rejected.md) before proposing a package split.
- **`mode`, `audience` and `profile` are three questions, never two.** `mcp/lib/mode.js` answers
  repo-vs-vault, `mcp/lib/resolve.js` answers solo/team/server, and `core/profile.js` answers
  home/work/lab. A work laptop can run a repo brain on a team; a lab box can hold a personal vault.
  `core/profile.js` reads **only** `CORTEX_PROFILE` — nothing about the root, the connector or the
  cwd may move it, and a test asserts that. See [ADR 0015](docs/adr/0015-a-profile-is-the-world-an-install-serves.md)
  and [ADR 0008](docs/adr/0008-three-audiences-one-seam.md).
- **`lab` refusing nothing and publishing nothing is ONE decision, stored as one policy object.** A
  profile that refused nothing locally and still pushed would be a way to switch the firewall off and
  keep leaking. If you ever add a fourth profile, decide both halves together.
- **Skills are per-repo; rituals are per-machine — `/cortex-skills` writes the first kind.** The
  plugin's rituals work in any repo once installed and are never copied into a project. What
  `/cortex-skills` writes is `.claude/skills/` in the *target*, committed with its code, chosen
  from `index.stack`. Add a new stack-specific candidate to `index/lib/skills.mjs` — a declarative
  row with its own `when()` — rather than improvising one inside the ritual, so the next repo with
  that stack gets it too. The evidence sentence must name what was **detected**; a candidate that
  cannot cite the index does not belong in the list.
- **`tools/test/install-on-a-project.test.sh` is the only test that asserts the *product* works.**
  Everything else points Cortex at fixtures shaped by whoever wrote the test. This one runs
  index → findings → `--offers` against a repo shaped like real product code, and asserts the target
  is left without a `.cortex/` — `/cortex-install`'s consent promise made executable. Point it at a
  real project with `CORTEX_E2E_REPO=<path>`; that pass is read-only.
- **The shell half has behaviour tests now — `bash tools/test/run.sh`.** `bash -n` and shellcheck
  never *run* a script, which is how four real bugs shipped in `tools/server/` and were found by
  reading rather than by CI. Tests build real git repos in temp dirs (a bare repo on disk is a
  complete remote, so no network), and every test touching `$HOME` must override it. They run in the
  `cortex-init test` workflow. Add a case there when you touch anything under `tools/`.
- **`mcp/lib/vault.js` is the only door onto a vault root.** Nothing else under `mcp/` may join a
  path onto one — ask the Vault (`list` · `entries` · `read` · `append` · `write` · `abs` ·
  `exists` · `isFile` · `isDirectory` · `mtimeMs`), which takes root-relative paths and resolves
  every one through `core/paths.js`. `mcp/test/vault-is-the-only-door.test.js` enforces it, twice:
  a scan for `join(root, …)`, plus an assertion that the four converted modules import no `node:fs`
  — because `recall` bypassed the guard through a closure variable without ever writing that call.
  The three allowlisted files join onto the **install** directory or a git clone, not a vault. The
  Vault does not scrub: secret refusal is policy and stays in `core/scrub.js`. See
  [ADR 0007](docs/adr/0007-the-vault-is-the-only-door.md).
- **`mode` and `audience` are two different questions — never conflate them.** `mcp/lib/mode.js`
  answers *what kind of brain this root is* (repo vs vault, decided by whether it ends in
  `.cortex`). `mcp/lib/resolve.js` answers *who it serves* (solo · team · server). They are
  orthogonal: a repo-mode brain can run on a server, a vault-mode brain can belong to a team. Solo
  and team are **detected** from a `.cortex/connector.json` found by walking up from the cwd; server
  is **declared** with `CORTEX_AUDIENCE=server`, because it leaves no filesystem trace and declaring
  beats detecting. The resolver never invents a root — `AI_OS_ROOT` unset stays a hard exit. See
  [ADR 0008](docs/adr/0008-three-audiences-one-seam.md).
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
  what it looks like. `/analyze-spec` and `/cortex-brief` should both speak it.

The `cortex-auditor` subagent lives in **`agents/`** at the repo root — where an installed plugin
loads subagents from — and is invoked by `/cortex-audit`. `.claude/agents/` would work in this
checkout and ship to nobody.
