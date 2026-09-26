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
| `/install` | prose + facts | `README.md` install section; `.claude-plugin/plugin.json`; `node` from `site-facts.json` |
| `/sequence` | prose | `README.md` "The order" table; `skills/cortex-next/SKILL.md` |
| `/what-lands` | prose | `README.md` tree; `docs/adr/0002-committed-repo-memory.md` |
| `/index-and-findings` | prose | `CONTEXT.md` (Index, Findings, Enrichment); `index/AGENTS.md` |
| `/cortex-view` | prose | `README.md` "See the repo, don't read about it"; `skills/cortex-view/SKILL.md` |
| `/context-layer` | prose | `CONTEXT.md` (Brief, Routing table); `skills/cortex-scaffold`, `skills/cortex-brief`, `skills/cortex-skills`, `skills/domain-modeling`, `skills/optimize-context` |
| `/team-memory` | prose | `CONTEXT.md` (Memory, The gate); `skills/dream`, `skills/handoff`, `skills/catch-me-up`, `skills/resume`, `skills/team-init`, `skills/team-add` |
| `/rituals` | facts | `site-facts.json` only |
| `/mcp` | prose + facts | `mcp/AGENTS.md`; the tool table from `site-facts.json` |
| `/cli` | prose | `README.md` CLI block and "Tools" table; `tools/README.md` |
| `/principles` | prose | ADRs 0004, 0005, 0006, 0007, 0010, 0016, 0017; the "code layers" section of `AGENTS.md` |
| `/vault` | prose | `README.md` personal-vault section |
| `/privacy` | prose | `README.md` privacy and firewall sections; ADR 0015 |
| `/contributing` | prose | `docs/changing-cortex.md`; `tools/test/run.sh` |
| `/migrate` | prose | `skills/migrate-engine/SKILL.md` |

A route not in this table is one the ritual cannot keep true. Add its row when the site gains a page,
in the same PR.
