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
private repository and is reached through `CORTEX_ROOT`. Its operating manual, including the
firewall that keeps a `home` vault and a `work` vault apart, is
[`templates/vault-AGENTS.md`](templates/vault-AGENTS.md); a vault carries a copy as its own
`AGENTS.md`. When a ritual says "the firewall", that file holds the rule and
[ADR 0015](docs/adr/0015-a-profile-is-the-world-an-install-serves.md) the reasoning.

The product's history is its git log and `CHANGELOG.md`; `archives/` is kept only for a vault and
is ignored in full here.

**Vague prompts go through `/clarify-request` first.** A `UserPromptSubmit` hook scores them in
Claude Code; other agents apply the rules in `skills/clarify-request/SKILL.md` by judgment.

## The rituals

Each is a plain-markdown `SKILL.md` under `skills/` — the canonical copy. Expose them as `/slash`
commands with `bash tools/cortex-sync-skills.sh`, or just name a ritual to any AI tool. That
mirror is gitignored, so nothing keeps it current — `--check` reports drift, and a plain `cp -r`
never removes anything or refreshes a changed skill. An installed plugin loads `skills/` directly
and needs no mirror at all.

| Ritual | When | Does |
|---|---|---|
| `/setup-repo` | **per repo — start here** | the single install: index, report, and stamp the whole SDLC loop in one pass, after one confirmation |
| `/personal-setup` | once | interview the user; fill `context/`, `home.md`, `connections.md` |
| `/quick-note` | anytime | one-line drop to `inbox/` or today's daily note |
| `/daily-plan` | each day | open today's note; surface priorities + due items |
| `/weekly-review` | weekly | empty `inbox/`, update `projects/`, restamp `current-focus` |
| `/retrospective` | biweekly | Notice→Decide→Build interview; ship one artifact |
| `/audit-notes` | periodic | vault health: find + fix orphans, dead links, misplaced files, privacy leaks; `score` for the read-only four-layer score, `graph` to rebuild the navigator |
| `/resume-work` | any time you are lost | where this repo is in the sequence, and the one command to run now |
| `/resume-work` | starting on work already in flight | committed · uncommitted · diverged, then what is left — before touching anything |
| `/merge-work` | work is finished | judge it against the repo's docs, one PR at a time, merge in an order that strands nothing |
| `/sync-website` | after a Cortex release | bring Cortex's public site back in line with the source — refresh its facts, redraft changed pages, PR after approval |
| `/update-plugin` | a skill edit had no effect | make the Cortex this session runs the one you edited |
| `/setup-repo` | when you want the read half alone | index a codebase and report findings, scaffolding only what the user picks. `/setup-repo` runs this and keeps going |
| `/repo-map` | after install | render the index as one offline HTML page — overview, map, structure, files, areas, gaps |
| `/write-context-docs` | on request | write the context layer — root `AGENTS.md`, shims, `CONTEXT.md`, `docs/adr/` |
| `/summarize-files` | on request | add summaries/roles/tags on top of the index. Costs tokens; optional |
| `/write-area-brief` | per critical area | write scoped `AGENTS.md` leaves + wire the root routing table |
| `/suggest-skills` | after scaffold | propose + write skills that fit the detected stack |
| `/change-impact` | before a change | who depends on these files, and which of it no test covers; `--against` — where it collides with another session's change set; `--size` — one agent or a team, recommended |
| `/review-change` | before committing | judge a change against the repo's own docs, and spot the ones it made wrong |
| `/debug-issue` | on a hard bug | build a red-capable loop first, ranked against the repo’s own invariants |
| `/set-profile` | per machine | show or set which world this install serves — home · work · lab |
| `/end-of-day-summary` | end of day | consolidate the day into the repo's committed `.cortex/memory/` |
| `/handover-notes` | leaving work mid-flight | compact this conversation to the OS temp dir for the next agent |
| `/trim-agent-docs` | per repo | audit + slim that repo's agent context files |
| `/write-agent-docs` | writing any agent-facing doc, or a new skill | the authoring discipline behind every file Cortex writes, and the steps that create and wire a new `skills/<name>/SKILL.md` |
| `/define-terms` | per repo, ongoing | sharpen that repo's glossary — write its `CONTEXT.md` + ADRs |
| `/design-spec` | per risky feature | brainstorm → design spec → plan. **No code.** |
| `/migrate-legacy-engine` | per repo, once | move off the retired `.ai-os/` engine |
| `/resolve-conflicts` | on conflict | resolve a stuck merge/rebase by intent, hunk by hunk. Never `--abort` |
| `/register-projects` | anytime | register personal repos into `projects/` — metadata only |
| `/connect-mcp` | once per machine | install the Cortex Core plugin bundle, and register `mcp/server.js` at user scope for recall/capture |
| `/create-team` | leader, once | create + seed the shared team-brain repo |
| `/join-team` | per product repo | clone the team-brain; drop `.cortex/connector.json` |
| `/whats-changed` | after time away | brain notes + team-brain git history → what changed & why |
| `/challenge-plan` | before committing to a plan | interview in rounds until the design tree has no unresolved branch |
| `/architecture-review` | on request | find deepening opportunities in a repo, report them as HTML, work one |
| `/trim-agent-docs` | when the collection has grown | which skills are never reached, redundant, or a prompt would do better |
| `/clarify-request` | automatic | the prompt gate — scores a vague prompt and sharpens it before work starts |

Run `node tools/cortex-capability.mjs` for what each ritual needs from the setup running it, and
`node tools/cortex-skill-graph.mjs` for how they reach each other — which ritual hands off to which,
and whether anything is stranded. A ritual nothing points at is not broken, it is unreachable except
by a user who already knows it exists, which is the same failure as it not being there.

**Picking the right ritual:**
- **On a repo that has never seen Cortex, that is `/setup-repo`** — working project or brand new, the
  same command. It indexes, reports, and stamps the whole artifact chain in one pass behind one
  confirmation, handing off to `/write-context-docs`, `/write-area-brief` and `/suggest-skills` where those
  already own the writing. The table above is a menu and a menu is not an answer; the front door
  is. `index/lib/loop.mjs` decides what a repo is missing and `index/cortex-loop.mjs` prints it.
- **When you are mid-sequence and lost, that is `/resume-work`.** It reads state off disk and names
  the single next command, which is the right question once `/setup-repo` has run and something was
  deferred. `node index/cortex-view.mjs .` shows the same sequence as a **Next steps** tab beside
  the repo's import graph.
- **`/setup-repo` and `/setup-repo` are the whole pass and its read half.** Install indexes,
  reports and offers; `/setup-repo` does that and then closes the artifact chain — `REVIEW.md`, the PR
  review workflow, the verification block, the verifier, the agent team, `intent/`, the hooks, the evals, the bands.
  Reach for install alone to *look* at a repo without being walked to a served one.
- `/debug-issue` and `/review-change` both read the context layer and are not interchangeable:
  review judges a **change** you already made, diagnosis hunts a **symptom** you cannot explain. The
  overlap is diagnosis's first step, where it borrows the review evidence to rank its hypotheses.
- **Five rituals are typed, never reached from a request**: `/quick-note`, `/daily-plan`, `/weekly-review`,
  `/retrospective` and `/register-projects` carry `disable-model-invocation`, beside the once-only
  ones. A ritual that hands off to one tells the user to type it.
  [ADR 0025](docs/adr/0025-the-collection-is-sized-by-use.md) has the measurement.
- `/migrate-legacy-engine` **harvests the old memory store into `AGENTS.md` before deleting anything.**
  Harvest first, delete second — otherwise knowledge is lost across the breaking change.
- `/design-spec` is the heavyweight path; `/plan-feature` (written by `/suggest-skills`) stays the
  lightweight one for routine tickets.
- `/register-projects` never lets company code into a `home` vault — that's the
  vault firewall in [`templates/vault-AGENTS.md`](templates/vault-AGENTS.md), not a style preference.
- `/write-area-brief` nests one filename (`AGENTS.md`), never a sprawl of per-topic files. Split only
  where a real invariant or gotcha lives.
- `/trim-agent-docs` targets **other repos**; `/audit-notes` targets a vault. It never deletes
  prose on its own authority. `/write-agent-docs` is its other half — the discipline for **writing**
  an agent-facing document, reached before authoring a brief or a skill, not after an audit calls it
  bloated.
- **`/resume-work` is the front door to the context-gap rituals**, and it exists because they were not
  being reached. A session that opens on work in flight asks "what's left" as a question to the
  model, when it is a question for the repo — the branches, the open PRs, `.cortex/memory/` and
  `cortex-next.mjs` all answer it off disk. Resume reads those, states the state, and routes to
  whichever of `/end-of-day-summary`, `/handover-notes`, `/whats-changed` or `/merge-work` the answer calls for.
- `/handover-notes`, `/end-of-day-summary` and `/whats-changed` all move context across a gap and are **not**
  interchangeable. The cut is in-flight state versus durable knowledge: `/handover-notes` writes
  ephemerally to the OS temp dir for the *next agent right now*, `/end-of-day-summary` commits what a future
  reader of the codebase needs, `/whats-changed` writes nothing and reads. Running `/handover-notes` alone on
  a day that taught you something loses the lesson.
- `/define-terms` writes a `CONTEXT.md` **in the target repo** — that repo's glossary of terms.
  It is *not* a vault's `context/` (who you are), and its ADRs are *not* `decisions/log.md`
  (your personal decisions). Same word, two different things; never merge them.

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
| `evals/` — scored tasks for skills, training them with SkillOpt, and the outcome harness | [`evals/AGENTS.md`](evals/AGENTS.md), then [`evals/README.md`](evals/README.md) for how to run them |
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
  Copies of them here drifted once already; read the leaf before changing behaviour it governs, and
  write the detail there.
- [[codebase-design]] is vocabulary, not a ritual — the words for *how code is shaped* (module,
  interface, depth, seam, adapter). [[operating-principles]] decides what to build; that decides
  what it looks like. `/design-spec` and `/write-area-brief` should both speak it.

Two subagents live in **`agents/`** — `cortex-auditor` (dispatched by `/audit-notes`) and
`cortex-role-reviewer` (dispatched by `/review-change`, once per angle: security, performance,
accessibility, data-integrity, operability, dx). A role reviewer grounds itself in the target repo's
index and must cite `path:line` — an ungrounded persona gives advice true everywhere and actionable
nowhere. Both live in `agents/` because an installed plugin loads subagents from there;
`.claude/agents/` would work in this checkout and ship to nobody.
