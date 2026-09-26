// view.mjs — turn index.json into the data one self-contained HTML page needs.
//
// The vault has had a force-graph viewer since v1 (tools/cortex.sh), but it walks vault folders and
// follows [[wikilinks]]. Pointed at a codebase it finds nothing and cheerfully writes an empty
// graph. This is the codebase half: the nodes are files, the edges are resolved imports, and the
// gaps are the ones the index can actually prove.
//
// Deterministic, like everything else in index/: same index.json, same bytes out. Colours come
// from a fixed palette indexed by sorted area order, never from a hash of a name.

import { buildCoverage } from "./coverage.mjs";
import { findOrphans } from "./orphans.mjs";

// Enough hues to separate the areas a reader can hold at once; past that they repeat, which is
// honest — a repo with 30 top-level areas has a structure problem the colours should not hide.
// Mid-luminance on purpose: the same swatch has to hold on a deep blue-slate canvas and on a white
// one, because the page follows the OS theme. Saturated-dark hues vanish on the first and pastels
// vanish on the second, and a brighter set measured 1.7:1 against the light ground — a dot nobody
// could find. Every entry here clears 2.6:1 on both. The first eight are also the most separated
// from each other, because a repo with eight top-level areas uses exactly those and no more; the
// pairs that are hard to tell apart (sky/periwinkle, amber/olive) are pushed past that mark.
const PALETTE = [
  "#3d8bf2", "#e07d1e", "#1a9d5a", "#8b4ef0", "#e0417e", "#0f8fa8",
  "#6fa314", "#bd40c9", "#5f6df0", "#8a7f3d", "#e0523a", "#1aa6d8",
];
const GREY = "#8b97ab";

const CATEGORY_SHAPE = { code: "dot", docs: "square", config: "diamond", script: "triangle", other: "dot" };

function areaOf(path) {
  const cut = path.indexOf("/");
  return cut === -1 ? "(root)" : path.slice(0, cut);
}

// A basename is a useless label when the convention is `index.*`: a React app drew a dozen nodes all
// reading "index.jsx" and the map became unreadable. Barrel and route files get their directory,
// which is the name a developer actually calls them by.
const BARREL = /^(index|main|mod|__init__|route|page|layout)\.[^.]+$/;
function labelOf(path) {
  const parts = path.split("/");
  const base = parts[parts.length - 1];
  if (parts.length > 1 && BARREL.test(base)) return parts[parts.length - 2] + "/" + base;
  return base;
}

// The agent shims Cortex writes, and the ones other tools read. Present only if the index has them.
const SHIMS = ["CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md", ".cursorrules"];

/**
 * The context layer as a tree: the root brief, what hangs beside it (shims, glossary, decisions,
 * review rules), and under it every area with the scoped brief that routes to it, if any, its
 * most-imported files and how many of its files are tests. Built from indexed paths only — a
 * document that is not tracked does not exist as far as an agent opening the repo is concerned.
 */
function buildStructure(files, areas, colorOf) {
  const paths = new Set(files.map((f) => f.path));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const briefs = files.filter((f) => f.path.endsWith("/AGENTS.md")).map((f) => f.path).sort();
  const area = (a) => {
    const own = (a.paths ?? []).map((p) => byPath.get(p)).filter(Boolean);
    const brief = briefs.find((b) => b === `${a.name}/AGENTS.md`) ?? briefs.find((b) => b.startsWith(`${a.name}/`)) ?? null;
    const key = own
      .filter((f) => f.category === "code" && !f.isTest)
      .sort((x, y) => (y.inbound ?? 0) - (x.inbound ?? 0) || (y.commits ?? 0) - (x.commits ?? 0) || (x.path < y.path ? -1 : 1))
      .slice(0, 3)
      .map((f) => ({ path: f.path, inbound: f.inbound ?? 0 }));
    return {
      name: a.name,
      color: colorOf.get(a.name) ?? GREY,
      files: own.length,
      code: own.filter((f) => f.category === "code" || f.category === "script").length,
      tests: own.filter((f) => f.isTest).length,
      brief,
      key,
    };
  };
  return {
    root: paths.has("AGENTS.md") ? "AGENTS.md" : null,
    shims: SHIMS.filter((p) => paths.has(p)),
    glossary: paths.has("CONTEXT.md") ? "CONTEXT.md" : null,
    adrs: files.filter((f) => /^docs\/adr\/\d{4}-.+\.md$/.test(f.path)).length,
    review: paths.has("REVIEW.md") ? "REVIEW.md" : null,
    briefs,
    // Areas with code first — they are what a brief routes to — then by size.
    areas: areas.map(area).sort((a, b) => (b.code > 0) - (a.code > 0) || b.files - a.files || (a.name < b.name ? -1 : 1)),
  };
}

// Orphans come from lib/orphans.mjs, shared with findings.mjs. There used to be a copy here, and
// the two would have drifted the moment either learned something — which is exactly what happened
// when the shared version learned that a file named by an ADR or a shell test is not unreferenced.

export function buildView(index, root, opts = {}) {
  const files = index.files ?? [];
  const edges = (index.edges ?? []).filter((e) => e.type === "imports");
  const enrichment = opts.enrichment ?? null;

  // `mergeEnrichment` writes `files` as an object keyed by path. This read the shape it expected
  // rather than the shape that exists — `summaries`, an array — so a complete enrichment attached
  // nothing and the cards stayed bare. Nothing errored: enrichment is optional, so an empty result
  // is indistinguishable from a repo that never ran it, which is what let the mismatch survive
  // alongside the filename one above it. Both forms are accepted now, and the object form is what
  // is actually produced.
  const summaries = new Map();
  const rows = enrichment?.files
    ? (Array.isArray(enrichment.files) ? enrichment.files : Object.values(enrichment.files))
    : (enrichment?.summaries ?? []);
  for (const s of rows) {
    if (s?.path) summaries.set(s.path, { summary: s.summary ?? "", role: s.role ?? "", tags: s.tags ?? [] });
  }

  // Colour only the areas that actually reach the Map, in sorted order. Indexing the palette over
  // every area instead wasted hues on directories that never draw and wrapped early: on this repo
  // `.claude` and `index` came out the same orange, and `core` and `skills` the same red — a legend
  // where two rows share a swatch cannot be read.
  const inMapCategory = (f) => f.category === "code" || f.category === "script";
  const mapAreas = [...new Set(files.filter(inMapCategory).map((f) => areaOf(f.path)))].sort();
  const colorOf = new Map(mapAreas.map((a, i) => [a, PALETTE[i % PALETTE.length]]));

  // Depth of a file in the layer stack, so the graph can be read top-down rather than as a hairball.
  const depthOf = new Map();
  for (const layer of index.layers ?? []) {
    for (const p of layer.paths ?? []) depthOf.set(p, layer.depth);
  }

  let coverage = null;
  try {
    coverage = buildCoverage(index, root);
  } catch {
    coverage = null;
  }
  // Coverage is the shared three-signal heuristic, not a second copy of it. Every "untested" below
  // means "no name, import or quoted mention ties a test to this file" — a floor, like impact's.
  const tested = new Set();
  if (coverage) {
    for (const f of files) {
      if (f.category === "code" && !f.isTest && coverage.isCovered(f.path)) tested.add(f.path);
    }
  }

  const inGraph = new Set(files.map((f) => f.path));
  const maxCommits = Math.max(1, ...files.map((f) => f.commits ?? 0));

  const nodes = files
    .filter((f) => f.category !== "other")
    .map((f) => {
      const deg = (f.inbound ?? 0) + (f.imports ?? []).length;
      const area = areaOf(f.path);
      const enr = summaries.get(f.path) ?? null;
      return {
        id: f.path,
        label: labelOf(f.path),
        path: f.path,
        area,
        lang: f.lang,
        category: f.category,
        shape: CATEGORY_SHAPE[f.category] ?? "dot",
        // Anything that reaches the Map is coloured by its area; the legend swatch and the node
        // must agree, or the legend is decoration. Docs and config keep grey — they never draw.
        color: inMapCategory(f) ? colorOf.get(area) : GREY,
        lines: f.lines ?? 0,
        commits: f.commits ?? 0,
        heat: Math.round(((f.commits ?? 0) / maxCommits) * 100),
        depth: depthOf.has(f.path) ? depthOf.get(f.path) : null,
        // Only things that can have import edges go on the Map. A repo's markdown outnumbered its
        // code 152 to 98 here, and every one of those nodes was isolated — a field of grey squares
        // that pushed the actual graph off screen. They stay searchable in Files; they just are
        // not a graph.
        inMap: inMapCategory(f),
        isTest: !!f.isTest,
        isEntry: !!f.isEntry,
        tested: tested.has(f.path),
        out: (f.imports ?? []).length,
        in: f.inbound ?? 0,
        r: 4 + Math.min(8, deg),
        deg,
        summary: enr?.summary ?? "",
        role: enr?.role ?? "",
        tags: enr?.tags ?? [],
      };
    });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links = edges
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e) => ({ source: e.from, target: e.to }));

  const orphans = findOrphans(index, root)
    .map((f) => f.path)
    .filter((p) => inGraph.has(p));
  const untested = files
    .filter((f) => f.category === "code" && !f.isTest && !tested.has(f.path))
    .sort((a, b) => (b.commits ?? 0) - (a.commits ?? 0))
    .slice(0, 40)
    .map((f) => ({ path: f.path, commits: f.commits ?? 0 }));
  const hot = files
    .filter((f) => f.category === "code")
    .sort((a, b) => (b.commits ?? 0) - (a.commits ?? 0))
    .slice(0, 20)
    .map((f) => ({ path: f.path, commits: f.commits ?? 0, lines: f.lines ?? 0, tested: tested.has(f.path) }));

  const areaCards = (index.areas ?? []).map((a) => {
    const paths = a.paths ?? [];
    const code = paths.filter((p) => files.find((f) => f.path === p)?.category === "code").length;
    const lines = paths.reduce((n, p) => n + (files.find((f) => f.path === p)?.lines ?? 0), 0);
    return {
      name: a.name,
      description: a.description ?? "",
      files: paths.length,
      code,
      lines,
      color: colorOf.get(a.name) ?? GREY,
      hasBrief: paths.some((p) => p.endsWith("/AGENTS.md")),
    };
  });

  const testable = files.filter((f) => f.category === "code" && !f.isTest).length;

  return {
    generated: { commit: index.commit ?? "", version: index.version ?? "", root },
    structure: buildStructure(files, index.areas ?? [], colorOf),
    overview: opts.overview ?? null,
    nodes,
    links,
    areas: areaCards,
    stack: index.stack ?? {},
    stats: {
      files: index.stats?.files ?? files.length,
      lines: index.stats?.lines ?? 0,
      edges: links.length,
      tests: index.stats?.tests ?? 0,
      // Coverage as a share of the code that COULD have a test — tests themselves and docs are not
      // in the denominator. `null` when the coverage pass could not run, never 0%.
      testable,
      tested: coverage ? tested.size : null,
      languages: index.stats?.languages ?? {},
      skipped: index.stats?.skipped ?? [],
      enriched: summaries.size,
    },
    gaps: {
      orphans,
      // `index.cycles` is `depth.cyclic` — a FLAT list of the paths that sit in some strongly
      // connected component, not a list of cycles. Reading it as an array of arrays crashed the
      // page on the first real repo that had one: ai-os has zero cycles and the unit fixture used
      // `[]`, so the branch had never run. Normalised here, and named for what it holds.
      cyclicFiles: (index.cycles ?? []).flat().filter((p) => typeof p === "string"),
      untested,
      hot,
      coverage: coverage ? { known: true } : { known: false },
    },
    next: opts.next ?? null,
  };
}
