import { test } from "node:test";
import assert from "node:assert/strict";
import { impactOf } from "../lib/impact.mjs";

/** A minimal index: files as [path, {isTest, commits}], edges as "from>to". */
function ix(files, edges) {
  return {
    files: files.map(([path, o = {}]) => ({
      path, category: "code", isTest: !!o.isTest, isEntry: false,
      commits: o.commits || 0, imports: [], inbound: 0,
    })),
    edges: edges.map((e) => { const [from, to] = e.split(">"); return { from, to, type: "imports" }; }),
  };
}

const paths = (r) => r.affected.map((a) => a.path);

test("finds direct dependents", () => {
  const r = impactOf(ix([["a.js"], ["b.js"], ["c.js"]], ["b.js>a.js", "c.js>a.js"]), ["a.js"]);
  assert.deepEqual(paths(r).sort(), ["b.js", "c.js"]);
});

test("walks transitively, and depth means hops from the change", () => {
  // depth is the number a reader uses to decide how far to look: d1 is where a break shows first.
  const r = impactOf(ix([["a.js"], ["b.js"], ["c.js"]], ["b.js>a.js", "c.js>b.js"]), ["a.js"]);
  const byPath = Object.fromEntries(r.affected.map((x) => [x.path, x.depth]));
  assert.deepEqual(byPath, { "b.js": 1, "c.js": 2 });
});

test("a changed file is not its own blast radius", () => {
  const r = impactOf(ix([["a.js"], ["b.js"]], ["b.js>a.js"]), ["a.js"]);
  assert.ok(!paths(r).includes("a.js"));
});

test("a dependency cycle terminates", () => {
  // Real codebases have them. Without the visited set this walks forever, which in a CLI reads as
  // a hang rather than an error.
  const r = impactOf(ix([["a.js"], ["b.js"]], ["b.js>a.js", "a.js>b.js"]), ["a.js"]);
  assert.deepEqual(paths(r), ["b.js"]);
});

test("nearest first, then by churn", () => {
  // A depth-1 file that changes weekly is where a break lands soonest.
  const r = impactOf(
    ix([["a.js"], ["quiet.js", { commits: 1 }], ["busy.js", { commits: 40 }], ["far.js"]],
       ["quiet.js>a.js", "busy.js>a.js", "far.js>busy.js"]),
    ["a.js"],
  );
  assert.deepEqual(paths(r), ["busy.js", "quiet.js", "far.js"]);
});

test("unknown paths are reported, never silently dropped", () => {
  // A typo contributing nothing would read as "nothing depends on this" — the most dangerous wrong
  // answer this module can give.
  const r = impactOf(ix([["a.js"], ["b.js"]], ["b.js>a.js"]), ["a.js", "typo.js"]);
  assert.deepEqual(r.unknown, ["typo.js"]);
  assert.deepEqual(r.changed, ["a.js"]);
  assert.deepEqual(paths(r), ["b.js"]);
});

test("backslashes and ./ prefixes are normalised", () => {
  // git and Windows hand paths over in both shapes; failing to match would silently report nothing.
  const r = impactOf(ix([["src/a.js"], ["src/b.js"]], ["src/b.js>src/a.js"]), ["src\\a.js"]);
  assert.deepEqual(r.changed, ["src/a.js"]);
  assert.deepEqual(paths(r), ["src/b.js"]);
});

test("the unverified list is the actionable half", () => {
  // A large radius that is covered is an ordinary change; a small one that is not is the regression.
  const r = impactOf(
    ix([["a.js"], ["tested.js"], ["untested.js"], ["tested.test.js", { isTest: true }]],
       ["tested.js>a.js", "untested.js>a.js", "tested.test.js>tested.js"]),
    ["a.js"],
  );
  assert.deepEqual(r.unverified.map((u) => u.path), ["untested.js"]);
});

test("test files in the radius are not themselves reported as unverified", () => {
  // A test is not production code waiting for a test.
  const r = impactOf(ix([["a.js"], ["a.test.js", { isTest: true }]], ["a.test.js>a.js"]), ["a.js"]);
  assert.deepEqual(r.unverified, []);
  assert.equal(r.affected[0].isTest, true);
});

test("suggested tests include those covering the changed file itself", () => {
  // The most likely test to run is the one named after what you just edited, and it may not be in
  // the radius at all if nothing imports the changed file.
  const r = impactOf(ix([["a.js"], ["a.test.js", { isTest: true }]], []), ["a.js"]);
  assert.deepEqual(paths(r), [], "nothing imports a.js");
  assert.deepEqual(r.suggestedTests, ["a.test.js"], "its own test is still worth running");
});

test("coverage is found by name even across directories", () => {
  // index/AGENTS.md: naming alone called mcp/lib untested because its tests live in mcp/test.
  const r = impactOf(
    ix([["a.js"], ["lib/thing.js"], ["test/thing.test.js", { isTest: true }]], ["lib/thing.js>a.js"]),
    ["a.js"],
  );
  assert.deepEqual(r.unverified, [], "thing.js is covered by test/thing.test.js");
});

test("maxDepth bounds the walk and says so", () => {
  const r = impactOf(ix([["a.js"], ["b.js"], ["c.js"]], ["b.js>a.js", "c.js>b.js"]), ["a.js"], { maxDepth: 1 });
  assert.deepEqual(paths(r), ["b.js"]);
  assert.equal(r.truncated, true);
});

test("atLeast is named so it cannot be reported as a total", () => {
  // Regex import resolution means every count is a floor. "3 affected" when the truth is 5 invites
  // someone to stop looking; "at least 3" does not.
  const r = impactOf(ix([["a.js"], ["b.js"]], ["b.js>a.js"]), ["a.js"]);
  assert.equal(r.atLeast, 1);
  assert.equal(r.truncated, false);
  assert.ok(!("total" in r) && !("complete" in r));
});

test("an empty change set is not an error, just an empty answer", () => {
  const r = impactOf(ix([["a.js"]], []), []);
  assert.deepEqual(r.affected, []);
  assert.deepEqual(r.changed, []);
});

test("output is stable across runs", () => {
  const args = [ix([["a.js"], ["b.js"], ["c.js"]], ["b.js>a.js", "c.js>a.js"]), ["a.js"]];
  assert.equal(JSON.stringify(impactOf(...args)), JSON.stringify(impactOf(...args)));
});
