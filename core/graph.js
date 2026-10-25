// graph.js — the parts of the import graph worth a reader's attention.
//
// Four lists, read off an index that already holds clusters (`index/lib/clusters.mjs`) and cycles
// (`index/lib/depth.mjs`). Nothing here re-derives either.
//
// ## Why this is in core/
//
// Two leaves answer from it. `index/cortex-graph.mjs` prints the report, and the `graph` MCP tool
// (`mcp/lib/graph.js`) returns the same hubs and bridges from the same stored index. The leaves may
// not import each other, and a second copy of the scoring would agree today and disagree after the
// next change to it, so the computation lives here. It is pure: an index in, plain data out. It
// reads no file and starts no process. `index/lib/graph-report.mjs` re-exports it with the glance
// line, so `index/` still asks its own module.
//
// - **Hubs**: the files with the most distinct neighbours. What a newcomer reads first, and what a
//   change ripples out from.
// - **Bridges**: imports from one cluster into another, scored so the unexpected ones rank first.
// - **Cycles**: each strongly connected group of files, with one shortest loop through it.
// - **Untested clusters**: clusters where coverage found no test for any member that needs one.
//
// ## Product files only, for hubs and bridges
//
// Tests, fixtures (`isTestData`), code that serves tests (`inTestSupportDir`) and files the repo
// declares vendored or generated are left out of the graph these two read. A test imports the code it covers, so counting tests made the
// best-tested file look like the most central one, and every test importing across `test/` → `src/`
// scored as a cross-area bridge: the most expected import a repo has, ranked as the most surprising.
// Clusters are read as the index stores them, tests included. A cycle is listed when one of its
// files is a product file; the rest are counted (`graphReport`).
//
// ## Twins
//
// Files that import the same files and are imported by the same files are one row, named by the
// first path, with the rest in `twins`. A Go import names a package, so the index links an
// importer to every file in it: on fzf the ten hubs were eight `src/util/*.go` files with the same
// 19 links, and the bridges repeated one `util` import once per file. The rule is not Go's:
// zustand's middleware files each import the store and are imported by the barrel, and listing
// four of them said one thing four times.
//
// ## The bridge score
//
// From the spec (`docs/specs/2026-10-25-code-graph-design.md`): +2 when the two files sit in
// different areas (`layerKeyFor`, the one area definition), +1 for crossing clusters. The sum is
// multiplied by the edge's confidence weight, `edgeWeight` below, which clustering uses too, so an
// `ambiguous` edge counts half. Edges carry no confidence yet, so every one reads as extracted.
//
// The rest was decided by reading every bridge on nine real repos:
//
// - **−2 for a shared dependency**, a target imported from at least `SHARED_REACH` clusters other
//   than its own. Without it the top of each list was the import a reader expects most: zustand's
//   middleware into its store, every fzf file into `util`, a UI kit's button.
// - **−2 for a re-export** (`export … from`). A barrel crossing into another cluster is the
//   barrel's interface, not a coupling.
// - **The spec's +1 for a file with few links reaching a hub is not scored.** It fired on 27
//   bridges, and 26 were the most expected import in their repo: a middleware importing its store,
//   a CLI importing its own helper, a hub importing its private util that Leiden put elsewhere.
//
// Ties are common. They break on how many bridges join the same two clusters, fewest first, since
// the one import between two features is the unexpected one and the fortieth is an interface. Then
// by the target's reach, then by path. An import both ways between two files is one bridge.
//
// ## Determinism and the floor
//
// Every order is code-unit path order, never `localeCompare`. Edges come from regex import
// resolution, so a dynamic import is invisible: a link count is a floor, a file can be a hub the
// report does not name, and a cluster reported untested may be run by a test the index cannot see.

import { inTestSupportDir, isTestData, layerKeyFor } from "./path-kinds.js";

/** How many hubs and bridges the report lists. */
export const TOP = 10;
/** A file needs at least this many distinct neighbours to be called a hub. */
export const HUB_MIN_LINKS = 3;
/** A file imported from at least this many other clusters is a shared dependency. */
export const SHARED_REACH = 3;
/** The bridge score's terms. */
export const SCORE = { area: 2, cluster: 1, shared: -2, reexport: -2 };

/** The weight of an edge whose `confidence` is `ambiguous`. */
export const UNSURE_WEIGHT = 0.5;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The weight one import edge adds to its pair, in clustering and in the bridge score. */
export function edgeWeight(edge) {
  return edge?.confidence === "ambiguous" ? UNSURE_WEIGHT : 1;
}

/**
 * Tarjan's strongly-connected components, iterative so a deep graph cannot blow the stack.
 * `index/lib/depth.mjs` condenses cycles with it and `cyclesOf` below reads them back as groups:
 * one copy, so the two cannot disagree about what a cycle is.
 */
export function components(nodes, edgesFrom) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const comp = new Map(); // node → component id
  const groups = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    const work = [[root, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const [v, i] = frame;
      if (i === 0) {
        index.set(v, counter);
        low.set(v, counter);
        counter++;
        stack.push(v);
        onStack.add(v);
      }
      const deps = edgesFrom.get(v) || [];
      if (i < deps.length) {
        frame[1]++;
        const w = deps[i];
        if (!index.has(w)) work.push([w, 0]);
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
        continue;
      }
      if (low.get(v) === index.get(v)) {
        const group = [];
        for (;;) {
          const w = stack.pop();
          onStack.delete(w);
          comp.set(w, groups.length);
          group.push(w);
          if (w === v) break;
        }
        groups.push(group.sort());
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(v)));
      }
    }
  }
  return { comp, groups };
}

/** A file the hubs and bridges are read over: not a test, test data, test support or vendored. */
export function isProductFile(f) {
  return !f.isTest && !f.vendored && !isTestData(f.path) && !inTestSupportDir(f.path);
}

/**
 * The product graph: each file's distinct neighbours and importers, the edges between product
 * files in path order, and the twin groups hubs and bridges fold by.
 */
export function productGraph(index) {
  const files = new Map((index.files ?? []).filter(isProductFile).map((f) => [f.path, f]));
  const nbrs = new Map();
  const importers = new Map();
  const imported = new Map();
  const edges = [];
  const add = (m, k, v) => {
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(v);
  };
  for (const e of index.edges ?? []) {
    if (e.from === e.to || !files.has(e.from) || !files.has(e.to)) continue;
    add(nbrs, e.from, e.to);
    add(nbrs, e.to, e.from);
    add(importers, e.to, e.from);
    add(imported, e.from, e.to);
    edges.push(e);
  }
  edges.sort((a, b) => byCodeUnit(a.from, b.from) || byCodeUnit(a.to, b.to));

  const linked = [...nbrs.keys()].sort(byCodeUnit);
  const list = (m, p) => [...(m.get(p) ?? [])].sort(byCodeUnit).join("\n");
  // Twins import the same files and are imported by the same files. Direction counts: on got,
  // `benchmark/index.ts` imports `source/index.ts` and `source/core/calculate-retry-delay.ts` is
  // imported by it, with the same three neighbours. Folded, the pair read "imports both ways".
  const nbrKey = (p) => `${list(imported, p)}\0${list(importers, p)}`;
  // A hub's twins may sit in any cluster. A bridge's must share its cluster too, so folding one
  // into another never moves a bridge between clusters: fzf's `util` files sit in five.
  const hubTwins = twinGroups(linked, nbrKey);
  const bridgeTwins = twinGroups(linked, (p) => `${files.get(p).cluster ?? ""}\0${nbrKey(p)}`);
  return {
    files,
    edges,
    links: (p) => nbrs.get(p)?.size ?? 0,
    inbound: (p) => importers.get(p)?.size ?? 0,
    hubTwins,
    bridgeTwins,
  };
}

/** Group sorted paths by `keyOf`: `rep(p)` is the first path in p's group, `twins(rep)` the rest. */
function twinGroups(paths, keyOf) {
  const groups = new Map();
  for (const p of paths) {
    const key = keyOf(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const repOf = new Map();
  const twinsOf = new Map();
  for (const g of groups.values()) {
    for (const p of g) repOf.set(p, g[0]);
    twinsOf.set(g[0], g.slice(1));
  }
  return { rep: (p) => repOf.get(p) ?? p, twins: (p) => twinsOf.get(p) ?? [] };
}

/** The top `TOP` product files by distinct neighbours, then importers, then path; twins fold in. */
export function hubsOf(index, graph = productGraph(index)) {
  const rows = [];
  for (const [path, f] of graph.files) {
    const links = graph.links(path);
    const { rep, twins } = graph.hubTwins;
    if (links < HUB_MIN_LINKS || rep(path) !== path) continue;
    rows.push({ path, cluster: f.cluster ?? null, links, inbound: graph.inbound(path), twins: twins(path) });
  }
  rows.sort((a, b) => b.links - a.links || b.inbound - a.inbound || byCodeUnit(a.path, b.path));
  return rows.slice(0, TOP);
}

/** Every import between product files in two different clusters, scored, highest first. */
export function bridgesOf(index, graph = productGraph(index)) {
  const clusterOf = (p) => graph.files.get(p)?.cluster ?? null;
  const pairKey = (a, b) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);

  // How many clusters other than its own import each file.
  const reachSets = new Map();
  const crossing = [];
  for (const e of graph.edges) {
    const ca = clusterOf(e.from);
    const cb = clusterOf(e.to);
    if (!ca || !cb || ca === cb) continue;
    crossing.push(e);
    if (!reachSets.has(e.to)) reachSets.set(e.to, new Set());
    reachSets.get(e.to).add(ca);
  }
  const reachOf = (p) => reachSets.get(p)?.size ?? 0;

  // One bridge per pair of twin groups, named by the groups' first paths, in the direction of the
  // first edge found.
  const byPair = new Map();
  const { rep } = graph.bridgeTwins;
  for (const e of crossing) {
    const from = rep(e.from);
    const to = rep(e.to);
    const key = pairKey(from, to);
    const seen = byPair.get(key);
    if (!seen) {
      byPair.set(key, { from, to, edge: e, mutual: false, reexport: !!e.reexport, weight: edgeWeight(e), pairs: new Set([pairKey(e.from, e.to)]) });
      continue;
    }
    if (from !== seen.from) seen.mutual = true;
    // The surest import it stands for sets the weight, and the confidence reported with it.
    if (edgeWeight(e) > seen.weight) {
      seen.weight = edgeWeight(e);
      seen.edge = e;
    }
    seen.reexport = seen.reexport && !!e.reexport;
    seen.pairs.add(pairKey(e.from, e.to));
  }
  const between = new Map();
  for (const { from, to } of byPair.values()) {
    const ck = pairKey(clusterOf(from), clusterOf(to));
    between.set(ck, (between.get(ck) ?? 0) + 1);
  }

  const out = [];
  for (const { from, to, edge: e, mutual, reexport, weight, pairs } of byPair.values()) {
    const fromCluster = clusterOf(from);
    const toCluster = clusterOf(to);
    const fromArea = layerKeyFor(from);
    const toArea = layerKeyFor(to);
    const reach = reachOf(to);
    let raw = 0;
    const reasons = [];
    if (fromArea !== toArea) {
      raw += SCORE.area;
      reasons.push(`crosses areas: ${fromArea} to ${toArea}`);
    }
    raw += SCORE.cluster;
    reasons.push(`crosses clusters: ${fromCluster} to ${toCluster}`);
    if (reexport) {
      raw += SCORE.reexport;
      reasons.push(`${from} re-exports ${to}, so the import is the barrel's interface`);
    }
    if (reach >= SHARED_REACH) {
      raw += SCORE.shared;
      reasons.push(`${to} is imported from ${reach} other clusters, so it is a shared dependency`);
    }
    const confidence = e.confidence ?? "extracted";
    if (weight !== 1) reasons.push(`${confidence} edge, weighted ${weight}`);
    if (mutual) reasons.push("imports both ways");
    const folded = pairs.size - 1;
    if (folded) reasons.push(`stands for ${plural(folded, "more import")} between files with the same links`);
    out.push({
      from,
      to,
      fromCluster,
      toCluster,
      fromArea,
      toArea,
      confidence,
      score: raw * weight,
      between: between.get(pairKey(fromCluster, toCluster)),
      reach,
      mutual,
      folded,
      reasons,
    });
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      a.between - b.between ||
      a.reach - b.reach ||
      byCodeUnit(a.from, b.from) ||
      byCodeUnit(a.to, b.to),
  );
  return out;
}

/**
 * The first `TOP` bridges with one row per importing file, each carrying `alsoFrom`: how many
 * lower-ranked bridges leave the same file. On fzf, `main.go` imports the `src` package, which the
 * index links to every file in it, and its bridges filled the whole list with one import.
 */
export function topBridges(ranked) {
  const out = [];
  const row = new Map();
  for (const b of ranked) {
    const first = row.get(b.from);
    if (first) first.alsoFrom++;
    else if (out.length < TOP) {
      const r = { ...b, alsoFrom: 0 };
      row.set(b.from, r);
      out.push(r);
    }
  }
  return out;
}

/** One shortest loop through `start` inside `inside`, as a path list without the repeat, or null. */
function loopThrough(start, edgesFrom, inside) {
  const prev = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const v = queue.shift();
    for (const w of edgesFrom.get(v) ?? []) {
      if (!inside.has(w)) continue;
      if (w === start) {
        const loop = [];
        for (let x = v; x !== null; x = prev.get(x)) loop.push(x);
        return loop.reverse();
      }
      if (prev.has(w)) continue;
      prev.set(w, v);
      queue.push(w);
    }
  }
  return null;
}

/**
 * The index's cycles as groups, each `{ files, loop }`: the strongly connected files, and the
 * shortest loop through any of them (the first by path on a tie). Shortest loop first, then the
 * smaller group, then path.
 */
export function cyclesOf(index) {
  const cyclic = [...new Set((index.cycles ?? []).filter((p) => typeof p === "string"))].sort(byCodeUnit);
  const inside = new Set(cyclic);
  const edgesFrom = new Map(cyclic.map((p) => [p, []]));
  for (const e of index.edges ?? []) {
    if (e.from !== e.to && inside.has(e.from) && inside.has(e.to)) edgesFrom.get(e.from).push(e.to);
  }
  for (const list of edgesFrom.values()) list.sort(byCodeUnit);
  const { groups } = components(cyclic, edgesFrom);
  const out = [];
  for (const group of groups) {
    if (group.length < 2) continue;
    const files = [...group].sort(byCodeUnit);
    const members = new Set(files);
    let loop = null;
    for (const start of files) {
      const l = loopThrough(start, edgesFrom, members);
      if (l && (!loop || l.length < loop.length)) loop = l;
    }
    out.push({ files, loop: loop ?? files });
  }
  out.sort((a, b) => a.loop.length - b.loop.length || a.files.length - b.files.length || byCodeUnit(a.files[0], b.files[0]));
  return out;
}

/**
 * Clusters with at least one member that needs a test and no test found for any of them.
 * `coverage` is `codeCoverage`'s answer (`index/lib/findings.mjs`): `{ testable, untested }`.
 */
export function untestedClustersOf(index, coverage) {
  const testable = new Set(coverage.testable);
  const untested = new Set(coverage.untested);
  const out = [];
  for (const c of index.clusters?.items ?? []) {
    const needing = (c.files ?? []).filter((p) => testable.has(p));
    if (needing.length && needing.every((p) => untested.has(p))) {
      out.push({ id: c.id, hub: c.hub, size: c.size, testable: needing.length });
    }
  }
  return out;
}

/**
 * graphReport(index, { coverage }) → { clusters, unclustered, hubs, bridges, bridgeCount, cycles,
 * cycleFiles, testCycles, untestedClusters }
 *
 * `untestedClusters` is null when no coverage was passed, which says "not asked", never "none".
 * `bridges` holds the top `TOP`; `bridgeCount` is how many there were before the cut.
 *
 * `cycles` holds the groups with at least one product file. A group made only of tests, fixtures
 * and test helpers is counted in `testCycles` instead: vite's 32 cycles were all fixtures under
 * `__tests__/fixtures/` that exist to test circular imports, and listed first they buried any
 * cycle in the code.
 */
export function graphReport(index, { coverage = null } = {}) {
  const graph = productGraph(index);
  const hubs = hubsOf(index, graph);
  const bridges = bridgesOf(index, graph);
  const byPath = new Map((index.files ?? []).map((f) => [f.path, f]));
  const inProduct = (p) => !byPath.has(p) || isProductFile(byPath.get(p));
  const allCycles = cyclesOf(index);
  const cycles = allCycles.filter((c) => c.files.some(inProduct));
  return {
    clusters: index.clusters?.items?.length ?? 0,
    unclustered: index.clusters?.unclustered ?? 0,
    hubs,
    bridges: topBridges(bridges),
    bridgeCount: bridges.length,
    cycles,
    cycleFiles: cycles.reduce((n, c) => n + c.files.length, 0),
    testCycles: allCycles.length - cycles.length,
    untestedClusters: coverage ? untestedClustersOf(index, coverage) : null,
  };
}
