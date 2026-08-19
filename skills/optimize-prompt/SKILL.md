---
name: optimize-prompt
description: Use when a prompt is vague, short, or missing its target — "fix it", "make it faster", "add the booking stuff" — or when the UserPromptSubmit hook reports a vagueness score of 4 or higher. Also use when the user says "optimize this prompt", "sharpen this", "what should I have asked".
---

# /optimize-prompt — sharpen a prompt before acting on it

A vague prompt makes the agent guess, and a guess costs a whole turn. This ritual converts an
unclear ask into one precise prompt, gets it confirmed, records it, and hands it to the right
ritual.

## What to do

1. **Score it** (the hook does this in Claude Code; do it yourself everywhere else):
   under 10 words `+2`; no action verb `+1`; no component reference `+1`; no domain keyword `+1`.
   - Action verbs: add, create, update, delete, fix, remove, migrate, refactor, write, build,
     review, audit, explain, document, test(s), rename, move, debug, optimi[sz]e, install, scan,
     implement, generate, wire, split, merge, run.
   - Component reference: a path, a `` `backticked` `` token, a `file.ext`, a `#123`, or a URL.
   - Domain keywords: auth, db, database, api, ui, schema, test(s), hook(s), skill(s), vault,
     graph, mcp, git, ci, cli, doc(s), readme, agent(s), prompt(s).

   Under 4 — act on the prompt as written, say nothing. **Bypass entirely** (no score, no
   directive) when the prompt: is empty; starts with `/`; is over 2000 characters; is over 60
   words; is a steer of two words or fewer (`yes`, `ok`, `go ahead`, `stop`, …); is a status check
   of eight words or fewer opening with is/are/was/were/did/does/do/has/have + it/this/that/we/
   they/everything/all (`is it done`, `did it work`); contains `just`, `quickly`, `only`, `typo`,
   or `rename`; or names an exact file path or `file:line`. Set
   `CORTEX_NO_OPTIMIZE=1` to disable the optimizer entirely.
2. **Ask at most 2 questions**, highest-value first, skipping any the prompt already answers:
   WHAT should happen (missing outcome), WHERE it lives (missing component), HOW it lands (new /
   change / migration). Ground every question in this repo's **real names** — "`skills/` or
   `tools/`?" beats "which layer?".
3. **Synthesize one prompt:** `[ACTION] [COMPONENT] [in DOMAIN] [with CONSTRAINTS] -> [RITUAL]`
4. **Confirm.** Show it, wait for a one-word yes or an adjustment. One adjustment round, then go.
   Never act on an unconfirmed prompt.
5. **Save** to `docs/prompts/YYYY-MM-DD-<slug>.md` — slug is kebab-case from 3–5 of the most
   specific words of the *optimized* prompt. If the file exists, append another block.
6. **Route** to the ritual named in the synthesis.

## Routing

| Prompt shape | Ritual |
|---|---|
| new feature or non-trivial change | `superpowers:brainstorming`, then `/analyze-spec` if risky |
| bug, test failure, surprise behavior | `superpowers:systematic-debugging` |
| stray thought, link, task | `/capture` |
| vault structure or health | `/cortex-audit` |
| "make a ritual for X" | `/skill-creator` |

## Record format

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
- Q: <question> -> A: <answer>

## Optimized
<the synthesized prompt>
```

## Don't
- Don't ask more than 2 questions. Friction is what gets this ritual disabled.
- Don't fire on slash commands, confirmations, or mid-flow replies.
- Don't act on a prompt the user hasn't confirmed.
- Don't optimize a prompt that is already precise — silence is the correct output.
- Don't write the record anywhere but `docs/prompts/` (gitignored; keeps the privacy firewall).
