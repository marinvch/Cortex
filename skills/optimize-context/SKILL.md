---
name: optimize-context
description: Audit and slim the AI-agent context files in a repo — AGENTS.md, CLAUDE.md, shims, rules files, skill bodies. Use when a repo's AGENTS.md has grown large, when agents there feel slow or drift off-convention, or when the user says "optimize the context", "our AGENTS.md is bloated", "reduce context", "context engineering pass", "audit the agent instructions". Runs inside a target repo, not the vault.
---

# /optimize-context — make a repo's agent context earn its tokens

Runs **inside a target repo** (Cortex-installed or not). Measures the files that steer AI agents
there, ranks what costs context without earning it, fixes what is mechanically safe, and proposes
everything else. The rules it applies are [[context-engineering]] Rules 1–5.

> Not for this vault — `/cortex-doctor` owns vault structure.

## The hard rule: never delete prose without a human yes

You cannot mechanically tell *redundant* from *deliberately repeated because it is load-bearing*
([[context-engineering]] Rule 5). In the Cortex vault itself, the employer-firewall enforcement
repeated across `/capture`, `/audit` and `/onboard` scores as textbook duplication — and cutting it
would silently remove a safety control.

So: automatic changes are limited to moves that **preserve total information**. Anything that
reduces it is quoted, reasoned, and waits for a yes.

## Files in scope
Root and nested `AGENTS.md` · `CLAUDE.md` · `GEMINI.md` · `.github/copilot-instructions.md` ·
`.github/instructions/*.md` · `.cursor/rules/*.mdc` · `.claude/skills/*/SKILL.md`

## Pass 1 — Measure
Per file: bytes, estimated tokens (bytes ÷ 4 — do not add a tokenizer), and whether it loads
**every session** (root `AGENTS.md`, `CLAUDE.md`, shims) or **on demand** (nested leaves, skill
bodies). Always-loaded bytes is the headline number; lead the report with it.

## Pass 2 — Find waste
- **Discoverable from code** (Rule 3) — file trees, dep lists, script names, versions. Check each
  claim against `package.json` and the actual tree. **Test per line:** keep any line carrying a fact
  the code does not state, and quote what you kept.
- **Duplicated across files** (Rule 4) — a shim holding its own copy; a convention stated in both
  root and a leaf. Keep one canonical copy; point the rest at it.
- **Inlined bulk** (Rule 2) — file templates, long examples, reference tables inside an
  always-loaded body. Move to a file; reference it from the step that needs it.

## Pass 3 — Find missing structure
The only pass that *adds*. Find directories that are high-churn, security/data sensitive, or hold an
invariant an agent could break, **and** have no scoped `AGENTS.md` leaf. Read the code to confirm
the invariant is real. Do not nominate a directory with no invariant and no gotcha.

## Pass 4 — Report, then act
Rank findings by always-loaded bytes recovered. Tag each:
- **`[safe]`** — content-preserving (extract a template, repoint a drifted shim). Apply it.
- **`[propose]`** — reduces information. Quote the exact lines, give the reason, wait for a yes.
- **`[handoff]`** — an approved leaf nomination. Invoke `/scope-area <dir>`; do not write leaves
  here. Leaves are Rule 2 (progressive disclosure for directories); delegating rather than
  duplicating is Rule 4.

Close with: measured always-loaded bytes before → projected after.

## Don't
- Don't delete prose on your own authority. Ever.
- Don't rewrite another tool's rules file beyond pointing it at `AGENTS.md`.
- Don't add a script, a config file, or a dependency — this must run in any repo.
- Don't touch the vault.
