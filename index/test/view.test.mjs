import { test } from "node:test";
import assert from "node:assert/strict";

import { buildView } from "../lib/view.mjs";
import { renderHtml } from "../lib/view-html.mjs";

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

// ── the band of unconnected files ──────────────────────────────────────────────────────────────
// Simulated alongside everything else, a node with no edges has only repulsion acting on it, so it
// drifts outward — 34 loose labels orbiting this repo's graph, reading as "half of it is
// disconnected". They are parked in a captioned band instead. These are lint-style assertions on
// the browser script, which has no DOM to run in here; the behaviour itself is a design decision
// and this is the guard that it was not quietly reverted.

test("the layout parks unconnected files instead of simulating them", () => {
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  assert.ok(html.includes("n.pin=1"), "loose nodes are pinned");
  assert.ok(
    html.includes("vis(n)&&!n.pin"),
    "the force step excludes them — otherwise pinning them is undone every frame",
  );
});

test("the band says what it is, and hedges what it means", () => {
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  assert.ok(html.includes("files with no import edge found"), "the band is captioned");
  // The hedge is the point: regex resolution cannot see a dynamically loaded or variable-sourced
  // file, so an empty edge list is a question. A silent band would read as a verdict.
  assert.ok(html.includes("a question, not a verdict"));
});
