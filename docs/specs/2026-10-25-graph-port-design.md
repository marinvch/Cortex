# Porting Graphify's graph into Cortex — design

**Date:** 2026-10-25 · **Status:** agreed, being built · **Decision record:**
[ADR 0029](../adr/0029-code-parsers-are-an-add-on-the-user-installs.md)

## Why

[Graphify](https://github.com/Graphify-Labs/graphify) (Apache-2.0, read at commit `92741d1`) turns a
codebase into a queryable knowledge graph. Cortex already has the file-level half: the import
graph, `/cortex-view`'s map, `/cortex-impact` and import cycles (`depth.cyclic`). Graphify also
answers questions Cortex cannot:

- Which files form one feature? Cortex's "areas" are top-level folders (`lib/layers.mjs`), and a
  folder is not a feature.
- Which files and links matter most, and which links are unexpected?
- Which function calls which?
- How sure is each link?

This spec ports those answers. It ports methods, not code: Graphify is Python on NetworkX, and
Cortex is dependency-free Node. Each ported module names the Graphify module it follows, and
`THIRD_PARTY_NOTICES.md` carries Graphify's notice.

## What is ported, from where

| Cortex | Graphify source | What carries over |
|---|---|---|
| `index/lib/clusters.mjs` | `graphify/cluster.py` | Leiden on the graph; split a community over 25% of nodes (min 10) with a second pass; re-split below 0.05 cohesion (min 50); cohesion = intra edges ÷ possible; label by hub, the highest-degree member, ties by id; largest first |
| `index/lib/graph-report.mjs` | `graphify/analyze.py` | `god_nodes` → **hubs**; `_surprise_score` → **bridges** (confidence weight, crosses areas +2, crosses clusters +1, peripheral → hub +1); `find_import_cycles` reads Cortex's own `depth.cyclic` |
| `mcp/lib/graph.js` | `graphify/serve.py` | the tool set: stats, node, neighbours, cluster, hubs, shortest path, then callers and definitions |
| `confidence` on edges | `ARCHITECTURE.md` "Confidence labels" | `extracted` · `inferred` · `ambiguous`, and `ambiguous` edges weigh 0.5 in clustering (`ambiguous_scale`) |
| `index/lib/parsers.mjs`, `index/lib/symbols.mjs` | `graphify/extract.py`, `extractors/` | tree-sitter definitions and calls, per language |
| `.cortex/index/symbols/` cache | `graphify/cache.py` | re-parse only files whose content hash changed |

**Not ported.** LLM extraction (`llm.py`), documents, PDFs, images and video (`detect.py`
categories), Obsidian, wiki and canvas exports, `watch.py`, the PR tools in `serve.py` (Cortex has
`/cortex-review` and `/cortex-impact`), and Graphify's skill installer. Reading
`graphify-out/graph.json` stays possible later. It is not part of this plan.

## Rules this must keep

- **Deterministic.** No randomness anywhere. Leiden's random node order becomes order by path,
  and refinement merges by best gain with ties broken by id. Graphify had to fix exactly this:
  edge orientation followed Python's hash order and gave 70 communities in one run and 69 in the
  next. `build.test.mjs` already asserts two runs give the same bytes, and the new sections fall
  under it.
- **No dependency** (ADR 0004 as amended by 0029). Clusters, the report and the MCP tool are pure
  Node. Only symbols need the add-on, and everything works without it.
- **Floors stay floors.** A count built on `inferred` or `ambiguous` edges says so. Impact's
  `atLeast` counts only `extracted` edges unless a caller asks for more.
- **The findings ranking is control flow** (ADR 0006). The graph report adds no offer and moves no
  finding. It is information on the glance and in the viewer, and a CLI of its own.
- **Validated on real repos and mutation-tested**, as every `index/` change is. Fixtures share the
  author's blind spots.

## The pieces, in build order

Each is one PR. Each merges to `master` unreleased. The release follows the last.

### G1 — Clusters

- Graph: indexed files as nodes, undirected, weight = import edges between the pair in both
  directions. A file with no in-repo edge is not clustered (`cluster: null`) and is counted in
  `clusters.unclustered`.
- Leiden at resolution 1.0, modularity quality: local moving, refinement, aggregation, repeated
  until stable. Then the oversized and low-cohesion splits.
- `index.clusters = { algorithm, resolution, unclustered, items: [{ id, hub, size, cohesion,
  areas, files }] }`. `id` is `c1`, `c2`, … by size descending, then hub path. `areas` counts
  members per top-level area, so a cluster that spans folders shows it. Each clustered file gets
  `cluster`. `INDEX_VERSION` moves.
- Viewer: the Map colours nodes by cluster, and the Areas tab lists clusters beside folders.
- **Validation:**
  - zustand, got, flask, fzf, ripgrep, a Vite React-TS app and bulletproof-react.
  - Two runs must be byte-identical.
  - The clusters' modularity must beat the folder partition's on each repo, with both numbers
    recorded.
  - Each cluster's hub and members are read for whether they name one concern.

### G2 — The graph report

- **Hubs:** top 10 by degree, excluding test files and files over 50% generated, each with cluster
  and inbound count.
- **Bridges:** cross-cluster edges scored as in the table, top 10, each with its reasons.
- **Cycles:** from `depth.cyclic`, shortest first.
- **Clusters without tests:** a cluster where `coverage.mjs` finds no test for any member.
- `index/cortex-graph.mjs [root] [--json]` prints it. The viewer gains a Graph section. The
  findings glance gets one line (cluster count, hubs, cycles) and no offer.
- **Validation:** on the G1 repos, every hub and bridge reported is opened and judged. The scoring
  is mutation-tested.

### G3 — The `graph` MCP tool

- `graph` with `op`: `stats`, `node`, `neighbors`, `cluster`, `hubs`, `bridges`, `path`. Repo
  mode, read-only, reading the repo's index through `index/lib/open.mjs`'s freshness rule. When
  the index is stale it says so instead of answering from old data.
- `ai-os graph <op>` for agents without MCP.
- **Validation:** answers compared against `cortex-graph.mjs --json` on the same repos.

### G4 — Parsers and symbols

- `index/parsers.lock.json` pins `web-tree-sitter` and the grammars: JavaScript, TypeScript, TSX,
  Python first. Go, Java and Rust follow in G5.
- `tools/cortex-parsers.mjs install|status|remove` and `index/lib/parsers.mjs`, as ADR 0029 says.
- `index/lib/symbols.mjs`, per file:
  - **Definitions:** functions, classes, methods, exported constants holding functions. Ids are
    `path#name`, and nested ones are `path#Class.method`.
  - **Calls:** the callee name and the line it is called on.
- Resolution:
  - A call to a definition in the same file, or to a name bound by an import that Cortex resolved,
    is `extracted`.
  - One unique definition of that name among the files this file imports is `inferred`.
  - Several definitions are `ambiguous`, and all of them are kept.
  - A call that resolves to nothing is counted, not kept.
- `index.symbols = { parser, definitions, calls, unresolved }`, apart from `files`, so no reader
  of `files` changes.
- Cache: `.cortex/index/symbols/<sha256>.json`, keyed by content and lock digest. A cold build and
  a warm one give the same bytes.
- Clusters gain call edges when present (`ambiguous` weighs 0.5).
- **Validation:**
  - The same seven repos.
  - Twenty call edges per repo are opened and checked.
  - Every `extracted` edge's target exists.
  - The installer is tested against a fake registry with a tampered tarball, which it must refuse.

### G5 — Symbols in use

- `cortex-impact --symbol path#name`: callers, as a floor of `extracted` edges, with `inferred`
  listed separately.
- The `graph` tool gains `callers`, `callees` and `defines`. Hubs and bridges can be symbols.
- Grammars for Go, Java and Rust, each validated on its own repos (fzf, spring-petclinic, ripgrep).

## Release

After G5, as 2.46.0. Each PR adds its own changelog entry under Unreleased. The site sync follows
the release, and its page map (`skills/site-sync/PAGES.md`) gains the new README sections in the
PR that writes them.
