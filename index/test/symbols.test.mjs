// Symbols (lib/symbols.mjs). Resolution is pure and runs everywhere, from hand-written
// extractions. Extraction needs the parser add-on: those tests run when it is installed for the
// HOME the test runs under, and are skipped otherwise, so CI checks resolution and a developer
// with the add-on checks both.

import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MAX_HOPS, callEdges, extractFile, resolveSymbols } from "../lib/symbols.mjs";
import { symbolCache, symbolsLine } from "../lib/symbol-cache.mjs";
import { loadParsers } from "../lib/parsers.mjs";
import { buildIndex } from "../lib/build.mjs";

// --- resolution, from extractions written by hand ---------------------------------------------

const ex = (o) => ({ defs: [], exports: [], imports: [], reexports: [], bound: [], calls: [], ...o });
const fn = (name, line = 1, extra = {}) => ({ name, kind: "function", line, exported: true, ...extra });

/**
 * Resolve a repo given as `{ path: { ex, imports: [paths] } }` and a resolver table
 * `{ "from|spec": [targets] }`.
 */
function resolveRepo(repo, table = {}) {
  const files = Object.entries(repo).map(([path, f]) => ({ path, lang: path.endsWith(".py") ? "python" : "typescript", imports: f.imports ?? [] }));
  const extractions = new Map(Object.entries(repo).map(([path, f]) => [path, f.ex]));
  const why = [];
  const r = resolveSymbols({
    files,
    extractions,
    resolve: (spec, f) => table[`${f.path}|${spec}`] ?? [],
    onUnresolved: (reason, path, c) => why.push([reason, `${path}:${c.line}`]),
  });
  return { ...r, why };
}

const callAt = (r, line) => r.calls.find((c) => c.line === line);

test("a call to a definition in the same file is extracted", () => {
  const r = resolveRepo({ "a.ts": { ex: ex({ defs: [fn("helper", 1), fn("main", 3)], calls: [{ in: "main", line: 4, kind: "call", name: "helper" }] }) } });
  assert.deepEqual(r.calls, [{ from: "a.ts#main", line: 4, name: "helper", to: ["a.ts#helper"], confidence: "extracted" }]);
});

test("a call through a resolved import is extracted, under an alias and through a default", () => {
  const r = resolveRepo(
    {
      "a.ts": {
        imports: ["b.ts"],
        ex: ex({
          imports: [{ spec: "./b", line: 1, names: [["run", "go"], ["Thing", "default"]] }],
          calls: [{ in: null, line: 5, kind: "call", name: "run" }, { in: null, line: 6, kind: "new", name: "Thing" }],
        }),
      },
      "b.ts": { ex: ex({ defs: [fn("go", 1), { name: "Thing", kind: "class", line: 3, exported: true, default: true }] }) },
    },
    { "a.ts|./b": ["b.ts"] },
  );
  assert.deepEqual(callAt(r, 5), { from: "a.ts", line: 5, name: "run", to: ["b.ts#go"], confidence: "extracted" });
  assert.deepEqual(callAt(r, 6), { from: "a.ts", line: 6, name: "Thing", kind: "new", to: ["b.ts#Thing"], confidence: "extracted" });
});

test("an unexported definition is not reachable through an import", () => {
  const r = resolveRepo(
    {
      "a.ts": { imports: ["b.ts"], ex: ex({ imports: [{ spec: "./b", line: 1, names: [["go", "go"]] }], calls: [{ in: null, line: 2, kind: "call", name: "go" }] }) },
      "b.ts": { ex: ex({ defs: [fn("go", 1, { exported: false })] }) },
    },
    { "a.ts|./b": ["b.ts"] },
  );
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.why, [["missing", "a.ts:2"]]);
});

test("re-exports are followed, named and star, and a local `export { a as b }` too", () => {
  const r = resolveRepo(
    {
      "app.ts": {
        imports: ["index.ts"],
        ex: ex({
          imports: [{ spec: "./index", line: 1, names: [["create", "create"], ["make", "make"], ["fmt", "fmt"]] }],
          calls: [{ in: null, line: 2, kind: "call", name: "create" }, { in: null, line: 3, kind: "call", name: "make" }, { in: null, line: 4, kind: "call", name: "fmt" }],
        }),
      },
      "index.ts": { ex: ex({ reexports: [{ spec: "./store", names: null }, { spec: "./util", names: [["make", "build"]] }, { spec: "./fmt", names: null }] }) },
      "store.ts": { ex: ex({ defs: [fn("create")] }) },
      "util.ts": { ex: ex({ defs: [fn("build", 1, { exported: false })], exports: [["build", "build"]] }) },
      "fmt.ts": { ex: ex({ defs: [fn("format", 1, { exported: false })], exports: [["format", "fmt"]] }) },
    },
    { "app.ts|./index": ["index.ts"], "index.ts|./store": ["store.ts"], "index.ts|./util": ["util.ts"], "index.ts|./fmt": ["fmt.ts"] },
  );
  assert.deepEqual(callAt(r, 2).to, ["store.ts#create"]);
  assert.deepEqual(callAt(r, 3).to, ["util.ts#build"]);
  assert.deepEqual(callAt(r, 4).to, ["fmt.ts#format"]);
  for (const c of r.calls) assert.equal(c.confidence, "extracted");
});

test("a name re-exported from a package is external, not missing", () => {
  const r = resolveRepo(
    {
      "t.ts": { imports: ["utils.ts"], ex: ex({ imports: [{ spec: "./utils", line: 1, names: [["screen", "screen"]] }], calls: [{ in: null, line: 2, kind: "call", name: "screen" }] }) },
      "utils.ts": { ex: ex({ reexports: [{ spec: "@testing-library/react", names: null }] }) },
    },
    { "t.ts|./utils": ["utils.ts"] },
  );
  assert.deepEqual(r.why, [["external", "t.ts:2"]]);
});

test("a re-export cycle ends", () => {
  const r = resolveRepo(
    {
      "a.ts": { imports: ["b.ts"], ex: ex({ imports: [{ spec: "./b", line: 1, names: [["x", "x"]] }], reexports: [{ spec: "./b", names: null }], calls: [{ in: null, line: 2, kind: "call", name: "x" }] }) },
      "b.ts": { ex: ex({ reexports: [{ spec: "./a", names: null }] }) },
    },
    { "a.ts|./b": ["b.ts"], "b.ts|./a": ["a.ts"] },
  );
  assert.deepEqual(r.why, [["missing", "a.ts:2"]]);
});

test("re-exports are followed for MAX_HOPS barrels and no further", () => {
  // app → b1 → b2 → … → bN → impl. Each barrel is one hop.
  const chain = (n) => {
    const repo = { "app.ts": { imports: ["b1.ts"], ex: ex({ imports: [{ spec: "./b1", line: 1, names: [["go", "go"]] }], calls: [{ in: null, line: 2, kind: "call", name: "go" }] }) } };
    const table = { "app.ts|./b1": ["b1.ts"] };
    for (let i = 1; i <= n; i++) {
      const next = i === n ? "impl" : `b${i + 1}`;
      repo[`b${i}.ts`] = { ex: ex({ reexports: [{ spec: `./${next}`, names: null }] }) };
      table[`b${i}.ts|./${next}`] = [`${next}.ts`];
    }
    repo["impl.ts"] = { ex: ex({ defs: [fn("go")] }) };
    return resolveRepo(repo, table);
  };
  assert.deepEqual(callAt(chain(MAX_HOPS), 2).to, ["impl.ts#go"]);
  assert.equal(callAt(chain(MAX_HOPS + 1), 2), undefined);
});

test("a name bound nowhere is inferred from the one imported file that defines it, and ambiguous with two", () => {
  const repo = (extra) => ({
    "m.py": { imports: ["a.py", ...extra], ex: ex({ imports: [{ spec: ".a", line: 1, names: [], star: true }], calls: [{ in: null, line: 3, kind: "call", name: "helper" }] }) },
    "a.py": { ex: ex({ defs: [fn("helper", 1)] }) },
    "b.py": { ex: ex({ defs: [fn("helper", 7)] }) },
  });
  const one = resolveRepo(repo([]));
  assert.deepEqual(callAt(one, 3), { from: "m.py", line: 3, name: "helper", to: ["a.py#helper"], confidence: "inferred" });
  const two = resolveRepo(repo(["b.py"]));
  assert.deepEqual(callAt(two, 3), { from: "m.py", line: 3, name: "helper", to: ["a.py#helper", "b.py#helper"], confidence: "ambiguous" });
});

test("an import that binds two definitions keeps both as ambiguous", () => {
  const r = resolveRepo(
    {
      "a.ts": { imports: ["x.ts", "y.ts"], ex: ex({ imports: [{ spec: "pkg", line: 1, names: [["go", "go"]] }], calls: [{ in: null, line: 2, kind: "call", name: "go" }] }) },
      "x.ts": { ex: ex({ defs: [fn("go")] }) },
      "y.ts": { ex: ex({ defs: [fn("go")] }) },
    },
    { "a.ts|pkg": ["x.ts", "y.ts"] },
  );
  assert.deepEqual(callAt(r, 2).to, ["x.ts#go", "y.ts#go"]);
  assert.equal(callAt(r, 2).confidence, "ambiguous");
});

test("a local name, a package, a builtin and a method on a value are counted and not kept", () => {
  const r = resolveRepo(
    {
      "a.ts": {
        imports: ["b.ts"],
        ex: ex({
          defs: [fn("get", 1)],
          imports: [{ spec: "react", line: 1, names: [["useState", "useState"]] }],
          bound: ["store"],
          calls: [
            { in: null, line: 2, kind: "call", name: "get", local: true },
            { in: null, line: 3, kind: "call", name: "useState" },
            { in: null, line: 4, kind: "call", name: "parseInt" },
            { in: null, line: 5, kind: "call", object: "items", property: "map" },
            { in: null, line: 6, kind: "call", name: "store" },
            { in: null, line: 7, kind: "call", dynamic: true },
          ],
        }),
      },
      "b.ts": { ex: ex({ defs: [fn("get", 1)] }) },
    },
  );
  assert.deepEqual(r.calls, [], "a parameter called `get` never resolves to a function `get`");
  assert.deepEqual(r.unresolved, { total: 6, external: 1, local: 2, member: 2, missing: 0, unknown: 1 });
});

test("this.m() resolves in its class, and through a stated base as inferred", () => {
  const r = resolveRepo(
    {
      "k.ts": {
        imports: ["base.ts"],
        ex: ex({
          defs: [{ name: "K", kind: "class", line: 2, exported: true, bases: ["Base"] }, fn("K.run", 3), fn("K.own", 5)],
          imports: [{ spec: "./base", line: 1, names: [["Base", "Base"]] }],
          calls: [
            { in: "K.run", line: 4, kind: "call", object: "this", property: "own" },
            { in: "K.run", line: 6, kind: "call", object: "this", property: "inherited" },
            { in: "K.run", line: 7, kind: "call", object: "this", property: "nowhere" },
            { in: null, line: 9, kind: "call", object: "K", property: "own" },
          ],
        }),
      },
      "base.ts": { ex: ex({ defs: [{ name: "Base", kind: "class", line: 1, exported: true }, fn("Base.inherited", 2)] }) },
    },
    { "k.ts|./base": ["base.ts"] },
  );
  assert.deepEqual(callAt(r, 4), { from: "k.ts#K.run", line: 4, name: "this.own", to: ["k.ts#K.own"], confidence: "extracted" });
  assert.deepEqual(callAt(r, 6), { from: "k.ts#K.run", line: 6, name: "this.inherited", to: ["base.ts#Base.inherited"], confidence: "inferred" });
  assert.equal(callAt(r, 7), undefined);
  assert.deepEqual(callAt(r, 9).to, ["k.ts#K.own"]);
});

test("a module bound whole resolves its members: a namespace import, and a Python submodule", () => {
  const r = resolveRepo(
    {
      "a.ts": { imports: ["util.ts"], ex: ex({ imports: [{ spec: "./util", line: 1, names: [["u", "*"]] }], calls: [{ in: null, line: 2, kind: "call", object: "u", property: "go" }] }) },
      "util.ts": { ex: ex({ defs: [fn("go")] }) },
      "pkg/app.py": {
        imports: ["pkg/__init__.py", "pkg/views.py"],
        ex: ex({ imports: [{ spec: ".", line: 1, names: [["views", "views"]] }], calls: [{ in: null, line: 3, kind: "call", object: "views", property: "index" }] }),
      },
      "pkg/__init__.py": { ex: ex() },
      "pkg/views.py": { ex: ex({ defs: [fn("index", 1, { exported: true })] }) },
    },
    { "a.ts|./util": ["util.ts"], "pkg/app.py|.": ["pkg/__init__.py"], "pkg/app.py|.views": ["pkg/views.py"] },
  );
  assert.deepEqual(callAt(r, 2).to, ["util.ts#go"]);
  assert.deepEqual(callAt(r, 3), { from: "pkg/app.py", line: 3, name: "views.index", to: ["pkg/views.py#index"], confidence: "extracted" });
});

test("Python re-exports by importing, as an __init__.py does", () => {
  const r = resolveRepo(
    {
      "main.py": { imports: ["pkg/__init__.py"], ex: ex({ imports: [{ spec: "pkg", line: 1, names: [["Flask", "Flask"]] }], calls: [{ in: null, line: 2, kind: "call", name: "Flask" }] }) },
      "pkg/__init__.py": { ex: ex({ imports: [{ spec: ".app", line: 1, names: [["Flask", "Flask"]] }] }) },
      "pkg/app.py": { ex: ex({ defs: [{ name: "Flask", kind: "class", line: 4, exported: true }] }) },
    },
    { "main.py|pkg": ["pkg/__init__.py"], "pkg/__init__.py|.app": ["pkg/app.py"] },
  );
  assert.deepEqual(callAt(r, 2).to, ["pkg/app.py#Flask"]);
});

test("definitions are listed once per id, first declaration wins, sorted by id", () => {
  const r = resolveRepo({ "b.ts": { ex: ex({ defs: [fn("x", 9), fn("x", 2), fn("a", 5)] }) }, "a.ts": { ex: ex({ defs: [fn("z", 1)] }) } });
  assert.deepEqual(r.definitions, [
    { id: "a.ts#z", kind: "function", line: 1, exported: true },
    { id: "b.ts#a", kind: "function", line: 5, exported: true },
    { id: "b.ts#x", kind: "function", line: 2, exported: true },
  ]);
});

test("call edges for clustering: one per pair of files, the surest confidence, none within a file", () => {
  const edges = callEdges([
    { from: "a.ts#f", line: 1, name: "g", to: ["a.ts#g"], confidence: "extracted" },
    { from: "a.ts", line: 3, name: "h", to: ["b.ts#h"], confidence: "extracted" },
    { from: "a.ts#f", line: 2, name: "h", to: ["b.ts#h", "c.ts#h"], confidence: "ambiguous" },
    { from: "c.ts#k", line: 1, name: "q", to: ["a.ts#q"], confidence: "inferred" },
  ]);
  assert.deepEqual(edges, [
    { from: "a.ts", to: "b.ts", type: "calls", confidence: "extracted" },
    { from: "a.ts", to: "c.ts", type: "calls", confidence: "ambiguous" },
    { from: "c.ts", to: "a.ts", type: "calls", confidence: "inferred" },
  ]);
});

// --- the cache --------------------------------------------------------------------------------

test("the cache returns what it stored, ignores a bad entry, and prunes only its own unused entries", () => {
  const dir = join(tempDir("cortex-symcache-"), "symbols");
  const key = (c) => c.repeat(64);
  const a = symbolCache(dir);
  assert.equal(a.get(key("a")), null);
  a.set(key("a"), ex({ defs: [fn("x")] }));
  a.set(key("b"), ex());
  assert.deepEqual(symbolCache(dir).get(key("a")).defs, [fn("x")]);
  writeFileSync(join(dir, `${key("c")}.json`), "{ not json");
  writeFileSync(join(dir, `${key("d")}.json`), JSON.stringify({ defs: [] }));
  writeFileSync(join(dir, "notes.txt"), "mine");
  const b = symbolCache(dir);
  assert.equal(b.get(key("c")), null, "an unreadable entry is a miss");
  assert.equal(b.get(key("d")), null, "an entry of the wrong shape is a miss");
  assert.ok(b.get(key("a")));
  b.prune();
  assert.deepEqual(readdirSync(dir).sort(), [`${key("a")}.json`, `${key("c")}.json`, `${key("d")}.json`, "notes.txt"].sort());
  assert.match(symbolsLine({ files: 1, definitions: [1], calls: [{ confidence: "extracted" }], unresolved: { total: 3 }, parser: "tree-sitter@x" }),
    /^Symbols: 1 definitions in 1 files, 1 calls \(1 extracted, 0 inferred, 0 ambiguous\), 3 not resolved — tree-sitter@x$/);
});

// --- extraction and the build, with the real add-on when it is installed ----------------------

const parsers = await loadParsers({ env: process.env });
const needs = { skip: parsers ? false : "the parser add-on is not installed (node tools/cortex-parsers.mjs install)" };

function extract(grammar, text) {
  const tree = parsers.parse(grammar, text);
  try {
    return extractFile(tree, grammar);
  } finally {
    tree.delete();
  }
}

test("JS/TS: functions, classes, methods, constants holding functions, and where each call sits", needs, () => {
  const e = extract("typescript", [
    "import def, { a as b } from './x';",
    "import * as ns from './y';",
    "export function f(q: number) { return b(q) + ns.g(); }",
    "export const k = (z) => { const loc = () => 1; loc(); return new K(); };",
    "const notFn = 3;",
    "export default class K extends Base { m() { this.n(); } n = () => 1; static s() {} }",
    "export const memoed = memo(() => null);",
    "export const alias = f as unknown as typeof f;",
    "export { f as eff };",
    "export * from './z';",
    "export { q as r } from './w';",
  ].join("\n"));
  assert.deepEqual(e.defs.map((d) => [d.name, d.kind, d.line]), [
    ["K", "class", 6], ["K.m", "method", 6], ["K.n", "method", 6], ["K.s", "method", 6],
    ["alias", "function", 8], ["f", "function", 3], ["k", "function", 4], ["memoed", "function", 7],
  ]);
  assert.deepEqual(e.defs.find((d) => d.name === "K").bases, ["Base"]);
  assert.equal(e.defs.find((d) => d.name === "K").default, true);
  assert.deepEqual(e.imports.map((i) => [i.spec, i.names]), [["./x", [["def", "default"], ["b", "a"]]], ["./y", [["ns", "*"]]]]);
  assert.deepEqual(e.exports, [["f", "eff"]]);
  assert.deepEqual(e.reexports, [{ spec: "./z", names: null }, { spec: "./w", names: [["r", "q"]] }]);
  assert.deepEqual(e.bound, ["notFn"]);
  // In line order, then by what is called; a call wrapping a definition sits in it.
  const calls = e.calls.map((c) => [c.in, c.line, c.kind, c.name ?? `${c.object}.${c.property}`, !!c.local]).sort((a, b) => a[1] - b[1] || (a[3] < b[3] ? -1 : 1));
  assert.deepEqual(calls, [
    ["f", 3, "call", "b", false],
    ["f", 3, "call", "ns.g", false],
    ["k", 4, "new", "K", false],
    ["k", 4, "call", "loc", true],
    ["K.m", 6, "call", "this.n", false],
    ["memoed", 7, "call", "memo", false],
  ]);
});

test("TSX: a capitalised element is a call, an intrinsic one is not", needs, () => {
  const e = extract("tsx", "export function App({ Item }) { return <div><Comp a={1} /><ui.Card /><Item /></div>; }\n");
  assert.deepEqual(e.calls.map((c) => [c.kind, c.name ?? `${c.object}.${c.property}`, !!c.local]).sort(), [
    ["jsx", "Comp", false], ["jsx", "Item", true], ["jsx", "ui.Card", false],
  ]);
});

test("Python: definitions, imports with their bindings, self calls and shadowing", needs, () => {
  const e = extract("python", [
    "from .a import b, c as d",
    "from . import mod",
    "import pkg.sub as ps",
    "from .star import *",
    "def f(x, *args, y=1, **kw):",
    "    return b(x) + mod.g() + ps.h() + y()",
    "class C(Base):",
    "    @staticmethod",
    "    def m(self):",
    "        self.n()",
    "    def n(self): pass",
    "lam = lambda: 1",
    "value = 3",
  ].join("\n"));
  assert.deepEqual(e.defs.map((d) => [d.name, d.kind, d.line]), [["C", "class", 7], ["C.m", "method", 9], ["C.n", "method", 11], ["f", "function", 5], ["lam", "function", 12]]);
  assert.deepEqual(e.imports.map((i) => [i.spec, i.names, !!i.star]), [
    [".a", [["b", "b"], ["d", "c"]], false], [".", [["mod", "mod"]], false], ["pkg.sub", [["ps", "*"]], false], [".star", [], true],
  ]);
  assert.deepEqual(e.bound, ["value"]);
  assert.deepEqual(e.calls.map((c) => [c.in, c.name ?? `${c.object}.${c.property}`, !!c.local]).sort(), [
    ["C.m", "this.n", false], ["f", "b", false], ["f", "mod.g", false], ["f", "ps.h", false], ["f", "y", true],
  ]);
});

test("the build adds symbols beside files, clusters over calls, and a warm cache writes the same bytes", needs, () => {
  const root = tempDir("cortex-symbuild-");
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write("src/a.ts", "import { b } from './b';\nexport function a() { return b(); }\n");
  write("src/b.ts", "export function b() { return 1; }\n");
  write("src/c.py", "def c():\n    return len([])\n");
  const cacheDir = join(tempDir("cortex-symcache-"), "symbols");
  const cold = buildIndex(root, { parsers, symbolCache: symbolCache(cacheDir) });
  const warmCache = symbolCache(cacheDir);
  const warm = buildIndex(root, { parsers, symbolCache: warmCache });
  assert.equal(warmCache.stats.misses, 0);
  assert.equal(JSON.stringify(warm), JSON.stringify(cold));
  assert.equal(cold.parser, parsers.name);
  assert.equal(cold.symbols.parser, parsers.name);
  assert.deepEqual(cold.symbols.calls, [{ from: "src/a.ts#a", line: 2, name: "b", to: ["src/b.ts#b"], confidence: "extracted" }]);
  assert.deepEqual(cold.symbols.unresolved, { total: 1, external: 0, local: 0, member: 0, missing: 0, unknown: 1 });
  assert.ok(cold.files.every((f) => !("symbols" in f)), "files are unchanged");
  const plain = buildIndex(root);
  assert.equal(plain.parser, "regex");
  assert.equal("symbols" in plain, false);
});
