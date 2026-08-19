import { test } from "node:test";
import assert from "node:assert/strict";
import { depthOf } from "../lib/depth.mjs";

/** files as paths, edges as "from>to". Everything is code unless the path says otherwise. */
function ix(paths, edges = [], overrides = {}) {
  return {
    files: paths.map((path) => ({
      path,
      category: /\.(md|json|ya?ml)$/.test(path) ? "docs" : "code",
      isTest: false,
      ...(overrides[path] || {}),
    })),
    edges: edges.map((e) => {
      const [from, to] = e.split(">");
      return { from, to, type: "imports" };
    }),
  };
}
const at = (r, p) => r.byPath.get(p);

test("depth 0 is what imports nothing inside the repo", () => {
  const r = depthOf(ix(["a.js", "b.js"], ["b.js>a.js"]));
  assert.equal(at(r, "a.js"), 0, "the foundation");
  assert.equal(at(r, "b.js"), 1);
});

test("depth is the LONGEST path down, not the shortest", () => {
  // c imports both a (depth 0) and b (depth 1). Taking the shortest would call c depth 1 and put it
  // level with its own dependency.
  const r = depthOf(ix(["a.js", "b.js", "c.js"], ["b.js>a.js", "c.js>a.js", "c.js>b.js"]));
  assert.equal(at(r, "c.js"), 2);
});

test("a mutual import is one stratum, not an invented order", () => {
  // Two files importing each other genuinely have no order between them — that is what makes it a
  // cycle. They share a depth and are reported, rather than one being arbitrarily called deeper.
  const r = depthOf(ix(["a.js", "b.js"], ["a.js>b.js", "b.js>a.js"]));
  assert.equal(at(r, "a.js"), at(r, "b.js"));
  assert.deepEqual(r.cyclic, ["a.js", "b.js"]);
});

test("a file above a cycle is deeper than it, and is not itself cyclic", () => {
  // The first version marked everything downstream of a cycle as cyclic too. On a Java repo, where
  // mutually-referencing classes are ordinary, that swallowed most of the graph.
  const r = depthOf(ix(["a.js", "b.js", "top.js"], ["a.js>b.js", "b.js>a.js", "top.js>a.js"]));
  assert.ok(at(r, "top.js") > at(r, "a.js"), "the file above the cycle sits above it");
  assert.deepEqual(r.cyclic, ["a.js", "b.js"], "only the cycle members are cyclic");
});

test("a long chain does not lose depth to memoisation order", () => {
  // The bug this module was rewritten for. A depth-first walk that memoises while a dependency is
  // still on the stack finalises a wrong number, and every dependent compounds it — on gson that
  // produced fourteen levels with ninety-nine files sharing the deepest.
  const paths = Array.from({ length: 12 }, (_, i) => `f${i}.js`);
  const edges = paths.slice(1).map((p, i) => `${p}>f${i}.js`);
  const r = depthOf(ix(paths, edges));
  for (let i = 0; i < 12; i++) assert.equal(at(r, `f${i}.js`), i, `f${i}.js should sit at depth ${i}`);
});

test("documentation is not part of the foundation", () => {
  // A markdown file imports nothing, so it landed at depth 0 beside the kernel — 238 of them on this
  // repo, burying the handful of files actually there.
  const r = depthOf(ix(["README.md", "package.json", "a.js"], []));
  assert.equal(at(r, "README.md"), undefined);
  assert.equal(at(r, "package.json"), undefined);
  assert.equal(at(r, "a.js"), 0);
});

test("an edge to something outside the index is ignored, not counted", () => {
  const r = depthOf(ix(["a.js"], ["a.js>node_modules/x.js"]));
  assert.equal(at(r, "a.js"), 0);
});

test("a self-import does not make a file its own layer", () => {
  // Two mechanisms give this: the edge filter in depthOf, and the condensation dropping edges inside
  // a component. Removing either alone changes nothing — a mutation run showed the filter is
  // defensive rather than load-bearing. The behaviour is pinned here regardless of which provides it.
  const r = depthOf(ix(["a.js"], ["a.js>a.js"]));
  assert.equal(at(r, "a.js"), 0);
  assert.deepEqual(r.cyclic, []);
});

test("layers are grouped ascending and every file appears exactly once", () => {
  const r = depthOf(ix(["a.js", "b.js", "c.js"], ["b.js>a.js", "c.js>b.js"]));
  assert.deepEqual(r.layers.map((l) => l.depth), [0, 1, 2]);
  const all = r.layers.flatMap((l) => l.paths);
  assert.equal(all.length, new Set(all).size);
  assert.equal(all.length, 3, "a cycle member is still placed in a layer");
});

test("output is stable across runs", () => {
  const args = ix(["z.js", "a.js", "m.js"], ["z.js>a.js", "m.js>a.js", "z.js>m.js"]);
  assert.equal(JSON.stringify(depthOf(args).layers), JSON.stringify(depthOf(args).layers));
});

test("an empty repo is an empty answer, not a crash", () => {
  const r = depthOf(ix([], []));
  assert.deepEqual(r.layers, []);
  assert.deepEqual(r.cyclic, []);
});
