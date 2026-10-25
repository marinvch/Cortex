// graph.js — the `graph` tool: questions about a repo's import graph, answered from its index.
//
// Seven ops over `.cortex/index/index.json`, the file `index/cortex-index.mjs` writes:
//
//   stats      counts, and how old the index is
//   node       one file: its cluster, area, imports, importers, the tests that import it, its summary
//   neighbors  imports and importers out to a depth of 1 to 3
//   cluster    one cluster's members, hub, cohesion and areas
//   hubs       the graph report's hubs, the same list `cortex-graph.mjs --json` prints
//   bridges    the graph report's bridges, likewise
//   path       the shortest import path between two files, directed or not
//
// ## The seam
//
// `mcp/` may not import `index/`. The hubs and bridges are scored, and a second copy of the score
// would drift from the first, so the computation is `core/graph.js`, which `index/` re-exports and
// this module calls. Reading the index, refusing a format this build does not read, and deciding
// whether it is stale are `core/index-file.js`, for the same reason: "stale" has one definition.
// `node`, `neighbors`, `cluster` and `path` are plain reads of `files`, `edges` and `clusters`.
// Nothing here builds or writes an index; it never spawns the indexer either.
//
// ## Rules
//
// - **A missing, unreadable, wrong-format or stale index is refused, never answered from.** The
//   result says which, and gives the command that rebuilds it. An index older than the code is a
//   confident map of code that moved. Outside git, freshness cannot be told: the answer comes back
//   with `index.state: "unknown"` and the reason.
// - **Every file argument goes through `resolveInRoot`** (`core/paths.js`), so `../x` or a link out
//   of the repo is an `OutsideRootError`, never a lookup.
// - **Every list is capped** at `LIST_MAX`, and a capped list says so with the full count.
//   `hubs` and `bridges` are the report's top `TOP`, and `bridgeCount` is how many there were.
// - **Every count is a floor.** Imports are found by regex, so a dynamic import is not an edge.
//   `node` lists the tests that import a file, which is one of coverage's three signals, not all;
//   `index/cortex-impact.mjs` reads all three.

import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInRoot } from "../../core/paths.js";
import { repoTop } from "./gitsync.js";
import { defaultIndexPath, indexFreshness, readEnrichment, readIndex } from "../../core/index-file.js";
import { graphReport, isProductFile, TOP } from "../../core/graph.js";
import { inTestSupportDir, isTestData, layerKeyFor } from "../../core/path-kinds.js";

export const OPS = ["stats", "node", "neighbors", "cluster", "hubs", "bridges", "path"];
/** The longest list one answer carries. */
export const LIST_MAX = 50;
/** How far `neighbors` walks. */
export const DEPTH_MAX = 3;

// The indexer of this install, named in a refusal so the command is one an agent can run as is.
const INDEXER = fileURLToPath(new URL("../../index/cortex-index.mjs", import.meta.url));

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A question this tool cannot answer as asked: an unknown op, a missing argument, a file not indexed. */
export class GraphRefused extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GraphRefused";
    this.code = code;
  }
}

/**
 * The repo a brain's graph questions are about. A repo-mode root is a repo's `.cortex/`, so the
 * repo is the directory above it. With no brain (the CLI with no root set) it is the git work tree
 * `cwd` sits in, the same degradation `ai-os catch-up` makes: this writes nothing. A vault is not a
 * repo and is refused.
 *
 * @param {object|null} brain   from `openBrain`, or null
 * @param {{ cwd: string, top?: (cwd: string) => string|null }} where  `top` is a parameter so a test needs no git
 */
export function graphRepo(brain, { cwd, top = repoTop }) {
  if (brain?.isRepo) return dirname(resolve(brain.root));
  if (brain) {
    throw new GraphRefused("not_a_repo", "graph reads a repo's index, and this root is a vault. Point CORTEX_ROOT at a repo's .cortex/, or unset it and run from the repo.");
  }
  const repo = top(cwd);
  if (!repo) throw new GraphRefused("no_repo", "graph found no repo: the current directory is not inside a git repository and CORTEX_ROOT is not set.");
  return repo;
}

/**
 * Answer one graph question about `repo`.
 *
 * Returns `{ op, index, ...answer }`, or `{ op, refused: true, index, message, rebuild }` when the
 * index cannot be answered from. Throws `GraphRefused` for a question that is wrong, and
 * `OutsideRootError` for a file argument that leaves the repo.
 *
 * `tracked` is handed to `indexFreshness`, so a test can say which files git tracks.
 */
export function graphAnswer(repo, args = {}, { tracked } = {}) {
  // The question is checked before the index is read, so a path out of the repo is refused the
  // same way whatever state the index is in.
  const q = question(repo, args);
  const op = q.op;

  const indexPath = defaultIndexPath(repo);
  const rebuild = `node "${INDEXER}" "${repo}"`;
  const read = readIndex(indexPath, { rootArg: repo });
  if (read.problem) {
    // The first line says what is wrong; the rest is the index CLIs' rebuild hint, which `rebuild`
    // replaces with a command that names this install's indexer.
    return { op, refused: true, index: { state: read.kind }, message: read.problem.split("\n")[0], rebuild };
  }
  const index = read.index;

  const fresh = indexFreshness(repo, indexPath, tracked ? { tracked } : {});
  if (fresh.stale) {
    const n = fresh.changedSince.length;
    return {
      op,
      refused: true,
      index: { state: "stale", ageDays: fresh.ageDays, changedSince: fresh.changedSince },
      message:
        `The index is ${fresh.ageDays}d old and ${n}${n >= 5 ? "+" : ""} tracked file${n === 1 ? " is" : "s are"} newer, ` +
        "so it describes code that has moved. Rebuild it, then ask again.",
      rebuild,
    };
  }
  const state = {
    state: fresh.stale === false ? "fresh" : "unknown",
    ageDays: fresh.ageDays,
    commit: index.commit ?? null,
    ...(fresh.reason ? { reason: fresh.reason } : {}),
  };

  const g = new IndexGraph(repo, index);
  const answer = OP_HANDLERS[op](g, q);
  return { op, index: state, ...answer };
}

/**
 * The arguments, checked: a known op, the arguments it needs, a depth in range, and every file
 * argument through the root guard as a repo-relative path with `/` separators.
 */
function question(repo, args) {
  const op = args?.op;
  if (!OPS.includes(op)) {
    throw new GraphRefused("unknown_op", `graph needs an op, one of: ${OPS.join(", ")}${op ? ` (got "${op}")` : ""}`);
  }
  const given = (k) => typeof args[k] === "string" && args[k].trim() !== "";
  const need = (k) => {
    if (!given(k)) throw new GraphRefused("missing_argument", `${op} needs \`${k}\`, a file path relative to the repo`);
  };
  if (op === "node" || op === "neighbors") need("file");
  if (op === "path") { need("from"); need("to"); }
  if (op === "cluster" && !given("cluster") && !given("file")) {
    throw new GraphRefused("missing_argument", "cluster needs `cluster` (an id such as c1) or `file`");
  }

  const q = { op, directed: args.directed === true || args.directed === "true" };
  // resolveInRoot realpaths the root, so the path is made relative to the same real root.
  const base = resolveInRoot(repo, ".");
  for (const k of ["file", "from", "to"]) {
    if (given(k)) q[k] = relative(base, resolveInRoot(repo, args[k].trim())).split(sep).join("/");
  }
  if (given("cluster")) q.cluster = args.cluster.trim();
  if (op === "neighbors") {
    const depth = args.depth === undefined || args.depth === null ? 1 : Number(args.depth);
    if (!Number.isInteger(depth) || depth < 1 || depth > DEPTH_MAX) {
      throw new GraphRefused("bad_depth", `depth is a whole number from 1 to ${DEPTH_MAX}`);
    }
    q.depth = depth;
  }
  return q;
}

/** A capped, sorted list: `{ items, total, truncated }`. */
function capped(list) {
  return { items: list.slice(0, LIST_MAX), total: list.length, truncated: list.length > LIST_MAX };
}

/** The index as a graph over every file, tests included, with each edge once. */
class IndexGraph {
  constructor(repo, index) {
    this.repo = repo;
    this.index = index;
    this.files = new Map((index.files ?? []).map((f) => [f.path, f]));
    this.out = new Map();
    this.in = new Map();
    this.confidence = new Map();
    let edges = 0;
    for (const e of index.edges ?? []) {
      if (e.from === e.to || !this.files.has(e.from) || !this.files.has(e.to)) continue;
      if (!this.out.has(e.from)) this.out.set(e.from, new Set());
      if (this.out.get(e.from).has(e.to)) continue;
      this.out.get(e.from).add(e.to);
      if (!this.in.has(e.to)) this.in.set(e.to, new Set());
      this.in.get(e.to).add(e.from);
      this.confidence.set(`${e.from}\n${e.to}`, e.confidence ?? "extracted");
      edges++;
    }
    this.edgeCount = edges;
    this.clusters = new Map((index.clusters?.items ?? []).map((c) => [c.id, c]));
  }

  imports(p) {
    return [...(this.out.get(p) ?? [])].sort(byCodeUnit);
  }

  importers(p) {
    return [...(this.in.get(p) ?? [])].sort(byCodeUnit);
  }

  /** A checked, repo-relative path → the same path, when the index holds that file. */
  file(rel) {
    if (this.files.has(rel)) return rel;
    const tail = `/${rel}`;
    const near = [...this.files.keys()].filter((p) => p.endsWith(tail)).sort(byCodeUnit).slice(0, 5);
    throw new GraphRefused(
      "not_indexed",
      `${rel || "."} is not a file in the index` + (near.length ? `. Did you mean: ${near.join(", ")}` : ""),
    );
  }
}

/** What kind of file the graph report takes a path to be. */
function kindOf(f) {
  if (f.isTest) return "test";
  if (f.vendored) return "vendored";
  if (isTestData(f.path)) return "test data";
  if (inTestSupportDir(f.path)) return "test support";
  return "product";
}

function stats(g) {
  const report = graphReport(g.index);
  return {
    files: g.files.size,
    edges: g.edgeCount,
    clusters: report.clusters,
    unclustered: report.unclustered,
    cycles: report.cycles.length,
    cycleFiles: report.cycleFiles,
    testCycles: report.testCycles,
    bridgeCount: report.bridgeCount,
  };
}

function node(g, args) {
  const path = g.file(args.file);
  const f = g.files.get(path);
  const imports = g.imports(path);
  const importers = g.importers(path);
  const testsImporting = importers.filter((p) => g.files.get(p)?.isTest);
  const out = {
    path,
    cluster: f.cluster ?? null,
    area: layerKeyFor(path),
    kind: kindOf(f),
    inReport: isProductFile(f),
    lang: f.lang ?? null,
    lines: f.lines ?? null,
    imports: capped(imports),
    importers: capped(importers),
    testsImporting: capped(testsImporting),
  };
  const enrich = readEnrichment(g.repo, g.index);
  if (enrich.state === "ok") {
    const e = enrich.enrichment.files?.[path];
    out.summary = e ? { summary: e.summary ?? null, role: e.role ?? null, tags: e.tags ?? [] } : null;
  } else if (enrich.state !== "absent") {
    out.summary = null;
    out.summaryNote = enrich.note.trim();
  }
  return out;
}

function neighbors(g, args) {
  const path = g.file(args.file);
  const { depth } = args;
  const walk = (next) => {
    const seen = new Map([[path, 0]]);
    let frontier = [path];
    for (let d = 1; d <= depth && frontier.length; d++) {
      const found = [];
      for (const p of frontier) {
        for (const q of next(p)) {
          if (seen.has(q)) continue;
          seen.set(q, d);
          found.push(q);
        }
      }
      frontier = found.sort(byCodeUnit);
    }
    seen.delete(path);
    return [...seen].map(([p, d]) => ({ path: p, depth: d })).sort((a, b) => a.depth - b.depth || byCodeUnit(a.path, b.path));
  };
  return {
    path,
    depth,
    imports: capped(walk((p) => g.imports(p))),
    importers: capped(walk((p) => g.importers(p))),
  };
}

function cluster(g, args) {
  let id = args.cluster;
  if (!id) {
    const path = g.file(args.file);
    id = g.files.get(path).cluster;
    if (!id) return { cluster: null, file: path, note: `${path} imports and is imported by no indexed file, so it is in no cluster` };
  }
  const c = g.clusters.get(id);
  if (!c) {
    const n = g.clusters.size;
    throw new GraphRefused("not_found", n ? `no cluster ${id}; this index has ${n}, c1 to c${n}` : "this index has no clusters");
  }
  return {
    cluster: c.id,
    hub: c.hub,
    size: c.size,
    cohesion: c.cohesion,
    areas: c.areas,
    members: capped([...(c.files ?? [])].sort(byCodeUnit)),
  };
}

function hubs(g) {
  return { hubs: graphReport(g.index).hubs, top: TOP };
}

function bridges(g) {
  const report = graphReport(g.index);
  return { bridges: report.bridges, bridgeCount: report.bridgeCount, top: TOP };
}

function path(g, args) {
  const from = g.file(args.from);
  const to = g.file(args.to);
  const { directed } = args;
  const shortest = (next) => {
    const prev = new Map([[from, null]]);
    const queue = [from];
    while (queue.length && !prev.has(to)) {
      const v = queue.shift();
      for (const [w, step] of next(v)) {
        if (prev.has(w)) continue;
        prev.set(w, { v, step });
        queue.push(w);
      }
    }
    if (!prev.has(to)) return null;
    const steps = [];
    for (let x = to; prev.get(x); x = prev.get(x).v) {
      const { v, step } = prev.get(x);
      steps.push({ from: v, to: x, edge: step });
    }
    return steps.reverse();
  };
  const forward = (v) => g.imports(v).map((w) => [w, "imports"]);
  // Undirected: a file's imports, then its importers, each in path order, so the answer is stable.
  const both = (v) => [...forward(v), ...g.importers(v).map((w) => [w, "imported by"])];
  const steps = shortest(directed ? forward : both);
  const out = { from, to, directed };
  if (!steps) {
    out.found = false;
    if (directed) {
      out.note = reachable(to, from, forward)
        ? `${from} does not reach ${to} through imports, but ${to} reaches ${from}; ask again with from and to swapped`
        : `${from} does not reach ${to} through imports; ask with directed false to follow importers too`;
    } else {
      out.note = `${from} and ${to} are not connected by any import the index found`;
    }
    return out;
  }
  out.found = true;
  out.length = steps.length;
  out.path = [from, ...steps.map((s) => s.to)];
  out.steps = steps.map((s) => ({ ...s, confidence: confidenceOf(g, s) }));
  return out;
}

/** Whether `to` is reachable from `from` over `next`. */
function reachable(from, to, next) {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const v = queue.shift();
    if (v === to) return true;
    for (const [w] of next(v)) {
      if (seen.has(w)) continue;
      seen.add(w);
      queue.push(w);
    }
  }
  return false;
}

function confidenceOf(g, step) {
  const key = step.edge === "imports" ? `${step.from}\n${step.to}` : `${step.to}\n${step.from}`;
  return g.confidence.get(key) ?? "extracted";
}

const OP_HANDLERS = { stats, node, neighbors, cluster, hubs, bridges, path };
