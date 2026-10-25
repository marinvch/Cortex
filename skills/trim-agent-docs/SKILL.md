---
name: trim-agent-docs
description: Audit and slim agent context files (AGENTS.md, CLAUDE.md, rules, skill bodies) in a repo or ~/.claude, and judge a skill collection by use — never reached, redundant. Triggers — "optimize the context", "our AGENTS.md is bloated", "clean up my global CLAUDE.md", "review my skills", "are any of these redundant".
metadata:
  capability: judgment
---

# /trim-agent-docs — make a repo's agent context earn its tokens

Runs **inside a target repo** (Cortex-installed or not). Measures the files that steer AI agents
there, ranks what costs context without earning it, fixes what is mechanically safe, and proposes
everything else. The rules it applies are [[context-engineering]] Rules 1–5.

> Not for this vault — `/audit-notes` owns vault structure.

This is the **audit** half of the job. `/write-agent-docs` is the other half — the discipline for
writing these documents in the first place, and the vocabulary this ritual's findings are named in
(context load, disclosure, sprawl, duplication, no-ops, a weakly worded pointer). Rewriting a file
this ritual flags means reaching for that skill, not improvising.

## The hard rule: never delete prose without a human yes

You cannot mechanically tell *redundant* from *deliberately repeated because it is load-bearing*
([[context-engineering]] Rule 5). In the Cortex vault itself, the employer-firewall enforcement
repeated across `/quick-note`, `/audit-notes score` and `/personal-setup` scores as textbook duplication — and cutting it
would silently remove a safety control.

So: automatic changes are limited to moves that **preserve total information**. Anything that
reduces it is quoted, reasoned, and waits for a yes.

## Two scopes — say which one you are in before Pass 1

**Repo scope** (the default): root and nested `AGENTS.md` · `CLAUDE.md` · `GEMINI.md` ·
`.github/copilot-instructions.md` · `.github/instructions/*.md` · `.cursor/rules/*.mdc` ·
`.claude/skills/*/SKILL.md`. Costs context only in that repo.

**Machine scope** — `~/.claude/CLAUDE.md`, `~/.claude/agents/*.md`, `~/.claude/skills/*/SKILL.md`,
and the `settings.json` that steers behaviour. Run this when the user says "my global CLAUDE.md",
"the rules I have everywhere", "my personal instructions".

The machine scope is where bloat is most expensive and least examined: those files load in **every
session on every project**, so a paragraph nobody needs is paid for on every turn of every task,
forever. A repo's `AGENTS.md` is at least paid for only by people working in that repo.

It also inverts the main trim. A rule can move out of a repo file into a skill and be no worse off,
because something will route back to it. A rule removed from a global `CLAUDE.md` and left only in a
skill **stops applying in every session where that skill does not trigger** — and skills trigger on
description match, which is exactly the thing you cannot guarantee. So in machine scope:

- Keep the **invariant** — the sentence that must hold even when no skill loads. One line.
- Move the **method** — the ordering, the checklists, the templates — into the skill, and point at
  it by name from the line you kept.
- Never move a safety or privacy rule out of a global file at all. Those are exactly the rules whose
  failure mode is silent.

The honest result of a machine-scope pass is often a file that is *shorter in method and no shorter
overall*. Report it that way rather than reporting a line count as if it were the goal.

A machine-scope run pairs with the [skill collection](#the-skill-collection) mode below: the passes
judge the always-loaded prose, and that mode judges whether the skills it points at are ever reached.

## Pass 1 — Measure
Per file: bytes, estimated tokens (bytes ÷ 4 — do not add a tokenizer), and whether it loads
**every session** or **on demand**. Always-loaded bytes is the headline number; lead the report
with it.

**Read the frontmatter before you classify — location is not the answer.** A file's own header
decides when its host loads it, and classifying by path understates the headline number in the
dangerous direction: the repo looks leaner than it is, so the findings that would recover the most
context rank lowest or get dropped. On one real repo that error halved the number.

| Signal | Loads |
|---|---|
| `applyTo: "**"` in `.github/instructions/*.md` | **every session** — Copilot applies it to every file |
| `applyTo: "src/pages/**, src/components/**"` | on demand, for those globs only |
| `alwaysApply: true` in `.cursor/rules/*.mdc` | **every session** |
| `globs:` in `.cursor/rules/*.mdc`, no `alwaysApply` | on demand |
| root `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, shims | every session |
| no frontmatter, nested leaf or skill body | on demand |

Two files that are both always-loaded are **co-loaded**, and that is what makes repointing one at
the other content-preserving rather than lossy. Without reading the frontmatter a safe `[safe]`
repoint is indistinguishable from an unsafe one, and the hard rule below — never delete prose
without a human yes — has no way to be applied correctly.

State the signal you used per file, so the classification can be checked rather than trusted.

## Pass 2 — Find waste
- **Discoverable from code** — cut what [[context-engineering]] Rule 3 covers. Check each claim
  against the repo's manifest — `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, whatever
  the stack uses — and the actual tree; anything recoverable from the manifest counts as stated by
  the code, including script names. **Test per line, not per section:** keep any line carrying a
  fact the code does not state, and quote what you kept.
- **Duplicated across files** (Rule 4) — a shim holding its own copy; a convention stated in both
  root and a leaf. Keep one canonical copy; point the rest at it — **but only when the duplicate's
  content is fully contained in the canonical file.** If it states anything the canonical file does
  not (drift), it is not a safe repoint — quote the divergent lines and treat it as `[propose]`.
- **Inlined bulk** (Rule 2) — file templates, long examples, reference tables inside an
  always-loaded body. Move to a file; reference it from the step that needs it.

### The official lens — every always-loaded line, against Anthropic's own test

Anthropic's best-practices page gives a test for `CLAUDE.md` that applies to anything loaded every
session. Cortex vendors it as rules in `${CLAUDE_PLUGIN_ROOT}/core/claude-code.js`, each with its
source sentence; cite the rule id in the finding, not a number from memory.

- **`claude-md.prune-test`** — for each always-loaded line: *would removing this cause Claude to
  make mistakes?* A line that fails is a `[propose]` finding, quoted with that reason. This does
  **not** loosen the hard rule: the test says what to propose, the human still says yes.
- **`claude-md.broad-only`** — a line that applies only to one area or one workflow belongs in a
  scoped leaf (`/write-area-brief`) or a skill, which load on demand. Moving it is `[propose]` unless
  the destination already states it word for word.
- **`claude-md.emphasis-one-line`** — `IMPORTANT`, `MUST`, `NEVER` on many lines means none stands
  out. Report the count; propose keeping emphasis on the one rule that is actually being skipped.
- **`claude-md.max-lines`** — a file over this limit is a finding on its own; say by how much.

What the page says belongs in the file, and what does not
([code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices)):

| Keep | Cut or move |
|---|---|
| commands Claude can't guess | anything Claude can learn by reading the code |
| style rules that differ from defaults | standard language conventions |
| testing instructions and preferred runners | detailed API documentation — link instead |
| repo etiquette (branch naming, PR conventions) | information that changes frequently |
| architectural decisions specific to the project | long explanations or tutorials |
| environment quirks (required env vars) | file-by-file descriptions of the codebase |
| gotchas and non-obvious behaviour | self-evident practice like "write clean code" |

If the repo's `/setup-repo` report already carries `claude-setup/claude-md-*` findings, start
from those — they are the mechanical half of this lens, and this pass is the judgment half.

## Pass 3 — Find missing structure
The only pass that *adds*. Find directories that are high-churn, security/data sensitive, or hold an
invariant an agent could break, **and** have no scoped `AGENTS.md` leaf. Read the code to confirm
the invariant is real. Do not nominate a directory with no invariant and no gotcha.

## Pass 4 — Report, then act
Rank findings by always-loaded bytes recovered. Tag each:
- **`[safe]`** — content-preserving (extract a template, repoint a shim whose content is fully
  contained in the canonical file). Apply it.
- **`[propose]`** — reduces information. Quote the exact lines, give the reason, wait for a yes.
- **`[handoff]`** — an approved leaf nomination. Invoke `/write-area-brief <dir>`; do not write leaves
  here. Leaves are Rule 2 (progressive disclosure for directories); delegating rather than
  duplicating is Rule 4.

Close with: measured always-loaded bytes before → projected after.

## The skill collection

Take this mode when the question is about the skills as a set: "review my skills", "are any of these
redundant", "why does Claude never use this skill". The passes above read the files. This mode reads
the **record of them being used**, because a skill's real defect is usually invisible in its own
file: well written, correct, wired in, and nobody ever reaches it. On one vault the first run found
28 of 42 skills never reached in 51 sessions, and no amount of re-reading the bodies would have
shown that. It reports only.

A skill nothing reaches is more often a **routing** failure than a quality one, and the fix is
usually one line in a neighbouring skill. Deleting is the least interesting outcome.

### Measure before reading anything

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-skill-usage.mjs"            # typed vs auto, per skill
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-skill-usage.mjs" --unused   # the never-reached list
node "${CLAUDE_PLUGIN_ROOT}/tools/cortex-skill-graph.mjs"            # who reaches whom

# exposure: when each skill first existed, against the window the sessions cover
for d in skills/*/; do echo "$(git log --format=%ad --date=short -- "$d" | tail -1)  $(basename "$d")"; done | sort
```

**Read the exposure dates first.** A skill added on the last recorded day has had no chance to fire,
so its zero is arithmetic, not evidence. Judge only the skills present for most of the window, and
say which ones you set aside.

The two counts are separate on purpose, and the gap between them is the diagnosis:

| typed | auto | What it means |
|---|---|---|
| > 0 | 0 | the description does not match how the work actually arrives |
| 0 | > 0 | it triggers on its own; the slash command is decoration |
| 0 | 0 | nothing reaches it; the graph says whether that is wiring or a missing front door |

**The usage tool reads a transcript directory holding everything the user has ever typed.** It
extracts skill names and timestamps only. Do not read those transcripts yourself for more context:
that is a different act with a different consent question, and this mode does not include it.

### Rank each skill, strongest signal first

1. **Was it ever reached?** Measured, not an opinion.
2. **Does another skill cover the same job?** Two skills whose descriptions both fire on the same
   sentence are worse than either alone: the model picks one, inconsistently. Read the
   `description:` lines side by side; that is what the model sees.
3. **Would a plain prompt do better?** A skill earns its place by holding what a prompt cannot: a
   sequence that must not be reordered, a constraint that gets forgotten, a hard-won gotcha, a
   script. A skill that only says "be careful and thorough" is a prompt in a costume.
4. **Is it stale?** Weakest, and often backwards: a correct skill does not get edited, so age
   measures stability as often as rot. Check the claims, not the date. A skill naming a file, flag
   or command that no longer exists is stale in the way that matters.

### Diagnose a never-reached skill before rewriting it

- **Nothing points at it.** `cortex-skill-graph.mjs` says so. The fix is an edge from the ritual
  that should hand off to it, not a pushier description.
- **The description does not match the words people use.** Compare it with how the request really
  arrives, including other languages and the vague version. This is where a rewrite helps, and the
  `skill-creator` plugin has a measured loop for it.
- **It is a deliberate act.** `/end-of-day-summary`, `/handover-notes`, `/create-team` are things a
  person decides to do. Zero auto-invocations is correct for these. **Never tune a skill into
  triggering itself when the user should be choosing.** Say which skills you put in this category.

### Report, then ask

One table, ranked by what you would act on first:

```
| Skill | Used | Verdict | Why | Proposed |
|---|---|---|---|---|
| /whats-changed | 0 | never reached | no ritual pointed at it | edge from /resume-work |
| /foo | 0 | redundant | /bar fires on the same sentence | merge into /bar |
| /baz | 3 | keep | | |
```

**Propose; do not delete.** Merging two skills, or adding one line of routing, resolves most of what
this finds. Where the fix is a rewrite, `/write-agent-docs` is the authoring discipline.

- **A short history proves nothing.** Under about 20 sessions, "never reached" mostly means "not
  yet". Give the sample size in the report.
- **A hook that injects prose is invisible to the usage tool**, which sees a typed `<command-name>`
  and a `Skill` call and nothing else. `/clarify-request` is reached by a `UserPromptSubmit` hook, so
  it reads 0/0 however often it fires. Check every ritual declaring `reached-by:` against its
  trigger before calling it unreached.
- **The work has to have occurred.** A ritual scores zero when its job never came up. Separate that
  from a description that never matched by looking at artifacts on disk: an ADR written in the
  window is `/define-terms`'s trigger having fired.
- **A renamed skill still typed under its old name** shows up among other plugins' skills and looks
  like one that vanished. Cortex renamed every ritual in 3.0.0, so expect this in older sessions.
- **Do not audit and rewrite in the same pass.** Measure the whole collection, report, get a
  decision, then change things.

## Don't
- Don't delete prose on your own authority. Ever.
- Don't rewrite another tool's rules file beyond pointing it at `AGENTS.md`.
- Don't add a script, a config file, or a dependency — this must run in any repo.
- Don't touch the vault.
