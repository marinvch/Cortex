---
name: cortex-install
description: Install Cortex into a codebase — index it, report what it finds, and let the user choose what to act on. Use when someone says "install cortex here", "set up cortex on this repo", "give this codebase a context layer", when opening an unfamiliar repo that needs understanding before work starts, or when a repo has no AGENTS.md and an agent is about to re-derive its architecture from scratch. Works on greenfield and legacy repos. Asks before writing anything, and never touches source code.
capability: mechanical
---

# /cortex-install — give a codebase a context layer

The entry point. Runs in a **target repo**, never in the Cortex repo itself.

> **The rule that governs this whole skill:** steps 1–5 read, report and *ask*. They do not modify
> one line of the repository. Writing happens in step 6, only for the items the user confirmed. If
> you find yourself editing a source file before the user has chosen something, stop — you have
> left the skill.

## 1. Orient

```bash
git rev-parse --show-toplevel 2>/dev/null || pwd
```

Refuse to continue if this is the Cortex repo itself (`.claude-plugin/plugin.json` names `cortex`)
— Cortex installs *into other repos*.

Note whether the repo already has `AGENTS.md`, `CONTEXT.md`, `docs/adr/`, `.cortex/`. An existing
`.cortex/` means Cortex is already installed; offer to re-index instead of reinstalling.

### The consent gate

This skill is **model-invocable** — you may start it yourself when a repo plainly needs it. That
makes the gate below the thing protecting the repository, not the invocation rules.

**If `.cortex/` does not exist, ask before writing anything** — including the index. Say what you
propose to do, that it writes only to `.cortex/` and never to source, and wait for a yes. Generated
and gitignored is not the same as invisible: these are files appearing in someone's project, on a
run they did not ask for.

**If `.cortex/` already exists**, Cortex is established here and re-indexing needs no ceremony —
refresh it and carry on.

The gate is on the **first write**, not on reading. Orienting yourself — reading `AGENTS.md`, the
tree, the manifest — needs no permission and never did.

## 2. Index

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-index.mjs" .
```

Deterministic and offline — parse, imports, inventory, layers, git hot spots. Writes only
`.cortex/index/index.json`. On a large repo this is seconds, not minutes.

If the repo is not a git checkout the indexer falls back to a filesystem walk; say so, because
hot spots will be empty and that changes how the findings should be read.

### The fork: greenfield or existing code

The indexer prints the file count. **Zero files is the greenfield flow**, and it is a different
sequence — not a degenerate case of the one below:

- **Greenfield** — there is nothing to analyse, so skip the ceremony. Still generate the report
  (it states plainly that the repo is greenfield and costs nothing), then go straight to offering
  the context layer. **Do not** offer scoped briefs or enrichment: both describe code, and there is
  none. Say the honest version — scaffolding now means the context layer grows *with* the code
  instead of being reverse-engineered from it later. `/cortex-scaffold` interviews them for the
  stack and commands, because there is no code to read them from.
- **Existing code** — continue with step 3 below.

The fork is on the index, not on a guess about the repo. A repo with a README and no source is
greenfield; a repo whose only code is a build script is not.

## 3. Report

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-findings.mjs" .
```

Writes exactly one file: `.cortex/findings/<date>.md`.

Read it, then give the user a **short** summary in chat — the top three or four items, most severe
first, in your own words. Do not paste the report; they can open it. Say plainly how many findings
there are and where the file is.

If there are `critical` security findings, lead with them. Those are possible secrets in the repo,
and some will be fixtures — say that, because a false positive presented as a breach destroys
trust in every other finding.

## 4. Walk the offers — and write nothing

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-findings.mjs" . --offers
```

This prints the **ranked worklist** as JSON and writes nothing at all. It is the same analysis the
report renders, in the shape you can act on: one entry per action, most severe first, each carrying
`targets` (what it would touch) and `findings` (the titles that produced it).

Walk it **top-down, one entry at a time**, and record yes / no / **later** for each. Say plainly,
before the first question, that nothing is written until the end — this step only collects answers.

Ask with the *why* attached; that is what `findings` is for. "Three areas may deserve their own
brief — `src/components`, `src/app`, `src/lib`" is a question a user can answer. "Run brief?" is not.

The worklist is already collapsed, so a repo with thirty findings is still four or five questions.
**Do not re-expand it** by asking per target — one `brief` entry is one question naming its
candidates; the user narrows the list in their answer.

| Action | Ask about |
|---|---|
| `scaffold` | the context layer — `AGENTS.md` + shims, `CONTEXT.md`, `docs/adr/` |
| `brief` | scoped `AGENTS.md` leaves for the named areas |
| `bundle` | the plugin tiers the index gave a reason for — never the whole list |
| `enrich` | semantic summaries over the index |
| `memory` | a committed `.cortex/memory/` |
| `triage-secrets` | **nothing.** See below |

**`enrich` states its token cost before the question, not after.** It is the only offer that spends
real money, and a user who says yes and then learns the price has been sold something.

**`triage-secrets` shows and stops.** Present the possible secrets, say that some will be fixtures,
and take no remediation action — not rotation, not redaction, not a commit. A false positive
presented as a breach destroys trust in every other finding, and Cortex is not the tool that
touches someone's credentials. It is a finding to hand over, not an offer to accept.

An empty worklist is a real outcome and a good one: this repo is already served. Say so and skip to
step 6 rather than inventing something to ask.

A user who declines everything has been served completely. That is a successful run.

## 5. Play back the worklist — one confirmation

Before writing anything, play back **everything they said yes to, as a list of paths**:

```
I'll create:
  AGENTS.md, CLAUDE.md, GEMINI.md, CONTEXT.md, docs/adr/
  src/components/AGENTS.md, src/lib/AGENTS.md
  .cortex/memory/
Not doing: enrichment (later), plugin bundle (no)
```

Take **one** confirmation for the whole set. Not one per file, not one per skill — the questions
were step 4; this is the single gate between deciding and doing. A user who has answered five
questions and is then asked five more times has been interviewed twice.

If they change their mind here, amend the list and play it back again. Then apply **in worklist
order** — severity order, the same sequence they answered in.

## 6. Apply — only what was confirmed

**Context layer** — copy from `${CLAUDE_PLUGIN_ROOT}/templates/`:
- `target-AGENTS.md` → `AGENTS.md`, filled in from the index: stack, layout, how to run tests,
  the invariants you actually observed. Keep it under ~120 lines; detail belongs in leaves.
- `CLAUDE.md` and `GEMINI.md` as one-line shims importing it.
- `CONTEXT.md` from the glossary template, seeded with the domain terms that appear in the code.
- `docs/adr/` with the ADR template. Create records lazily, not preemptively.

Never clobber a curated file. If `AGENTS.md` exists and has real content, write
`AGENTS.generated.md` beside it and tell the user to diff.

**Context layer, the writing itself** — hand off to `/cortex-scaffold`. It owns the templates, the
never-clobber rules and the post-write verification; do not duplicate that logic here.

**Scoped briefs** — hand off to `/cortex-brief` for each area they picked.

**Bundle** — hand off to `/setup-plugins`, which reads `plugins/cortex-core-plugins.json`:

| Tier | Holds | When |
|---|---|---|
| `core` | superpowers, context7, skill-creator, claude-md-management, claude-code-setup, feature-dev, code-review, code-simplifier | always — this is the developer experience Cortex assumes |
| `dev-tools` | typescript-lsp, github | opt-in |
| `api` | postman | opt-in; offer it when the index shows an API surface or a collection |
| `browser-qa` | playwright, chrome-devtools-mcp | opt-in; offer it when the index shows a frontend |
| `platform` | vercel, cloudflare, karpathy skills | opt-in |

Core carries **superpowers** because Cortex's workflow is spec- and test-driven and leans on it,
and **Context7** because a context manager whose agents guess at library APIs from stale training
data is not managing much.

Offer a tier when the index gives you a reason to — an API surface, a frontend — not by reciting
the whole list. Every declared name is verified against the marketplace by
`core/test/bundle.test.js`, so if a tier fails to install, the manifest is stale rather than wrong.

**Memory** — create `.cortex/memory/` and tell the user it is committed on purpose: it is how
several developers and their agents share one context. Then say the hard part out loud — nothing
personal or secret may go in it, and Cortex will refuse writes that carry credentials.

## 7. Close

State what was written, as a list of paths — the same shape as the step 5 playback, so they can see
the promise and the result side by side.

Then state what was marked **later**, by name. "Later" is a real answer and the close is where it
survives; a deferred offer that goes unmentioned is a decision the user made and Cortex quietly
dropped. Say that re-running `/cortex-install` picks those up, and that satisfied offers will not be
asked again.

Suggest committing what was written so the team shares the context. Mention that re-running
`index/cortex-index.mjs` refreshes the index after significant changes, and `/dream` at the end of a
working day.

**End with one next command, not a menu.** Run `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-next.mjs" . --line` and print what
it says. This is the last thing the user reads, and a list of eleven commands sorted by nothing is
where an install stops being useful — they leave holding options instead of a step. If they want the
whole sequence, that is `/cortex-next`; if they would rather see the repo than read about it,
`node "${CLAUDE_PLUGIN_ROOT}/index/cortex-view.mjs" .` renders the index as one offline page.

## Gotchas

- `.cortex/index/` and `.cortex/findings/` are generated — gitignore them. `.cortex/memory/` is
  **committed**; that asymmetry is deliberate and worth explaining once.
- The indexer resolves imports by convention, so dynamically loaded files look like orphans.
  Present orphans as "worth checking", never "safe to delete".
- On a monorepo, offer to index one package rather than the whole tree if the top-level file
  count is very large.
