---
name: cortex-view
description: Render this repo as one self-contained HTML page you can open in a browser — an overview of its state (index freshness, coverage, churn, findings, next steps, timeline), the import graph, the context layer as a tree, every file with who imports it, the areas, and the gaps. Use when someone wants to SEE the codebase rather than read a report, on the triggers "show me the graph", "visualise this repo", "what does the architecture look like", "open the map", "cortex view". Writes only under .cortex/.
capability: mechanical
---

# /cortex-view — see the repo instead of reading about it

The findings report is prose and the index is JSON. Neither answers *"what shape is this codebase"*
in the two seconds a picture takes. This renders the index Cortex already built into one page.

```bash
node "${CLAUDE_PLUGIN_ROOT}/index/cortex-view.mjs" .
```

**This skill exists because that command does not work when a user types it themselves.**
`${CLAUDE_PLUGIN_ROOT}` is set inside a skill and nowhere else, so a plugin user in their own
terminal has to know a version-pinned path into the plugin cache — one that changes on every
update. `/cortex-view` is the address they can actually remember.

No server, no CDN, no runtime: the data is inlined, so the page works offline and copies anywhere.

## Before the first write

**If `.cortex/` does not exist, ask before running anything** — the index comes first, and that is
the write [ADR 0005](../../docs/adr/0005-the-install-sequence-may-start-itself.md) gates. Generated
and gitignored is not the same as invisible. The `.gitignore` entry is written for you at creation
time; the asking is not.

## How to run it

1. **Check the index.** If `.cortex/index/index.json` is missing or older than the working tree,
   re-run `node "${CLAUDE_PLUGIN_ROOT}/index/cortex-index.mjs" .` first — a picture of a stale index
   is worse than no picture, because it looks current.
2. **Run the viewer.** It writes `.cortex/view/repo.html` and opens it in the default browser. Pass
   `--no-open` when the user is on a headless machine or has said not to open windows.
3. **Print the path.** The browser may not surface on every setup, and the file is the deliverable.
4. **Say what the numbers mean**, using the summary line the CLI prints — files, import edges, areas,
   orphans, files in cycles, busiest untested. Do not re-count anything yourself.

## What is on the page

| Tab | Holds |
|---|---|
| **Overview** | opens first: index freshness, profile, memory age and version; vitals (files, edges, test coverage, 30-day churn, findings by severity) and the top 3 findings; the import graph as a turning particle cloud; next-step commands to copy; a timeline of memory entries and commits |
| **Map** | every code file as a node, coloured by area, laid out by import depth so it reads top-down rather than as a hairball |
| **Structure** | the context layer as a tree — root `AGENTS.md`, the docs beside it, each code area with its scoped brief, busiest files and tests, and what Cortex generates. A dashed box is missing and names the command that writes it |
| **Files** | each file with who imports it and what it imports, both clickable |
| **Areas** | the top-level shape, and which areas already have a scoped brief |
| **Gaps** | orphans, files in import cycles, and the busiest code with no test found |
| **Next steps** | where this repo is in the Cortex sequence, each ✓ traced to a file on disk |

Any Overview fact that could not be read — no git, no memory yet, no findings pass — says **not
available** and why. Report it that way; never read a missing value as zero. Churn and the timeline
end at the indexed commit, not at today, so the page is the same on every machine.

A red outline on a node means no test was found. Click an area in the legend to hide it; `/` focuses
search; scroll zooms and drag pans. On the Overview, drag turns the cloud and a click opens the file.
The theme follows the OS; the button in the top bar overrides it and is remembered.

## What you must not claim about the picture

**A graph is persuasive in a way prose is not, so the hedges matter more here, not less.**

- **An orphan is a question.** Import resolution is regex-based ([ADR 0004](../../docs/adr/0004-no-runtime-dependencies.md)
  rules out a parser), so a dynamically loaded or framework-discovered file looks exactly like a dead
  one. Never present the Gaps tab as a delete list.
- **"No test found" is a floor.** Coverage uses three signals — a test named for the file, importing
  it, or naming it in a quoted string — so a file exercised only through a subprocess reads as
  untested. Wrong in the safe direction, and say so.
- **Markdown and config are not drawn.** They have no imports; on one repo 171 isolated nodes buried
  the 98 connected ones. They are still in the Files tab, and the legend says how many.
- **Depth is a floor too.** An unresolved import makes a file look shallower than it is, so the layer
  count is the smallest honest answer rather than a verdict on the architecture.

## Related

- `/cortex-install` builds the index this renders; run it first on a repo Cortex has never seen.
- `/cortex-enrich` adds a summary to every file card — what the file *does*, not just how it is
  wired. Optional and costs tokens.
- `/cortex-next` answers the same "where am I" question in text, and is what the Next steps tab shows.
