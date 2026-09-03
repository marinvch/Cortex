# Cortex agent team

Six role definitions for working on this repo as an agent team. Reference for the mechanics:
[`docs/agent-teams.md`](../../docs/agent-teams.md).

## The roster

| Agent | Model | Writes to | Role |
|:---|:---|:---|:---|
| `architect` | opus | anywhere | Holds the design, spawns and directs everyone else |
| `implementer` | inherit | `src/` `bin/` `scripts/` `templates/` | Builds features and fixes bugs |
| `qa` | sonnet | `test/` | Proves it works; owns the test suite |
| `auditor` | inherit | **nothing** | Finds optimization, complexity, constraint violations |
| `refactorer` | inherit | `src/` (see below) | Behaviour-preserving restructuring |
| `product-manager` | sonnet | proposals only | Proposes what to build next |

## Launching

The architect must be the **main session**, not a teammate — teammates cannot spawn teammates, and the
lead cannot be reassigned once a session starts. So:

```bash
claude --agent architect
```

Then ask it to form the team. Everything else spawns as teammates from there:

```text
Spawn implementer, qa, and auditor as teammates. Give implementer src/map.mjs only,
qa the map suite, and auditor a read-only pass over the scan hot path.
```

To make it the default for this repo instead of typing the flag, add to `.claude/settings.local.json`:

```json
{ "agent": "architect" }
```

You can also use any of these as an ordinary subagent without a team — the definitions work both ways.

## Rules the team runs on

**Ownership is exclusive.** Each writer owns disjoint paths. This is the one thing that prevents
teammates overwriting each other, since they cannot see each other's edits.

**`implementer` and `refactorer` both write `src/` — never run them concurrently on the same modules.**
Sequence them, partition by module explicitly in the spawn prompt, or spawn the refactorer with
`isolation: worktree`. This is the single most likely way to lose work here.

**`qa`, `auditor`, and `product-manager` write no production code** and can run alongside anything.

**Evidence over claims.** `qa` running `npm test` and `npm run check:egress` is the only thing that
counts as verification. A teammate reporting success is a claim.

## Standard flows

| Goal | Sequence |
|:---|:---|
| New feature | `product-manager` proposes → `architect` designs → `implementer` builds → `qa` verifies |
| Optimization | `auditor` finds with evidence → `refactorer` proposes options → `architect` picks → `refactorer` executes → `qa` proves behaviour unchanged |
| Hard review | `auditor` and `qa` on the same change with opposing briefs, told to disprove each other |

Start with 3-5 teammates. Three focused ones beat five scattered ones, and every teammate is a full
Claude instance with its own token cost.

## Why each body repeats the project constraints

This repo has **no root `AGENTS.md` or `CLAUDE.md`**, so teammates load no project context
automatically — and they inherit none of the lead's conversation history either. The zero-dependency,
no-network, Node 18, `resolveInRepo`, and LF rules are therefore restated in each definition, because
an agent that does not know them will violate them.

Installing Cortex into its own repo would fix this and let the bodies shrink to their role-specific
parts. Worth doing.

## Editing these

`skills:` in a definition is **ignored** for teammates — put anything a role must always know in the
body instead. In-process teammates (the only mode available on Windows) get the body *appended* to the
default system prompt, and definition-level `mcpServers` are ignored in favour of project config.
Details in [`docs/agent-teams.md`](../../docs/agent-teams.md) §6.
