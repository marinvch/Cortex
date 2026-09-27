import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { overlapOf, parseChangeList } from "../lib/overlap.mjs";

// Issue #408, v0: two sessions editing one repo had nothing to warn them. A `tools/test/run.sh`
// run reported 9 failures and then 0 minutes later, because another agent was landing edits
// underneath it. This is the static half of that warning — given my change set and theirs, which
// files do we both touch, and where does one of mine import one of theirs (or the reverse)?

/** A minimal index: paths, and edges as "from>to". */
function ix(paths, edges = []) {
  return {
    files: paths.map((path) => ({ path, category: "code", isTest: false, commits: 0, imports: [], inbound: 0 })),
    edges: edges.map((e) => { const [from, to] = e.split(">"); return { from, to, type: "imports" }; }),
  };
}

test("a file both sets touch is a direct overlap", () => {
  const r = overlapOf(ix(["a.js", "b.js", "c.js"]), ["a.js", "b.js"], ["b.js", "c.js"]);
  assert.deepEqual(r.overlap, ["b.js"]);
});

test("disjoint sets with no edge between them report nothing — and the counts stay floors", () => {
  const r = overlapOf(ix(["a.js", "b.js"]), ["a.js"], ["b.js"]);
  assert.deepEqual(r.overlap, []);
  assert.deepEqual(r.collisions, []);
  // Named so a caller cannot print it as a total: regex resolution misses dynamic imports, so an
  // empty collision list is the smallest honest answer, not proof of independence.
  assert.deepEqual(r.atLeast, { overlap: 0, collisions: 0 });
  assert.equal("total" in r, false);
});

test("one-hop collisions are found in both directions, and say which way the edge runs", () => {
  // mine.js imports theirs.js: they change what I depend on. dep.js (theirs) imports lib.js
  // (mine): I change what they depend on. Pure path overlap misses both.
  const r = overlapOf(
    ix(["mine.js", "theirs.js", "lib.js", "dep.js"], ["mine.js>theirs.js", "dep.js>lib.js"]),
    ["mine.js", "lib.js"],
    ["theirs.js", "dep.js"],
  );
  assert.deepEqual(r.overlap, []);
  assert.deepEqual(r.collisions, [
    { mine: "lib.js", theirs: "dep.js", edge: "theirs-imports-mine" },
    { mine: "mine.js", theirs: "theirs.js", edge: "mine-imports-theirs" },
  ]);
  assert.equal(r.atLeast.collisions, 2);
});

test("only one hop: a two-hop chain is not a collision", () => {
  // v0 is deliberately the one-hop read. a → x → b is real coupling, but reporting it here would
  // turn every shared utility into a warning; the full radius is what the plain command is for.
  const r = overlapOf(ix(["a.js", "x.js", "b.js"], ["a.js>x.js", "x.js>b.js"]), ["a.js"], ["b.js"]);
  assert.deepEqual(r.collisions, []);
});

test("an edge between two files both sets already touch is not reported twice", () => {
  // Both endpoints are in the overlap list, which is the stronger warning. Listing the edge again,
  // once per direction, would double the section for no new fact.
  const r = overlapOf(ix(["a.js", "b.js"], ["a.js>b.js"]), ["a.js", "b.js"], ["a.js", "b.js"]);
  assert.deepEqual(r.overlap, ["a.js", "b.js"]);
  assert.deepEqual(r.collisions, []);
});

test("an edge from a shared file to one only they touch is still a collision", () => {
  const r = overlapOf(ix(["s.js", "t.js"], ["s.js>t.js"]), ["s.js"], ["s.js", "t.js"]);
  assert.deepEqual(r.overlap, ["s.js"]);
  assert.deepEqual(r.collisions, [{ mine: "s.js", theirs: "t.js", edge: "mine-imports-theirs" }]);
});

test("a self-edge and a duplicated edge produce nothing extra", () => {
  const r = overlapOf(ix(["a.js", "b.js"], ["a.js>a.js", "a.js>b.js", "a.js>b.js"]), ["a.js"], ["b.js"]);
  assert.deepEqual(r.collisions, [{ mine: "a.js", theirs: "b.js", edge: "mine-imports-theirs" }]);
});

test("paths the index does not know still overlap directly, and are reported, never dropped", () => {
  // Two sessions both creating src/new.ts is a real collision the index cannot know about yet.
  // Dropping unknown paths would hide exactly that case.
  const r = overlapOf(ix(["a.js"]), ["a.js", "src/new.ts"], ["src/new.ts", "typo.js"]);
  assert.deepEqual(r.overlap, ["src/new.ts"]);
  assert.deepEqual(r.unknown, { mine: ["src/new.ts"], theirs: ["src/new.ts", "typo.js"] });
});

test("Windows separators and ./ prefixes are normalised on both sides before comparing", () => {
  const r = overlapOf(ix(["src/a.js", "src/b.js"], ["src/a.js>src/b.js"]), [".\\src\\a.js"], ["./src/b.js", "src\\a.js"]);
  assert.deepEqual(r.mine, ["src/a.js"]);
  assert.deepEqual(r.theirs, ["src/a.js", "src/b.js"]);
  assert.deepEqual(r.overlap, ["src/a.js"]);
});

test("an absolute path inside the root is made relative; one outside it stays unknown", () => {
  // A list written by another session — or copied out of its transcript — often carries absolute
  // paths. Comparing them literally against repo-relative ones would report no overlap at all.
  const root = resolve("fixture-root");
  const r = overlapOf(ix(["src/a.js"]), ["src/a.js"], [join(root, "src", "a.js")], { root });
  assert.deepEqual(r.overlap, ["src/a.js"]);

  const outside = overlapOf(ix(["src/a.js"]), ["src/a.js"], [resolve("elsewhere", "src", "a.js")], { root });
  assert.deepEqual(outside.overlap, []);
  assert.equal(outside.unknown.theirs.length, 1);
});

test("the report is sorted and deduplicated, so two runs agree byte for byte", () => {
  const index = ix(["a.js", "b.js", "c.js", "d.js"], ["d.js>a.js", "c.js>b.js"]);
  const one = overlapOf(index, ["d.js", "c.js", "c.js"], ["b.js", "a.js"]);
  const two = overlapOf(index, ["c.js", "d.js"], ["a.js", "b.js", "a.js"]);
  assert.deepEqual(one, two);
  assert.deepEqual(one.mine, ["c.js", "d.js"]);
});

// --- the list file ---------------------------------------------------------------------------------

test("a change list is one path per line; CRLF, a BOM, blanks and # comments are stripped", () => {
  // Written on Windows by Notepad or by `git diff --name-only > list` in PowerShell, a list arrives
  // with a BOM and \r on every line. Left in, `src/a.js\r` matches nothing and the report says
  // "no overlap" — a confident zero from a line ending.
  const text = "﻿src/a.js\r\n\r\n# another session, 14:02\r\n  src\\b.js  \r\nsrc/c.js";
  assert.deepEqual(parseChangeList(text), ["src/a.js", "src\\b.js", "src/c.js"]);
});

test("an empty or comment-only list parses to nothing, which the CLI refuses rather than reads as clean", () => {
  assert.deepEqual(parseChangeList(""), []);
  assert.deepEqual(parseChangeList("\r\n# nothing yet\r\n"), []);
});
