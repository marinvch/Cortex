# Site pages and the Cortex source each one is written from

The one copy of this mapping (#415, #416). `/site-sync` reads it to decide which pages a change
touches; the site's own README points here rather than keeping a second table. Paths on the left are
routes in the site repo; paths on the right are in this repository.

**Rendered, not written.** Rows marked *facts* render from the committed `site-facts.json`. They
cannot drift in prose — refreshing that file is the whole update. Every other row is prose a person
reads, and is drafted from its sources.

| Route | Kind | Written from |
|---|---|---|
| `/` | prose + facts | `README.md` intro and "Install as a Claude plugin"; version, install block and counts from `site-facts.json` |
| `/install` | prose + facts | `README.md` install section and "Keep it current" (turning on auto-update, which is off by default for a third-party marketplace; the two update commands; `/reload-plugins`; what an older plugin on a team is told; the shared-plugin settings a team's repo is offered, and that each teammate still installs once); `skills/cortex/SKILL.md` (consent gate) and `RUNS.md` (running unattended); `.claude-plugin/plugin.json`; `node` from `site-facts.json` |
| `/sequence` | prose | `README.md` "The order" table and the per-change table under it (`/cortex-impact --size`); `skills/cortex-next/SKILL.md`; `skills/cortex/SKILL.md` (the second round: `/cortex evals`, `/cortex bands`) |
| `/what-lands` | prose | `README.md` tree and "The agent team" (the roles, their tools, the single-or-team question, the debate, existing agents, the fence's limits, removal); `skills/cortex/SKILL.md` (the loop artifacts table); `skills/cortex/TEAM.md`; `templates/team/README.md`; `skills/cortex-review/SKILL.md` (the PR review workflow); `docs/adr/0002-committed-repo-memory.md`; `docs/adr/0019-the-agent-team-is-written-into-the-repo-and-run-by-the-main-session.md` |
| `/index-and-findings` | prose | `CONTEXT.md` (Index, Findings, Enrichment); `index/AGENTS.md` |
| `/cortex-view` | prose | `README.md` "See the repo, don't read about it"; `skills/cortex-view/SKILL.md`; the header comments of `index/lib/view.mjs`, `index/lib/view-html.mjs` and `index/cortex-view.mjs` |
| `/context-layer` | prose | `CONTEXT.md` (Brief, Routing table); `skills/cortex-scaffold`, `skills/cortex-brief`, `skills/cortex-skills`, `skills/domain-modeling`, `skills/optimize-context` |
| `/team-memory` | prose | `CONTEXT.md` (Memory, The gate); `skills/dream`, `skills/handoff`, `skills/catch-me-up`, `skills/resume`, `skills/team-init`, `skills/team-add` |
| `/rituals` | facts | `site-facts.json` only |
| `/mcp` | prose + facts | `mcp/AGENTS.md`; the tool table from `site-facts.json` |
| `/cli` | prose | `README.md` CLI block, and the "Tools" table **copied row for row**, with the rule above it about what is listed. The site keeps no list of its own. `tools/test/tools-table.test.sh` pins the README table to `tools/`. Usage detail comes from `tools/README.md` |
| `/principles` | prose | ADRs 0004, 0005, 0006, 0007, 0010, 0016, 0017, 0018, 0019; the "code layers" section of `AGENTS.md` |
| `/vault` | prose | `README.md` personal-vault section |
| `/privacy` | prose | `README.md` privacy and firewall sections; ADR 0015. The page carries **every** bullet of "What Cortex runs, sends and fetches": the `index/` scripts and the three that write outside `.cortex/`; who fetches an update (Claude Code, never Cortex); the MCP server's `git` use against a team brain; the rituals' network steps; the stamped CI workflows and marketplace entry; and "No telemetry" |
| `/contributing` | prose | `docs/changing-cortex.md`; `tools/test/run.sh` |
| `/migrate` | prose | `skills/migrate-engine/SKILL.md` |

**Never on the site.** `docs/specs/` and `docs/plans/` are design records. They say what was decided
and in what order, for whoever builds it, and no route is written from them. Once a spec ships, the
page is drafted from the README, skill or ADR that the shipped work changed, not from the spec.

A route not in this table is one the ritual cannot keep true. Add its row when the site gains a page,
in the same PR.
