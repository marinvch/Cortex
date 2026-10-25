// The `graph` tool: its ops over a hand-built index, its refusals, and the one comparison that
// matters — hubs, bridges and counts equal to what `index/cortex-graph.mjs --json` prints for the
// same repo. That test spawns the index CLIs as processes; nothing here imports `index/`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEPTH_MAX, GraphRefused, LIST_MAX, OPS, graphAnswer, graphRepo } from "../lib/graph.js";
import { INDEX_VERSION } from "../../core/index-file.js";
import { OutsideRootError } from "../../core/paths.js";
import { tempDir } from "./tmp.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const AI_OS = join(HERE, "..", "ai-os.js");
const SERVER = join(HERE, "..", "server.js");

const LONG_AGO = new Date("2026-01-01T00:00:00Z");

// src/a.js is the hub of c1; lib/ is c2 and reaches into src/; a test imports a.js; the readme is
// in no cluster.
const FILES = [
  { path: "src/a.js", isTest: false, cluster: "c1", lang: "javascript", lines: 10 },
  { path: "src/b.js", isTest: false, cluster: "c1", lang: "javascript", lines: 5 },
  { path: "src/c.js", isTest: false, cluster: "c1", lang: "javascript", lines: 3 },
  { path: "lib/d.js", isTest: false, cluster: "c2", lang: "javascript", lines: 4 },
  { path: "lib/e.js", isTest: false, cluster: "c2", lang: "javascript", lines: 4 },
  { path: "test/a.test.js", isTest: true, cluster: "c1", lang: "javascript", lines: 8 },
  { path: "docs/readme.md", isTest: false, lang: "markdown", lines: 2 },
];
const EDGES = [
  { from: "src/a.js", to: "src/b.js", type: "imports" },
  { from: "src/a.js", to: "src/c.js", type: "imports" },
  { from: "src/b.js", to: "src/c.js", type: "imports" },
  { from: "lib/d.js", to: "src/c.js", type: "imports" },
  { from: "lib/e.js", to: "lib/d.js", type: "imports" },
  { from: "test/a.test.js", to: "src/a.js", type: "imports" },
];
const CLUSTERS = {
  algorithm: "leiden", resolution: 1, unclustered: 0,
  items: [
    { id: "c1", hub: "src/a.js", size: 4, cohesion: 0.667, areas: { src: 3, test: 1 }, files: ["src/a.js", "src/b.js", "src/c.js", "test/a.test.js"] },
    { id: "c2", hub: "lib/d.js", size: 2, cohesion: 1, areas: { lib: 2 }, files: ["lib/d.js", "lib/e.js"] },
  ],
};

/** A repo whose files are older than its index, and the tracked list to hand freshness. */
function fixture({ files = FILES, edges = EDGES, clusters = CLUSTERS, extra = {} } = {}) {
  const repo = tempDir("cortex-graph-");
  for (const f of files) {
    const p = join(repo, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "");
    utimesSync(p, LONG_AGO, LONG_AGO);
  }
  writeIndex(repo, { version: INDEX_VERSION, commit: "abc1234def", files, edges, clusters, cycles: [], ...extra });
  return { repo, tracked: () => files.map((f) => f.path) };
}

function writeIndex(repo, index) {
  const dir = join(repo, ".cortex", "index");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.json"), typeof index === "string" ? index : JSON.stringify(index));
}

const ask = (fx, args) => graphAnswer(fx.repo, args, { tracked: fx.tracked });

test("stats counts files, edges, clusters and cycles off the index", () => {
  const fx = fixture();
  const r = ask(fx, { op: "stats" });
  assert.equal(r.refused, undefined);
  assert.equal(r.index.state, "fresh");
  assert.equal(r.index.commit, "abc1234def");
  assert.equal(r.files, 7);
  assert.equal(r.edges, 6);
  assert.equal(r.clusters, 2);
  assert.equal(r.cycles, 0);
  assert.equal(r.bridgeCount, 1, "lib/d.js -> src/c.js is the one import between product files in two clusters");
});

test("an edge listed twice counts once, and an edge to a file the index lacks is not an edge", () => {
  const fx = fixture({ edges: [...EDGES, EDGES[0], { from: "src/a.js", to: "gone.js", type: "imports" }, { from: "src/a.js", to: "src/a.js", type: "imports" }] });
  assert.equal(ask(fx, { op: "stats" }).edges, 6);
});

test("node gives the cluster, area, imports, importers and the tests that import it", () => {
  const fx = fixture();
  const r = ask(fx, { op: "node", file: "src/a.js" });
  assert.equal(r.path, "src/a.js");
  assert.equal(r.cluster, "c1");
  assert.equal(r.area, "src");
  assert.equal(r.kind, "product");
  assert.deepEqual(r.imports.items, ["src/b.js", "src/c.js"]);
  assert.deepEqual(r.importers.items, ["test/a.test.js"]);
  assert.deepEqual(r.testsImporting.items, ["test/a.test.js"]);
  assert.equal(r.summary, undefined, "no enrichment, no summary field");
  const t = ask(fx, { op: "node", file: "test/a.test.js" });
  assert.equal(t.kind, "test");
  assert.equal(t.inReport, false);
  assert.equal(ask(fx, { op: "node", file: "docs/readme.md" }).cluster, null);
});

test("node accepts a path with ./ or backslashes, and resolves it to the indexed path", () => {
  const fx = fixture();
  assert.equal(ask(fx, { op: "node", file: "./src/b.js" }).path, "src/b.js");
  if (process.platform === "win32") assert.equal(ask(fx, { op: "node", file: "src\\b.js" }).path, "src/b.js");
});

test("node shows the summary only when the enrichment describes this index", () => {
  const fx = fixture();
  const enriched = (doc) => writeFileSync(join(fx.repo, ".cortex", "index", "enriched.json"), JSON.stringify(doc));
  enriched({ indexCommit: "abc1234def", coverage: { indexed: 7 }, files: { "src/a.js": { path: "src/a.js", summary: "Wires b and c together.", role: "entry", tags: ["core"] } } });
  const ok = ask(fx, { op: "node", file: "src/a.js" });
  assert.deepEqual(ok.summary, { summary: "Wires b and c together.", role: "entry", tags: ["core"] });
  assert.equal(ask(fx, { op: "node", file: "src/b.js" }).summary, null, "enriched, but not this file");

  enriched({ indexCommit: "0000000000", coverage: { indexed: 7 }, files: { "src/a.js": { summary: "old" } } });
  const stale = ask(fx, { op: "node", file: "src/a.js" });
  assert.equal(stale.summary, null);
  assert.match(stale.summaryNote, /does not describe this index/);
});

test("neighbors walks imports and importers out to the depth asked, and no further", () => {
  const fx = fixture();
  const one = ask(fx, { op: "neighbors", file: "lib/d.js" });
  assert.deepEqual(one.imports.items, [{ path: "src/c.js", depth: 1 }]);
  assert.deepEqual(one.importers.items, [{ path: "lib/e.js", depth: 1 }]);
  const two = ask(fx, { op: "neighbors", file: "src/c.js", depth: 2 });
  assert.deepEqual(two.importers.items, [
    { path: "lib/d.js", depth: 1 },
    { path: "src/a.js", depth: 1 },
    { path: "src/b.js", depth: 1 },
    { path: "lib/e.js", depth: 2 },
    { path: "test/a.test.js", depth: 2 },
  ]);
  assert.equal(two.imports.total, 0);
  for (const depth of [0, DEPTH_MAX + 1, 1.5, "x"]) {
    assert.throws(() => ask(fx, { op: "neighbors", file: "src/c.js", depth }), (e) => e instanceof GraphRefused && e.code === "bad_depth", String(depth));
  }
});

test("cluster answers by id or by a member file", () => {
  const fx = fixture();
  const byId = ask(fx, { op: "cluster", cluster: "c2" });
  assert.equal(byId.hub, "lib/d.js");
  assert.deepEqual(byId.members.items, ["lib/d.js", "lib/e.js"]);
  assert.deepEqual(byId.areas, { lib: 2 });
  assert.equal(ask(fx, { op: "cluster", file: "src/b.js" }).cluster, "c1");
  assert.equal(ask(fx, { op: "cluster", file: "docs/readme.md" }).cluster, null);
  assert.throws(() => ask(fx, { op: "cluster", cluster: "c9" }), /no cluster c9; this index has 2/);
  assert.throws(() => ask(fx, { op: "cluster" }), (e) => e.code === "missing_argument");
});

test("path finds the shortest route, says which way each step goes, and is flagged directed or not", () => {
  const fx = fixture();
  const und = ask(fx, { op: "path", from: "lib/e.js", to: "src/a.js" });
  assert.equal(und.directed, false);
  assert.equal(und.found, true);
  assert.deepEqual(und.path, ["lib/e.js", "lib/d.js", "src/c.js", "src/a.js"]);
  assert.deepEqual(und.steps.map((s) => s.edge), ["imports", "imports", "imported by"]);
  assert.ok(und.steps.every((s) => s.confidence === "extracted"));

  const dir = ask(fx, { op: "path", from: "lib/e.js", to: "src/c.js", directed: true });
  assert.equal(dir.directed, true);
  assert.deepEqual(dir.path, ["lib/e.js", "lib/d.js", "src/c.js"]);

  const back = ask(fx, { op: "path", from: "src/c.js", to: "lib/e.js", directed: true });
  assert.equal(back.found, false);
  assert.match(back.note, /lib\/e\.js reaches src\/c\.js/);

  const none = ask(fx, { op: "path", from: "docs/readme.md", to: "src/a.js" });
  assert.equal(none.found, false);
  assert.match(none.note, /not connected/);

  const self = ask(fx, { op: "path", from: "src/a.js", to: "src/a.js" });
  assert.equal(self.length, 0);
});

test("hubs and bridges are the graph report's, with the cap they were cut at", () => {
  const fx = fixture();
  const h = ask(fx, { op: "hubs" });
  assert.equal(h.top, 10);
  assert.deepEqual(h.hubs.map((x) => x.path), ["src/c.js"], "three links; tests are left out, so a.js has two");
  const b = ask(fx, { op: "bridges" });
  assert.equal(b.bridgeCount, 1);
  assert.equal(b.bridges[0].from, "lib/d.js");
  assert.equal(b.bridges[0].to, "src/c.js");
});

test("every list is capped at LIST_MAX and says how many there were", () => {
  const many = Array.from({ length: LIST_MAX + 10 }, (_, i) => ({ path: `src/m${String(i).padStart(3, "0")}.js`, isTest: false, cluster: "c1" }));
  const files = [...FILES, ...many];
  const edges = [...EDGES, ...many.map((f) => ({ from: f.path, to: "src/c.js", type: "imports" }))];
  const fx = fixture({ files, edges, clusters: { ...CLUSTERS, items: [{ ...CLUSTERS.items[0], files: [...CLUSTERS.items[0].files, ...many.map((f) => f.path)] }, CLUSTERS.items[1]] } });
  const n = ask(fx, { op: "node", file: "src/c.js" });
  assert.equal(n.importers.items.length, LIST_MAX);
  assert.equal(n.importers.total, LIST_MAX + 13);
  assert.equal(n.importers.truncated, true);
  assert.equal(n.imports.truncated, false);
  const nb = ask(fx, { op: "neighbors", file: "src/c.js", depth: 2 });
  assert.equal(nb.importers.items.length, LIST_MAX);
  assert.equal(nb.importers.truncated, true);
  assert.deepEqual(nb.importers.items.slice(0, 3).map((x) => x.depth), [1, 1, 1], "nearest first, so the cap drops the far ones");
  const c = ask(fx, { op: "cluster", cluster: "c1" });
  assert.equal(c.members.items.length, LIST_MAX);
  assert.equal(c.members.total, LIST_MAX + 14);
});

test("a missing, unreadable or wrong-format index is refused with the rebuild command, and not answered", () => {
  const empty = tempDir("cortex-graph-none-");
  const absent = graphAnswer(empty, { op: "stats" }, { tracked: () => [] });
  assert.equal(absent.refused, true);
  assert.equal(absent.index.state, "absent");
  assert.match(absent.rebuild, /cortex-index\.mjs/);
  assert.equal(absent.files, undefined);

  const bad = tempDir("cortex-graph-bad-");
  writeIndex(bad, "{ not json");
  assert.equal(graphAnswer(bad, { op: "hubs" }, { tracked: () => [] }).index.state, "unreadable");

  const old = tempDir("cortex-graph-old-");
  writeIndex(old, { version: "1", files: [], edges: [] });
  const v = graphAnswer(old, { op: "hubs" }, { tracked: () => [] });
  assert.equal(v.index.state, "version");
  assert.equal(v.hubs, undefined);
});

test("a stale index is refused for every op, never answered from", () => {
  const fx = fixture();
  utimesSync(join(fx.repo, "src/b.js"), new Date(), new Date());
  utimesSync(join(fx.repo, ".cortex/index/index.json"), LONG_AGO, LONG_AGO);
  for (const op of OPS) {
    const r = ask(fx, { op, file: "src/a.js", from: "src/a.js", to: "src/c.js", cluster: "c1" });
    assert.equal(r.refused, true, op);
    assert.equal(r.index.state, "stale", op);
    assert.deepEqual(r.index.changedSince, ["src/b.js"], op);
    assert.match(r.rebuild, /cortex-index\.mjs/, op);
    assert.deepEqual(Object.keys(r).sort(), ["index", "message", "op", "rebuild", "refused"], `${op} carries no answer`);
  }
});

test("outside git, freshness cannot be told: it answers and says so", () => {
  const fx = fixture();
  const r = graphAnswer(fx.repo, { op: "stats" }, { tracked: () => null });
  assert.equal(r.refused, undefined);
  assert.equal(r.index.state, "unknown");
  assert.match(r.index.reason, /not a git repo/);
});

test("a file argument that leaves the repo is refused by the root guard", () => {
  const fx = fixture();
  const outside = tempDir("cortex-graph-outside-");
  writeFileSync(join(outside, "secret.js"), "");
  for (const file of ["../secret.js", "src/../../secret.js", join(outside, "secret.js")]) {
    assert.throws(() => ask(fx, { op: "node", file }), OutsideRootError, file);
    assert.throws(() => ask(fx, { op: "path", from: "src/a.js", to: file }), OutsideRootError, file);
  }
  assert.throws(() => ask(fx, { op: "neighbors", file: "../../x" }), OutsideRootError);
  assert.throws(() => ask(fx, { op: "cluster", file: "../x" }), OutsideRootError);
});

test("a link out of the repo is refused too", { skip: process.platform === "win32" && "symlinks need admin on Windows" }, () => {
  const fx = fixture();
  const outside = tempDir("cortex-graph-outside-");
  writeFileSync(join(outside, "x.js"), "");
  symlinkSync(outside, join(fx.repo, "out"));
  assert.throws(() => ask(fx, { op: "node", file: "out/x.js" }), OutsideRootError);
});

test("a wrong question is refused with what would be right", () => {
  const fx = fixture();
  assert.throws(() => ask(fx, {}), (e) => e.code === "unknown_op" && e.message.includes(OPS.join(", ")));
  assert.throws(() => ask(fx, { op: "drop" }), (e) => e.code === "unknown_op");
  assert.throws(() => ask(fx, { op: "node" }), (e) => e.code === "missing_argument");
  assert.throws(() => ask(fx, { op: "path", from: "src/a.js" }), (e) => e.code === "missing_argument");
  assert.throws(() => ask(fx, { op: "node", file: "a.js" }), (e) => e.code === "not_indexed" && /Did you mean: src\/a\.js/.test(e.message));
});

test("the repo is the one above a repo-mode root, else the work tree the cwd is in; a vault is refused", () => {
  assert.equal(graphRepo({ isRepo: true, root: join("/x", "app", ".cortex") }, { cwd: "/", top: () => null }), resolve("/x", "app"));
  assert.equal(graphRepo(null, { cwd: "/w", top: () => "/w" }), "/w");
  assert.throws(() => graphRepo(null, { cwd: "/w", top: () => null }), (e) => e.code === "no_repo");
  assert.throws(() => graphRepo({ isRepo: false, root: "/vault" }, { cwd: "/", top: () => "/" }), (e) => e.code === "not_a_repo");
});

// --- against the index CLIs -----------------------------------------------------------------------

const git = (cwd, args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] });

/** A small real repo: two features sharing an api client and a util, a test, a fixture. */
function realRepo() {
  const repo = tempDir("cortex-graph-real-");
  const files = {
    "src/api/client.js": 'import { fmt } from "../util/fmt.js";\nexport const get = () => fmt("x");\n',
    "src/api/auth.js": 'import { get } from "./client.js";\nexport const login = () => get();\n',
    "src/util/fmt.js": "export const fmt = (s) => s;\n",
    "src/util/log.js": 'import { fmt } from "./fmt.js";\nexport const log = (s) => fmt(s);\n',
    "src/users/list.js": 'import { get } from "../api/client.js";\nimport { log } from "../util/log.js";\nexport const users = () => log(get());\n',
    "src/users/view.js": 'import { users } from "./list.js";\nimport { login } from "../api/auth.js";\nexport const view = () => [users(), login()];\n',
    "src/orders/list.js": 'import { get } from "../api/client.js";\nimport { fmt } from "../util/fmt.js";\nexport const orders = () => fmt(get());\n',
    "src/orders/view.js": 'import { orders } from "./list.js";\nimport { view } from "../users/view.js";\nexport const page = () => [orders(), view()];\n',
    "src/index.js": 'import { page } from "./orders/view.js";\nimport { view } from "./users/view.js";\nexport default () => [page(), view()];\n',
    "scripts/seed.js": 'import { orders } from "../src/orders/list.js";\nimport { users } from "../src/users/list.js";\norders(); users();\n',
    "test/users.test.js": 'import { users } from "../src/users/list.js";\nusers();\n',
    "test/fixtures/sample.js": 'import { fmt } from "../../src/util/fmt.js";\nfmt("y");\n',
  };
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, p)), { recursive: true });
    writeFileSync(join(repo, p), text);
    utimesSync(join(repo, p), LONG_AGO, LONG_AGO);
  }
  git(repo, ["init", "-q"]);
  git(repo, ["add", "-A"]);
  return repo;
}

test("hubs, bridges and the counts equal what cortex-graph.mjs --json prints for the same repo", () => {
  const repo = realRepo();
  const index = spawnSync(process.execPath, [join(REPO_ROOT, "index", "cortex-index.mjs"), repo], { encoding: "utf8" });
  assert.equal(index.status, 0, index.stderr);
  const cli = spawnSync(process.execPath, [join(REPO_ROOT, "index", "cortex-graph.mjs"), repo, "--json"], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  const report = JSON.parse(cli.stdout);
  assert.ok(report.hubs.length > 0 && report.bridges.length > 0, "the fixture must have both, or the comparison proves nothing");

  const hubs = graphAnswer(repo, { op: "hubs" });
  assert.equal(hubs.index.state, "fresh");
  assert.deepEqual(hubs.hubs, report.hubs);
  const bridges = graphAnswer(repo, { op: "bridges" });
  assert.deepEqual(bridges.bridges, report.bridges);
  assert.equal(bridges.bridgeCount, report.bridgeCount);
  const stats = graphAnswer(repo, { op: "stats" });
  assert.equal(stats.clusters, report.clusters);
  assert.equal(stats.unclustered, report.unclustered);
  assert.equal(stats.cycles, report.cycles.length);
  assert.equal(stats.cycleFiles, report.cycleFiles);
  assert.equal(stats.testCycles, report.testCycles);
});

// --- the two adapters -------------------------------------------------------------------------------

function cli(args, { cwd, root = "" } = {}) {
  return spawnSync(process.execPath, [AI_OS, "graph", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CORTEX_ROOT: root, AI_OS_ROOT: "", CORTEX_PROFILE: "" },
  });
}

test("ai-os graph answers from the repo CORTEX_ROOT names, and from the cwd's repo with no root", () => {
  const repo = realRepo();
  spawnSync(process.execPath, [join(REPO_ROOT, "index", "cortex-index.mjs"), repo], { encoding: "utf8" });
  const named = cli(["node", "src/util/fmt.js", "--json"], { cwd: tempDir("cortex-graph-cwd-"), root: join(repo, ".cortex") });
  assert.equal(named.status, 0, named.stderr);
  assert.equal(JSON.parse(named.stdout).path, "src/util/fmt.js");

  const here = cli(["path", "src/index.js", "src/util/fmt.js", "--directed"], { cwd: repo });
  assert.equal(here.status, 0, here.stderr);
  assert.match(here.stdout, /following imports only/);

  const text = cli(["stats"], { cwd: repo });
  assert.match(text.stdout, /import edges/);
});

test("ai-os graph exits 2 on a missing index, 1 on a bad question, and names the rebuild", () => {
  const repo = tempDir("cortex-graph-cli-");
  git(repo, ["init", "-q"]);
  const missing = cli(["stats"], { cwd: repo });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /cortex-index\.mjs/);
  assert.equal(missing.stdout, "", "nothing answered");
  assert.equal(cli([], { cwd: repo }).status, 1);
  const escape = cli(["node", "../x.js"], { cwd: repo });
  assert.equal(escape.status, 1);
  assert.match(escape.stderr, /escapes the Cortex root/);
});

test("the graph tool answers over the wire in repo mode", async () => {
  const { repo } = fixture();
  git(repo, ["init", "-q"]);
  git(repo, ["add", "-A"]);
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, AI_OS_ROOT: "", CORTEX_ROOT: join(repo, ".cortex"), CORTEX_AUTHOR: "dev-a" } });
  let buf = "";
  let err = "";
  child.stderr.on("data", (d) => { err += d; });
  const got = new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        try { const m = JSON.parse(line); if (m.id === 2) resolve(m); } catch { /* partial line */ }
      }
    });
    setTimeout(() => reject(new Error(`timed out\n${err}`)), 5000);
  });
  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "graph", arguments: { op: "node", file: "src/a.js" } } });
  const res = await got;
  child.kill();
  assert.ok(!res.result.isError, res.result.content?.[0]?.text);
  const body = JSON.parse(res.result.content[0].text);
  assert.equal(body.cluster, "c1");
  assert.deepEqual(body.imports.items, ["src/b.js", "src/c.js"]);
});
