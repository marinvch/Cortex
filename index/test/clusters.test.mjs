import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./tmp.mjs";
import { buildIndex } from "../lib/build.mjs";
import {
  clustersOf,
  clusterGraph,
  leiden,
  modularityOf,
  cohesionOf,
  splitReason,
  settleGroups,
  edgeWeight,
  LARGE_SHARE,
  LARGE_MIN_FILES,
  LOOSE_COHESION,
  LOOSE_MIN_FILES,
  UNSURE_WEIGHT,
} from "../lib/clusters.mjs";

const code = (path) => ({ path, category: "code" });

/** k files under `dir`, every pair importing one way. */
function clique(dir, k, files, edges) {
  for (let i = 0; i < k; i++) files.push(code(`${dir}/f${i}.js`));
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) edges.push({ from: `${dir}/f${i}.js`, to: `${dir}/f${j}.js` });
}

function twoCliques() {
  const files = [];
  const edges = [];
  clique("a", 5, files, edges);
  clique("b", 5, files, edges);
  edges.push({ from: "a/f0.js", to: "b/f0.js" });
  return { files, edges };
}

// Zachary's karate club, the standard check for a modularity method: its best partition has four
// communities and modularity 0.4198.
const KARATE = [[2,1],[3,1],[3,2],[4,1],[4,2],[4,3],[5,1],[6,1],[7,1],[7,5],[7,6],[8,1],[8,2],[8,3],[8,4],[9,1],[9,3],[10,3],[11,1],[11,5],[11,6],[12,1],[13,1],[13,4],[14,1],[14,2],[14,3],[14,4],[17,6],[17,7],[18,1],[18,2],[20,1],[20,2],[22,1],[22,2],[26,24],[26,25],[28,3],[28,24],[28,25],[29,3],[30,24],[30,27],[31,2],[31,9],[32,1],[32,25],[32,26],[32,29],[33,3],[33,9],[33,15],[33,16],[33,19],[33,21],[33,23],[33,24],[33,30],[33,31],[33,32],[34,9],[34,10],[34,14],[34,15],[34,16],[34,19],[34,20],[34,21],[34,23],[34,24],[34,27],[34,28],[34,29],[34,30],[34,31],[34,32],[34,33]];
const kp = (i) => `n${String(i).padStart(2, "0")}.js`;
function karate() {
  return {
    files: Array.from({ length: 34 }, (_, i) => code(kp(i + 1))),
    edges: KARATE.map(([a, b]) => ({ from: kp(a), to: kp(b) })),
  };
}

/** A deterministic shuffle, so the test is the same on every run. */
function shuffled(list, seed) {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function isConnected(G, members) {
  const inside = new Set(members);
  const seen = new Set([members[0]]);
  const stack = [members[0]];
  while (stack.length) {
    const v = stack.pop();
    for (const u of G.nbr[v]) if (inside.has(u) && !seen.has(u)) {
      seen.add(u);
      stack.push(u);
    }
  }
  return seen.size === members.length;
}

test("two cliques joined by one edge are two clusters, each named by its bridging hub", () => {
  const { clusters, byPath } = clustersOf(twoCliques());
  assert.equal(clusters.algorithm, "leiden");
  assert.equal(clusters.resolution, 1);
  assert.equal(clusters.items.length, 2);
  const [c1, c2] = clusters.items;
  assert.deepEqual([c1.id, c1.hub, c1.size, c1.cohesion], ["c1", "a/f0.js", 5, 1]);
  assert.deepEqual([c2.id, c2.hub, c2.size, c2.cohesion], ["c2", "b/f0.js", 5, 1]);
  assert.deepEqual(c1.files, ["a/f0.js", "a/f1.js", "a/f2.js", "a/f3.js", "a/f4.js"]);
  assert.equal(byPath.get("a/f3.js"), "c1");
  assert.equal(byPath.get("b/f3.js"), "c2");
});

test("Leiden finds the best known partition of the karate club, and every cluster is connected", () => {
  const { graph } = clusterGraph(karate());
  const m = leiden(graph);
  assert.equal(new Set(m).size, 4);
  assert.ok(modularityOf(graph, m) > 0.4197, `modularity ${modularityOf(graph, m)}`);
  const groups = new Map();
  for (let v = 0; v < m.length; v++) groups.set(m[v], [...(groups.get(m[v]) ?? []), v]);
  for (const g of groups.values()) assert.ok(isConnected(graph, g), "Leiden's guarantee: no cluster in pieces");
});

/** `groups` × `size` files, each pair joined with chance `pin` inside a group and `pout` across. */
function planted(groups, size, pin, pout, seed) {
  let s = seed;
  const roll = () => ((s = (s * 1103515245 + 12345) % 2147483648), s % 1000);
  const p = (i) => `g${String(Math.floor(i / size)).padStart(3, "0")}/f${String(i % size).padStart(3, "0")}.js`;
  const n = groups * size;
  const files = Array.from({ length: n }, (_, i) => code(p(i)));
  const edges = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (roll() < (Math.floor(i / size) === Math.floor(j / size) ? pin : pout) * 1000) edges.push({ from: p(i), to: p(j) });
  }
  return { files, edges };
}

test("on a weak planted partition, refinement, re-queueing and repeated rounds each earn their keep", () => {
  // Karate is easy enough that a plain greedy pass finds the optimum. This graph is not: dropping
  // the refinement, the re-queue of a moved node's neighbours, or the repeat rounds each scored
  // between 0.363 and 0.391 on it, and letting a tie move scored 0.393.
  const { graph } = clusterGraph(planted(8, 25, 0.15, 0.02, 4));
  const m = leiden(graph);
  assert.ok(modularityOf(graph, m) >= 0.3953, `modularity ${modularityOf(graph, m).toFixed(4)}`);
  const groups = new Map();
  for (let v = 0; v < m.length; v++) groups.set(m[v], [...(groups.get(m[v]) ?? []), v]);
  for (const g of groups.values()) assert.ok(isConnected(graph, g));
});

test("the answer does not depend on the order files and edges arrive in, nor on edge direction", () => {
  const base = karate();
  const want = JSON.stringify(clustersOf(base).clusters);
  for (const seed of [1, 7, 42, 99, 2024]) {
    const files = shuffled(base.files, seed);
    const edges = shuffled(base.edges, seed + 1).map((e, i) => (i % 2 ? { from: e.to, to: e.from } : e));
    assert.equal(JSON.stringify(clustersOf({ files, edges }).clusters), want, `seed ${seed}`);
  }
});

test("paths are ordered by code unit, never by locale", () => {
  // localeCompare puts "B" after "a"; code-unit order puts it first. The hub tie below is decided
  // by that order, so a locale-dependent sort would name a different hub on another machine.
  const files = [code("a.js"), code("B.js"), code("x.js")];
  const edges = [{ from: "x.js", to: "a.js" }, { from: "x.js", to: "B.js" }, { from: "a.js", to: "B.js" }];
  const { paths } = clusterGraph({ files, edges });
  assert.deepEqual(paths, ["B.js", "a.js", "x.js"]);
  assert.equal(clustersOf({ files, edges }).clusters.items[0].hub, "B.js");
});

test("an import each way weighs 2, an ambiguous one 0.5, and a self-import or an unindexed end nothing", () => {
  assert.equal(edgeWeight({}), 1);
  assert.equal(edgeWeight({ confidence: "extracted" }), 1);
  assert.equal(edgeWeight({ confidence: "ambiguous" }), UNSURE_WEIGHT);
  assert.equal(UNSURE_WEIGHT, 0.5);
  const files = [code("a.js"), code("b.js"), code("c.js")];
  const edges = [
    { from: "a.js", to: "b.js" },
    { from: "b.js", to: "a.js" },
    { from: "b.js", to: "c.js", confidence: "ambiguous" },
    { from: "c.js", to: "c.js" },
    { from: "c.js", to: "gone.js" },
  ];
  const { paths, graph } = clusterGraph({ files, edges });
  assert.deepEqual(paths, ["a.js", "b.js", "c.js"]);
  assert.deepEqual([...graph.wt[0]], [2]);
  assert.deepEqual([...graph.nbr[1]], [0, 2]);
  assert.deepEqual([...graph.wt[1]], [2, 0.5]);
  assert.equal(graph.self[2], 0, "a self-import adds no weight");
  assert.equal(graph.m2, 5);
  // A file whose only import is itself has no edge, so it is not a node and counts as unclustered.
  const selfOnly = clustersOf({ files: [code("x.js")], edges: [{ from: "x.js", to: "x.js" }] }).clusters;
  assert.deepEqual([selfOnly.items.length, selfOnly.unclustered], [0, 1]);
});

test("cohesion counts pairs, not edges, and rounds to three places", () => {
  const files = [code("a.js"), code("b.js"), code("c.js"), code("d.js")];
  const path4 = [{ from: "a.js", to: "b.js" }, { from: "b.js", to: "a.js" }, { from: "b.js", to: "c.js" }, { from: "c.js", to: "d.js" }];
  const { graph } = clusterGraph({ files, edges: path4 });
  assert.equal(cohesionOf(graph, [0, 1, 2, 3]), 3 / 6, "a both-ways pair is one pair: 3 of 6");
  assert.equal(cohesionOf(graph, [0, 1]), 1);
  assert.equal(cohesionOf(graph, [2]), 1, "one file is fully cohesive");
  assert.equal(cohesionOf(graph, [0, 2]), 0);
  // A chain of three is one cluster with two of three pairs: 0.6666…, written as 0.667.
  const tri = clustersOf({ files: files.slice(0, 3), edges: [{ from: "a.js", to: "b.js" }, { from: "b.js", to: "c.js" }] });
  assert.equal(tri.clusters.items.length, 1);
  assert.equal(tri.clusters.items[0].cohesion, 0.667);
});

test("a large cluster is one over a quarter of the clustered files and at least ten", () => {
  assert.equal(LARGE_SHARE, 0.25);
  assert.equal(LARGE_MIN_FILES, 10);
  const G = (n) => ({ n, nbr: Array.from({ length: n }, () => new Int32Array(0)) });
  const range = (k) => Array.from({ length: k }, (_, i) => i);
  assert.equal(splitReason(G(40), range(11)), "large", "11 of 40 is over a quarter");
  assert.equal(splitReason(G(40), range(10)), null, "10 of 40 is exactly a quarter, not over");
  assert.equal(splitReason(G(12), range(10)), "large", "10 of 12, and ten files");
  assert.equal(splitReason(G(12), range(9)), null, "nine files is under the floor however big a share");
});

test("a loose cluster is fifty files or more with cohesion under 0.05", () => {
  assert.equal(LOOSE_COHESION, 0.05);
  assert.equal(LOOSE_MIN_FILES, 50);
  // A ring: k pairs among k·(k−1)/2, so 2/(k−1). 60 files → 0.034; the graph is large enough
  // that the ring is not over a quarter of it.
  const ring = (k, n) => {
    const nbr = Array.from({ length: n }, () => []);
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k;
      nbr[i].push(j);
      nbr[j].push(i);
    }
    return { n, nbr: nbr.map((l) => Int32Array.from(l.sort((a, b) => a - b))) };
  };
  const range = (k) => Array.from({ length: k }, (_, i) => i);
  assert.equal(splitReason(ring(60, 400), range(60)), "loose");
  assert.equal(splitReason(ring(49, 400), range(49)), null, "49 files is under the floor");
  // Fifty files holding 62 of their 1,225 pairs: cohesion just over the line, so it stands.
  const members = range(50);
  const pairsNeeded = Math.ceil((0.05 * (50 * 49)) / 2);
  const lists = Array.from({ length: 400 }, () => []);
  let made = 0;
  for (let i = 0; i < 50 && made < pairsNeeded; i++) for (let j = i + 1; j < 50 && made < pairsNeeded; j++) {
    lists[i].push(j);
    lists[j].push(i);
    made++;
  }
  const dense = { n: 400, nbr: lists.map((l) => Int32Array.from(l.sort((a, b) => a - b))) };
  assert.ok(cohesionOf(dense, members) >= 0.05);
  assert.equal(splitReason(dense, members), null, "cohesion at or over the line is not loose");
  // 162 of 81 files' 3,240 pairs is exactly 0.05, and on the line is not under it.
  const exact = Array.from({ length: 400 }, () => []);
  made = 0;
  for (let i = 0; i < 81 && made < 162; i++) for (let j = i + 1; j < 81 && made < 162; j++) {
    exact[i].push(j);
    exact[j].push(i);
    made++;
  }
  const onLine = { n: 400, nbr: exact.map((l) => Int32Array.from(l.sort((a, b) => a - b))) };
  assert.equal(cohesionOf(onLine, range(81)), 0.05);
  assert.equal(splitReason(onLine, range(81)), null);
  // And 61 pairs is under it: the same fifty files are loose.
  const less = lists.map((l) => [...l]);
  less[0].pop();
  const dropped = lists[0][lists[0].length - 1];
  less[dropped] = less[dropped].filter((x) => x !== 0);
  const under = { n: 400, nbr: less.map((l) => Int32Array.from(l)) };
  assert.ok(cohesionOf(under, members) < 0.05);
  assert.equal(splitReason(under, members), "loose");
});

test("a large cluster is clustered again on its own subgraph, and one that will not split stays whole", () => {
  const { files, edges } = twoCliques();
  const { graph } = clusterGraph({ files, edges });
  const all = Array.from({ length: graph.n }, (_, i) => i);
  // Handed as one group, the ten files are all of the graph: large, so re-run, and the two cliques
  // come apart.
  const parts = settleGroups(graph, [all]);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((p) => p.length), [5, 5]);
  // A clique of twelve is large too, but nothing inside it splits, so it is kept as it was.
  const k = { files: [], edges: [] };
  clique("k", 12, k.files, k.edges);
  const { graph: kg } = clusterGraph(k);
  const whole = Array.from({ length: 12 }, (_, i) => i);
  assert.deepEqual(settleGroups(kg, [whole]), [whole]);
});

test("a loose cluster is clustered again, end to end", () => {
  // A 60-file chain inside 400 clustered files: not large (60 ≤ 100), but loose.
  const files = [];
  const edges = [];
  for (let i = 0; i < 60; i++) files.push(code(`ring/r${String(i).padStart(2, "0")}.js`));
  for (let i = 0; i < 60; i++) edges.push({ from: files[i].path, to: files[(i + 1) % 60].path });
  for (let p = 0; p < 170; p++) {
    files.push(code(`pair/p${p}a.js`), code(`pair/p${p}b.js`));
    edges.push({ from: `pair/p${p}a.js`, to: `pair/p${p}b.js` });
  }
  const { graph, paths } = clusterGraph({ files, edges });
  const ring = paths.map((p, i) => [p, i]).filter(([p]) => p.startsWith("ring/")).map(([, i]) => i);
  assert.equal(splitReason(graph, ring), "loose");
  const parts = settleGroups(graph, [ring]);
  assert.ok(parts.length > 1, "the chain is cut into runs");
  for (const p of parts) assert.ok(isConnected(graph, p));
  assert.equal(parts.flat().length, 60, "no file lost");
});

test("the hub is the member with the most neighbours, ties by path, and ids run largest first then by hub", () => {
  const files = [code("z/hub.js"), code("z/x.js"), code("z/y.js"), code("m/one.js"), code("m/two.js"), code("m/three.js")];
  const edges = [
    { from: "z/x.js", to: "z/hub.js" },
    { from: "z/y.js", to: "z/hub.js" },
    { from: "z/x.js", to: "z/y.js" },
    { from: "m/one.js", to: "m/two.js" },
    { from: "m/two.js", to: "m/three.js" },
    { from: "m/three.js", to: "m/one.js" },
  ];
  const items = clustersOf({ files, edges }).clusters.items;
  // Both are triangles: equal size, every member degree 2, so each hub is its lowest path and the
  // cluster whose hub sorts first is c1.
  assert.deepEqual(items.map((c) => [c.id, c.hub, c.size]), [["c1", "m/one.js", 3], ["c2", "z/hub.js", 3]]);
  const bigger = clustersOf({ files: [...files, code("z/w.js")], edges: [...edges, { from: "z/w.js", to: "z/x.js" }] }).clusters.items;
  assert.deepEqual(bigger.map((c) => [c.id, c.hub, c.size]), [["c1", "z/x.js", 4], ["c2", "m/one.js", 3]]);
});

test("areas count members per top-level area, keys in order", () => {
  const files = [code("src/billing/a.js"), code("src/billing/b.js"), code("src/ui/c.js"), code("lib.js")];
  // Every pair imports one way, so the four are one cluster across three areas.
  const edges = [];
  for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) edges.push({ from: files[i].path, to: files[j].path });
  const [only] = clustersOf({ files, edges }).clusters.items;
  assert.deepEqual(only.areas, { root: 1, "src/billing": 2, "src/ui": 1 });
  assert.deepEqual(Object.keys(only.areas), ["root", "src/billing", "src/ui"]);
});

test("an empty repo and an edge-free one have no clusters; only code and scripts count as unclustered", () => {
  assert.deepEqual(clustersOf({ files: [], edges: [] }).clusters, { algorithm: "leiden", resolution: 1, unclustered: 0, items: [] });
  assert.deepEqual(clustersOf({}).clusters.items, []);
  const files = [code("a.js"), { path: "run.sh", category: "script" }, { path: "README.md", category: "docs" }, { path: "x.json", category: "config" }];
  const { clusters, byPath } = clustersOf({ files, edges: [] });
  assert.equal(clusters.unclustered, 2);
  assert.deepEqual(clusters.items, []);
  assert.equal(byPath.size, 0);
});

test("the index carries clusters, and every file states its cluster or null", () => {
  const root = tempDir("cortex-clusters-");
  mkdirSync(join(root, "src", "billing"), { recursive: true });
  writeFileSync(join(root, "src", "index.js"), 'import { charge } from "./billing/charge.js";\ncharge();\n');
  writeFileSync(join(root, "src", "billing", "charge.js"), 'import { tax } from "./tax.js";\nexport function charge() { tax(); }\n');
  writeFileSync(join(root, "src", "billing", "tax.js"), "export function tax() {}\n");
  writeFileSync(join(root, "src", "lonely.js"), "export const x = 1;\n");
  writeFileSync(join(root, "README.md"), "# r\n");
  const idx = buildIndex(root);
  assert.equal(idx.clusters.algorithm, "leiden");
  assert.equal(idx.clusters.unclustered, 1);
  const byPath = new Map(idx.files.map((f) => [f.path, f]));
  assert.equal(byPath.get("src/lonely.js").cluster, null);
  assert.equal(byPath.get("README.md").cluster, null);
  assert.equal(byPath.get("src/billing/charge.js").cluster, "c1");
  for (const f of idx.files) assert.ok("cluster" in f, `${f.path} states its cluster`);
  const listed = idx.clusters.items.flatMap((c) => c.files).sort();
  assert.deepEqual(listed, idx.files.filter((f) => f.cluster).map((f) => f.path).sort());
});
