// view.mjs — turn index.json into the data one self-contained HTML page needs.
//
// The vault has had a force-graph viewer since v1 (tools/cortex.sh), but it walks vault folders and
// follows [[wikilinks]]. Pointed at a codebase it finds nothing and cheerfully writes an empty
// graph. This is the codebase half: the nodes are files, the edges are resolved imports, and the
// gaps are the ones the index can actually prove.
//
// Deterministic, like everything else in index/: same index.json, same bytes out. Colours come
// from a fixed palette indexed by sorted area order, never from a hash of a name.

import { basename, resolve } from "node:path";
import { homedir } from "node:os";
import { codeCoverage } from "./findings.mjs";
import { briefCandidates, TOOLING_DIRS } from "./layers.mjs";
import { findOrphans } from "./orphans.mjs";
import { ADR_DIRS, isAdrRecord } from "./adr.mjs";

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
function labelOf(path, depth = 1) {
  const parts = path.split("/");
  const base = parts[parts.length - 1];
  const keep = Math.max(depth, parts.length > 1 && BARREL.test(base) ? 2 : 1);
  return parts.slice(-keep).join("/");
}

/**
 * One label per path, unique wherever the paths allow it. The same argument as the barrel rule, for
 * every other name: zustand has `src/shallow.ts`, `src/react/shallow.ts` and `src/vanilla/shallow.ts`,
 * and the Map drew three chips reading "shallow.ts". A label that repeats takes one more directory
 * until it no longer does, and only the labels that collide pay for it.
 */
function uniqueLabels(paths) {
  const depth = new Map(paths.map((p) => [p, 1]));
  for (let round = 0; round < 8; round++) {
    const seen = new Map();
    for (const p of paths) {
      const l = labelOf(p, depth.get(p));
      if (!seen.has(l)) seen.set(l, []);
      seen.get(l).push(p);
    }
    let grew = false;
    for (const group of seen.values()) {
      if (group.length < 2) continue;
      for (const p of group) {
        if (depth.get(p) < p.split("/").length) {
          depth.set(p, depth.get(p) + 1);
          grew = true;
        }
      }
    }
    if (!grew) break;
  }
  return new Map(paths.map((p) => [p, labelOf(p, depth.get(p))]));
}

// Every spelling of the machine's own paths that could reach the page. The page is a file people
// share — attached to a PR, published as a demo — and the index handed it the absolute root, so
// `C:\Users\<name>\…` rode along in the inlined data. The view carries the repo's NAME and
// repo-relative paths only; this is the backstop for any string that still quotes the root, such as
// a git or findings error message.
function machinePaths(root) {
  const out = new Set();
  for (const p of [root, root && resolve(root), homedir()]) {
    if (!p || p.length < 4) continue;
    for (const v of [p, p.replace(/\\/g, "/"), p.replace(/\//g, "\\")]) out.add(v);
  }
  // Longest first, so the root is replaced whole before the home directory inside it.
  return [...out].sort((a, b) => b.length - a.length);
}

function scrubPaths(value, paths) {
  if (!paths.length) return value;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(paths.map(esc).join("|"), "gi");
  const walk = (v) => {
    if (typeof v === "string") return v.replace(re, "…");
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}

// The agent shims Cortex writes, and the ones other tools read. Present only if the index has them.
const SHIMS = ["CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md", ".cursorrules"];

/**
 * The context layer as a tree: the root brief, what hangs beside it (shims, glossary, decisions,
 * review rules), and under it every area with the scoped brief that routes to it, if any, its
 * most-imported files and how many of its files are tests. Built from indexed paths only — a
 * document that is not tracked does not exist as far as an agent opening the repo is concerned.
 */
// "Code" on every surface of this page means the same thing: a file that can have an import edge,
// which is what the Map draws. The Areas tab counted `code` alone while the Structure tab counted
// code and scripts, so one area showed two different code counts on two tabs.
const isCodeish = (f) => f.category === "code" || f.category === "script";

// The root area is the files at the top of the tree. `inferAreas` names it "root", which is a label,
// not a directory: the tab offered `/cortex-brief root/` for a folder that does not exist. It is
// recognised by its paths, so a real directory that happens to be called `root/` is still one.
const isRootArea = (a) => (a.paths ?? []).length > 0 && (a.paths ?? []).every((p) => !p.includes("/"));

/**
 * Which brief serves an area, and how. `own` is `<area>/AGENTS.md`; `inherits` is the nearest
 * ancestor's, because a nested AGENTS.md is loaded for everything beneath it. A brief BELOW an area
 * serves only its own subtree, so it never counts for the parent — the tab said `src/` had a brief
 * because `src/middleware/AGENTS.md` started with `src/`, and the headline counted three briefs
 * where two existed.
 */
function briefFor(a, briefPaths, rootBrief) {
  if (isRootArea(a)) return { own: rootBrief, inherits: null, root: true };
  const own = briefPaths.has(`${a.name}/AGENTS.md`) ? `${a.name}/AGENTS.md` : null;
  let inherits = null;
  if (!own) {
    const parts = a.name.split("/");
    for (let i = parts.length - 1; i > 0 && !inherits; i--) {
      const up = `${parts.slice(0, i).join("/")}/AGENTS.md`;
      if (briefPaths.has(up)) inherits = up;
    }
    if (!inherits && rootBrief) inherits = rootBrief;
  }
  return { own, inherits, root: false };
}

function buildStructure(files, areas, colorOf, { tested, labels }) {
  const paths = new Set(files.map((f) => f.path));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const briefs = files.filter((f) => f.path.endsWith("/AGENTS.md")).map((f) => f.path).sort();
  const briefPaths = new Set(briefs);
  const rootBrief = paths.has("AGENTS.md") ? "AGENTS.md" : null;
  // The command a missing brief names is the one the findings report would offer: the same
  // ranking, so the tab cannot suggest a brief for a one-file directory or for `.claude/` while the
  // report, reading the same index, says no such thing.
  const candidates = new Set(briefCandidates(files, { tested }).map((c) => c.dir).filter((d) => !briefPaths.has(`${d}/AGENTS.md`)));
  const area = (a) => {
    const own = (a.paths ?? []).map((p) => byPath.get(p)).filter(Boolean);
    const brief = briefFor(a, briefPaths, rootBrief);
    const key = own
      .filter((f) => f.category === "code" && !f.isTest)
      .sort((x, y) => (y.inbound ?? 0) - (x.inbound ?? 0) || (y.commits ?? 0) - (x.commits ?? 0) || (x.path < y.path ? -1 : 1))
      .slice(0, 3)
      .map((f) => ({ path: f.path, label: labels.get(f.path) ?? f.path, inbound: f.inbound ?? 0 }));
    // Tests are the coverage signal, not a directory listing. zustand keeps every test in a
    // top-level `tests/`, and the tab said "no tests found" under each `src/` area those tests
    // import — the opposite of what the findings report said about the same files.
    const testable = own.filter((f) => f.category === "code" && !f.isTest);
    return {
      name: a.name,
      root: brief.root,
      color: colorOf.get(a.name) ?? GREY,
      files: own.length,
      code: own.filter(isCodeish).length,
      tests: own.filter((f) => f.isTest).length,
      testable: testable.length,
      tested: testable.filter((f) => tested.has(f.path)).length,
      brief: brief.own,
      inherits: brief.inherits,
      tooling: TOOLING_DIRS.has(a.name.split("/")[0]),
      suggest: !brief.root && !brief.own && candidates.has(a.name) ? `/cortex-brief ${a.name}/` : null,
      key,
    };
  };
  // Which of the ADR homes holds them, so the page names the directory that exists, and the file the
  // tab links to: a scaffold writes `TEMPLATE.md` and no records, which is "in place", not "missing".
  const adrDir = ADR_DIRS.find((d) => files.some((f) => f.path.startsWith(`${d}/`))) ?? null;
  const adrFiles = adrDir ? files.filter((f) => f.path.startsWith(`${adrDir}/`)).map((f) => f.path).sort() : [];
  return {
    root: rootBrief,
    shims: SHIMS.filter((p) => paths.has(p)),
    glossary: paths.has("CONTEXT.md") ? "CONTEXT.md" : null,
    adrs: files.filter((f) => isAdrRecord(f.path)).length,
    adrDir,
    adrGo: adrFiles.find((p) => /\/TEMPLATE\.md$/i.test(p)) ?? adrFiles[0] ?? null,
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

  // Coverage is the findings report's own answer (`codeCoverage`), not a loop of this file's. Every
  // "untested" below means "no name, import or quoted mention ties a test to this file" — a floor,
  // like impact's — and the count is the one the report's title prints.
  let coverage = null;
  try {
    coverage = codeCoverage({ ...index, files, edges: index.edges ?? [] }, root);
  } catch {
    coverage = null;
  }
  const untestedSet = new Set(coverage ? coverage.untested : []);
  const tested = new Set(coverage ? coverage.testable.filter((p) => !untestedSet.has(p)) : []);

  const inGraph = new Set(files.map((f) => f.path));
  const maxCommits = Math.max(1, ...files.map((f) => f.commits ?? 0));

  // Churn is only a signal when there is history behind it. A shallow clone holds one commit, so
  // every file reads "1 commits" and the hot-spot table is the first twenty files in path order,
  // presented as the busiest. The overview knows the clone is shallow; a history where nothing was
  // touched twice says the same thing without git's help.
  const churn = opts.overview?.shallow
    ? { known: false, reason: "this is a shallow clone, so git holds too little history to rank files by churn — `git fetch --unshallow` fetches the rest" }
    : files.length && maxCommits <= 1
      ? { known: false, reason: "no file has more than one commit in the history the index read, so there is nothing to rank by churn yet" }
      : { known: true, reason: null };

  const labels = uniqueLabels(files.filter((f) => f.category !== "other").map((f) => f.path));

  const nodes = files
    .filter((f) => f.category !== "other")
    .map((f) => {
      const deg = (f.inbound ?? 0) + (f.imports ?? []).length;
      const area = areaOf(f.path);
      const enr = summaries.get(f.path) ?? null;
      return {
        id: f.path,
        label: labels.get(f.path) ?? labelOf(f.path),
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
  // With no churn to rank by, the untested list is ranked by how much of the repo leans on a file
  // instead — and says so — rather than by a column of ones in path order.
  const byChurn = (a, b) => (b.commits ?? 0) - (a.commits ?? 0);
  const byInbound = (a, b) => (b.inbound ?? 0) - (a.inbound ?? 0) || (a.path < b.path ? -1 : 1);
  const untestedAll = files.filter((f) => f.category === "code" && !f.isTest && untestedSet.has(f.path));
  const untested = [...untestedAll]
    .sort(churn.known ? byChurn : byInbound)
    .slice(0, 40)
    .map((f) => ({ path: f.path, commits: f.commits ?? 0, inbound: f.inbound ?? 0 }));
  const hot = churn.known
    ? files
        .filter((f) => f.category === "code")
        .sort(byChurn)
        .slice(0, 20)
        .map((f) => ({ path: f.path, commits: f.commits ?? 0, lines: f.lines ?? 0, tested: tested.has(f.path) }))
    : [];

  const structure = buildStructure(files, index.areas ?? [], colorOf, { tested, labels });
  const briefOf = new Map(structure.areas.map((a) => [a.name, a]));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const areaCards = (index.areas ?? []).map((a) => {
    const paths = a.paths ?? [];
    const own = paths.map((p) => byPath.get(p)).filter(Boolean);
    const s = briefOf.get(a.name);
    return {
      name: a.name,
      description: a.description ?? "",
      files: paths.length,
      code: own.filter(isCodeish).length,
      lines: own.reduce((n, f) => n + (f.lines ?? 0), 0),
      color: colorOf.get(a.name) ?? GREY,
      // The Structure tab's answer, not a second one: `paths` of `src` never holds a nested brief,
      // and the root area's brief is the root AGENTS.md, which no "/AGENTS.md" suffix test finds.
      hasBrief: !!s?.brief,
      brief: s?.brief ?? null,
    };
  });

  const testable = coverage ? coverage.testable.length : files.filter((f) => f.category === "code" && !f.isTest).length;
  const mapIds = new Set(nodes.filter((n) => n.inMap).map((n) => n.id));

  // The sequence, minus the machine. `nextSteps` carries the absolute root and the whole disk state
  // for its own callers; the page needs the steps and the count, and nothing that names a home
  // directory.
  const seq = opts.next
    ? {
        steps: (opts.next.steps ?? []).map(({ id, title, cmd, done, optional, blocking, next, why }) => ({
          id, title, cmd, done: !!done, optional: !!optional, blocking: !!blocking, next: !!next, why,
        })),
        done: opts.next.done,
        total: opts.next.total,
        complete: !!opts.next.complete,
        perChange: opts.next.perChange ?? [],
      }
    : null;

  const view = {
    // The repo's NAME. The absolute root used to sit here, so every page carried
    // `C:\Users\<name>\…` in its inlined data — and the page is the file people share.
    generated: { commit: index.commit ?? "", version: index.version ?? "", repo: basename(resolve(root || ".")) || "repo" },
    structure,
    overview: opts.overview ?? null,
    nodes,
    links,
    areas: areaCards,
    stack: index.stack ?? {},
    // Every count the page prints, computed once here and read by every tab. Two numbers that differ
    // are two different fields with two different names — `edges` is every resolved import, the
    // same number cortex-index prints; `mapEdges` is the ones between two files the Map draws.
    stats: {
      files: index.stats?.files ?? files.length,
      lines: index.stats?.lines ?? 0,
      edges: index.stats?.edges ?? edges.length,
      mapFiles: mapIds.size,
      mapEdges: links.filter((l) => mapIds.has(l.source) && mapIds.has(l.target)).length,
      tests: index.stats?.tests ?? 0,
      // Coverage as a share of the code that COULD have a test — tests themselves and docs are not
      // in the denominator. `null` when the coverage pass could not run, never 0%.
      testable,
      tested: coverage ? tested.size : null,
      untested: coverage ? untestedAll.length : null,
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
      churn,
      coverage: coverage ? { known: true } : { known: false },
    },
    next: seq,
  };
  return scrubPaths(view, machinePaths(root));
}
