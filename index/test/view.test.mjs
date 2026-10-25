import { test } from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildView } from "../lib/view.mjs";
import { buildOverview } from "../lib/overview.mjs";
import { inferAreas, layerKeyFor } from "../lib/layers.mjs";
import { renderHtml, THEMES, CONTRAST } from "../lib/view-html.mjs";
import { runPage, runOverview } from "./browser.mjs";
import { bothLayouts, ENTRIES } from "../../core/test/memory-fixture.js";

function idx(over = {}) {
  return {
    version: "1",
    root: "/tmp/x",
    commit: "abc",
    stats: { files: 4, lines: 100, edges: 2, tests: 1, languages: { javascript: 4 }, skipped: [] },
    files: [
      { path: "src/a.js", lang: "javascript", category: "code", lines: 40, commits: 9, isTest: false, isEntry: true, imports: ["src/b.js"], inbound: 0 },
      { path: "src/b.js", lang: "javascript", category: "code", lines: 30, commits: 3, isTest: false, isEntry: false, imports: [], inbound: 1 },
      { path: "src/lonely.js", lang: "javascript", category: "code", lines: 10, commits: 1, isTest: false, isEntry: false, imports: [], inbound: 0 },
      { path: "README.md", lang: "markdown", category: "docs", lines: 20, commits: 5, isTest: false, isEntry: false, imports: [], inbound: 0 },
    ],
    edges: [{ from: "src/a.js", to: "src/b.js", type: "imports" }],
    areas: [{ id: "area:src", name: "src", description: "Files under src/", paths: ["src/a.js", "src/b.js", "src/lonely.js"] }],
    layers: [{ depth: 0, paths: ["src/b.js"] }, { depth: 1, paths: ["src/a.js"] }],
    cycles: [],
    stack: {},
    ...over,
  };
}

test("only files that can have import edges reach the Map", () => {
  const v = buildView(idx(), "/tmp/x");
  const mapped = v.nodes.filter((n) => n.inMap).map((n) => n.id);
  assert.ok(mapped.includes("src/a.js"));
  assert.ok(!mapped.includes("README.md"), "docs are searchable but not drawn");
  // They are still present as nodes, because the Files tab lists everything.
  assert.ok(v.nodes.some((n) => n.id === "README.md"));
});

test("a legend swatch and its nodes share one colour", () => {
  const v = buildView(idx(), "/tmp/x");
  const area = v.areas.find((a) => a.name === "src");
  for (const n of v.nodes.filter((n) => n.inMap && n.area === "src")) {
    assert.equal(n.color, area.color, `${n.id} matches its legend swatch`);
  }
});

test("no two drawn areas share a swatch while the palette has room", () => {
  // Colouring across every area — including the many that never draw — wrapped the palette early
  // and gave two legend rows the same colour. Only mapped areas get a hue.
  const many = idx({
    files: [
      ...Array.from({ length: 9 }, (_, i) => ({
        path: `docsonly${i}/README.md`, lang: "markdown", category: "docs",
        lines: 1, commits: 1, isTest: false, isEntry: false, imports: [], inbound: 0,
      })),
      { path: "core/a.js", lang: "javascript", category: "code", lines: 1, commits: 1, isTest: false, isEntry: false, imports: [], inbound: 0 },
      { path: "web/b.js", lang: "javascript", category: "code", lines: 1, commits: 1, isTest: false, isEntry: false, imports: [], inbound: 0 },
      { path: "tools/c.sh", lang: "shell", category: "script", lines: 1, commits: 1, isTest: false, isEntry: false, imports: [], inbound: 0 },
    ],
    edges: [],
    areas: [],
  });
  const drawn = buildView(many, "/tmp/x").nodes.filter((n) => n.inMap);
  const byArea = new Map(drawn.map((n) => [n.area, n.color]));
  assert.equal(byArea.size, 3);
  assert.equal(new Set(byArea.values()).size, 3, "three drawn areas, three distinct colours");
});

test("cycles are a flat list of paths, not a list of cycles", () => {
  // index.cycles is depth.cyclic — every path sitting in a strongly connected component. Reading it
  // as an array of arrays threw `c.map is not a function` and blanked the whole page on the first
  // real repo that had one. ai-os has zero cycles and this fixture used to pass `[]`, so the branch
  // had never executed. Fixtures share the code's blind spots; only a real repo found this.
  const cyclic = idx({ cycles: ["src/a.js", "src/b.js"] });
  const v = buildView(cyclic, "/tmp/x");
  assert.deepEqual(v.gaps.cyclicFiles, ["src/a.js", "src/b.js"]);
  const html = renderHtml(v);
  assert.ok(html.includes("src/a.js"), "the page names them");
  // The KPI counts FILES in cycles, so it must not be labelled "cycles" — two files in one cycle
  // read as two cycles, and the viewer then disagrees with what cortex-index prints for that repo.
  assert.ok(html.includes("<span>in cycles</span>"), "the tile says what it counts");
  assert.ok(!html.includes(">cycles</span>"), "and never calls a file count a cycle count");
});

test("a nested cycle shape still renders — the page never crashes on this field", () => {
  // Defensive rather than speculative: whichever shape reaches it, the field is normalised to
  // strings. A crash here takes down every other tab with it, which is what made this expensive.
  const nested = idx({ cycles: [["src/a.js", "src/b.js"], ["src/c.js"]] });
  const v = buildView(nested, "/tmp/x");
  assert.deepEqual(v.gaps.cyclicFiles, ["src/a.js", "src/b.js", "src/c.js"]);
  assert.ok(renderHtml(v).includes("src/c.js"));
});

test("a barrel file is labelled by its directory, not by index.js", () => {
  // On a React app the map drew a dozen nodes all reading "index.jsx" — every one of them a
  // different component, none of them identifiable. The basename is only a name when it is unique.
  const barrels = idx({
    files: [
      { path: "src/components/Button/index.jsx", lang: "javascript", category: "code", lines: 5, commits: 1, isTest: false, isEntry: false, imports: [], inbound: 1 },
      { path: "src/components/Modal/index.jsx", lang: "javascript", category: "code", lines: 5, commits: 1, isTest: false, isEntry: false, imports: [], inbound: 1 },
      { path: "src/utils/format.js", lang: "javascript", category: "code", lines: 5, commits: 1, isTest: false, isEntry: false, imports: [], inbound: 1 },
    ],
    edges: [],
    areas: [],
  });
  const label = (p) => buildView(barrels, "/tmp/x").nodes.find((n) => n.id === p).label;
  assert.equal(label("src/components/Button/index.jsx"), "Button/index.jsx");
  assert.equal(label("src/components/Modal/index.jsx"), "Modal/index.jsx");
  assert.equal(label("src/utils/format.js"), "format.js", "an ordinary file keeps its plain name");
});

test("links are dropped when either end is not a node", () => {
  const bad = idx({ edges: [{ from: "src/a.js", to: "vendor/ghost.js", type: "imports" }] });
  const v = buildView(bad, "/tmp/x");
  assert.equal(v.links.length, 0);
});

test("orphans exclude entry points and tests, and are stated as questions", () => {
  const v = buildView(idx(), "/tmp/x");
  assert.deepEqual(v.gaps.orphans, ["src/lonely.js"]);
  assert.ok(!v.gaps.orphans.includes("src/a.js"), "an entry point is not an orphan");
});

test("layer depth reaches the node so the graph can be read top-down", () => {
  const v = buildView(idx(), "/tmp/x");
  assert.equal(v.nodes.find((n) => n.id === "src/b.js").depth, 0);
  assert.equal(v.nodes.find((n) => n.id === "src/a.js").depth, 1);
});

test("the same index renders the same bytes", () => {
  const a = renderHtml(buildView(idx(), "/tmp/x"));
  const b = renderHtml(buildView(idx(), "/tmp/x"));
  assert.equal(a, b);
});

test("the page is self-contained — no network, no runtime", () => {
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  assert.ok(!/src\s*=\s*["']https?:/i.test(html), "no remote script");
  assert.ok(!/<link[^>]+href\s*=\s*["']https?:/i.test(html), "no remote stylesheet");
  assert.ok(html.startsWith("<!doctype html>"));
});

test("inlined data cannot end the script element early", () => {
  const nasty = idx();
  const html = renderHtml(
    buildView(nasty, "/tmp/x", {
      enrichment: { summaries: [{ path: "src/a.js", summary: "closes with </script><script>alert(1)</script>" }] },
    })
  );
  const between = html.slice(html.indexOf("const DATA="), html.indexOf("const DATA=") + 4000);
  assert.ok(!between.includes("</script><script>alert"), "the payload is escaped, not emitted");
  assert.ok(html.includes("\\u003c/script"), "< is escaped inside the JSON");
});

test("enrichment is additive — its absence changes only the detail on a card", () => {
  const plain = buildView(idx(), "/tmp/x");
  const rich = buildView(idx(), "/tmp/x", {
    enrichment: { summaries: [{ path: "src/a.js", summary: "the entry point", role: "entry", tags: ["cli"] }] },
  });
  assert.equal(plain.nodes.length, rich.nodes.length);
  assert.equal(plain.links.length, rich.links.length);
  assert.equal(plain.nodes.find((n) => n.id === "src/a.js").summary, "");
  assert.equal(rich.nodes.find((n) => n.id === "src/a.js").summary, "the entry point");
  assert.equal(rich.stats.enriched, 1);
});

test("the light theme cannot rot while the dark one is tuned", () => {
  // The page declares color-scheme:light dark and is opened next to an editor that already made
  // that choice. A token added to one block and not the other renders as an empty string on canvas
  // — which is not an error, just an invisible node. Both blocks must define the same names.
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  const names = (block) => new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const light = html.slice(html.indexOf(":root{"), html.indexOf("@media (prefers-color-scheme:dark)"));
  const dark = html.slice(html.indexOf("@media (prefers-color-scheme:dark)"), html.indexOf("*{box-sizing"));
  const l = names(light), d = names(dark);
  assert.ok(l.size > 10, "the light palette is a full palette, not a stub");
  assert.deepEqual([...l].filter((n) => !d.has(n)), [], "every light token has a dark counterpart");
  assert.deepEqual([...d].filter((n) => !l.has(n)), [], "and every dark token has a light one");
  // The toggle's block is the same palette as the OS-preference block, or choosing "dark" by hand
  // gives a different dark from the one the OS gives.
  const forced = html.slice(html.indexOf(":root[data-theme=dark]{"), html.indexOf("*{box-sizing"));
  assert.ok(forced.length > 20, "there is a block for a dark theme chosen by hand");
  assert.deepEqual([...names(forced)].sort(), [...d].sort(), "and it defines the same tokens");
  assert.ok(html.includes(":root:not([data-theme=light])"), "a light theme chosen by hand beats a dark OS");
});

test("nothing in the page rolls a die", () => {
  // Determinism is the index's central promise and the viewer is a consumer of it: the same index
  // must open the same way, on every machine, every time.
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  assert.ok(!/Math\.random\s*\(/.test(html), "no randomness — the word survives only in comments");
  assert.ok(!/Date\.now\s*\(|new Date\b/.test(html), "and no clock");
});

// ── the Map ────────────────────────────────────────────────────────────────────────────────────
// On this repo the Map drew 365 files in rows by import depth on two-thirds of the screen, with 630
// import lines too faint to follow, a cluster's files in every row, labels on test helpers and on
// top of dots, and a legend of 8 areas beside an Overview that said 16. These run the page's own
// script (`browser.mjs`) and measure what it placed.

/** Builds an index from paths and import pairs: `imports`, `inbound` and the areas follow from them. */
function graphIndex(files, pairs, clusters = null) {
  const byPath = new Map(files.map((f) => [f.path, {
    lang: "javascript", category: "code", lines: 10, commits: 1, isTest: false, isEntry: false,
    imports: [], inbound: 0, cluster: null, ...f,
  }]));
  for (const [from, to] of pairs) {
    byPath.get(from).imports.push(to);
    byPath.get(to).inbound += 1;
  }
  const all = [...byPath.values()];
  return idx({
    files: all,
    edges: pairs.map(([from, to]) => ({ from, to, type: "imports" })),
    areas: inferAreas(all),
    layers: [],
    stats: { files: all.length, lines: all.length * 10, edges: pairs.length, tests: all.filter((f) => f.isTest).length },
    clusters,
  });
}

/**
 * Three clusters of code, a fourth of tests and the helpers they share, and one file with no edge.
 * The two helpers are imported more than any code file but the first hub, which is what makes them
 * candidates for a name.
 */
function mapIndex() {
  const code = (path, cluster, extra = {}) => ({ path, cluster, ...extra });
  const files = [
    code("src/a/hub.js", "c1"), code("src/a/one.js", "c1"), code("src/a/two.js", "c1"), code("src/a/three.js", "c1"),
    code("src/b/hub.js", "c2"), code("src/b/one.js", "c2"), code("src/b/two.js", "c2"),
    code("src/c/hub.js", "c3"), code("src/c/one.js", "c3"),
    code("test/helpers.js", "c4", { isTest: true }), code("src/testing/test-utils.js", "c4"),
    code("test/a.test.js", "c4", { isTest: true }), code("test/b.test.js", "c4", { isTest: true }),
    code("test/c.test.js", "c4", { isTest: true }),
    code("src/loose.js", null),
  ];
  const pairs = [
    ["src/a/one.js", "src/a/hub.js"], ["src/a/two.js", "src/a/hub.js"], ["src/a/three.js", "src/a/hub.js"],
    ["src/a/three.js", "src/a/one.js"],
    ["src/b/one.js", "src/b/hub.js"], ["src/b/two.js", "src/b/hub.js"],
    ["src/c/one.js", "src/c/hub.js"],
    // c2 imports c1 three times and c1 imports c2 once; c3 imports c1 twice.
    ["src/b/one.js", "src/a/hub.js"], ["src/b/two.js", "src/a/hub.js"], ["src/b/hub.js", "src/a/one.js"],
    ["src/a/two.js", "src/b/hub.js"],
    ["src/c/one.js", "src/a/hub.js"], ["src/c/hub.js", "src/a/hub.js"],
    ...["test/a.test.js", "test/b.test.js", "test/c.test.js"].flatMap((t) => [[t, "test/helpers.js"], [t, "src/testing/test-utils.js"]]),
    ["test/a.test.js", "src/a/hub.js"], ["test/b.test.js", "src/b/hub.js"], ["test/c.test.js", "src/c/hub.js"],
  ];
  const item = (id, hub, members) => ({ id, hub, size: members.length, cohesion: 0.5, areas: { src: members.length }, files: members });
  const of = (c) => files.filter((f) => f.cluster === c).map((f) => f.path);
  return graphIndex(files, pairs, {
    algorithm: "leiden", resolution: 1, unclustered: 1,
    items: [item("c1", "src/a/hub.js", of("c1")), item("c4", "test/a.test.js", of("c4")), item("c2", "src/b/hub.js", of("c2")), item("c3", "src/c/hub.js", of("c3"))],
  });
}

/** n files in clusters of about `size`, each importing a neighbour, and every tenth one a hub. */
function bigClustered(n, size = 20) {
  const files = [], pairs = [], items = [];
  for (let i = 0; i < n; i++) {
    const c = `c${Math.floor(i / size) + 1}`;
    files.push({ path: `pkg${Math.floor(i / 300)}/mod${String(i).padStart(4, "0")}-with-a-longer-name.js`, cluster: c, commits: i % 7 });
  }
  for (let i = 1; i < n; i++) {
    pairs.push([files[i].path, files[i - 1].path]);
    if (i % 3 === 0) pairs.push([files[i].path, files[Math.floor(i / 10) * 10].path]);
  }
  const seen = new Set();
  const uniq = pairs.filter(([a, b]) => a !== b && !seen.has(a + ">" + b) && seen.add(a + ">" + b));
  for (let k = 0; k * size < n; k++) {
    const members = files.slice(k * size, (k + 1) * size).map((f) => f.path);
    items.push({ id: `c${k + 1}`, hub: members[0], size: members.length, cohesion: 0.2, areas: {}, files: members });
  }
  return graphIndex(files, uniq, { algorithm: "leiden", resolution: 1, unclustered: 0, items });
}

// The page runs in its own realm; its arrays are compared by value, not by prototype.
const plain = (v) => JSON.parse(JSON.stringify(v));
const inside = (n, c) => n.x >= c.x && n.x <= c.x + c.w && n.y >= c.y && n.y <= c.y + c.h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("the Map puts each cluster's files in one box, and the boxes span the canvas", () => {
  for (const [name, view] of [["fixture", buildView(mapIndex(), "/tmp/x")], ["600 files", buildView(bigClustered(600), "/tmp/x")]]) {
    const page = runPage(view, { width: 1400, height: 900 });
    assert.equal(page.BY, "cluster", `${name}: clusters are the default when the index has them`);
    for (const n of page.N) {
      assert.equal(n.g.key, n.cluster || "-", `${name}: ${n.id} is in its own cluster's box`);
      assert.ok(inside(n, n.g.cell), `${name}: ${n.id} is drawn inside that box`);
    }
    const cells = page.CELLS;
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) assert.ok(!overlap(cells[i], cells[j]), `${name}: boxes ${i} and ${j} do not overlap`);
    }
    const b = page.bounds();
    assert.ok((b.x1 - b.x0) / page.W >= 0.9, `${name}: the graph is ${(b.x1 - b.x0).toFixed(0)}px of a ${page.W}px canvas`);
    assert.ok(b.x0 >= 0 && b.x1 <= page.W, `${name}: and none of it is off the canvas`);
  }
});

test("the file with no import edge sits in a quiet box of its own, last", () => {
  const page = runPage(buildView(mapIndex(), "/tmp/x"), { width: 1400, height: 900 });
  const last = page.CELLS[page.CELLS.length - 1];
  assert.equal(last.g.key, "-");
  assert.ok(last.g.quiet);
  assert.deepEqual(plain(last.g.members.map((n) => n.id)), ["src/loose.js"]);
  assert.ok(page.CELLS.every((c) => c === last || c.y + c.h < last.y), "on a shelf below every cluster");
});

test("the same index on the same canvas gives the same Map", () => {
  const view = buildView(bigClustered(400), "/tmp/x");
  const shape = (p) => plain({
    nodes: p.N.map((n) => [n.id, n.x, n.y, n.r]),
    words: p.LABELS.map((l) => [l.kind, l.text, l.x, l.y]),
    cells: p.CELLS.map((c) => [c.g.key, c.x, c.y, c.w, c.h]),
  });
  const a = runPage(view, { width: 1400, height: 900 }), b = runPage(view, { width: 1400, height: 900 });
  assert.deepEqual(shape(a), shape(b));
  // A round trip through another grouping lands where it started.
  const before = shape(a);
  a.run("regroup('area');regroup('depth');regroup('cluster')");
  assert.deepEqual(shape(a), before);
});

test("imports between two clusters are one line per pair, and it carries their count", () => {
  const page = runPage(buildView(mapIndex(), "/tmp/x"), { width: 1400, height: 900 });
  const rows = page.BUNDLES.map((B) => [B.a.key, B.b.key, B.n, B.ab, B.ba]);
  // Box order is the index's cluster order (c1, c4, c2, c3), and a pair is keyed by it.
  assert.deepEqual(plain(rows), [
    ["c1", "c2", 4, 1, 3],
    ["c1", "c3", 2, 0, 2],
    ["c1", "c4", 1, 0, 1],
    ["c4", "c2", 1, 1, 0],
    ["c4", "c3", 1, 1, 0],
  ]);
  const intra = page.CELLS.reduce((n, c) => n + c.g.intra.length, 0);
  assert.equal(intra + page.BUNDLES.reduce((n, B) => n + B.n, 0), page.E.length, "every import is drawn exactly once");
  assert.ok(page.BUNDLES[0].w > page.BUNDLES[1].w && page.BUNDLES[1].w > page.BUNDLES[2].w, "and a line is thicker for more");
  const pills = page.LABELS.filter((l) => l.kind === "count");
  assert.ok(pills.length > 0, "the counts are written on the lines where they fit");
  for (const p of pills) assert.equal(p.text, String(p.B.n));
});

test("a test, or a file that only serves tests, is never named on the Map", () => {
  const view = buildView(mapIndex(), "/tmp/x");
  const node = (p) => view.nodes.find((n) => n.id === p);
  assert.equal(node("src/testing/test-utils.js").isTest, false, "the index does not count it as a test");
  assert.equal(node("src/testing/test-utils.js").testSupport, true, "and the Map still knows what it is for");
  assert.equal(node("src/a/one.js").testSupport, false);
  const page = runPage(view, { width: 1400, height: 900 });
  const named = page.LABELS.filter((l) => l.n).map((l) => l.n);
  assert.ok(named.some((n) => n.id === "src/a/one.js"), "a code file is named");
  assert.ok(named.every((n) => !n.isTest && !n.testSupport), `named: ${named.map((n) => n.id).join(", ")}`);
  // The helpers outrank the code file that was named, so the rule, not their rank, kept them out.
  const ind = (p) => page.N.find((n) => n.id === p).ind;
  assert.ok(ind("test/helpers.js") > ind("src/a/one.js") && ind("src/testing/test-utils.js") > ind("src/a/one.js"));
  // Lighting a helper names its neighbours that are code, and neither it nor the tests.
  page.run("setHover(M.get('test/helpers.js'))");
  assert.ok(page.run("FW").every((l) => !l.n.isTest && !l.n.testSupport));
  // And a box is labelled with its hub, the `cN · hub` name the legend uses.
  const titles = page.LABELS.filter((l) => l.kind === "cell").map((l) => l.text);
  assert.ok(titles.includes("c1 · a/hub.js · 4 files"), titles.join(" | "));
});

test("no word on the Map covers a dot or another word, at rest or with a file lit", () => {
  for (const [name, view, hover] of [
    ["fixture", buildView(mapIndex(), "/tmp/x"), "src/a/hub.js"],
    ["600 files", buildView(bigClustered(600), "/tmp/x"), "pkg0/mod0010-with-a-longer-name.js"],
  ]) {
    const page = runPage(view, { width: 1400, height: 900 });
    assert.deepEqual(page.collisions(), [], `${name}, at rest`);
    assert.ok(page.LABELS.length > 0, `${name}: words are placed, or this proves nothing`);
    page.run(`setHover(M.get(${JSON.stringify(hover)}))`);
    const focus = page.run("FW");
    const all = [...page.LABELS, ...focus];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) assert.ok(!overlap(all[i], all[j]), `${name}: ${all[i].text} / ${all[j].text}`);
      for (const n of page.N) {
        assert.ok(!overlap(all[i], { x: n.x - n.r, y: n.y - n.r, w: 2 * n.r, h: 2 * n.r }), `${name}: ${all[i].text} on ${n.id}`);
      }
    }
  }
});

test("lighting a file lights exactly its imports and importers", () => {
  const page = runPage(buildView(mapIndex(), "/tmp/x"), { width: 1400, height: 900, hover: "src/a/hub.js" });
  const lit = [...page.NB].map((n) => n.id).sort();
  const expected = mapIndex().edges.filter((e) => e.from === "src/a/hub.js" || e.to === "src/a/hub.js")
    .map((e) => (e.from === "src/a/hub.js" ? e.to : e.from)).sort();
  assert.deepEqual(lit, [...new Set(expected)]);
  // A click keeps it lit after the pointer leaves, and the bar names it.
  page.run("hover=null;sel=M.get('src/a/hub.js');focusSet()");
  assert.equal(page.NB.size, expected.length);
  assert.match(page.html("msel"), /src\/a\/hub\.js<\/b> · imports 0 · imported by 8/);
});

test("the Map's areas are the index's areas, so it counts what the Overview counts", () => {
  const files = [
    { path: "src/react/use-store.ts", cluster: null }, { path: "src/vanilla/store.ts", cluster: null },
    { path: "src/index.ts", cluster: null }, { path: "tools/build.sh", category: "script", lang: "shell", cluster: null },
    { path: "docs/guide.md", category: "docs", lang: "markdown" }, { path: "README.md", category: "docs", lang: "markdown" },
  ];
  const index = graphIndex(files, [["src/index.ts", "src/vanilla/store.ts"], ["src/react/use-store.ts", "src/vanilla/store.ts"]]);
  const view = buildView(index, "/tmp/x");
  const names = new Set(view.areas.map((a) => a.name));
  for (const n of view.nodes) {
    assert.equal(n.area, layerKeyFor(n.path), `${n.id} carries the area index.areas put it in`);
    assert.ok(names.has(n.area), `${n.area} is an area the Overview counts`);
  }
  // Keyed on the first segment, all three src files were one area "src", and the cards of
  // src/react and src/vanilla came out grey because no node named them.
  assert.equal(view.nodes.find((n) => n.id === "src/react/use-store.ts").area, "src/react");
  const card = (a) => view.areas.find((x) => x.name === a);
  assert.equal(card("src/react").color, view.nodes.find((n) => n.id === "src/react/use-store.ts").color);
  assert.notEqual(card("src/react").color, card("src/vanilla").color);
  assert.equal(view.stats.mapAreas, 4, "src/react, src/vanilla, src and tools hold code");
  assert.equal(view.areas.length, 6, "docs and root hold none");
  const page = runPage(view, { width: 1400, height: 900 });
  page.run("regroup('area')");
  assert.deepEqual(plain(page.CELLS.map((c) => c.g.key).sort()), ["src", "src/react", "src/vanilla", "tools"]);
  assert.match(page.html("legend"), /This repo has 6 areas, the count on the Overview; 4 hold code and are drawn here, the other 2 hold only docs or config\./);
});

test("the legend sits beside the Map, never over it, and folds", () => {
  const html = renderHtml(buildView(mapIndex(), "/tmp/x"));
  assert.match(html, /<div class="view" id="v-map"><div id="mapmain"><div id="hud"><\/div><div id="cvwrap"><canvas id="cv"[^>]*><\/canvas><\/div><\/div><aside id="legend"/);
  const css = html.slice(html.indexOf("#legend{"), html.indexOf("}", html.indexOf("#legend{")));
  assert.ok(!/position\s*:\s*(absolute|fixed)/.test(css), "a column of its own, not an overlay");
  assert.ok(html.includes("#legend.min{"), "it folds");
  const page = runPage(buildView(mapIndex(), "/tmp/x"), { width: 1400, height: 900 });
  assert.match(page.html("legend"), /aria-expanded="true"/);
  assert.match(page.html("legend"), /c1 · a\/hub\.js/, "a row per cluster, by the name its box carries");
  assert.match(page.html("legend"), /a question, not a verdict/, "and the files with no edge are hedged");
});

test("keys, buttons and the canvas label still work on the Map", () => {
  const page = runPage(buildView(mapIndex(), "/tmp/x"), { width: 1400, height: 900 });
  assert.match(renderHtml(buildView(mapIndex(), "/tmp/x")), /<canvas id="cv" tabindex="0" role="img"/);
  assert.match(page.attr("cv", "aria-label"), /15 code files in 5 clusters.*Arrow keys pan, plus and minus zoom, zero resets/);
  const tx = page.tx;
  page.fire("cv", "keydown", { key: "ArrowRight" });
  assert.equal(page.tx, tx - 60, "an arrow key pans");
  page.fire("cv", "keydown", { key: "+" });
  assert.equal(page.scale, 1.25, "plus zooms in");
  page.fire("cv", "keydown", { key: "-" });
  page.fire("cv", "keydown", { key: "-" });
  assert.ok(Math.abs(page.scale - 0.8) < 1e-9, "minus zooms out");
  page.fire("cv", "keydown", { key: "0" });
  assert.deepEqual([page.scale, page.tx, page.ty], [1, page.MARGIN, page.MARGIN], "zero resets");
  assert.match(page.html("hud"), /aria-label="Zoom out"/);
  assert.match(page.html("hud"), /aria-label="Reset zoom"/);
  assert.match(page.html("hud"), /aria-label="Zoom in"/);
  assert.match(page.html("hud"), /data-by="cluster" aria-pressed="true"/);
});

test("every grouping goes through the one packer, and hiding a box re-packs the rest on the full width", () => {
  const page = runPage(buildView(bigClustered(300), "/tmp/x"), { width: 1400, height: 900 });
  page.run("regroup('depth')");
  assert.ok(page.CELLS.every((c) => Math.abs(c.w - page.BOX.x1) < 1), "by depth, every layer is a full-width box");
  assert.equal(page.BUNDLES.length, 0, "and its imports are drawn one by one");
  page.run("regroup('cluster');hidden.add('c1');layout()");
  assert.ok(page.N.filter((n) => n.cluster === "c1").every((n) => !n.g), "a hidden cluster is not drawn");
  assert.ok(page.CELLS.every((c) => c.g.key !== "c1"));
  const b = page.bounds();
  assert.ok((b.x1 - b.x0) / page.W >= 0.9, "and what is left still spans the canvas");
  // An index without clusters opens by area and offers no cluster switch.
  const plain = runPage(buildView(idx(), "/tmp/x"), { width: 1400, height: 900 });
  assert.equal(plain.BY, "area");
  assert.doesNotMatch(plain.html("hud"), /data-by="cluster"/);
});

test("the Map lays out and draws 2,000 files without stalling", () => {
  const view = buildView(bigClustered(2000), "/tmp/x");
  const page = runPage(view, { width: 1400, height: 900 });
  assert.equal(page.N.length, 2000);
  let best = Infinity;
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); page.run("layout()"); best = Math.min(best, performance.now() - t0); }
  assert.ok(best < 250, `a layout of 2,000 files took ${best.toFixed(1)}ms`);
  page.run("TAB='map'");
  const before = { ...page.calls };
  let draw = Infinity;
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); page.run("draw()"); draw = Math.min(draw, performance.now() - t0); }
  assert.ok(draw < 60, `a draw of 2,000 files took ${draw.toFixed(1)}ms of script time`);
  // A stroke per file is what makes a canvas stutter. The strokes are per box, per pair and per colour.
  const strokes = (page.calls.stroke - before.stroke) / 3;
  assert.ok(strokes <= 2 * page.CELLS.length + page.BUNDLES.length + 60, `${strokes} strokes for ${page.CELLS.length} boxes`);
  page.run("setHover(N[500])");
  const t0 = performance.now();
  page.run("draw()");
  assert.ok(performance.now() - t0 < 60, "and lighting a file costs no more");
});

test("the Map's in-box edges stay light on a light ground, and a line between boxes reads over them", () => {
  assert.equal(THEMES.light["edge-rest"], ".12", "the light theme is not darkened");
  assert.ok(+THEMES.dark["edge-rest"] >= 0.2, "a dark ground needs them raised to be seen at all");
  for (const t of ["light", "dark"]) assert.ok(+THEMES[t].bundle > +THEMES[t]["edge-rest"], `${t}: a pair line is darker than an edge`);
});

// ── legibility, computed ───────────────────────────────────────────────────────────────────────
// The reader this page was redesigned for is farsighted, with strabismus. "High contrast" tuned by
// eye is the claim that rots first — someone softens a grey and nothing fails — so the ratios are
// computed here from the same token objects the CSS is generated from.

function rgba(v) {
  const s = String(v).trim();
  if (s.startsWith("#")) {
    const n = parseInt(s.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  const p = m[1].split(",").map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
}
function over(top, under) {
  const [r, g, b, a] = rgba(top), [R, G, B] = rgba(under);
  return [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
}
function lum([r, g, b]) {
  const c = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
function contrastTable() {
  const rows = [];
  for (const [theme, t] of Object.entries(THEMES)) {
    const ground = (g) => (Array.isArray(g) ? [`${g[0]} on ${g[1]}`, over(t[g[0]], t[g[1]])] : [g, rgba(t[g]).slice(0, 3)]);
    const ratio = (fg, bg) => { const a = lum(rgba(fg).slice(0, 3)), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    for (const g of CONTRAST.grounds) {
      const [name, bg] = ground(g);
      for (const fg of CONTRAST.text) rows.push({ theme, text: fg, ground: name, ratio: ratio(t[fg], bg) });
    }
    for (const g of CONTRAST.tints.grounds) {
      for (const fg of CONTRAST.tints.text) rows.push({ theme, text: fg, ground: g, ratio: ratio(t[fg], rgba(t[g]).slice(0, 3)) });
    }
    for (const [fg, bg] of CONTRAST.pairs) rows.push({ theme, text: fg, ground: bg, ratio: ratio(t[fg], rgba(t[bg]).slice(0, 3)) });
  }
  return rows;
}

test("every text colour clears 7:1 on every ground it can sit on, in both themes", () => {
  const rows = contrastTable();
  assert.ok(rows.length > 100, "the table covers the palette, not a sample of it");
  const low = rows.filter((r) => r.ratio < CONTRAST.min).map((r) => `${r.theme}: ${r.text} on ${r.ground} = ${r.ratio.toFixed(2)}`);
  assert.deepEqual(low, [], "no pair below 7:1");
});

test("nothing on the page is set under 13px, the canvas included", () => {
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  const sizes = [
    ...[...html.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => [m[0], +m[1]]),
    // the `font:` shorthand, in CSS and in canvas strings: `600 13px …`
    ...[...html.matchAll(/(?:font:\s*|['"])(?:\d{3}\s+)?([\d.]+)px[\s/]/g)].map((m) => [m[0], +m[1]]),
  ];
  assert.ok(sizes.length > 30, "the sizes were found, or this proves nothing");
  assert.deepEqual(sizes.filter(([, px]) => px < 13).map(([s]) => s), [], "no size under 13px");
});

// ── the Overview and the Structure tab ─────────────────────────────────────────────────────────

test("every tab is on the page, and the Overview opens first", () => {
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  for (const v of ["ov", "map", "structure", "files", "areas", "gaps", "next"]) {
    assert.ok(html.includes(`data-v="${v}"`), `the ${v} tab`);
    assert.ok(html.includes(`id="v-${v}"`), `and its view`);
  }
  assert.ok(html.includes(`class="tab on" role="tab" aria-selected="true" data-v="ov"`), "Overview is selected");
  assert.ok(html.includes(`<div class="view on" id="v-ov">`), "and shown");
  // The harness runs the LAST plain <script>; the Map's layout is what it measures.
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.pop().includes("function pack("), "the Map's script stays last");
  assert.ok(html.indexOf('<script id="ov-js">') < html.lastIndexOf("<script>"), "the Overview's runs before it");
});

test("a page with no repo state says what is missing and why, instead of drawing zeros", () => {
  // No overview facts and no sequence: the state a page is in when rendered straight from buildView.
  const page = runOverview(buildView(idx({ stats: { files: 4, lines: 100, tests: 1 } }), "/tmp/x"));
  assert.match(page.html("ovbar"), /Repo state not available/);
  assert.match(page.html("ovl"), /not available — the page was rendered without the repo state/);
  assert.match(page.html("ovr"), /not available — no install sequence was computed/);
  assert.ok(!/>0<\/div><svg/.test(page.html("ovl")), "no zero-commit sparkline stands in for no git");
  assert.match(page.html("spane"), /AGENTS\.md|no root AGENTS\.md/, "the Structure tab still renders");
});

test("the no-git state is named, and memory still reaches the timeline", () => {
  const overview = {
    cortex: "9.9.9", commit: null, commitDate: null, index: "unknown",
    profile: { name: "home", source: "default" },
    memory: { newest: "2026-01-02", days: 1, lagDays: null },
    churn: { unavailable: "not a git repository" },
    findings: { counts: { critical: 0, high: 1, medium: 0, low: 0 }, total: 1, top: [{ severity: "high", kind: "k", title: "a finding" }] },
    timeline: [{ date: "2026-01-02", time: "09:00", kind: "memory", tag: "digest", title: "we decided a thing" }],
    timelineNote: "not a git repository — only memory entries can be listed",
    generated: [{ path: ".cortex/index/", what: "the index", present: true }],
  };
  const page = runOverview(buildView(idx(), "/tmp/x", { overview }));
  assert.match(page.html("ovl"), /not available — not a git repository/);
  assert.match(page.html("ovr"), /we decided a thing/);
  assert.match(page.html("ovr"), /only memory entries can be listed/);
  assert.match(page.html("ovbar"), /last commit <b>date not available<\/b>/);
  assert.match(page.html("ovbar"), /Cortex v9\.9\.9/);
});

// Both memory layouts (plan step 4.1), from the files to the drawn page. An entry from
// `<date>/<author>.md` says whose it is; one from an old `<date>.md` has no author, and the page
// shows nothing there rather than a guess.
test("the timeline names the author of an entry that has one, and shows nothing for one that has none", () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-view-memory-"));
  try {
    bothLayouts(join(root, ".cortex"));
    const overview = buildOverview(idx(), root, { git: () => ({ error: "fatal: not a git repository" }) });
    const html = runOverview(buildView(idx(), "/tmp/x", { overview })).html("ovr");
    const items = [...html.matchAll(/<li class="memory">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    const tag = (item) => /<span class="tag">([^<]*)<\/span>/.exec(item)[1];
    const title = (item) => /<span class="tt">([^<]*)<\/span>/.exec(item)[1];
    assert.deepEqual(items.map((i) => [tag(i), title(i)]), [
      ["memory · note", ENTRIES.oldAfternoon],
      ["memory · dream · dev-a", ENTRIES.devA],
      ["memory · dream · dev-b", ENTRIES.devB],
      ["memory · decision", ENTRIES.oldMorning],
      ["memory · note", ENTRIES.dayBefore],
    ]);
    assert.match(runOverview(buildView(idx(), "/tmp/x", { overview })).html("ovbar"), /2 days of entries/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an author on a timeline entry is escaped like every other value on the page", () => {
  const overview = {
    cortex: "9.9.9", commit: null, commitDate: null, index: "unknown",
    profile: { name: "home", source: "default" },
    memory: { newest: "2026-01-02", days: 1, lagDays: null },
    churn: { unavailable: "not a git repository" },
    findings: { counts: { critical: 0, high: 0, medium: 0, low: 0 }, total: 0, top: [] },
    timeline: [
      { date: "2026-01-02", time: "09:00", kind: "memory", tag: "digest", author: "<b>x</b>", title: "one" },
      { date: "2026-01-02", time: "", kind: "commit", tag: "abc1234", author: "A Person", title: "two" },
    ],
    timelineNote: null,
    generated: [],
  };
  const html = runOverview(buildView(idx(), "/tmp/x", { overview })).html("ovr");
  assert.ok(html.includes("memory · digest · &lt;b&gt;x&lt;/b&gt;"), "escaped");
  assert.ok(html.includes('<span class="tag">commit abc1234</span>'), "a commit's tag is unchanged");
});

test("the Structure tab names what is missing and the command that writes it", () => {
  // Five code files is the findings report's threshold for proposing a scoped brief; the tab names
  // the command only where the report would offer it.
  const five = Array.from({ length: 5 }, (_, i) => ({
    path: `src/m${i}.js`, lang: "javascript", category: "code", lines: 5, commits: 1,
    isTest: false, isEntry: false, imports: [], inbound: 0,
  }));
  const page = runOverview(buildView(idx({
    files: five, edges: [], layers: [],
    areas: [{ name: "src", paths: five.map((f) => f.path) }],
  }), "/tmp/x"));
  const s = page.html("spane");
  assert.match(s, /no root AGENTS\.md/);
  assert.match(s, /\/cortex-brief src\//, "an area the report would propose names the command");
  assert.match(s, /no CONTEXT\.md/);
});

test("a small area is covered by the brief above it, and is not sent to /cortex-brief", () => {
  // Three files: under the threshold. A dashed box with a command in it is an instruction, and the
  // tab used to give it for every area with code — one-file directories included.
  const s = runOverview(buildView(idx(), "/tmp/x")).html("spane");
  assert.doesNotMatch(s, /\/cortex-brief src\//);
  assert.match(s, /too small to need its own brief/);
});

test("backticks in the sequence's prose render as code, not as backticks", () => {
  const next = {
    done: 5, total: 6, complete: false, perChange: [],
    steps: [{ id: "loop", title: "Close the artifact chain", cmd: "/cortex", done: false, next: true,
      why: "6 of 8 in place — run `cortex-loop.mjs .` for which and why" }],
  };
  const page = runOverview(buildView(idx(), "/tmp/x", { next }));
  assert.match(page.html("ovr"), /run <code>cortex-loop\.mjs \.<\/code> for which/);
  assert.doesNotMatch(page.html("ovr"), /`/);
  const html = renderHtml(buildView(idx(), "/tmp/x", { next }));
  assert.ok(html.includes("'+ic(s.why)+'"), "the Next steps tab renders the same way");
});

test("the page has an inline favicon, so a served copy does not 404 on /favicon.ico", () => {
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/);
});

test("a phone gets a bar that wraps and views that stack, never a page wider than the screen", () => {
  // Lint-style, like the layout tests above: the geometry itself is checked in a real browser at
  // 390px (see the PR that added this). These pin the three decisions that made it fit.
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  assert.ok(!html.includes("calc(100vh - 60px)"), "the views are not sized against a fixed-height bar");
  assert.ok(html.includes("body{overflow:hidden;display:flex;flex-direction:column}"));
  const phone = html.slice(html.indexOf("@media (max-width:720px)"));
  assert.ok(phone.includes("#top{flex-wrap:wrap"), "the bar wraps");
  assert.ok(phone.includes("#tabs{order:4;flex:1 1 100%;flex-wrap:wrap}"), "the tabs get rows of their own, all in view");
  assert.ok(phone.includes("#stree{min-width:0}"), "the Structure tree drops its 960px floor");
  const narrow = html.slice(html.indexOf("@media (max-width:1100px)"));
  assert.ok(narrow.includes("#v-ov.on{display:block"), "the stacked Overview is normal flow, not a collapsing grid");
});

function bigIndex(n) {
  const areas = ["api", "app", "core", "data", "lib", "ui"];
  const files = Array.from({ length: n }, (_, i) => ({
    path: `${areas[i % areas.length]}/m${i}.js`, lang: "javascript", category: "code",
    lines: 10, commits: i % 7, isTest: false, isEntry: false, imports: [], inbound: 0,
  }));
  const edges = [];
  for (let i = 1; i < n; i++) {
    for (const t of new Set([Math.floor(i / 2), Math.floor(i / 3)])) {
      edges.push({ from: files[i].path, to: files[t].path, type: "imports" });
      files[i].imports.push(files[t].path);
      files[t].inbound += 1;
    }
  }
  return idx({
    files, edges, layers: [], cycles: [],
    areas: areas.map((a) => ({ name: a, paths: files.filter((f) => f.path.startsWith(a + "/")).map((f) => f.path) })),
    stats: { files: n, lines: n * 10, tests: 0 },
  });
}

/**
 * The fastest frame of each page, sampled in alternation after a warm-up.
 *
 * Load on the machine only ever ADDS time, so the minimum of several frames is the frame's own cost
 * with the least noise in it. The test used to average 30 frames from cold — JIT warm-up included,
 * and whatever else was running — and failed at 12.4–18.6ms under parallel suites while passing
 * alone, on a frame whose fastest run is about 1ms. Alternating the pages exposes both to the same
 * load, which is what makes their ratio mean something.
 */
function fastestFrames(pages, { warm = 5, samples = 20 } = {}) {
  for (const p of pages) for (let i = 0; i < warm; i++) p.OV.frame();
  const best = pages.map(() => Infinity);
  for (let s = 0; s < samples; s++) {
    pages.forEach((p, k) => {
      const t0 = performance.now();
      p.OV.frame();
      best[k] = Math.min(best[k], performance.now() - t0);
    });
  }
  return best;
}

test("the cloud draws 2,000 files in one pass per frame, fast enough to turn smoothly", () => {
  // A frame is one path for every import and one sprite per file. A stroke per edge, or a pass that
  // is quadratic in files, is what makes a large repo stutter — and it is invisible on this repo.
  const page = runOverview(buildView(bigIndex(2000), "/tmp/x"));
  const small = runOverview(buildView(bigIndex(200), "/tmp/x"));
  assert.equal(page.OV.count, 2000);
  const before = { ...page.calls };
  for (let i = 0; i < 30; i++) page.OV.frame();
  assert.equal((page.calls.drawImage - before.drawImage) / 30, 2000, "one sprite per file");
  assert.ok((page.calls.stroke - before.stroke) / 30 <= 2, "the links are one stroke, not thousands");

  const [big, tenth] = fastestFrames([page, small]);
  // Scaling, measured against itself on the same machine at the same moment: ten times the files is
  // about ten times the frame when the draw is linear, and about a hundred when it is quadratic. 20
  // leaves room for noise and fixed per-frame cost on either side of that gap.
  const ratio = big / Math.max(tenth, 0.01);
  assert.ok(ratio < 20, `2,000 files cost ${ratio.toFixed(1)}× a 200-file frame (${big.toFixed(2)}ms vs ${tenth.toFixed(2)}ms) — the draw is no longer linear`);
  // And an absolute ceiling, for a draw that stays linear but gets heavy per file. 12 is the budget
  // this test always held, now applied to the fastest frame rather than to a cold average.
  assert.ok(big < 12, `the fastest of 20 frames took ${big.toFixed(2)}ms of script time`);
});

test("the same index opens as the same cloud", () => {
  const a = runOverview(buildView(bigIndex(300), "/tmp/x"));
  const b = runOverview(buildView(bigIndex(300), "/tmp/x"));
  assert.deepEqual([...a.OV.points()], [...b.OV.points()], "every file lands in the same place");
  assert.equal(renderHtml(buildView(bigIndex(300), "/tmp/x")), renderHtml(buildView(bigIndex(300), "/tmp/x")));
});

test("the cloud zooms in fixed steps about its centre, and stops at both ends", () => {
  // A reader who cannot make out one point among 262 had the Map's wheel zoom and nothing here.
  const page = runOverview(buildView(bigIndex(300), "/tmp/x"));
  const spread = () => { page.OV.frame(); const xs = page.OV.screen(); return Math.max(...xs) - Math.min(...xs); };
  // The stub canvas is 1600 wide, so the cloud's centre is x = 800. Every point's offset from it
  // doubles at 2x, the outermost ones included.
  const offset = () => { const xs = page.OV.screen(); return (Math.max(...xs) + Math.min(...xs)) / 2 - 800; };
  const at1 = spread(), off1 = offset();
  assert.equal(page.OV.zoom(-1), 1, "it does not zoom out past the whole cloud");
  assert.equal(page.OV.zoom(+2), 2, "two steps in is 2x: 1, 1.5, 2");
  assert.ok(Math.abs(spread() / at1 - 2) < 0.01, "at 2x the points are twice as far apart on screen");
  assert.ok(Math.abs(offset() - 2 * off1) < 0.5, "and the cloud grows about its centre, so nothing slides away");
  for (let i = 0; i < 10; i++) page.OV.zoom(+1);
  assert.equal(page.OV.zoom(+1), 5, "it stops at 5x");
  const before = { ...page.calls };
  page.OV.frame();
  assert.equal(page.calls.drawImage - before.drawImage, 300, "a zoomed frame is still one sprite per file");
});

test("zoom has buttons a keyboard and a screen reader can reach, and a bare wheel still scrolls the page", () => {
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  for (const label of ["Zoom out", "Reset zoom", "Zoom in"]) {
    assert.match(html, new RegExp(`<button type="button" id="ovz[ori]" aria-label="${label}">`), `a "${label}" button`);
  }
  assert.match(html, /role="group" aria-label="Zoom the import graph"/);
  // The cloud sits in a page that scrolls. Taking every wheel event would trap the reader on it.
  assert.match(html, /addEventListener\('wheel',e=>\{if\(!e\.ctrlKey&&!e\.metaKey\)return;/);
  assert.match(html, /plus and minus zoom it/, "the canvas's label says the keys");
});

// ── enrichment reaches the cards ───────────────────────────────────────────────────────────────
// Two mismatches in one seam, both silent. `merge` writes `.cortex/index/enriched.json` while the
// viewer and the sequence looked for `enrichment.json`; and `mergeEnrichment` writes `files` as an
// object keyed by path while buildView read `summaries`, an array. Neither errored, because
// enrichment is OPTIONAL — an empty result is indistinguishable from a repo that never ran it,
// which is exactly what let a completed 307-file enrichment show up as no enrichment at all.

test("summaries from the shape merge actually writes reach the cards", () => {
  const enrichment = {
    files: {
      "src/a.js": { path: "src/a.js", summary: "does the thing", role: "core-logic", tags: ["x"] },
    },
  };
  const v = buildView(idx(), "/tmp/x", { enrichment });
  const card = v.nodes.find((n) => n.path === "src/a.js");
  assert.equal(card.summary, "does the thing", "the object-keyed form is what merge produces");
  assert.equal(v.stats.enriched, 1);
  // A partial enrichment leaves the rest bare rather than inventing prose for them. This used to
  // be asserted against `applyEnrichment`, a function nothing in the product called; it belongs
  // here, at the interface the viewer actually crosses.
  assert.equal(v.nodes.find((n) => n.path === "src/b.js").summary, "", "no summary stays no summary");
});

test("the older array form still works, so an existing enrichment is not orphaned", () => {
  const enrichment = { summaries: [{ path: "src/a.js", summary: "legacy shape", role: "utility" }] };
  const v = buildView(idx(), "/tmp/x", { enrichment });
  assert.equal(v.nodes.find((n) => n.path === "src/a.js").summary, "legacy shape");
});

test("no enrichment is still the normal optional case", () => {
  const v = buildView(idx(), "/tmp/x");
  assert.equal(v.stats.enriched, 0);
  assert.equal(v.nodes.find((n) => n.path === "src/a.js").summary ?? "", "");
});

// ── clusters ────────────────────────────────────────────────────────────────────────────────────

/** An index whose `k` clusters each hold two files of `src/`, so cluster and area disagree. */
function clustered(k) {
  const files = [];
  const edges = [];
  const items = [];
  for (let i = 0; i < k; i++) {
    const a = `src/f${String(i).padStart(2, "0")}a.js`;
    const b = `src/f${String(i).padStart(2, "0")}b.js`;
    const id = `c${i + 1}`;
    files.push(
      { path: a, lang: "javascript", category: "code", lines: 5, commits: 1, isTest: false, isEntry: false, imports: [b], inbound: 0, cluster: id },
      { path: b, lang: "javascript", category: "code", lines: 5, commits: 1, isTest: false, isEntry: false, imports: [], inbound: 1, cluster: id },
    );
    edges.push({ from: a, to: b, type: "imports" });
    items.push({ id, hub: a, size: 2, cohesion: 1, areas: { src: 2 }, files: [a, b] });
  }
  files.push({ path: "src/alone.js", lang: "javascript", category: "code", lines: 5, commits: 1, isTest: false, isEntry: false, imports: [], inbound: 0, cluster: null });
  return idx({
    files,
    edges,
    areas: [{ id: "area:src", name: "src", description: "", paths: files.map((f) => f.path) }],
    layers: [{ depth: 0, paths: files.map((f) => f.path) }],
    clusters: { algorithm: "leiden", resolution: 1, unclustered: 1, items },
  });
}

test("each node carries its cluster and a cluster colour; only the largest clusters get a hue", () => {
  const v = buildView(clustered(14), "/tmp/x");
  const byId = new Map(v.nodes.map((n) => [n.id, n]));
  assert.equal(byId.get("src/f00a.js").cluster, "c1");
  assert.equal(byId.get("src/alone.js").cluster, null);
  const hues = v.clusters.items.filter((c) => c.coloured).map((c) => c.color);
  assert.equal(hues.length, 12, "as many hues as the palette holds");
  assert.equal(new Set(hues).size, hues.length, "and no two named clusters share one");
  const grey = v.clusters.items.find((c) => !c.coloured).color;
  assert.ok(!hues.includes(grey), "the small ones are grey, never a reused hue");
  assert.deepEqual(v.clusters.items.filter((c) => !c.coloured).map((c) => c.id), ["c13", "c14"]);
  for (const n of v.nodes.filter((n) => n.cluster)) {
    assert.equal(n.ccolor, v.clusters.items.find((c) => c.id === n.cluster).color, `${n.id} matches its legend row`);
  }
  assert.equal(byId.get("src/alone.js").ccolor, grey);
  // The area colour is untouched: every other tab still reads `color`.
  assert.equal(byId.get("src/f00a.js").color, v.areas.find((a) => a.name === "src").color);
});

test("the view lists clusters without their files, areas most-members first, and null for an index without them", () => {
  const i = clustered(2);
  i.clusters.items[0].areas = { "src/b": 1, "src/a": 1, lib: 3 };
  const v = buildView(i, "/tmp/x");
  assert.equal(v.clusters.unclustered, 1);
  assert.ok(!("files" in v.clusters.items[0]), "every node already says its cluster");
  assert.deepEqual(v.clusters.items[0].areas, [{ name: "lib", files: 3 }, { name: "src/a", files: 1 }, { name: "src/b", files: 1 }]);
  assert.equal(v.clusters.items[0].hubLabel, "f00a.js");
  assert.equal(buildView(idx(), "/tmp/x").clusters, null);
});

test("the page carries the cluster switch and the Areas tab's cluster table", () => {
  const html = renderHtml(buildView(clustered(2), "/tmp/x"));
  assert.match(html, /data-by=/);
  assert.match(html, /<h2 class="vh">Clusters/);
  assert.ok(!html.includes("/tmp/x"), "no machine path reaches the page");
});

test("fixture code does not count as testable in an area", () => {
  const base = idx();
  const fixture = { path: "src/fixtures/sample.js", lang: "javascript", category: "code", lines: 5, commits: 1, isTest: false, isEntry: false, imports: [], inbound: 0 };
  const v = buildView(idx({
    files: [...base.files, fixture],
    areas: [{ ...base.areas[0], paths: [...base.areas[0].paths, fixture.path] }],
  }), "/tmp/x");
  const src = v.structure.areas.find((a) => a.name === "src");
  assert.equal(src.testable, 3, "the three source files, not the fixture");
});
