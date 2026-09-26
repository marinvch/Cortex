import { test } from "node:test";
import assert from "node:assert/strict";

import { buildView } from "../lib/view.mjs";
import { renderHtml, THEMES, CONTRAST } from "../lib/view-html.mjs";
import { runPage, runOverview } from "./browser.mjs";

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

test("a node is a labelled chip, not an anonymous dot", () => {
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  assert.ok(html.includes("function chip("), "chips are drawn");
  assert.ok(html.includes("scale>=CHIP_LOD"), "and fall back to dots when too small to read");
  // Hit-testing has to follow what is drawn. A radius test against a 200px-wide chip leaves most of
  // the card unclickable, which is the kind of bug a screenshot never shows.
  assert.ok(html.includes("Math.abs(dx)<=n.w/2"), "picking uses the chip rectangle");
});

test("the layout cools, and the fit never zooms past legibility", () => {
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  // A graph that never settles cannot be fitted — every fit is undone by the next frame.
  assert.ok(html.includes("1-frames/760"), "the simulation cools to a stop");
  assert.ok(
    html.includes("Math.max(CHIP_LOD+.08"),
    "fitting stops at the point the chips stop being readable",
  );
  assert.ok(html.includes("!touched"), "and never moves a camera the user has already touched");
});

// ── the graph is layered, because the docs say it is ───────────────────────────────────────────
// `skills/cortex-view/SKILL.md` told readers the nodes were "laid out by import depth so it reads
// top-down". They were not: depth was read once to size the loose-file tray and never positioned
// anything, so the page was a plain force hairball making a claim only prose could keep. These
// assert the claim is in the code. They are lint-style, like the tray ones above — the script has
// no DOM to run in here — and the geometry itself is checked by running the emitted script against
// cloned repositories, which is where every layout defect in this file has actually been found.

test("depth places a node; nothing else is allowed to", () => {
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  assert.ok(html.includes("n.x=x+slot(n)/2;n.y=ly;"), "pack() is the only thing that writes x or y");
  // A velocity on either axis and a node drifts off the layer it is supposed to name. The fields
  // are gone rather than merely unused, so neither can come back by accident.
  const graph = html.slice(html.indexOf("---- graph"));
  assert.ok(!/\bvy\b/.test(graph), "there is no y velocity");
  assert.ok(!/\bvx\b/.test(graph), "and no x velocity — pack() assigns, it does not integrate");
  assert.ok(html.includes("0 · foundation"), "band 0 is named for what it means");
  assert.ok(html.includes("--band:"), "and the bands have a token in both themes");
});

test("nothing in the page rolls a die", () => {
  // Determinism is the index's central promise and the viewer is a consumer of it: the same index
  // must open the same way, on every machine, every time. Seeding is index-derived.
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  assert.ok(!/Math\.random\s*\(/.test(html), "no randomness — the word survives only in comments");
  assert.ok(!/Date\.now\s*\(|new Date\b/.test(html), "and no clock");
});

test("prominence follows inbound count, so the map is not a wall of labels", () => {
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  // Every node drawing a full chip put 162 labels on screen at equal weight, which says nothing
  // about structure: the file a third of the repo imports looked exactly like a leaf test.
  assert.ok(html.includes("HUB_MIN"), "there is an inbound threshold");
  assert.ok(html.includes("Math.sqrt(n.ind)"), "and the radius scale is compressed, not linear");
  const rule = html.slice(html.indexOf("const wantChip="), html.indexOf("function bands("));
  for (const clause of ["HUB.has(n.id)", "n.pin", "NB.has(n.id)", "MT.has(n.id)"]) {
    assert.ok(rule.includes(clause), `a chip is wanted for ${clause}`);
  }
  assert.ok(rule.includes("scale>=CHIP_LOD"), "and nothing is labelled below the legibility floor");
  // Picking reads the same predicate rather than a copy of it. Two copies is how you get a chip
  // that is visible and not clickable, which no screenshot shows.
  assert.ok(html.includes("if(showChip(n)){if(Math.abs(dx)<=n.w/2"), "picking asks showChip too");
});

test("reduced motion settles rather than animating", () => {
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  assert.ok(html.includes("prefers-reduced-motion"), "the preference is read");
  assert.ok(html.includes("if(REDUCED)settle()"), "and the same steps run before the first frame");
});

test("an edge carries its source area's colour", () => {
  const html = renderHtml(buildView(idx(), "/tmp/x"));
  assert.ok(html.includes("'rgba('+e.s.rgb+'"), "so a bundle can be traced across rows");
  assert.ok(html.includes("rgba('+EC+',.13)"), "and everything else dims out of the way on hover");
});

// ── the settled layout, measured ───────────────────────────────────────────────────────────────
// Everything above asserts that a decision is still written in the source. None of it can see what
// a reader sees, and the first layered version shipped with `cort|di|m|setup|s|s|version.js` across
// its top band — 43 chips on one line at 1900px is 44px each, against the 86-210px a filename
// needs, so every chip clipped its neighbour into a sliver. Every test in this file passed. These
// run the page's own script (see `browser.mjs`) and measure what the draw loop actually paints.

function bigView(n = 60) {
  // One crowded band is the shape that broke: many files at the same depth, all competing for one
  // line. Fixtures with four files cannot express it, which is why the defect reached a screenshot.
  const files = Array.from({ length: n }, (_, i) => ({
    path: `pkg/mod${i}-with-a-longish-name.js`, lang: "javascript", category: "code",
    lines: 10 + i, commits: n - i, isTest: false, isEntry: false,
    imports: i < n - 1 ? ["pkg/core.js"] : [], inbound: 0,
  }));
  files.push({ path: "pkg/core.js", lang: "javascript", category: "code", lines: 5, commits: 99,
    isTest: false, isEntry: false, imports: [], inbound: n - 1 });
  return buildView(idx({
    files,
    edges: files.filter((f) => f.imports.length).map((f) => ({ from: f.path, to: "pkg/core.js", type: "imports" })),
    layers: [{ depth: 0, paths: ["pkg/core.js"] }, { depth: 1, paths: files.slice(0, n - 1).map((f) => f.path) }],
    areas: [],
  }), "/tmp/x");
}

test("no two drawn chips overlap, however crowded the band", () => {
  const page = runPage(bigView(60), { width: 1900, height: 1000 });
  assert.deepEqual(page.overlaps(), [], "chip rectangles must not intersect");
  assert.ok(page.chips.length > 0, "and some chips are actually drawn, or this proves nothing");
});

test("a crowded band wraps onto sub-rows instead of crushing one line", () => {
  const page = runPage(bigView(60), { width: 1900, height: 1000 });
  const lanes = new Set(page.ROWS[1].map((n) => n.y));
  assert.ok(lanes.size > 1, `59 files on one depth need more than one sub-row, got ${lanes.size}`);
  // Wrapping is worth nothing if a node escapes the band its depth names.
  page.ROWS.forEach((r, i) => {
    for (const n of r) {
      assert.ok(n.y >= page.BTOP[i] && n.y <= page.BTOP[i] + page.BH[i], `${n.label} is inside band ${i}`);
    }
  });
});

test("the chip budget is a cap, not a target", () => {
  const page = runPage(bigView(60), { width: 1900, height: 1000 });
  const graphChips = page.chips.filter((n) => !n.pin);
  assert.ok(graphChips.length <= page.HUB_MAX,
    `${graphChips.length} labels drawn against a budget of ${page.HUB_MAX}`);
});

test("nothing is drawn outside the band box, so no label is clipped", () => {
  // The band's own label lives inside that box at its left edge. Fitting the nodes instead of the
  // box put the left edge off screen and band 0's label rendered as "ounda…".
  const page = runPage(bigView(60), { width: 1900, height: 1000 });
  for (const n of page.chips) {
    assert.ok(n.x - n.w / 2 >= page.bandL, `${n.label} starts inside the band box`);
    assert.ok(n.x + n.w / 2 <= page.bandR, `${n.label} ends inside the band box`);
  }
  assert.ok(page.bandL * page.scale + page.tx >= 0, "and the box itself is on screen");
});

test("hovering names the neighbourhood without stacking labels", () => {
  // The hub budget reserves chip-width room for its own; a hovered node's neighbours are promoted
  // onto positions that only ever reserved a dot. This is the case the demotion rule exists for —
  // and the one place a screenshot will not help, because it needs a cursor.
  const page = runPage(bigView(60), { width: 1900, height: 1000, hover: "pkg/core.js" });
  assert.deepEqual(page.overlaps(), [], "promoted neighbours must not collide with anything");
  assert.ok(page.CHIPS.has("pkg/core.js"), "what the cursor is on always keeps its label");
  assert.ok(page.chips.length > page.HUB.size, "and the neighbourhood adds some");
});

test("the same index settles to the same layout", () => {
  // Determinism is only observable from outside, and a layout is the part of this page that could
  // most easily stop being deterministic without anything else noticing.
  const a = runPage(bigView(30)), b = runPage(bigView(30));
  assert.deepEqual(a.N.map((n) => [n.id, n.x, n.y]), b.N.map((n) => [n.id, n.x, n.y]));
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
  assert.match(page.html("ovbar"), /indexed <b>date not available<\/b>/);
  assert.match(page.html("ovbar"), /Cortex v9\.9\.9/);
});

test("the Structure tab names what is missing and the command that writes it", () => {
  const page = runOverview(buildView(idx(), "/tmp/x"));
  const s = page.html("spane");
  assert.match(s, /no root AGENTS\.md/);
  assert.match(s, /\/cortex-brief src\//, "an area with no scoped brief names the command");
  assert.match(s, /no CONTEXT\.md/);
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

test("the cloud draws 2,000 files in one pass per frame, fast enough to turn smoothly", () => {
  // A frame is one path for every import and one sprite per file. A stroke per edge, or a pass that
  // is quadratic in files, is what makes a large repo stutter — and it is invisible on this repo.
  const page = runOverview(buildView(bigIndex(2000), "/tmp/x"));
  assert.equal(page.OV.count, 2000);
  const before = { ...page.calls };
  const t0 = performance.now();
  for (let i = 0; i < 30; i++) page.OV.frame();
  const ms = (performance.now() - t0) / 30;
  assert.equal((page.calls.drawImage - before.drawImage) / 30, 2000, "one sprite per file");
  assert.ok((page.calls.stroke - before.stroke) / 30 <= 2, "the links are one stroke, not thousands");
  assert.ok(ms < 12, `a frame took ${ms.toFixed(2)}ms of script time`);
});

test("the same index opens as the same cloud", () => {
  const a = runOverview(buildView(bigIndex(300), "/tmp/x"));
  const b = runOverview(buildView(bigIndex(300), "/tmp/x"));
  assert.deepEqual([...a.OV.points()], [...b.OV.points()], "every file lands in the same place");
  assert.equal(renderHtml(buildView(bigIndex(300), "/tmp/x")), renderHtml(buildView(bigIndex(300), "/tmp/x")));
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
