# Renamed rituals

Cortex 3.0.0 gave every ritual a plain name: the job it does, in words an engineer, a project
manager or a team lead can read without a glossary. The old commands no longer exist. Each
ritual's description still carries the common phrasings, so asking in the old words reaches the
right one.

Script names did not change. `index/cortex-*.mjs` and `tools/cortex-*` are the command-line tools,
not rituals, and keep their names.

## Old name to new name

| Old name | New name | What it does |
|---|---|---|
| `/cortex` | `/setup-repo` | Set a repo up in one pass: index, findings, the context layer and the development loop, after one confirmation |
| `/cortex-install` | `/setup-repo` | Merged: the report-only path of `/setup-repo` |
| `/cortex-next` | `/resume-work` | Merged: `/resume-work` also says where the repo is in the setup, and the one command to run next |
| `/cortex-review` | `/review-change` | Check a change against the repo's own docs, and find the docs it made wrong |
| `/cortex-impact` | `/change-impact` | Which files depend on the ones you are changing, and which of them no test covers |
| `/cortex-view` | `/repo-map` | Render the repo as one offline HTML page: overview, import graph, files, areas, gaps |
| `/cortex-scaffold` | `/write-context-docs` | Write the root `AGENTS.md`, its shims, `CONTEXT.md` and `docs/adr/` |
| `/cortex-brief` | `/write-area-brief` | Write a scoped `AGENTS.md` for one critical directory |
| `/cortex-skills` | `/suggest-skills` | Propose and write skills that fit the repo's detected stack |
| `/cortex-enrich` | `/summarize-files` | Add summaries, roles and tags to the index. Costs tokens |
| `/cortex-profile` | `/set-profile` | Show or set whether this machine serves home, work or lab |
| `/cortex-audit` | `/audit-notes` | Check a personal vault for dead links, orphans, misplaced files and privacy leaks |
| `/analyze-spec` | `/design-spec` | Brainstorm, then a design spec and a plan for a risky change. No code |
| `/grilling` | `/challenge-plan` | Question a plan in rounds until no decision is left open |
| `/diagnosing-bugs` | `/debug-issue` | Find the cause of a hard bug with a loop that can fail on demand |
| `/domain-modeling` | `/define-terms` | Settle the repo's terms in `CONTEXT.md`, and record decisions as ADRs |
| `/improve-codebase-architecture` | `/architecture-review` | Find places where the code's structure could be deeper, report them, work one |
| `/resolving-merge-conflicts` | `/resolve-conflicts` | Resolve a stuck merge or rebase hunk by hunk, by what each side meant |
| `/handoff` | `/handover-notes` | Write in-flight state to the OS temp dir for the next agent |
| `/dream` | `/end-of-day-summary` | Write the day's changes and lessons into the repo's committed `.cortex/memory/` |
| `/catch-me-up` | `/whats-changed` | What changed on a project while you were away, from notes and git history |
| `/resume` | `/resume-work` | Pick up work in flight: committed, uncommitted, diverged, then what is left |
| `/ship` | `/merge-work` | Get finished work onto main, one pull request at a time, in an order that strands nothing |
| `/level-up` | `/retrospective` | A biweekly look back that ends in one thing built |
| `/daily` | `/daily-plan` | Open today's note with priorities and what is due |
| `/weekly-review` | `/weekly-review` | Unchanged: empty the inbox, update projects, restamp the current focus |
| `/capture` | `/quick-note` | Drop one line into the inbox or today's note |
| `/onboard` | `/personal-setup` | Set up a personal vault: who you are, your projects, your tools |
| `/optimize-context` | `/trim-agent-docs` | Measure and slim agent context files, in a repo or under `~/.claude` |
| `/skill-audit` | `/trim-agent-docs` | Merged: the skill-collection mode of `/trim-agent-docs` |
| `/optimize-prompt` | `/clarify-request` | Sharpen a vague request before work starts |
| `/writing-for-agents` | `/write-agent-docs` | How to write a document an agent reads, and how to add a new skill |
| `/team-init` | `/create-team` | Create and seed a team's shared brain repository |
| `/team-add` | `/join-team` | Connect a product repo to the team's shared brain |
| `/connect-brain` | `/connect-mcp` | Install the plugin bundle and register the Cortex MCP server on this machine |
| `/scan-projects` | `/register-projects` | Register personal repos in the vault, metadata only |
| `/migrate-engine` | `/migrate-legacy-engine` | Move a repo off the retired `.ai-os/` engine, keeping its memory |
| `/plugin-sync` | `/update-plugin` | Make the Cortex this session runs match the one you edited |
| `/site-sync` | `/sync-website` | Bring Cortex's public site in line after a release |

## The three merges

- **`/cortex-install` is the report-only path of `/setup-repo`.** Ask for a report only ("just index
  this", "show me the findings") and `/setup-repo` indexes, writes the findings report, and walks
  the offers. It writes nothing else. A yes to any offer turns the run into a setup of just those
  rows.
- **`/cortex-next` is part of `/resume-work`.** When the question is about the setup ("I installed
  Cortex, now what", "what do I run next"), `/resume-work` runs `index/cortex-next.mjs` and names
  the one command to run. The script is unchanged.
- **`/skill-audit` is a mode of `/trim-agent-docs`.** Ask it to review your skills and it measures
  which are never reached, which overlap, and which a plain prompt would do better. It still reports
  only.

## Where the old names still appear

`CHANGELOG.md` entries for releases before 3.0.0, the ADRs in `docs/adr/` and the dated records in
`docs/specs/` and `docs/plans/` keep the names they were written with. They are records of what
was true then.
