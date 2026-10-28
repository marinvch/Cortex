# The code graph: clusters, hubs, symbols and a graph tool — design

**Date:** 2026-10-25 · **Status:** agreed, being built · **Decision record:**
[ADR 0029](../adr/0029-code-parsers-are-an-add-on-the-user-installs.md)

## Why

Cortex already has the file-level half of a code graph: the import graph, `/cortex-view`'s map,
`/cortex-impact` and import cycles (`depth.cyclic`). Four questions it cannot answer yet:

- Which files form one feature? Cortex's "areas" are top-level folders (`lib/layers.mjs`), and a
  folder is not a feature.
- Which files and links matter most, and which links are unexpected?
- Which function calls which?
- How sure is each link?

This spec answers them with Cortex's own code, written from published algorithms and Cortex's own
design. Nothing is copied from another project, and nothing in the code names one.

## The pieces

| Cortex | What it does |
|---|---|
| `index/lib/clusters.mjs` | Groups files into communities with the Leiden algorithm (Traag, Waltman & van Eck, 2019), made deterministic |
| `index/lib/graph-report.mjs` | Hubs, bridges (unexpected cross-cluster links), cycles, untested clusters |
| `mcp/lib/graph.js` | A read-only `graph` tool: stats, node, neighbours, cluster, hubs, bridges, path; later callers and definitions |
| `confidence` on edges | `extracted` · `inferred` · `ambiguous` |
| `index/lib/parsers.mjs`, `index/lib/symbols.mjs` | Definitions and calls from tree-sitter, when the add-on is installed |
| `.cortex/index/symbols/` | A cache keyed by file content, so only changed files are parsed again |

**Out of scope:**
- LLM extraction in the index.
- Documents, PDFs and media.
- Exports to other note formats.
- File watching.

## Rules this must keep

- **Deterministic.** No randomness anywhere. Leiden normally visits nodes in random order. Here it
  visits them in path order, and refinement merges by best gain with ties broken by id. Edge order
  and orientation are canonicalised before anything iterates them, so the result never depends on
  insertion order. `build.test.mjs` already asserts that two runs give the same bytes, and the new
  sections fall under it.
- **No dependency** (ADR 0004 as amended by 0029). Clusters, the report and the MCP tool are pure
  Node. Only symbols need the add-on, and everything works without it.
- **Floors stay floors.** A count built on `inferred` or `ambiguous` edges says so. Impact's
  `atLeast` counts only `extracted` edges unless a caller asks for more.
- **The findings ranking is control flow** (ADR 0006). The graph report adds no offer and moves no
  finding. It is information on the glance and in the viewer, and a CLI of its own.
- **Validated on real repos and mutation-tested**, as every `index/` change is. Fixtures share the
  author's blind spots.

## Build order

Each piece is one PR. Each merges to `master` unreleased. The release follows the last.

### G1 — Clusters

- **The graph:**
  - Indexed files are the nodes, undirected.
  - Weight = import edges between the pair, in both directions.
  - An `ambiguous` edge, once edges carry confidence, weighs 0.5.
  - A file with no in-repo edge is not clustered (`cluster: null`) and is counted in
    `clusters.unclustered`.
- **The algorithm:**
  - Leiden, modularity quality, resolution 1.0.
  - Local moving, refinement and aggregation, repeated until stable.
- **Splits:**
  - A community holding more than a quarter of the clustered files (and at least 10) is split by a
    second pass on its own subgraph.
  - So is one whose cohesion is below 0.05 (and has at least 50 files).
  - Cohesion = edges inside ÷ possible pairs.
- **Output:**
  - `index.clusters = { algorithm, resolution, unclustered, items: [{ id, hub, size, cohesion,
    areas, files }] }`.
  - `id` is `c1`, `c2`, …, by size descending, then hub path.
  - `hub` is the member with the most edges, ties broken by path.
  - `areas` counts members per top-level area, so a cluster that spans folders shows it.
  - Each clustered file gets `cluster`, and `INDEX_VERSION` moves.
- **Viewer:** the Map colours nodes by cluster, and the Areas tab lists clusters beside folders.
- **Validation:**
  - Run on zustand, got, flask, fzf, ripgrep, a Vite React-TS app and bulletproof-react.
  - Two runs must be byte-identical.
  - The clusters' modularity must beat the folder partition's, with both numbers recorded.
  - Each cluster's hub and members are read for whether they name one concern.

### G2 — The graph report

- **Hubs:** the top 10 by degree, excluding test files and generated files, each with its cluster
  and inbound count.
- **Bridges:** cross-cluster edges, scored:
  - crossing areas: +2;
  - crossing clusters: +1;
  - a file with few links reaching a hub: +1;
  - weighted by confidence.

  The top 10 are listed, each with its reasons.
- **Cycles:** from `depth.cyclic`, shortest first.
- **Untested clusters:** a cluster where `coverage.mjs` finds no test for any member.
- **Where it shows:**
  - `index/cortex-graph.mjs [root] [--json]` prints it.
  - The viewer gains a Graph section.
  - The findings glance gets one line (cluster count, hubs, cycles) and no offer.
- **Validation:** on the G1 repos, every hub and bridge reported is opened and judged. The scoring
  is mutation-tested.
- **As built.** Reading every bridge on nine repos changed the score. The +1 for a file with few
  links reaching a hub is not scored: it fired on 27 bridges and 26 were the most expected import
  in their repo. An import of a file that three or more other clusters import, or a re-export,
  scores 2 less. Ties go to the pair of clusters with the fewest bridges between them.
  `index/lib/graph-report.mjs` holds the reasons.

### G3 — The `graph` MCP tool

- `graph` takes an `op`: `stats`, `node`, `neighbors`, `cluster`, `hubs`, `bridges` or `path`.
- It runs in repo mode, read-only, and reads the repo's index through `index/lib/open.mjs`'s
  freshness rule. A stale index is reported as stale, never answered from.
- `ai-os graph <op>` serves agents without MCP.
- **Validation:** answers are compared against `cortex-graph.mjs --json` on the same repos.

### G4 — Parsers and symbols

- `index/parsers.lock.json` pins the WebAssembly parser and its grammars: JavaScript, TypeScript,
  TSX and Python first; Go, Java and Rust in G5.
- `tools/cortex-parsers.mjs install|status|remove` and `index/lib/parsers.mjs`, as ADR 0029 says.
  The installer checks its download host with the work profile's approved-destinations rule.
- `index/lib/symbols.mjs`, per file:
  - **Definitions:** functions, classes, methods, and exported constants holding functions. Ids are
    `path#name`, nested ones `path#Class.method`.
  - **Calls:** the name called and the line it is called on.
- **Resolution:**
  - A call to a definition in the same file, or to a name bound by an import that Cortex resolved,
    is `extracted`.
  - A name with exactly one definition among the files this file imports is `inferred`.
  - Several candidates make it `ambiguous`, and all are kept.
  - A call that resolves to nothing is counted, not kept.
- `index.symbols = { parser, definitions, calls, unresolved }` sits apart from `files`, so no
  reader of `files` changes.
- **Cache:** `.cortex/index/symbols/<sha256>.json`, keyed by file content and lock digest. A cold
  build and a warm one give the same bytes.
- Clusters gain call edges when symbols are present.
- **Validation:**
  - Run on the same seven repos.
  - Twenty call edges per repo are opened and checked.
  - Every `extracted` target exists.
  - The installer must refuse a tampered tarball from a fake registry.
- **As built.** Reading the call edges on four repos changed what counts as a definition, and the
  rules are in `index/lib/symbols.mjs`'s header.
  - **Definitions.** A top-level constant holding a function counts whether or not it is exported:
    without it, the commonest call in a file, to a helper beside it, was unresolved.
  - **More definitions:**
    - A constant that renames a function (`export const devtools = devtoolsImpl as Devtools`) is
      a definition.
    - So is one built with `Object.assign(fn, …)`. Without the first, zustand's middleware was
      unreachable; without the second, got's `test` was.
  - **More calls.** A capitalised JSX element and a `new` count as calls.
  - **More inferred edges.** A method reached through a class's stated base, one level up, is
    `inferred`.
  - **Unresolved calls** are counted by reason: `external`, `local`, `member`, `missing` and
    `unknown`. A name a barrel re-exports from a package counts as `external`, not `missing`.
  - **The index** says `parser` at the top level, as ADR 0029 asks, and `symbols.parser` repeats it.
  - **The cache key** also carries a digest of the extractor's source, so an edit to it cannot
    reuse an old extraction.
  - **`INDEX_VERSION` stays 2.** `symbols` and `parser` are fields a reader may ignore, and no
    existing field changed meaning.

### G5 — Symbols in use

- `cortex-impact --symbol path#name` lists callers, as a floor of `extracted` edges, with `inferred`
  ones listed apart.
- The `graph` tool gains `callers`, `callees` and `defines`.
- Grammars for Go, Java and Rust, each validated on its own repos (fzf, spring-petclinic, ripgrep).
- **As built.** The first pass resolved 6% of spring-petclinic's calls, because Java code calls
  methods on fields and parameters, and the JS model treats those as values of unknown type.
  - **Declared types.** Go, Java and Rust state a parameter's, a local's or a field's type, so
    `x.m()` now resolves to the declared type's `m`: extracted on the type itself, inferred through
    its base. Petclinic went to 20%, and fzf and ripgrep gained about a hundred edges each.
  - **The package.** Go and Java files see their package's names without an import.
  - **Conversions.** A Go call to a type is a conversion, not a call.
  - **Overloads.** Java overloads share one id.
  - **Validation.** Sixty edges were read against the source, and cold and warm runs are
    byte-identical.

## Release

The release follows G5, as 2.46.0. Each PR adds its own changelog entry under Unreleased. The site
sync follows the release. Its page map (`skills/site-sync/PAGES.md`) gains the new README sections
in the PR that writes them.
