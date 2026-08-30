---
name: optimize-context
description: Audit and slim the AI-agent context files in a repo — AGENTS.md, CLAUDE.md, shims, rules files, skill bodies. Two scopes: a repo's files, or the machine-wide ones under ~/.claude that load in EVERY session. Use when a repo's AGENTS.md has grown large, when agents feel slow or drift off-convention, and on "optimize the context", "our AGENTS.md is bloated", "reduce context", "context engineering pass", "audit the agent instructions", "clean up my global CLAUDE.md", "remove what's outdated or contradictory from my instructions", "my personal rules have grown".
capability: judgment
---

# /optimize-context — make a repo's agent context earn its tokens

Runs **inside a target repo** (Cortex-installed or not). Measures the files that steer AI agents
there, ranks what costs context without earning it, fixes what is mechanically safe, and proposes
everything else. The rules it applies are [[context-engineering]] Rules 1–5.

> Not for this vault — `/cortex-audit` owns vault structure.

This is the **audit** half of the job. `/writing-for-agents` is the other half — the discipline for
writing these documents in the first place, and the vocabulary this ritual's findings are named in
(context load, disclosure, sprawl, duplication, no-ops, a weakly worded pointer). Rewriting a file
this ritual flags means reaching for that skill, not improvising.

## The hard rule: never delete prose without a human yes

You cannot mechanically tell *redundant* from *deliberately repeated because it is load-bearing*
([[context-engineering]] Rule 5). In the Cortex vault itself, the employer-firewall enforcement
repeated across `/capture`, `/audit` and `/onboard` scores as textbook duplication — and cutting it
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

A machine-scope run pairs with `/skill-audit`: this one judges the always-loaded prose, that one
judges whether the skills it points at are ever reached.

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

## Pass 3 — Find missing structure
The only pass that *adds*. Find directories that are high-churn, security/data sensitive, or hold an
invariant an agent could break, **and** have no scoped `AGENTS.md` leaf. Read the code to confirm
the invariant is real. Do not nominate a directory with no invariant and no gotcha.

## Pass 4 — Report, then act
Rank findings by always-loaded bytes recovered. Tag each:
- **`[safe]`** — content-preserving (extract a template, repoint a shim whose content is fully
  contained in the canonical file). Apply it.
- **`[propose]`** — reduces information. Quote the exact lines, give the reason, wait for a yes.
- **`[handoff]`** — an approved leaf nomination. Invoke `/cortex-brief <dir>`; do not write leaves
  here. Leaves are Rule 2 (progressive disclosure for directories); delegating rather than
  duplicating is Rule 4.

Close with: measured always-loaded bytes before → projected after.

## Don't
- Don't delete prose on your own authority. Ever.
- Don't rewrite another tool's rules file beyond pointing it at `AGENTS.md`.
- Don't add a script, a config file, or a dependency — this must run in any repo.
- Don't touch the vault.
