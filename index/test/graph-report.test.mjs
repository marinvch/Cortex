import { test } from "node:test";
import assert from "node:assert/strict";
import {
  graphReport,
  hubsOf,
  bridgesOf,
  topBridges,
  cyclesOf,
  untestedClustersOf,
  glanceLine,
  isProductFile,
  TOP,
  HUB_MIN_LINKS,
} from "../lib/graph-report.mjs";
import { render, analyse } from "../lib/findings.mjs";
import { buildView } from "../lib/view.mjs";
import { inferAreas } from "../lib/layers.mjs";
import { runPage } from "./browser.mjs";
import { textSource } from "../lib/repo-text.mjs";

const file = (path, cluster = null, extra = {}) => ({ path, category: "code", lang: "javascript", cluster, isTest: false, ...extra });
const edge = (from, to, extra = {}) => ({ from, to, type: "imports", ...extra });

/** An index from files and edges, with clusters built from the files' `cluster` fields. */
function idx(files, edges, cycles = []) {
  const byId = new Map();
  for (const f of files) if (f.cluster) (byId.get(f.cluster) ?? byId.set(f.cluster, []).get(f.cluster)).push(f.path);
  const items = [...byId].map(([id, paths]) => ({ id, hub: paths[0], size: paths.length, cohesion: 1, areas: {}, files: paths.sort() }));
  return { files, edges, cycles, clusters: { algorithm: "leiden", resolution: 1, unclustered: 0, items } };
}

/** A star: `center` imported by `n` leaves, all in cluster `c`. */
function star(center, n, c, files, edges, leafDir = center.replace(/[^/]*$/, "")) {
  files.push(file(center, c));
  for (let i = 0; i < n; i++) {
    const leaf = `${leafDir}leaf${i}.js`;
    files.push(file(leaf, c));
    edges.push(edge(leaf, center));
  }
}

// ── which files count ─────────────────────────────────────────────────────────────────────────────

test("tests, fixtures, test helpers and vendored files are never product files", () => {
  assert.equal(isProductFile(file("src/a.js")), true);
  assert.equal(isProductFile(file("src/a.test.js", null, { isTest: true })), false);
  assert.equal(isProductFile(file("src/fixtures/a.js")), false);
  assert.equal(isProductFile(file("src/testing/render.js")), false);
  assert.equal(isProductFile(file("src/__mocks__/fs.js")), false);
  assert.equal(isProductFile(file("vendor/x.js", null, { vendored: true })), false);
  assert.equal(isProductFile(file("pkg/testdata/x.go")), false);
});

// ── hubs ──────────────────────────────────────────────────────────────────────────────────────────

test("hubs rank by distinct neighbours, then importers, then code-unit path order", () => {
  const files = [];
  const edges = [];
  star("src/b.js", 4, "c1", files, edges, "src/b/");
  star("src/a.js", 4, "c2", files, edges, "src/a/");
  star("src/Z.js", 4, "c3", files, edges, "src/z/");
  // src/c.js has five neighbours, but imports four of them: fewer importers cannot outrank links.
  files.push(file("src/c.js", "c4"));
  for (let i = 0; i < 4; i++) {
    files.push(file(`src/c/dep${i}.js`, "c4"));
    edges.push(edge("src/c.js", `src/c/dep${i}.js`, {}));
  }
  edges.push(edge("src/c/dep0.js", "src/c/dep1.js"));
  files.push(file("src/c/user.js", "c4"));
  edges.push(edge("src/c/user.js", "src/c.js"));
  // src/A.js ties the stars on four links, with two importers to their four.
  files.push(file("src/A.js", "c5"), ...["w", "x", "y", "z"].map((n) => file(`src/A/${n}.js`, "c5")));
  edges.push(edge("src/A/w.js", "src/A.js"), edge("src/A/x.js", "src/A.js"), edge("src/A.js", "src/A/y.js"), edge("src/A.js", "src/A/z.js"));
  const hubs = hubsOf(idx(files, edges));
  assert.deepEqual(hubs.map((h) => h.path), ["src/c.js", "src/Z.js", "src/a.js", "src/b.js", "src/A.js"]);
  assert.deepEqual(hubs[0], { path: "src/c.js", cluster: "c4", links: 5, inbound: 1, twins: [] });
  assert.equal(hubs[1].inbound, 4);
  assert.equal(hubs[4].inbound, 2);
});

test("a file with two links is not a hub, and one with three is", () => {
  const files = [];
  const edges = [];
  star("a/two.js", 2, "c1", files, edges);
  star("b/three.js", 3, "c2", files, edges);
  assert.deepEqual(hubsOf(idx(files, edges)).map((h) => [h.path, h.links]), [["b/three.js", 3]]);
});

test("a test importing a file does not make it a hub, and nor does a fixture or a vendored file", () => {
  const files = [file("src/core.js", "c1"), file("src/one.js", "c1")];
  const edges = [edge("src/one.js", "src/core.js")];
  for (let i = 0; i < 5; i++) {
    files.push(file(`test/t${i}.test.js`, "c1", { isTest: true }));
    edges.push(edge(`test/t${i}.test.js`, "src/core.js"));
  }
  files.push(file("src/fixtures/f.js", "c1"), file("src/testing/h.js", "c1"), file("lib/v.js", "c1", { vendored: true }));
  edges.push(edge("src/fixtures/f.js", "src/core.js"), edge("src/testing/h.js", "src/core.js"), edge("lib/v.js", "src/core.js"));
  assert.deepEqual(hubsOf(idx(files, edges)), [], "one product neighbour is below the floor");
});

test(`a hub needs ${HUB_MIN_LINKS} links, and at most ${TOP} are listed`, () => {
  const files = [];
  const edges = [];
  for (let i = 0; i < TOP + 2; i++) star(`s${String(i).padStart(2, "0")}/hub.js`, HUB_MIN_LINKS + (i % 3), `c${i}`, files, edges);
  star("small/hub.js", HUB_MIN_LINKS - 1, "cx", files, edges);
  const hubs = hubsOf(idx(files, edges));
  assert.equal(hubs.length, TOP);
  assert.ok(hubs.every((h) => h.links >= HUB_MIN_LINKS));
  assert.ok(!hubs.some((h) => h.path === "small/hub.js"));
});

test("files with the same importers and the same imports are one hub row; direction counts", () => {
  // A Go-style package import: three importers each linked to every file of `util/`.
  const files = [file("util/a.go", "c1"), file("util/b.go", "c2"), file("util/c.go", "c1")];
  const edges = [];
  for (const user of ["x.go", "y.go", "z.go"]) {
    files.push(file(user, "c3"));
    for (const u of ["util/a.go", "util/b.go", "util/c.go"]) edges.push(edge(user, u));
  }
  // q.go has the same three neighbours as util/*.go but IMPORTS them rather than being imported.
  files.push(file("q.go", "c1"));
  for (const user of ["x.go", "y.go", "z.go"]) edges.push(edge("q.go", user));
  const hubs = hubsOf(idx(files, edges));
  const util = hubs.find((h) => h.path === "util/a.go");
  assert.deepEqual(util.twins, ["util/b.go", "util/c.go"], "twins may sit in other clusters");
  assert.ok(!hubs.some((h) => h.path === "util/b.go" || h.path === "util/c.go"), "and take no row of their own");
  assert.ok(hubs.some((h) => h.path === "q.go"), "an importer is not a twin of what it imports");
});

// ── bridges ───────────────────────────────────────────────────────────────────────────────────────

test("a bridge is an import between two clusters; inside one cluster or to an unclustered file is not", () => {
  const files = [file("src/a.js", "c1"), file("src/b.js", "c1"), file("src/c.js", "c2"), file("src/d.js", null)];
  const edges = [edge("src/a.js", "src/b.js"), edge("src/a.js", "src/c.js"), edge("src/a.js", "src/d.js")];
  const b = bridgesOf(idx(files, edges));
  assert.deepEqual(b.map((x) => [x.from, x.to]), [["src/a.js", "src/c.js"]]);
  assert.equal(b[0].score, 1);
  assert.deepEqual(b[0].reasons, ["crosses clusters: c1 to c2"]);
});

test("crossing areas adds 2, and the area is layerKeyFor's", () => {
  const files = [file("src/core/a.js", "c1"), file("src/ui/b.js", "c2"), file("src/core/c.js", "c3")];
  const edges = [edge("src/core/a.js", "src/ui/b.js"), edge("src/core/a.js", "src/core/c.js")];
  const b = bridgesOf(idx(files, edges));
  assert.equal(b[0].to, "src/ui/b.js");
  assert.equal(b[0].score, 3);
  assert.equal(b[0].reasons[0], "crosses areas: src/core to src/ui");
  assert.equal(b[1].score, 1);
});

test("a target imported from 3 other clusters is a shared dependency, and 2 is not", () => {
  const build = (users) => {
    const files = [file("lib/util.js", "c0")];
    const edges = [];
    for (let i = 1; i <= users; i++) {
      files.push(file(`app${i}/main.js`, `c${i}`));
      edges.push(edge(`app${i}/main.js`, "lib/util.js"));
    }
    return bridgesOf(idx(files, edges));
  };
  const shared = build(3);
  assert.ok(shared.every((x) => x.reach === 3 && x.score === 1));
  assert.match(shared[0].reasons.at(-1), /imported from 3 other clusters, so it is a shared dependency/);
  const not = build(2);
  assert.ok(not.every((x) => x.score === 3));
});

test("reach counts the clusters importing a file, not the files", () => {
  const files = [file("lib/util.js", "c0"), file("app/a.js", "c1"), file("app/b.js", "c1"), file("app/c.js", "c1")];
  const edges = [edge("app/a.js", "lib/util.js"), edge("app/b.js", "lib/util.js"), edge("app/c.js", "lib/util.js"), edge("app/c.js", "app/a.js")];
  const b = bridgesOf(idx(files, edges));
  assert.ok(b.length >= 2 && b.every((x) => x.reach === 1 && x.score === 3));
});

test("a re-export scores 2 less, unless an import it stands for is not one", () => {
  const files = [file("src/index.js", "c1"), file("src/feature/x.js", "c2"), file("src/feature/y.js", "c3")];
  const edges = [edge("src/index.js", "src/feature/x.js", { reexport: true }), edge("src/index.js", "src/feature/y.js")];
  const b = bridgesOf(idx(files, edges));
  const x = b.find((r) => r.to === "src/feature/x.js");
  const y = b.find((r) => r.to === "src/feature/y.js");
  assert.equal(x.score, 1);
  assert.match(x.reasons.join("\n"), /re-exports src\/feature\/x\.js/);
  assert.equal(y.score, 3);

  // An import back the other way is not a re-export, so the pair is not either. The barrel sorts
  // first, so its re-export is the edge found first.
  const pair = [file("lib/index.js", "c1"), file("src/x.js", "c2")];
  const both = bridgesOf(idx(pair, [edge("lib/index.js", "src/x.js", { reexport: true }), edge("src/x.js", "lib/index.js")]));
  assert.equal(both.length, 1, "an import both ways is one bridge");
  assert.equal(both[0].from, "lib/index.js");
  assert.equal(both[0].mutual, true);
  assert.equal(both[0].score, 3);
  assert.ok(both[0].reasons.includes("imports both ways"));
});

test("a folded bridge takes the surest weight among the imports it stands for", () => {
  const files = [file("mw/a.js", "c1"), file("mw/b.js", "c1"), file("store/s.js", "c2")];
  const edges = [edge("mw/a.js", "store/s.js", { confidence: "ambiguous" }), edge("mw/b.js", "store/s.js")];
  const [b] = bridgesOf(idx(files, edges));
  assert.equal(b.folded, 1);
  assert.equal(b.score, 3);
});

test("the score is weighted by the edge's confidence, and an edge without one is extracted", () => {
  const files = [file("a/x.js", "c1"), file("b/y.js", "c2"), file("c/z.js", "c3")];
  const b = bridgesOf(idx(files, [edge("a/x.js", "b/y.js", { confidence: "ambiguous" }), edge("a/x.js", "c/z.js")]));
  const unsure = b.find((r) => r.to === "b/y.js");
  const sure = b.find((r) => r.to === "c/z.js");
  assert.equal(unsure.score, 1.5);
  assert.equal(unsure.confidence, "ambiguous");
  assert.match(unsure.reasons.at(-1), /ambiguous edge, weighted 0\.5/);
  assert.equal(sure.confidence, "extracted");
  assert.equal(sure.score, 3);
  assert.deepEqual(b.map((r) => r.to), ["c/z.js", "b/y.js"], "the surer one ranks first");
});

test("ties go to the cluster pair with the fewest bridges, then the target's reach, then path", () => {
  const files = [
    file("src/p.js", "c1"), file("src/q.js", "c1"), file("src/r.js", "c2"), file("src/s.js", "c2"),
    file("src/t.js", "c3"), file("src/u.js", "c4"), file("src/v.js", "c5"),
  ];
  const edges = [
    edge("src/p.js", "src/r.js"), edge("src/q.js", "src/s.js"), // two between c1 and c2
    edge("src/t.js", "src/u.js"), // one between c3 and c4, u reached from 2 clusters
    edge("src/v.js", "src/u.js"), // one between c5 and c4
    edge("src/v.js", "src/t.js"), // one between c5 and c3, t reached from 1 cluster
  ];
  const b = bridgesOf(idx(files, edges));
  assert.deepEqual(
    b.map((r) => `${r.from}>${r.to}`),
    ["src/v.js>src/t.js", "src/t.js>src/u.js", "src/v.js>src/u.js", "src/p.js>src/r.js", "src/q.js>src/s.js"],
  );
  assert.deepEqual(b.map((r) => r.between), [1, 1, 1, 2, 2]);
});

test("twins fold into one bridge only inside one cluster, and the bridge says how many it stands for", () => {
  const files = [file("store.js", "c1"), file("mw/a.js", "c2"), file("mw/b.js", "c2"), file("mw/c.js", "c3"), file("mw.js", "c4")];
  const edges = [];
  for (const m of ["mw/a.js", "mw/b.js", "mw/c.js"]) edges.push(edge(m, "store.js"), edge("mw.js", m));
  const b = bridgesOf(idx(files, edges)).filter((r) => r.to === "store.js");
  assert.deepEqual(b.map((r) => r.from), ["mw/a.js", "mw/c.js"], "mw/c.js shares the links but not the cluster");
  assert.equal(b[0].folded, 1);
  assert.match(b[0].reasons.at(-1), /stands for 1 more import between files with the same links/);
  assert.equal(b[1].folded, 0);
});

test("the top bridges are one row per importing file, each saying how many more leave it", () => {
  const files = [file("main.go", "c0")];
  const edges = [];
  for (let i = 1; i <= 15; i++) {
    files.push(file(`src/f${String(i).padStart(2, "0")}.go`, `c${i}`));
    edges.push(edge("main.go", `src/f${String(i).padStart(2, "0")}.go`));
  }
  files.push(file("src/g.go", "c20"), file("lib/h.go", "c21"));
  edges.push(edge("src/g.go", "lib/h.go"));
  const ranked = bridgesOf(idx(files, edges));
  const top = topBridges(ranked);
  assert.deepEqual(top.map((r) => r.from), ["main.go", "src/g.go"]);
  assert.equal(top[0].alsoFrom, 14);
  assert.equal(top[1].alsoFrom, 0);
  assert.ok(!("alsoFrom" in ranked[0]), "the ranking itself is not changed");

  const many = [];
  for (let i = 0; i < TOP + 3; i++) many.push({ from: `f${i}`, to: "x" });
  assert.equal(topBridges(many).length, TOP);
});

test("a test, a fixture or a test helper never forms a bridge", () => {
  const files = [
    file("src/a.js", "c1"), file("test/a.test.js", "c2", { isTest: true }),
    file("src/testing/render.js", "c3"), file("src/fixtures/data.js", "c4"),
  ];
  const edges = [edge("test/a.test.js", "src/a.js"), edge("src/testing/render.js", "src/a.js"), edge("src/a.js", "src/fixtures/data.js")];
  assert.deepEqual(bridgesOf(idx(files, edges)), []);
});

// ── cycles ────────────────────────────────────────────────────────────────────────────────────────

test("cycles come back as groups with a shortest loop, shortest loop first, then the smaller group", () => {
  const files = ["a", "b", "c", "d", "e", "m", "n", "o", "p", "q", "r", "s", "x", "y"].map((n) => file(`${n}.js`));
  const edges = [
    // a → b → c → d → a, with a shortcut c → a: the shortest loop is a → b → c.
    edge("a.js", "b.js"), edge("b.js", "c.js"), edge("c.js", "d.js"), edge("d.js", "a.js"), edge("c.js", "a.js"),
    edge("m.js", "n.js"), edge("n.js", "o.js"), edge("o.js", "m.js"),
    // Every loop through p has four files; r and s import each other, so the shortest has two.
    edge("p.js", "q.js"), edge("q.js", "r.js"), edge("r.js", "s.js"), edge("s.js", "p.js"), edge("s.js", "r.js"),
    edge("x.js", "y.js"), edge("y.js", "x.js"),
    edge("e.js", "a.js"), // into the cycle, not part of it
  ];
  const cyclic = ["a", "b", "c", "d", "m", "n", "o", "p", "q", "r", "s", "x", "y"].map((n) => `${n}.js`);
  // e.js is listed as cyclic, as an index older than its edges might say; it has no loop.
  const cycles = cyclesOf({ files, edges, cycles: [...cyclic, "e.js"] });
  assert.deepEqual(cycles, [
    { files: ["x.js", "y.js"], loop: ["x.js", "y.js"] },
    { files: ["p.js", "q.js", "r.js", "s.js"], loop: ["r.js", "s.js"] },
    { files: ["m.js", "n.js", "o.js"], loop: ["m.js", "n.js", "o.js"] },
    { files: ["a.js", "b.js", "c.js", "d.js"], loop: ["a.js", "b.js", "c.js"] },
  ]);
  assert.deepEqual(cyclesOf({ files, edges, cycles: [] }), [], "only what the index calls cyclic");
});

test("a cycle of fixtures only is counted, not listed; one product file is enough to list it", () => {
  const files = [
    file("src/a.js"), file("src/b.js"),
    file("test/fixtures/x.js"), file("test/fixtures/y.js"),
    file("src/testing/h.js"), file("src/c.js"),
  ];
  const edges = [
    edge("src/a.js", "src/b.js"), edge("src/b.js", "src/a.js"),
    edge("test/fixtures/x.js", "test/fixtures/y.js"), edge("test/fixtures/y.js", "test/fixtures/x.js"),
    edge("src/testing/h.js", "src/c.js"), edge("src/c.js", "src/testing/h.js"),
  ];
  const r = graphReport(idx(files, edges, files.map((f) => f.path)));
  assert.deepEqual(r.cycles.map((c) => c.files), [["src/a.js", "src/b.js"], ["src/c.js", "src/testing/h.js"]]);
  assert.equal(r.testCycles, 1);
  assert.equal(r.cycleFiles, 4);
});

// ── untested clusters ─────────────────────────────────────────────────────────────────────────────

test("a cluster is untested when no member that needs a test has one", () => {
  const index = idx(
    [file("a/x.js", "c1"), file("a/y.js", "c1"), file("b/x.js", "c2"), file("b/y.js", "c2"), file("t/x.test.js", "c3", { isTest: true })],
    [],
  );
  const coverage = { testable: ["a/x.js", "a/y.js", "b/x.js", "b/y.js"], untested: ["a/x.js", "a/y.js", "b/y.js"] };
  assert.deepEqual(untestedClustersOf(index, coverage), [{ id: "c1", hub: "a/x.js", size: 2, testable: 2 }]);
  assert.equal(graphReport(index).untestedClusters, null, "no coverage passed is 'not asked', never 'none'");
});

// ── the whole report ──────────────────────────────────────────────────────────────────────────────

test("the report is the same bytes whatever order the index lists its files and edges in", () => {
  const files = [];
  const edges = [];
  star("src/core.js", 5, "c1", files, edges, "src/core/");
  star("ui/app.js", 4, "c2", files, edges, "ui/");
  edges.push(edge("ui/app.js", "src/core.js"), edge("ui/leaf0.js", "src/core/leaf1.js"), edge("src/core/leaf2.js", "ui/leaf3.js"));
  // Both ways: which direction names the bridge must not depend on which edge was listed first.
  edges.push(edge("src/core.js", "ui/app.js"));
  const a = idx(files, edges, ["src/core/leaf2.js", "ui/leaf3.js"]);
  const b = idx([...files].reverse(), [...edges].reverse(), [...a.cycles].reverse());
  b.clusters = a.clusters;
  assert.equal(JSON.stringify(graphReport(a)), JSON.stringify(graphReport(b)));
});

test("the glance line names clusters, the top hubs and cycles, and is absent without clusters", () => {
  const files = [];
  const edges = [];
  star("src/core.js", 4, "c1", files, edges, "src/core/");
  const r = graphReport(idx(files, edges));
  assert.equal(glanceLine(r), "- 1 import cluster; most linked: `src/core.js`; no import cycles");
  assert.equal(glanceLine(graphReport({ files, edges })), null);
});

// ── where it shows ────────────────────────────────────────────────────────────────────────────────

function fullIndex() {
  const files = [];
  const edges = [];
  star("src/core.js", 4, "c1", files, edges, "src/core/");
  star("ui/app.js", 3, "c2", files, edges, "ui/");
  edges.push(edge("ui/app.js", "src/core.js"));
  for (const f of files) Object.assign(f, { lines: 5, commits: 1, isEntry: false, imports: [], inbound: 0 });
  for (const e of edges) files.find((f) => f.path === e.from).imports.push(e.to);
  const index = idx(files, edges);
  return {
    ...index,
    version: 2,
    commit: "abc1234",
    stats: { files: files.length, lines: 5 * files.length, edges: edges.length, tests: 0, languages: { javascript: files.length }, categories: { code: files.length } },
    areas: inferAreas(files),
    layers: [],
  };
}

test("the findings glance gains one line, and the findings and offers do not move (ADR 0006)", () => {
  const index = fullIndex();
  const root = "/nonexistent-cortex-root";
  const with_ = analyse(index, root, { text: textSource(null) });
  const without = analyse({ ...index, clusters: undefined }, root, { text: textSource(null) });
  assert.deepEqual(with_, without, "the graph report adds no finding and no offer");
  const a = render(index, with_, { day: "2026-10-25" }).split("\n");
  const b = render({ ...index, clusters: undefined }, without, { day: "2026-10-25" }).split("\n");
  const added = a.filter((l) => !b.includes(l));
  assert.deepEqual(added, ["- 2 import clusters; most linked: `src/core.js`, `ui/app.js`; no import cycles"]);
  assert.equal(a.length, b.length + 1);
});

test("the viewer carries the report on the Areas tab, under the clusters, and null without clusters", () => {
  const index = fullIndex();
  const v = buildView(index, "/tmp/x");
  assert.deepEqual(v.graph.hubs.map((h) => h.path), ["src/core.js", "ui/app.js"]);
  assert.equal(v.graph.bridgeCount, 1);
  assert.deepEqual(v.graph.bridges[0].reasons, ["crosses areas: ui to src", "crosses clusters: c2 to c1"]);
  assert.equal(buildView({ ...index, clusters: undefined }, "/tmp/x").graph, null);

  const page = runPage(v);
  const html = page.html("apane");
  assert.ok(html.indexOf("Clusters") < html.indexOf("Hubs"), "the report sits under the cluster table");
  for (const h of ["Hubs", "Bridges", "Import cycles"]) assert.match(html, new RegExp(`<h2 class="vh">${h}`));
  assert.match(html, /data-go="ui\/app\.js"/, "every path opens its file");
});
