# 0025. The collection is sized by use: five rituals folded, six typed only

**Date:** 2026-10-12
**Status:** accepted. Amends [ADR 0020](0020-the-vault-rituals-stay-in-the-one-plugin.md).

## Context

Cortex shipped 45 rituals, 39 of them model-invocable. `/skill-audit` was run on the collection on
2026-10-12, and two measurements came back.

**The listing budget.** Claude Code gives every plugin's skill descriptions together 1% of the
model's context window (`skill.listing.budget-fraction` in `core/claude-code.js`), and drops
descriptions past it. On a 200k-token model that is about 2,000 tokens. Cortex's 39 descriptions
were 8,142 characters, about 2,000 tokens, before any other plugin was counted. A dropped
description is a ritual no request can reach.

**Use.** `tools/cortex-skill-usage.mjs` found 27 of the 45 never reached. The record is one
machine, and many of its sessions are harness and eval runs that load no skill, so a zero is weak
evidence for any single ritual. It is stronger for the ones that were present since June or July
and have the same job as a ritual that was reached.

Reading the descriptions side by side found five rituals whose job another ritual already did:

| Ritual | Same job as |
|---|---|
| `/audit`, `/reindex` | `/cortex-audit`. `AGENTS.md` carried a paragraph to tell the three apart, which is the test [ADR 0011](0011-four-rituals-covered-two-jobs.md) set |
| `/install-project` | `/cortex`, which arrived later and writes the same root brief and shims from the index |
| `/skill-creator` | `/writing-for-agents`, and it shared a name with Anthropic's `skill-creator` plugin, which the Core bundle installs |
| `/setup-plugins` | one command and an offer; `/cortex` and `/cortex-install` already ran its status check themselves |

## Decision

**Five rituals are folded into the ritual that had the job.** Nothing they knew is deleted:

| Was | Is now |
|---|---|
| `/audit` | `/cortex-audit score`, in `skills/cortex-audit/SCORE.md` |
| `/reindex` | `/cortex-audit graph`, in `skills/cortex-audit/GRAPH.md` |
| `/skill-creator` | `skills/writing-for-agents/NEW-SKILL.md` |
| `/setup-plugins` | the first half of `/connect-brain` |
| `/install-project` | `/cortex`. Its two dev-cycle skills are offered by `/cortex-skills` from `DEV-CYCLE.md` |

**Six rituals carry `disable-model-invocation: true`:** `/capture`, `/daily`, `/weekly-review`,
`/level-up`, `/scan-projects` and `/wizard`. They run when a person types the name. Their
descriptions lose their trigger lists, as the frontmatter check requires of a typed ritual.

The collection is 40 rituals, 28 of them model-invocable, with 6,302 description characters.
`core/test/plugin.test.js` lowers the total it allows from 8,500 to 6,800 so the room is not
spent again without a decision.

**The prompt gate routes a bug to `/diagnosing-bugs`.** It named only
`superpowers:systematic-debugging`, so Cortex's own ritual was never the route.

## What this overturns in ADR 0020

ADR 0020 kept the vault rituals model-invocable because a vault user would lose natural-language
triggering: "capture this" would stop reaching `/capture`. That cost is real and is now accepted
for five of them. What changed is the evidence: none of the five was reached from a request in the
record, and the listing was at the budget. ADR 0020's other decision stands. There is still one
plugin, and `/cortex-audit`, `/catch-me-up`, `/onboard` and `/connect-brain` are as they were.

## Proposed and not done

| Proposal | Why not |
|---|---|
| Fold `/catch-me-up` into `/resume` | `/resume` is measured: `evals/data/resume/` holds 44 task references to `/catch-me-up` as a route, and the scorer checks the route by name. The fold would rewrite the tasks and the baseline of the most-used ritual to remove one description. |
| Make `/cortex-install` typed only | `docs/changing-cortex.md` forbids it by name. The flag marks once-only or destructive, and install is read-only by construction ([ADR 0005](0005-the-install-sequence-may-start-itself.md)). |
| Make `/cortex-next` typed only | `/resume` routes to it, and a typed ritual cannot be routed to. |
| Delete any ritual outright | A never-reached ritual is more often a routing failure than a bad ritual. Every body that was folded still exists as a file. |

## Consequences

- A ritual that hands off to one of the six typed rituals tells the user to type it. `/onboard`,
  `/weekly-review` and `/optimize-prompt` do. A handoff that reads as a command to run is a bug.
- `/cortex` and `/cortex-install` run `ai-os setup-plugins --tier <tier>` themselves, because
  `/connect-brain` is typed and cannot be handed to.
- Someone who types `/audit`, `/reindex`, `/setup-plugins`, `/install-project` or `/skill-creator`
  gets no such command. The surviving ritual's body names the old one so a search finds it.
- `/skill-creator` now means Anthropic's plugin alone.
- The fold is a breaking change to five command names, released as 2.42.0.
