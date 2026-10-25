// clusters.mjs — which files form one feature, read off the import graph.
//
// ## Why clusters and areas both exist
//
// An **area** (`lib/layers.mjs`) is a top-level folder. It records how a team laid the tree out,
// and reading it costs nothing. A **cluster** is a set of files that import each other more than
// they import the rest of the repo, so it records which files change together. The two disagree on
// purpose. A library can keep its core, its bindings and its middleware side by side in one
// `src/`, and an app's one feature can span `components/`, `hooks/` and `api/`. Neither replaces
// the other: a brief lives in a folder, so areas route briefs, and clusters show features.
//
// ## The method
//
// Leiden, as published by Traag, Waltman & van Eck (2019), "From Louvain to Leiden: guaranteeing
// well-connected communities", with modularity as the quality function at `RESOLUTION` 1:
//
// 1. **Move.** Each node joins the neighbouring community that raises modularity most. A node that
//    moves puts its neighbours outside the new community back on the queue.
// 2. **Refine.** Inside each community, start from single nodes and merge each well-connected one
//    into a well-connected piece of the same community. A piece never leaves its community, which
//    is what guarantees every final cluster is connected.
// 3. **Aggregate.** Each refined piece becomes one node, starting in its community, and step 1
//    runs again on the smaller graph.
//
// That repeats until moving changes nothing, and the whole run repeats from its own answer until a
// round stops raising modularity.
//
// ## Determinism, which the paper does not give
//
// The paper visits nodes in random order and picks a refinement merge at random. Here nodes are
// visited in path order and refinement takes the best gain, ties to the lower id, which is the
// zero-randomness limit of the paper's choice. A move must beat staying by more than `EPS`, so a
// tie never moves anything and float noise cannot make two runs disagree. Paths are compared by
// code unit, never with `localeCompare`, whose order depends on the machine's ICU. Every Map and
// Set here is filled from a list already sorted by index, and an edge's weight is keyed by its
// unordered pair, so the direction an edge was found in cannot change the graph.
//
// ## After Leiden: Cortex's own rules
//
// - **No cluster swallows the repo.** One holding more than `LARGE_SHARE` of the clustered files,
//   and at least `LARGE_MIN_FILES`, is clustered again on its own subgraph.
// - **No loose cluster.** One of at least `LOOSE_MIN_FILES` whose cohesion is under
//   `LOOSE_COHESION` is clustered again too. Both rules re-apply to the parts; a re-run that finds
//   one group keeps it whole.
// - **Cohesion** is the node pairs joined by an edge ÷ n·(n−1)/2. A pair that imports both ways is
//   one pair, so cohesion cannot pass 1. A one-file cluster scores 1.
// - **The hub** names a cluster: the member with the most distinct neighbours, ties by path. `c1`
//   is the largest cluster, ties by hub. No two clusters share a hub, so the order is total.
// - **An `ambiguous` edge weighs `UNSURE_WEIGHT`.** No edge carries a confidence yet. Call edges
//   will, and a guess must not glue two features together.
// - **A file with no in-repo edge is not clustered** and carries `cluster: null`. Code and script
//   files without one are counted in `unclustered`. Docs and config never have edges, so counting
//   them would measure how much prose a repo has. The share above is of the clustered files.
//
// ## The limit
//
// Edges come from regex import resolution, so a dynamic import is invisible. A file that looks
// unclustered may be loaded at runtime. A cluster is a floor, in the sense depth is.

import { layerKeyFor } from "./layers.mjs";

export const RESOLUTION = 1;
/** A cluster holding more than this share of the clustered files is clustered again… */
export const LARGE_SHARE = 0.25;
/** …when it holds at least this many. */
export const LARGE_MIN_FILES = 10;
/** A cluster with cohesion under this is clustered again… */
export const LOOSE_COHESION = 0.05;
/** …when it holds at least this many files. */
export const LOOSE_MIN_FILES = 50;
/** The weight of an edge whose `confidence` is `ambiguous`. */
export const UNSURE_WEIGHT = 0.5;
/** Cohesion is written with this many decimals, so the bytes carry no float noise. */
export const COHESION_DECIMALS = 3;

const EPS = 1e-10;
// Rounds of whole-Leiden refinement, and levels of aggregation inside one. Each is a safety bound:
// a level always shrinks the graph, and a round stops at the first that does not raise modularity.
const MAX_ROUNDS = 10;
const MAX_LEVELS = 64;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The weight one import edge adds to its pair. */
export function edgeWeight(edge) {
  return edge?.confidence === "ambiguous" ? UNSURE_WEIGHT : 1;
}

// --- the graph ------------------------------------------------------------------------------------

/**
 * A weighted undirected graph over nodes 0..n-1. `nbr[v]`/`wt[v]` are v's neighbours, sorted by
 * index, without v itself; `self[v]` is weight folded inside v by aggregation; `deg[v]` counts a
 * self weight twice, so `m2` (the sum of degrees) is twice the total weight.
 */
function makeGraph(n, pairWeights, self = null) {
  const lists = Array.from({ length: n }, () => []);
  for (const [key, w] of pairWeights) {
    const a = Math.floor(key / n);
    const b = key - a * n;
    lists[a].push([b, w]);
    lists[b].push([a, w]);
  }
  const nbr = new Array(n);
  const wt = new Array(n);
  const deg = new Float64Array(n);
  const selfW = self ?? new Float64Array(n);
  let m2 = 0;
  for (let v = 0; v < n; v++) {
    lists[v].sort((x, y) => x[0] - y[0]);
    nbr[v] = Int32Array.from(lists[v], (x) => x[0]);
    wt[v] = Float64Array.from(lists[v], (x) => x[1]);
    let d = 2 * selfW[v];
    for (const w of wt[v]) d += w;
    deg[v] = d;
    m2 += d;
  }
  return { n, nbr, wt, self: selfW, deg, m2 };
}

/** Add `w` to the pair (a, b), a ≠ b, keyed so the key never depends on the edge's direction. */
function addPair(pairs, n, a, b, w) {
  const key = a < b ? a * n + b : b * n + a;
  pairs.set(key, (pairs.get(key) ?? 0) + w);
}

/** Renumber a membership by first appearance in node order: 0, 1, 2, … */
function renumber(memb) {
  const map = new Map();
  const out = new Int32Array(memb.length);
  for (let v = 0; v < memb.length; v++) {
    let c = map.get(memb[v]);
    if (c === undefined) {
      c = map.size;
      map.set(memb[v], c);
    }
    out[v] = c;
  }
  return out;
}

function distinct(memb) {
  return new Set(memb).size;
}

/** Modularity of a membership at resolution γ: Σ_c in_c/m − γ·(K_c/2m)². 0 for a graph with no weight. */
export function modularityOf(G, memb, resolution = RESOLUTION) {
  if (!G.m2) return 0;
  const inside = new Map();
  const tot = new Map();
  for (let v = 0; v < G.n; v++) {
    const c = memb[v];
    tot.set(c, (tot.get(c) ?? 0) + G.deg[v]);
    let s = 2 * G.self[v];
    const nb = G.nbr[v];
    const ws = G.wt[v];
    for (let i = 0; i < nb.length; i++) if (memb[nb[i]] === c) s += ws[i];
    inside.set(c, (inside.get(c) ?? 0) + s);
  }
  // Summed in first-appearance order, which is node order: the same membership, the same float.
  let q = 0;
  for (const c of tot.keys()) {
    const k = tot.get(c) / G.m2;
    q += inside.get(c) / G.m2 - resolution * k * k;
  }
  return q;
}

// --- Leiden ---------------------------------------------------------------------------------------

/**
 * Local moving (the paper's MoveNodesFast), in place on `comm`. Every node is queued once in index
 * order; a node that moves re-queues the neighbours left outside its new community. A node moves
 * only to a strictly better community: ties stay put, and among better ones the lower id wins.
 */
function moveNodes(G, comm, resolution) {
  const { n, nbr, wt, deg, m2 } = G;
  const K = new Float64Array(n);
  const size = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    K[comm[v]] += deg[v];
    size[comm[v]]++;
  }
  const empty = [];
  for (let c = n - 1; c >= 0; c--) if (size[c] === 0) empty.push(c);
  const queue = new Int32Array(n);
  const inQ = new Uint8Array(n);
  let head = 0;
  let count = n;
  for (let v = 0; v < n; v++) {
    queue[v] = v;
    inQ[v] = 1;
  }
  const wTo = new Float64Array(n);
  const seen = new Uint8Array(n);
  const touched = [];
  while (count > 0) {
    const v = queue[head];
    head = (head + 1) % n;
    count--;
    inQ[v] = 0;
    const old = comm[v];
    touched.length = 0;
    const nb = nbr[v];
    const ws = wt[v];
    for (let i = 0; i < nb.length; i++) {
      const c = comm[nb[i]];
      if (!seen[c]) {
        seen[c] = 1;
        touched.push(c);
      }
      wTo[c] += ws[i];
    }
    K[old] -= deg[v];
    size[old]--;
    const scale = (resolution * deg[v]) / m2;
    const stay = wTo[old] - scale * K[old];
    let best = old;
    let bestGain = stay;
    for (const c of touched) {
      if (c === old) continue;
      const g = wTo[c] - scale * K[c];
      if (g > bestGain + EPS || (best !== old && Math.abs(g - bestGain) <= EPS && c < best)) {
        best = c;
        bestGain = g;
      }
    }
    // An empty community gains 0. Only worth taking when v's old one still holds someone else, and
    // then one exists: v is out of every community, so at most n−1 of the n ids are in use.
    if (size[old] > 0 && 0 > bestGain + EPS) best = empty.pop();
    comm[v] = best;
    K[best] += deg[v];
    size[best]++;
    if (size[old] === 0 && old !== best) empty.push(old);
    for (const c of touched) {
      wTo[c] = 0;
      seen[c] = 0;
    }
    if (best !== old) {
      for (let i = 0; i < nb.length; i++) {
        const u = nb[i];
        if (comm[u] !== best && !inQ[u]) {
          queue[(head + count) % n] = u;
          count++;
          inQ[u] = 1;
        }
      }
    }
  }
}

/**
 * Refinement (the paper's RefinePartition and MergeNodesSubset). Inside each community S of
 * `comm`, start from singletons and merge a well-connected singleton into the well-connected
 * refined community with the best positive gain, ties by the lower id. A refined community never
 * leaves S, which is what keeps every final community connected.
 */
function refine(G, comm, resolution) {
  const { n, nbr, wt, deg, m2 } = G;
  const rc = new Int32Array(n);
  const Kr = new Float64Array(n);
  const sizeR = new Int32Array(n);
  const ext = new Float64Array(n); // weight from a refined community to the rest of its S
  const KS = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    rc[v] = v;
    Kr[v] = deg[v];
    sizeR[v] = 1;
    KS[comm[v]] += deg[v];
    const nb = nbr[v];
    const ws = wt[v];
    for (let i = 0; i < nb.length; i++) if (comm[nb[i]] === comm[v]) ext[v] += ws[i];
  }
  const wellConnected = (e, k, kS) => e >= (resolution * k * (kS - k)) / m2 - EPS;
  const wTo = new Float64Array(n);
  const seen = new Uint8Array(n);
  const touched = [];
  for (let v = 0; v < n; v++) {
    const S = comm[v];
    if (sizeR[rc[v]] !== 1) continue; // only a node still on its own is merged
    if (!wellConnected(ext[v], deg[v], KS[S])) continue;
    touched.length = 0;
    const nb = nbr[v];
    const ws = wt[v];
    for (let i = 0; i < nb.length; i++) {
      if (comm[nb[i]] !== S) continue;
      const c = rc[nb[i]];
      if (!seen[c]) {
        seen[c] = 1;
        touched.push(c);
      }
      wTo[c] += ws[i];
    }
    let best = -1;
    let bestGain = 0;
    for (const c of touched) {
      if (!wellConnected(ext[c], Kr[c], KS[S])) continue;
      const g = wTo[c] - (resolution * deg[v] * Kr[c]) / m2;
      if (g > bestGain + EPS || (best !== -1 && Math.abs(g - bestGain) <= EPS && c < best)) {
        best = c;
        bestGain = g;
      }
    }
    if (best !== -1) {
      const own = rc[v];
      ext[best] = ext[best] + ext[own] - 2 * wTo[best];
      Kr[best] += deg[v];
      sizeR[best]++;
      sizeR[own] = 0;
      rc[v] = best;
    }
    for (const c of touched) {
      wTo[c] = 0;
      seen[c] = 0;
    }
  }
  return rc;
}

/** Collapse each group of `part` into one node. Aggregate ids follow first appearance in node order. */
function aggregate(G, part) {
  const map = renumber(part);
  const n2 = distinct(map);
  const self = new Float64Array(n2);
  const pairs = new Map();
  for (let v = 0; v < G.n; v++) {
    const a = map[v];
    self[a] += G.self[v];
    const nb = G.nbr[v];
    const ws = G.wt[v];
    for (let i = 0; i < nb.length; i++) {
      const u = nb[i];
      if (u < v) continue; // each pair once
      const b = map[u];
      if (a === b) self[a] += ws[i];
      else addPair(pairs, n2, a, b, ws[i]);
    }
  }
  return { G: makeGraph(n2, pairs, self), map };
}

/** One run of Leiden from `init` (or singletons) until local moving leaves every node alone. */
function leidenOnce(G0, init, resolution) {
  let G = G0;
  let comm = init ? renumber(init) : Int32Array.from({ length: G0.n }, (_, i) => i);
  let top = Int32Array.from({ length: G0.n }, (_, i) => i); // original node → node of G
  for (let level = 0; level < MAX_LEVELS; level++) {
    moveNodes(G, comm, resolution);
    if (distinct(comm) === G.n) break;
    let refined = refine(G, comm, resolution);
    // A refinement that merged nothing would aggregate to the same graph and loop. Aggregate by
    // the moved partition instead, which always shrinks it: it is not all singletons, or we broke.
    if (distinct(refined) === G.n) refined = comm;
    const { G: G2, map } = aggregate(G, refined);
    const comm2 = new Int32Array(G2.n);
    for (let v = 0; v < G.n; v++) comm2[map[v]] = comm[v];
    top = top.map((t) => map[t]);
    G = G2;
    comm = renumber(comm2);
  }
  return renumber(top.map((t) => comm[t]));
}

/**
 * Leiden at `resolution`, repeated from its own answer until a round no longer raises modularity.
 * Returns a membership over G's nodes, numbered by first appearance.
 */
export function leiden(G, resolution = RESOLUTION) {
  if (G.n === 0) return new Int32Array(0);
  let part = leidenOnce(G, null, resolution);
  let q = modularityOf(G, part, resolution);
  for (let round = 1; round < MAX_ROUNDS; round++) {
    const next = leidenOnce(G, part, resolution);
    const q2 = modularityOf(G, next, resolution);
    if (!(q2 > q + EPS)) break;
    part = next;
    q = q2;
  }
  return part;
}

// --- the splits -----------------------------------------------------------------------------------

/** Cohesion of a node set: the node pairs joined by an edge ÷ every pair. 1 for one node. */
export function cohesionOf(G, members) {
  const n = members.length;
  if (n <= 1) return 1;
  const inside = new Uint8Array(G.n);
  for (const v of members) inside[v] = 1;
  let actual = 0;
  for (const v of members) for (const u of G.nbr[v]) if (u > v && inside[u]) actual++;
  return actual / ((n * (n - 1)) / 2);
}

/** The subgraph `members` induces, in members' own order, or null when it has no edge. */
function subgraph(G, members) {
  const local = new Map(members.map((v, i) => [v, i]));
  const pairs = new Map();
  for (const v of members) {
    const nb = G.nbr[v];
    const ws = G.wt[v];
    for (let i = 0; i < nb.length; i++) {
      const u = nb[i];
      if (u > v && local.has(u)) addPair(pairs, members.length, local.get(v), local.get(u), ws[i]);
    }
  }
  return pairs.size ? makeGraph(members.length, pairs) : null;
}

function groupsOf(memb) {
  const groups = [];
  for (let v = 0; v < memb.length; v++) (groups[memb[v]] ??= []).push(v);
  return groups.filter(Boolean);
}

/** Why `group` must be clustered again: "large", "loose", or null when it may stand. */
export function splitReason(G, group) {
  if (group.length >= LARGE_MIN_FILES && group.length > LARGE_SHARE * G.n) return "large";
  if (group.length >= LOOSE_MIN_FILES && cohesionOf(G, group) < LOOSE_COHESION) return "loose";
  return null;
}

/**
 * Apply the two rules until every group stands. A group with a reason is clustered again on its
 * own subgraph and its parts are judged in turn; one that comes back whole stays whole, so this
 * ends. Takes and returns lists of node indices, each sorted. Exported so the rules can be tested
 * on a grouping chosen by hand.
 */
export function settleGroups(G, groups, resolution = RESOLUTION) {
  const pending = groups.map((g) => [...g].sort((a, b) => a - b)).reverse();
  const out = [];
  while (pending.length) {
    const g = pending.pop();
    const sub = splitReason(G, g) ? subgraph(G, g) : null;
    const parts = sub ? groupsOf(leiden(sub, resolution)) : [];
    if (parts.length < 2) {
      out.push(g);
      continue;
    }
    for (let i = parts.length - 1; i >= 0; i--) pending.push(parts[i].map((v) => g[v]));
  }
  return out;
}


// --- the index's view -----------------------------------------------------------------------------

/**
 * The cluster graph of an index: every indexed file that is an end of an in-repo import edge, in
 * path order, and one weighted pair per pair of files that import each other in either direction.
 */
export function clusterGraph({ files = [], edges = [] }) {
  const known = new Set(files.map((f) => f.path));
  const ends = new Set();
  for (const e of edges) {
    if (e.from === e.to || !known.has(e.from) || !known.has(e.to)) continue;
    ends.add(e.from);
    ends.add(e.to);
  }
  const paths = [...ends].sort(byCodeUnit);
  const id = new Map(paths.map((p, i) => [p, i]));
  const pairs = new Map();
  // The edges are summed in a sorted order, so even a weight that is not an integer adds up to the
  // same float on every run.
  const rows = edges
    .filter((e) => e.from !== e.to && id.has(e.from) && id.has(e.to))
    .map((e) => [id.get(e.from), id.get(e.to), edgeWeight(e)])
    .sort((x, y) => Math.min(x[0], x[1]) - Math.min(y[0], y[1]) || Math.max(x[0], x[1]) - Math.max(y[0], y[1]) || x[2] - y[2]);
  for (const [a, b, w] of rows) if (w > 0) addPair(pairs, paths.length, a, b, w);
  return { paths, graph: makeGraph(paths.length, pairs) };
}

/**
 * clustersOf(index) → { clusters, byPath }
 *
 * `clusters` is what `index.clusters` holds: `{ algorithm, resolution, unclustered, items }`, each
 * item `{ id, hub, size, cohesion, areas, files }`, `c1` the largest. `byPath` maps each clustered
 * file to its id, for the builder to write onto the file.
 */
export function clustersOf(index) {
  const files = index.files ?? [];
  const { paths, graph } = clusterGraph({ files, edges: index.edges ?? [] });
  const clustered = new Set(paths);
  const unclustered = files.filter(
    (f) => (f.category === "code" || f.category === "script") && !clustered.has(f.path),
  ).length;
  const groups = paths.length ? settleGroups(graph, groupsOf(leiden(graph))) : [];
  const degree = (v) => graph.nbr[v].length;
  const hubOf = (g) => g.reduce((h, v) => (degree(v) > degree(h) || (degree(v) === degree(h) && byCodeUnit(paths[v], paths[h]) < 0) ? v : h), g[0]);
  const rows = groups.map((g) => ({ g, hub: paths[hubOf(g)] }));
  rows.sort((a, b) => b.g.length - a.g.length || byCodeUnit(a.hub, b.hub));
  const byPath = new Map();
  const items = rows.map(({ g, hub }, i) => {
    const id = `c${i + 1}`;
    const members = g.map((v) => paths[v]).sort(byCodeUnit);
    const areaCount = new Map();
    for (const p of members) {
      byPath.set(p, id);
      const k = layerKeyFor(p);
      areaCount.set(k, (areaCount.get(k) ?? 0) + 1);
    }
    const areas = {};
    for (const k of [...areaCount.keys()].sort(byCodeUnit)) areas[k] = areaCount.get(k);
    return {
      id,
      hub,
      size: members.length,
      cohesion: Number(cohesionOf(graph, g).toFixed(COHESION_DECIMALS)),
      areas,
      files: members,
    };
  });
  return {
    clusters: { algorithm: "leiden", resolution: RESOLUTION, unclustered, items },
    byPath,
  };
}
