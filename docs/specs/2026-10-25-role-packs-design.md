# Cortex by role: what each person installs, and one shared picture — design

**Date:** 2026-10-25 · **Status:** agreed, queued after the code graph (G1–G4) and the 3.0.0 rename

## The idea

People on a team need different parts of Cortex:

- A developer works in a repository with Claude Code and needs the whole loop.
- An architect needs the domain language, decisions and the structure of the code.
- A project manager often never opens the repository. They work in Claude Desktop, claude.ai or
  another assistant. They need what changed, what is blocked, the questions waiting on them, and
  how epics and stories map onto the code.

Each person installs **only their part**. Everyone reads and writes **one shared team repository**,
the team-brain, so the knowledge is centralised even though each install is personal. The code
graph links that knowledge to the code: epic → stories → commits and PRs → files → clusters → API
contracts.

## What each role gets

| Role | Works in | Skills | Also |
|---|---|---|---|
| Developer | Claude Code, in the repo | setup-repo, review-change, change-impact, debug-issue, resume-work, merge-work, repo-map, handover-notes, end-of-day-summary | The full plugin, as today |
| Architect | Claude Code or Desktop | define-terms, design-spec, architecture-review, write-area-brief, write-context-docs, challenge-plan, repo-map | The `graph` tool: clusters, hubs, bridges |
| Team lead | Claude Code | create-team, join-team, whats-changed, review-change, suggest-skills, trim-agent-docs, set-profile | The agent team and PR-review CI |
| Project manager | Claude Desktop, claude.ai, other assistants | whats-changed, challenge-plan, a new story-map skill | MCP tools `ask`, `inbox`, `answer`, `contract`, `graph` (stories); tracker sync |
| QA / tester | Claude Code | change-impact, review-change, debug-issue | Untested clusters and the gaps report |

Names follow the 3.0.0 rename.

## How each person installs their part

1. **In Claude Code: the one plugin, as today.** [ADR 0020](../adr/0020-the-vault-rituals-stay-in-the-one-plugin.md)
   holds: a plugin cannot reach files outside its own folder, so per-role plugins would duplicate
   `core/`, `mcp/` and the templates. A person's role changes what setup installs and what
   `next-step` suggests, not which plugin they install.
2. **Everywhere else: a role pack.** `node tools/cortex-pack.mjs <role>` builds, from `skills/` (the
   one source):
   - that role's skills, in the portable Agent Skills format, as folders and zips ready to upload
     to claude.ai or Claude Desktop;
   - the MCP configuration that connects the person's assistant to the team-brain, through
     `cortex-setup.mjs`, which already writes it for Copilot, Gemini CLI and Codex.

   A pack is generated, never committed, and attached to each release by the release workflow.
   A skill that belongs in a pack must not depend on running repo scripts. It reaches the
   team-brain through MCP tools. A test fails on a pack skill that names a `node tools/` or
   `node index/` command.
3. **The role is recorded once, in the team roster.** The roster (`team.json` `members`, #620)
   gains `job`: `developer` · `architect` · `lead` · `pm` · `qa`. It is not a fourth runtime switch
   beside mode, audience and profile. It decides what is offered and installed, never what is
   allowed.

## The shared picture: stories in the team-brain

- **Stories and epics come from the tracker the team already uses.** The tracker sync (#624) also
  mirrors epics and stories into `stories/<key>.md` in the team-brain: key, title, status,
  assignee, parent epic and links. It does not copy descriptions, which can hold anything; a
  person follows the link for those. Every write passes the publish gate. On `work`, the tracker
  host must be an approved destination.
- **Each repository publishes its story links,** the way it publishes its contract. Ticket keys
  found in commit messages and branch names (`ABC-123`, `#45`) link a story to commits, then to
  the files those commits changed, then to those files' clusters. Each link carries `confidence`:
  - a key in a commit message is `extracted`;
  - a key only in a branch name is `inferred`.
- **The `graph` tool answers across them,** with new ops:
  - `story <key>`: the code an epic or story touches, its clusters, its contracts, and its
    untested parts;
  - `stories-for <path|cluster>`: which stories changed this code;
  - `risk`: open stories that touch untested or hub code.
- **A story-map skill for project managers** reads those answers and writes a plain status:
  what each epic touches, what is blocked on an open ask, and where the risk is. It never
  estimates.

## Rules

- **Privacy first.**
  - Story titles are published text and pass the gate: credentials, the employer denylist on
    `home`, and personal data.
  - On `home`, a ticket key that matches the denylist is refused.
  - A role pack carries no secrets. Credentials stay in each person's environment.
- **One source.** Packs are generated from `skills/`. No second copy of a skill is committed.
- **Floors.** A story's code is "at least these files": commits without a key are invisible to it.

## Build order

The prerequisites are the code graph (G1–G4) and the 3.0.0 rename. Each step is one PR.

- **R1:** `job` in the roster. `setup-repo`, `next-step` and `join-team` offer by job.
- **R2:** `tools/cortex-pack.mjs` and the portable-skill test. The release workflow attaches the
  packs.
- **R3:** stories mirrored by the tracker sync, and per-repo story links published.
- **R4:** the `graph` story ops and the story-map skill.
- **R5:** the website gets a page per role, with each role's install steps.
