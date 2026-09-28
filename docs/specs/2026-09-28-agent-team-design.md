# Design: an agent team in every repo Cortex serves

- **Date:** 2026-09-28
- **Status:** Draft for review
- **Decided by:** the maintainer, in a brainstorm (`/analyze-spec`, two rounds of questions)
- **Area:** `index/` (detection, sizing), `templates/team/` (new), `skills/cortex/` (the offer)
- **Depends on:** [the stamp record](2026-09-28-stamp-record-design.md), which ships first

## Destination

After `/cortex` runs on a repo, solo or team, that repo has:

- a small **team of single-job agents** in `.claude/agents/`. Each one is tied to *that* repo's own
  briefs, ADRs, index and commands, and carries only the tools its job needs;
- a short **"How this team works"** block in `CLAUDE.md`. It loads in every session, so the team
  is available the moment the developer types `claude`;
- a main session that **sizes each task and asks** whether it runs as a single agent or as the
  team. On a team task, the plan goes through a **bounded, evidence-only debate** before any code
  is written, and the human settles what the agents do not agree on;
- agents the repo already had, **graded, matched to a role and improved with consent**. They are
  never duplicated or silently overwritten.

The same files work as ordinary subagents today and as teammates under Claude Code's experimental
agent-teams mode. Cortex never turns that mode on.

Scope is judged against this. Cortex is built by developers for developers. The team exists to
help a human decide, not to take the decision away from them.

## Context

- `/cortex` already stamps one agent: the read-only `verifier`
  (`templates/loop/verifier.md` → `.claude/agents/verifier.md`, loop row `verifier`).
- `index/lib/claude-setup.mjs` already grades a repo's subagents against the vendored Claude Code
  rules. It covers unreadable frontmatter, a missing `name` or `description`, unknown keys, a `:`
  in a name, keys ignored on plugin agents, and "described as read-only but can edit".
- `/cortex-brief` already writes scoped `AGENTS.md` leaves for large repos and wires them into the
  root routing table. The team reads those; it does not replace them.
- **What the docs allow** (checked 2026-09-28):
  - Project-scope agents in `.claude/agents/` are ordinary subagents, and can also be referenced
    as agent-team teammates. Plugin-shipped agents are **not** documented as teammates, so the
    team must be written into the repo, not shipped in the plugin.
  - Subagents can spawn subagents up to three layers deep.
  - Agent teams are "experimental and disabled by default" behind
    `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, and "use significantly more tokens than a single
    session".
  - Running a session *as* an agent (`claude --agent`, or the `agent` setting) replaces the
    default Claude Code system prompt entirely.
- **What Cortex has learned:** the note on `cortex-role-reviewer` records that an ungrounded expert
  persona "returns advice that is true everywhere and actionable nowhere". The docs say nothing
  either way about role-based agents versus task-based ones. This design therefore requires every
  role to be grounded in the repo, and every objection to carry a citation.

## Decisions locked

| # | Decision | Rejected alternative, and why |
|---|---|---|
| T1 | **The orchestrator is the main session**, run by a short playbook in `CLAUDE.md` that every session loads | `agent: orchestrator` in settings: it replaces Claude Code's own system prompt. An orchestrator subagent: the human only sees its summary and cannot answer mid-run |
| T2 | **The human is always in the loop.** For each new task the session recommends *single* or *team* from repo evidence, and the developer chooses | Deciding on the developer's behalf; Cortex is not a vibe-coding system |
| T3 | **One job per agent.** Each agent has one responsibility, a description that says when to call it, and the least tools that do the job | General-purpose agents that do everything and debate nothing |
| T4 | **Core roster:** Architect, Implementer, Tester, Reviewer. The **Project manager** is offered only when the repo has something to manage: issues, a spec or plan folder, or `intent/`. Every role is offered, and the developer picks each one | All five everywhere, sized the same for a script and a monorepo |
| T5 | **Debate is bounded and evidence-only.** The Architect proposes; the Tester and Reviewer object. Every objection cites a `path:line`, an ADR or a test, and an objection without one is dropped. At most two rounds. Remaining disagreements go to the human side by side. Debate runs on team-sized tasks only | Arguing to consensus: expensive and can loop. Debate only in teams mode: plain-subagent users would get none |
| T6 | **Existing agents are graded, mapped and improved.** They are graded with `claude-setup.mjs`, mapped to a role, and given concrete proposed edits (grounding, trimmed tools, a sharper description), each confirmed per agent. A covered role is never duplicated | Only filling gaps: leaves weak agents weak. Replacing them: loses the repo's own tuning |
| T7 | **Compatible with teams mode, off by default.** Agents are written so they work as teammates, and the playbook says how to start a team. Cortex never sets the experimental flag | Setting the flag: turns a large token cost on for everyone |
| T8 | **The team is written into the repo** (`.claude/agents/`, project scope), not shipped as plugin agents | Plugin agents: not documented as teammates; `hooks` and `permissionMode` are ignored on them |
| T9 | **The verifier becomes the Reviewer.** A repo that already has `verifier.md` is offered the upgrade, and the file keeps working until the developer accepts | Two agents doing the same check |

## Architecture

### The roster

Each agent body is rendered from the repo's own state, the same way `verifier.md` gets `{{RUN}}`.
Nothing is invented: a value `loop.mjs` did not detect becomes a question for the developer.

| Role | One job | Tools | Grounded in |
|---|---|---|---|
| **Architect** | Turn a request into a plan: files touched, blast radius, which ADR or invariant applies, which scoped brief governs each area | `Read`, `Grep`, `Glob`, `Bash` (read-only index CLIs). No edit tools | root and scoped `AGENTS.md`, `docs/adr/`, `CONTEXT.md`, `cortex-impact`, `cortex-routes` |
| **Implementer** | Make the agreed change, inside the files the plan names | `Read`, `Edit`, `Write`, `Bash` | the verification block, conventions, protected paths |
| **Tester** | Write the failing test from the plan first, then confirm it passes after the change | `Read`, `Grep`, `Glob`, `Bash`, `Edit`, `Write`. Edits are **fenced to test paths** by a `PreToolUse` hook in its own frontmatter | detected test command, `canBeTest` paths, coverage gaps from the index |
| **Reviewer** | Check the change independently before anyone says "done": run it, exercise what sits next to it, judge the diff against `REVIEW.md` and the docs | `Read`, `Grep`, `Glob`, `Bash`. No edit tools | `REVIEW.md`, `cortex-review`, the run command |
| **Project manager** *(offered by evidence)* | Turn a request into acceptance criteria and keep the task list | `Read`, `Grep`, `Glob`, `Bash` (`gh` read-only); writes only `intent/` and plan files | issues, `docs/specs/`, `docs/plans/`, `intent/` |

Every agent body carries the same short rule: every claim about the repo cites `path:line`, an ADR
or a command's output.

### How a task flows

```
developer types a request
        │
main session (playbook in CLAUDE.md)
        ├─ sizes it from the index ──► recommends single | team ──► developer chooses
        │
single ─┴─► works as today, then the Reviewer checks before "done"

team ──► Architect: plan (files, blast radius, invariants)
          ├─► Tester + Reviewer: objections, each with a citation   ┐ at most
          ├─► Architect: accept, or rebut with a citation           ┘ 2 rounds
          ├─► developer: sees the open disagreements side by side, decides
          ├─► Tester: failing test          (red)
          ├─► Implementer: the change       (green)
          └─► Reviewer: independent check ──► developer
```

**Sizing** is deterministic and uses signals the index already has: how many areas the files
touch, whether any has a scoped brief (a critical area), dependents and untested dependents from
`cortex-impact`. It recommends; it never decides.

### Where the words live

- `CLAUDE.md` gains a block of about 10 lines: the roster, the single-or-team question and the
  debate limit. It stays short because `CLAUDE.md` loads in every session and the checker already
  flags one that grows too long.
- The full protocol lives in a stamped `team` skill (`.claude/skills/team/SKILL.md`), which loads
  only when a team task starts.
- The agents live in `.claude/agents/<role>.md`.

### Existing agents

1. List `.claude/agents/*.md`. The checker's reader already finds them.
2. Grade each with the existing `claude-setup` checks.
3. Map each to a role from its description and tools. The mapping is a proposal; the developer
   confirms it.
4. For a mapped agent, propose specific edits: grounding lines, trimmed tools, a sharper
   description. Show the diff and ask per agent, as `/cortex-skills` does for a drifted skill.
5. Offer only the roles that nothing covers.

### Invariants this must not break

- **Consent before the first write** ([ADR 0016](../adr/0016-a-guarantee-belongs-to-the-act-not-to-the-skill.md)),
  and `/cortex` still asks once.
- **Never clobber.** An existing agent is edited only with consent, and only through a shown diff.
- **Everything `/cortex` stamps passes the checker, as a test** (roadmap Q9). The role templates
  are rendered in a fixture and graded.
- **No runtime dependencies** ([ADR 0004](../adr/0004-no-runtime-dependencies.md)).
- **Data-free.** The templates and their examples stay generic.

## Risks & edges

- **Token cost.** A team task costs several agents. Mitigations: single agent is the default
  recommendation for small tasks, debate is capped at two rounds, and teams mode stays off.
- **Persona fluff.** A role label with no grounding produces generic advice. Every body is rendered
  from repo state, and uncited objections are dropped.
- **Stale grounding.** The paths and commands in an agent go stale as the repo moves. The stamp
  record, which ships first, notices them, and an agent-drift check reuses `skill-drift.mjs`.
- **The Tester fence.** A hook in agent frontmatter is honoured only for project-scope agents,
  which is where the team lives (T8). It must fail closed, as `protected-paths.sh` does.
- **A developer who never wants a team.** Single agent works exactly as it does today, and the
  playbook is a few lines they can delete.
- **Rollback.** Every artifact is a file in the repo. Deleting `.claude/agents/<role>.md`, the
  `team` skill and the `CLAUDE.md` block removes the feature.

## Not yet specified

- **Sizing thresholds.** How many areas, dependents or untested dependents make a task "team".
  This needs real repos and should be measured with the eval harness (#407) rather than guessed.
  Provisional starting values, calibrated on four repos' commit history but not measured against
  outcomes, live in `SIZING_THRESHOLDS` in `index/lib/sizing.mjs`.
- **Where the plan and the debate record live.** Candidates: `intent/`, a gitignored
  `.cortex/work/<task>/`, or the PR body. It depends on whether a team wants the record committed.
- **Whether the Implementer is fenced too**, for example kept out of test files during a
  red-green cycle. #457 removed a promised test-file lock no template provided, so this must not
  come back as a promise without a hook behind it.
- **Per-role memory.** The subagent `memory` field exists, but where each role's memory lives is
  not documented precisely enough to design against.
- **The orchestrator agent file.** Whether also to stamp one for developers who do want
  `claude --agent orchestrator`, knowing it replaces the default system prompt.

## Out of scope

- Turning on `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` for anyone.
- Agents that merge, push, or close issues without the developer's go-ahead.
- Replacing Claude Code's system prompt (`agent:` in settings).
- Shipping the team as plugin agents.
- Writing to an issue tracker other than reading it through `gh`.
