# Cortex — Agent Brief

The single source of truth for any AI agent working in **this repository**. Claude reads
`CLAUDE.md`, Gemini reads `GEMINI.md` — both are shims importing this file. Other tools read it
natively.

## What this is

**Cortex is a project: a context manager for new and legacy codebases**, shipped as a Claude plugin
and as a clone-and-run repo. People point it at *their* codebases — personal repos, and team repos
at work where several developers share one committed context layer (`AGENTS.md`, scoped briefs,
`CONTEXT.md`, `docs/adr/`, `.cortex/memory/`). The rituals below are its interface; `core/`,
`index/` and `mcp/` are its implementation.

Treat this repository the way its users treat theirs — as source code with contributors, tests, CI
and releases. It is not anybody's second brain.

## The one rule (data-free)

**This repository holds the product and nothing else.** No user's content lives here — committed
or untracked — because the product is cloned, forked and read by strangers, and gitignore is not a
security boundary. That covers personal notes, employer or client names, work tickets, colleague
names, and any team's internal architecture. Examples in docs and fixtures stay generic.

A **vault** — the optional personal second brain the capture rituals serve — lives in its own
private repository and is reached through `AI_OS_ROOT`. Its operating manual, including the
firewall that keeps a `home` vault and a `work` vault apart, is
[`templates/vault-AGENTS.md`](templates/vault-AGENTS.md); a vault carries a copy as its own
`AGENTS.md`. When a ritual says "the firewall", that file holds the rule and
[ADR 0015](docs/adr/0015-a-profile-is-the-world-an-install-serves.md) the reasoning.

The product's history is its git log and `CHANGELOG.md`; `archives/` is kept only for a vault and
is ignored in full here.

**Vague prompts go through `/optimize-prompt` first.** A `UserPromptSubmit` hook scores them in
Claude Code; other agents apply the rules in `skills/optimize-prompt/SKILL.md` by judgment.

## The rituals

Each is a plain-markdown `SKILL.md` under `skills/` — the canonical copy. Expose them as `/slash`
commands with `bash tools/cortex-sync-skills.sh`, or just name a ritual to any AI tool. That
mirror is gitignored, so nothing keeps it current — `--check` reports drift, and a plain `cp -r`
never removes anything or refreshes a changed skill. An installed plugin loads `skills/` directly
and needs no mirror at all.

| Ritual | When | Does |
|---|---|---|
| `/cortex` | **per repo — start here** | the single install: index, report, and stamp the whole SDLC loop in one pass, after one confirmation |
| `/onboard` | once | interview the user; fill `context/`, `home.md`, `connections.md` |
| `/capture` | anytime | one-line drop to `inbox/` or today's daily note |
| `/daily` | each day | open today's note; surface priorities + due items |
| `/weekly-review` | weekly | empty `inbox/`, update `projects/`, restamp `current-focus` |
| `/audit` | weekly | read-only four-layer health score + top gaps |
| `/level-up` | biweekly | Notice→Decide→Build interview; ship one artifact |
| `/reindex` | periodic | regenerate the navigator graph, nominate MOCs, fix dead links |
| `/cortex-audit` | periodic | find + fix orphans, dead links, stale/duplicate/misplaced files, privacy leaks |
| `/cortex-next` | any time you are lost | where this repo is in the sequence, and the one command to run now |
| `/resume` | starting on work already in flight | committed · uncommitted · diverged, then what is left — before touching anything |
| `/ship` | work is finished | judge it against the repo's docs, one PR at a time, merge in an order that strands nothing |
| `/plugin-sync` | a skill edit had no effect | make the Cortex this session runs the one you edited |
| `/cortex-install` | when you want the read half alone | index a codebase and report findings, scaffolding only what the user picks. `/cortex` runs this and keeps going |
| `/cortex-view` | after install | render the index as one offline HTML page — map, files, areas, gaps |
| `/cortex-scaffold` | on request | write the context layer — root `AGENTS.md`, shims, `CONTEXT.md`, `docs/adr/` |
| `/cortex-enrich` | on request | add summaries/roles/tags on top of the index. Costs tokens; optional |
| `/cortex-brief` | per critical area | write scoped `AGENTS.md` leaves + wire the root routing table |
| `/cortex-skills` | after scaffold | propose + write skills that fit the detected stack |
| `/cortex-impact` | before a change | who depends on these files, and which of it no test covers |
| `/cortex-review` | before committing | judge a change against the repo's own docs, and spot the ones it made wrong |
| `/diagnosing-bugs` | on a hard bug | build a red-capable loop first, ranked against the repo’s own invariants |
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
| `/skill-audit` | when the collection has grown | which skills are never reached, redundant, or a prompt would do better |
| `/skill-creator` | on request | write a new `skills/<name>/SKILL.md` and wire it in |
| `/optimize-prompt` | automatic | the prompt gate — scores a vague prompt and sharpens it before work starts |

Run `node tools/cortex-capability.mjs` for what each ritual needs from the setup running it, and
`node tools/cortex-skill-graph.mjs` for how they reach each other — which ritual hands off to which,
and whether anything is stranded. A ritual nothing points at is not broken, it is unreachable except
by a user who already knows it exists, which is the same failure as it not being there.

**Picking the right ritual:**
- **On a repo that has never seen Cortex, that is `/cortex`** — working project or brand new, the
  same command. It indexes, reports, and stamps the whole artifact chain in one pass behind one
  confirmation, handing off to `/cortex-scaffold`, `/cortex-brief` and `/cortex-skills` where those
  already own the writing. The table above is a menu and a menu is not an answer; the front door
  is. `index/lib/loop.mjs` decides what a repo is missing and `index/cortex-loop.mjs` prints it.
- **When you are mid-sequence and lost, that is `/cortex-next`.** It reads state off disk and names
  the single next command, which is the right question once `/cortex` has run and something was
  deferred. `node index/cortex-view.mjs .` shows the same sequence as a **Next steps** tab beside
  the repo's import graph.
- **`/cortex` and `/cortex-install` are the whole pass and its read half.** Install indexes,
  reports and offers; `/cortex` does that and then closes the artifact chain — `REVIEW.md`, the
  verification block, the verifier subagent, `intent/`, the hooks, the evals, the bands. Reach for
  install alone when you want to *look* at a repo without being walked to a served one.
- `/diagnosing-bugs` and `/cortex-review` both read the context layer and are not interchangeable:
  review judges a **change** you already made, diagnosis hunts a **symptom** you cannot explain. The
  overlap is Phase 0, where diagnosis borrows the review evidence to rank its hypotheses.
- The three health rituals are not interchangeable — `/audit` scores *content* and writes nothing,
  `/cortex-audit` finds and fixes *structure*, `/reindex` rebuilds the *graph*.
- `/migrate-engine` **harvests the old memory store into `AGENTS.md` before deleting anything.**
  Harvest first, delete second — otherwise knowledge is lost across the breaking change.
- `/analyze-spec` is the heavyweight path; `/plan-feature` (written by `/install-project`) stays the
  lightweight one for routine tickets.
- `/scan-projects` and `/install-project` never let company code into a `home` vault — that's the
  vault firewall in [`templates/vault-AGENTS.md`](templates/vault-AGENTS.md), not a style preference.
- `/cortex-brief` nests one filename (`AGENTS.md`), never a sprawl of per-topic files. Split only
  where a real invariant or gotcha lives.
- `/optimize-context` targets **other repos**; `/cortex-audit` targets a vault. It never deletes
  prose on its own authority. `/writing-for-agents` is its other half — the discipline for **writing**
  an agent-facing document, reached before authoring a brief or a skill, not after an audit calls it
  bloated.
- **`/resume` is the front door to the context-gap rituals**, and it exists because they were not
  being reached. A session that opens on work in flight asks "what's left" as a question to the
  model, when it is a question for the repo — the branches, the open PRs, `.cortex/memory/` and
  `cortex-next.mjs` all answer it off disk. Resume reads those, states the state, and routes to
  whichever of `/dream`, `/handoff`, `/catch-me-up` or `/ship` the answer calls for.
- `/handoff`, `/dream` and `/catch-me-up` all move context across a gap and are **not**
  interchangeable. The cut is in-flight state versus durable knowledge: `/handoff` writes
  ephemerally to the OS temp dir for the *next agent right now*, `/dream` commits what a future
  reader of the codebase needs, `/catch-me-up` writes nothing and reads. Running `/handoff` alone on
  a day that taught you something loses the lesson.
- `/domain-modeling` writes a `CONTEXT.md` **in the target repo** — that repo's glossary of terms.
  It is *not* a vault's `context/` (who you are), and its ADRs are *not* `decisions/log.md`
  (your personal decisions). Same word, two different things; never merge them.
- `/wizard` output handles credentials, so it lands in the target repo's `scripts/` or the
  scratchpad — **never in a vault or in this repo**, and never committed with values baked in.

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
| `tools/` — the scripts a person runs, and the repo's self-checks | [`tools/AGENTS.md`](tools/AGENTS.md) |
| `evals/` — scored tasks for skills, and training them with SkillOpt | [`evals/README.md`](evals/README.md) |
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

Two subagents live in **`agents/`** — `cortex-auditor` (dispatched by `/cortex-audit`) and
`cortex-role-reviewer` (dispatched by `/cortex-review`, once per angle: security, performance,
accessibility, data-integrity, operability, dx). A role reviewer grounds itself in the target repo's
index and must cite `path:line`; an ungrounded expert persona returns advice that is true everywhere
and actionable nowhere, which costs a careful read and returns nothing. Both live in `agents/`
because that is where an installed plugin loads subagents from; `.claude/agents/` would work in
this checkout and ship to nobody.
