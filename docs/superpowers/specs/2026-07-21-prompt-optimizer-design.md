# Prompt Optimizer — Design Spec

> **Date:** 2026-07-21
> **Status:** Approved — ready for implementation plan
> **Scope:** A Cortex ritual (`/optimize-prompt`) that sharpens vague prompts into precise,
> actionable ones *before* any work starts, saves each result under `docs/prompts/`, and routes
> the work to the right ritual. Enforced automatically by a `UserPromptSubmit` hook in Claude Code,
> and by a protocol section in `AGENTS.md` for every other agent.

---

## Problem

A vague prompt makes the agent guess. Guesses cost a full turn — sometimes a full session — before
the mismatch surfaces. The failure is not a missing skill; the intent exists in the user's head but
never reaches the agent precisely.

| Input | What's missing | Result today |
|---|---|---|
| "fix it" | subject | wasteful "fix what?" round-trip |
| "make it faster" | target, metric | random optimization |
| "add the booking stuff" | layer, action | wrong file, wrong layer |

Prior art exists in this repo: [`2026-05-25-prompt-booster-design.md`](2026-05-25-prompt-booster-design.md),
written for the **retired engine** (`boost_prompt` MCP tool + generated `copilot-instructions.md`).
Its scoring model and synthesis template are sound and are carried forward here; its delivery
mechanism is dead and is replaced by the plain-files + hook approach below.

## Goals

1. Every prompt is gated automatically — nothing to invoke manually.
2. A precise prompt costs **zero** tokens and is never touched.
3. A vague prompt yields a confirmed, sharper prompt plus a named ritual handoff.
4. Each optimized prompt is persisted under `docs/prompts/`.
5. Behavior is identical for agents without hook support (Gemini, Copilot, Codex).

## Non-goals

- Propagating the optimizer into other repos via `/install-project` (later, cheap once thresholds are tuned).
- An MCP `boost_prompt` tool.
- Acting on an unconfirmed synthesized prompt. Non-negotiable.

---

## Architecture

Hybrid: a **deterministic gate** where a regex is genuinely sufficient, **model judgment** where it
is not.

```text
user prompt
   │
   ▼
.claude/hooks/optimize-prompt.mjs        (UserPromptSubmit, deterministic)
   │  bypass    → exit 0, emit nothing
   │  score < 3 → exit 0, emit nothing        ← zero tokens, invisible
   │  score ≥ 3 → stdout JSON { additionalContext: "<directive + score>" }
   ▼
skills/optimize-prompt/SKILL.md          (model judgment)
   ≤2 grounded questions → synthesize → confirm → save → route
   ▼
target ritual (/analyze-spec, brainstorming, systematic-debugging, /capture, …)
```

Agents without hooks reach the same skill via the **Prompt Optimization Protocol** section in
`AGENTS.md`, which every agent loads at session start.

---

## Component 1 — the gate (`.claude/hooks/optimize-prompt.mjs`)

Pure ESM with named exports, mirroring the existing `reflect-session.mjs` so it is unit-testable
without spawning a process.

**Vagueness score** (carried forward from the engine spec):

| Signal | Points |
|---|---|
| prompt under 10 words | +2 |
| no action verb (`add, create, update, delete, fix, remove, migrate, refactor, write, build, review, audit, explain, document, test, rename, move, debug, optimize, install, scan`) | +1 |
| no component reference (path-like token, `file.ext`, backticked token, `#123`, URL) | +1 |
| no domain keyword (`auth, db, database, api, ui, schema, test, hook, skill, vault, graph, mcp, git, ci`) | +1 |

**Threshold:** score ≥ 3 triggers. Score < 3 passes through silently.

**Bypass — emit nothing regardless of score:**

- prompt begins with `/` (an explicit ritual is already named)
- contains a bypass keyword: `just, quickly, only, typo, rename`
- is a short confirmation/steer: `yes, no, ok, continue, go ahead, stop, undo`
- exceeds 60 words (already detailed)
- contains a file path or `file:line` reference
- `CORTEX_NO_OPTIMIZE=1` is set

**Output on trigger** — JSON on stdout:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Prompt vagueness score N/5. Before acting, run the Prompt Optimization Protocol (skills/optimize-prompt/SKILL.md): ask at most 2 grounded questions, synthesize one precise prompt, confirm it, save it to docs/prompts/, then route to the named ritual."
  }
}
```

**Fails open, always.** The whole body is wrapped in try/catch and exits 0 on any error — malformed
stdin, missing fields, unwritable disk. A broken optimizer must never block a prompt or cost a
session.

**Open item resolved during implementation:** confirm the exact `UserPromptSubmit` context-injection
contract against the installed Claude Code version. If the JSON shape differs, fall back to plain
stdout, which that event appends as context.

---

## Component 2 — the brain (`skills/optimize-prompt/SKILL.md`)

Plain markdown under ~500 words. Per `/skill-creator`, the `description:` frontmatter carries
**triggering conditions only** — never a workflow summary, or agents follow the description and skip
the body.

**What to do:**

1. **Score** the prompt using the table above. This duplicate exists so hook-less agents behave
   identically; the hook is an optimization, not the source of truth.
2. **Ask at most 2 questions**, in priority order, skipping any already answered:
   - WHAT should happen (missing action/outcome)
   - WHERE it lives (missing component/layer)
   - HOW it should land (new vs. change vs. migration)
   Ground every question in **this repo's real names** — "`skills/` or `tools/`?" beats "which
   layer?". Generic questions are the reason the engine-era version was never worth using.
3. **Synthesize** one prompt: `[ACTION] [COMPONENT] [in DOMAIN] [with CONSTRAINTS] → [RITUAL]`
4. **Confirm** — show it, wait for a one-word yes/adjust. One adjustment round, then proceed.
5. **Save** to `docs/prompts/YYYY-MM-DD-<slug>.md` (append a `##` block if the slug exists).
6. **Route** — hand off to the named ritual.

**Don't:**

- Don't fire on slash commands, confirmations, or mid-flow replies.
- Don't ask more than 2 questions — friction is what kills this tool.
- Don't act on an unconfirmed synthesized prompt.
- Don't write personal or business facts into committed files (privacy firewall).

**Routing table** (prompt shape → ritual):

| Shape | Ritual |
|---|---|
| new feature / non-trivial change | `superpowers:brainstorming`, then `/analyze-spec` if risky |
| bug, test failure, unexpected behavior | `superpowers:systematic-debugging` |
| stray thought, link, task | `/capture` |
| vault structure / health question | `/cortex-doctor` or `/cortex-audit` |
| "make a ritual for X" | `/skill-creator` |

---

## Component 3 — storage

One file per optimized prompt: `docs/prompts/YYYY-MM-DD-<slug>.md`, where `<slug>` is kebab-case
from the 3–5 most specific words of the *optimized* prompt (`add-prompt-optimizer-ritual`). If that
file already exists, append a new `## Raw` / `## Clarified` / `## Optimized` block to it rather than
suffixing a counter — same-day, same-topic prompts belong together.

```markdown
---
type: optimized-prompt
created: 2026-07-21
score: 4
ritual: superpowers:brainstorming
---
## Raw
<the original prompt, verbatim>

## Clarified
- Q: <question> → A: <answer>

## Optimized
<the synthesized prompt>
```

**Privacy.** `docs/` is committed, and real prompts name real clients, repos, and plans. Therefore
`.gitignore` gains:

```gitignore
docs/prompts/
!docs/prompts/README.md
```

`docs/prompts/README.md` is committed and **data-free** — it documents the convention so the vault
stays forkable while the prompts themselves never leave the machine. This upholds the vault's one
privacy rule.

---

## Component 4 — wiring

| File | Change |
|---|---|
| `AGENTS.md` | New `## Prompt Optimization Protocol` section (agent-agnostic prose) + one bullet in the rituals list |
| `README.md` | One row in the rituals table |
| `.claude/settings.json` | `UserPromptSubmit` hook entry beside the existing `SessionEnd` one |
| `.claude/skills/optimize-prompt/SKILL.md` | Slash-command copy of the canonical skill |
| `.gitignore` | `docs/prompts/` + `!docs/prompts/README.md` |

---

## Testing

`.claude/hooks/optimize-prompt.test.mjs`, run by `node --test`, matching `reflect-session.test.mjs`:

| Case | Expected |
|---|---|
| `"fix the null check in tools/cortex.sh:42"` | no output, exit 0 |
| `"add the booking stuff"` | JSON emitted, score ≥ 3 |
| `"/capture buy milk"` | bypass, no output |
| `"just rename this"` | bypass, no output |
| 80-word detailed prompt | no output |
| malformed stdin | no output, exit 0 |
| `CORTEX_NO_OPTIMIZE=1` | no output |

---

## Acceptance criteria

1. Typing a vague prompt in Claude Code produces ≤2 grounded questions, then a synthesized prompt
   shown for confirmation — with no ritual invoked manually.
2. Typing a precise prompt produces no optimizer output of any kind.
3. Each confirmed optimized prompt exists at `docs/prompts/YYYY-MM-DD-<slug>.md`.
4. `git status` never shows a file under `docs/prompts/` except `README.md`.
5. `node --test .claude/hooks/` passes.
6. `AGENTS.md`, `README.md`, and `.claude/skills/` all list the ritual (no skill-wiring drift, so
   `/cortex-doctor` stays clean).
7. Deleting or breaking the hook degrades to the `AGENTS.md` protocol without blocking any prompt.
