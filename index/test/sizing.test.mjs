import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sizeTask, SIZING_THRESHOLDS, scopedBriefs } from "../lib/sizing.mjs";
import { INDEX_VERSION } from "../lib/format.mjs";

// Single or team (spec T2): the session recommends from repo evidence and the developer chooses.
// Every signal is pinned on both sides of its line using the thresholds constant itself, so moving a
// provisional value — which is expected — does not rewrite this file, while breaking the rule does.

const T = SIZING_THRESHOLDS;
const LANG = { js: "javascript", kt: "kotlin", md: "markdown", json: "json", sh: "shell" };

/** A literal index: files as paths (or [path, {isTest}]), edges as "from>to". */
function ix(files, edges = []) {
  return {
    version: INDEX_VERSION,
    files: files.map((f) => {
      const [path, o = {}] = Array.isArray(f) ? f : [f];
      const ext = path.split(".").pop();
      return {
        path, lang: LANG[ext] || "other", category: ext === "md" ? "docs" : "code",
        isTest: !!o.isTest, isEntry: false, commits: 0, imports: [], inbound: 0,
      };
    }),
    edges: edges.map((e) => { const [from, to] = e.split(">"); return { from, to, type: "imports" }; }),
  };
}

/** `n` files each importing `hub`, optionally each with a test named after it (the name signal). */
function hubWith(n, { tested = false } = {}) {
  const files = ["core/hub.js"];
  const edges = [];
  for (let i = 0; i < n; i++) {
    files.push(`app/d${i}.js`);
    edges.push(`app/d${i}.js>core/hub.js`);
    if (tested) files.push([`test/d${i}.test.js`, { isTest: true }]);
  }
  return ix(files, edges);
}

/** hub ← mid (tested) ← `leaves` files: one direct dependent, `leaves + 1` in all. */
function fan(leaves, { tested }) {
  const files = ["core/hub.js", "core/mid.js", ["test/mid.test.js", { isTest: true }]];
  const edges = ["core/mid.js>core/hub.js"];
  for (let i = 0; i < leaves; i++) {
    files.push(`app/l${i}.js`);
    edges.push(`app/l${i}.js>core/mid.js`);
    if (tested) files.push([`test/l${i}.test.js`, { isTest: true }]);
  }
  return ix(files, edges);
}

// --- missing evidence is never a default ------------------------------------------------------------

test("no index → recommendation null, with the reason, never a default", () => {
  for (const index of [null, undefined, {}, { files: [] }]) {
    const r = sizeTask(index, ["src/a.js"]);
    assert.equal(r.recommendation, null);
    assert.equal(r.provisional, true);
    assert.equal(r.signals, null);
    assert.match(r.reasons.join(" "), /No index/);
  }
});

test("no files → recommendation null, not single", () => {
  const r = sizeTask(ix(["src/a.js"]), []);
  assert.equal(r.recommendation, null);
  assert.match(r.reasons[0], /No files were named/);
});

// --- the shape ---------------------------------------------------------------------------------------

test("a one-file change with nothing depending on it is single, and says so with numbers", () => {
  const r = sizeTask(ix(["src/a.js", "src/b.js"]), ["src/a.js"]);
  assert.equal(r.recommendation, "single");
  assert.equal(r.provisional, true);
  assert.deepEqual(r.thresholds, T);
  // One sentence per signal, and each carries its number.
  assert.ok(r.reasons.some((s) => /Touches 1 area of source \(src\)/.test(s)));
  assert.ok(r.reasons.some((s) => /At least 0 production files depend on these, 0 directly/.test(s)));
  assert.ok(r.reasons.some((s) => /At least 0 of those are exercised by no test/.test(s)));
  for (const s of r.reasons) assert.match(s, /\d/, `every reason carries a number: ${s}`);
});

test("the thresholds live in one frozen constant, and are the ones reported", () => {
  assert.ok(Object.isFrozen(T));
  assert.deepEqual(Object.keys(T).sort(), ["areas", "areasWithBrief", "dependents", "directDependents", "untestedDependents"]);
  assert.deepEqual(sizeTask(ix(["a.js"]), ["a.js"]).thresholds, T);
});

// --- areas ---------------------------------------------------------------------------------------------

test("areas: at the line is team, one under is single", () => {
  const dirs = Array.from({ length: T.areas }, (_, i) => `m${i}`);
  const files = dirs.map((d) => `${d}/x.js`);
  const at = sizeTask(ix(files), files);
  assert.equal(at.signals.areas.count, T.areas);
  assert.equal(at.signals.areas.crossed, true);
  assert.equal(at.recommendation, "team");
  assert.match(at.reasons[0], new RegExp(`Touches ${T.areas} areas of source .* at or over the team line of ${T.areas}`));

  const under = sizeTask(ix(files), files.slice(1));
  assert.equal(under.signals.areas.count, T.areas - 1);
  assert.equal(under.recommendation, "single");
});

test("areas: tests, documents and configuration do not widen a task", () => {
  const index = ix(["src/a.js", ["tests/a.test.js", { isTest: true }], "docs/a.md", "CHANGELOG.md", "config/app.json"]);
  const r = sizeTask(index, ["src/a.js", "tests/a.test.js", "docs/a.md", "CHANGELOG.md", "config/app.json"]);
  assert.deepEqual(r.signals.areas.names, ["src"]);
  assert.equal(r.recommendation, "single");
});

test("areas: a task with no source says so instead of reporting zero as small", () => {
  const files = ["a/README.md", "b/README.md", "c/README.md", "d/README.md"];
  const r = sizeTask(ix(files), files);
  assert.equal(r.signals.areas.count, 0);
  assert.equal(r.recommendation, "single");
  assert.ok(r.reasons.some((s) => /Touches no source file — 4 files of tests, documents or configuration/.test(s)));
});

test("areas: a file not in the index still counts where it lands, and is reported", () => {
  const index = ix(["m0/x.js", "m1/x.js"]);
  const r = sizeTask(index, ["m0/x.js", "m1/x.js", "m2/new.js"]);
  assert.deepEqual(r.signals.unknown, ["m2/new.js"]);
  assert.equal(r.signals.areas.count, 3);
  assert.ok(r.reasons.some((s) => /1 file not in the index \(m2\/new\.js\)/.test(s)));
});

// --- critical: a scoped brief lowers the areas line ----------------------------------------------------

test("critical: an area with a scoped brief takes the areas line down to areasWithBrief", () => {
  assert.ok(T.areasWithBrief < T.areas, "the brief line is the lower one, or the signal does nothing");
  const dirs = Array.from({ length: T.areasWithBrief }, (_, i) => `m${i}`);
  const files = dirs.map((d) => `${d}/x.js`);

  const withBrief = sizeTask(ix([...files, "m0/AGENTS.md"]), files);
  assert.deepEqual(withBrief.signals.critical.briefs, ["m0/AGENTS.md"]);
  assert.equal(withBrief.signals.areas.threshold, T.areasWithBrief);
  assert.equal(withBrief.recommendation, "team");
  assert.ok(withBrief.reasons.some((s) => /1 scoped brief governs this work \(m0\/AGENTS\.md\)/.test(s)));

  const without = sizeTask(ix(files), files);
  assert.equal(without.signals.areas.threshold, T.areas);
  assert.equal(without.recommendation, T.areasWithBrief >= T.areas ? "team" : "single");
});

test("critical: one file in a briefed area is not a team on its own", () => {
  const r = sizeTask(ix(["pay/x.js", "pay/AGENTS.md"]), ["pay/x.js"]);
  assert.equal(r.signals.critical.count, 1);
  assert.equal(r.recommendation, "single");
  assert.ok(r.reasons.some((s) => /read it before starting/.test(s)));
});

test("critical: the root brief governs everything and so marks nothing", () => {
  const files = Array.from({ length: T.areasWithBrief }, (_, i) => `m${i}/x.js`);
  const r = sizeTask(ix([...files, "AGENTS.md"]), files);
  assert.equal(r.signals.critical.count, 0);
});

test("critical: only a file named exactly AGENTS.md is a brief — a template named *-AGENTS.md is not", () => {
  // This repository ships `templates/target-AGENTS.md`; it governs nothing.
  const r = sizeTask(ix(["templates/x.js", "templates/target-AGENTS.md"]), ["templates/x.js"]);
  assert.equal(r.signals.critical.count, 0);
  assert.deepEqual(scopedBriefs(ix(["AGENTS.md", "a/AGENTS.md", "t/target-AGENTS.md"])).map((b) => b.path), ["a/AGENTS.md"]);
});

test("critical: the nearest brief governs, and a brief on a test file alone does not count", () => {
  const index = ix(["pay/core/x.js", "pay/AGENTS.md", "pay/core/AGENTS.md", ["tests/pay/AGENTS.md"], ["tests/pay/x.test.js", { isTest: true }]]);
  const order = scopedBriefs(index).map((b) => b.path);
  assert.ok(order.indexOf("pay/core/AGENTS.md") < order.indexOf("pay/AGENTS.md"), "deeper brief is tried first");
  const r = sizeTask(index, ["pay/core/x.js", "tests/pay/x.test.js"]);
  assert.deepEqual(r.signals.critical.briefs, ["pay/core/AGENTS.md"]);
});

// --- dependents ------------------------------------------------------------------------------------------

test("direct dependents: at the line is team even when every one is tested; one under is single", () => {
  assert.ok(T.directDependents < T.dependents, "fixture keeps the total under its own line");
  const at = sizeTask(hubWith(T.directDependents, { tested: true }), ["core/hub.js"]);
  assert.equal(at.signals.dependents.directAtLeast, T.directDependents);
  assert.equal(at.signals.untestedDependents.atLeast, 0);
  assert.equal(at.recommendation, "team");
  assert.match(at.reasons[0], new RegExp(`At least ${T.directDependents} production files depend on these, ${T.directDependents} directly — at or over the team line of ${T.directDependents} direct`));

  const under = sizeTask(hubWith(T.directDependents - 1, { tested: true }), ["core/hub.js"]);
  assert.equal(under.recommendation, "single");
  assert.ok(under.reasons.some((r) => r.includes(`under the team lines of ${T.directDependents} direct and ${T.dependents} in all`)));
});

test("all dependents: at the line is team through one direct importer; one under is single", () => {
  const at = sizeTask(fan(T.dependents - 1, { tested: true }), ["core/hub.js"]);
  assert.equal(at.signals.dependents.directAtLeast, 1);
  assert.equal(at.signals.dependents.atLeast, T.dependents);
  assert.equal(at.recommendation, "team");
  assert.match(at.reasons[0], new RegExp(`at or over the team line of ${T.dependents} in all`));

  const under = sizeTask(fan(T.dependents - 2, { tested: true }), ["core/hub.js"]);
  assert.equal(under.signals.dependents.atLeast, T.dependents - 1);
  assert.equal(under.recommendation, "single");
});

test("dependents: tests that import the change are not production dependents", () => {
  const index = ix(["core/hub.js", ["test/hub.test.js", { isTest: true }]], ["test/hub.test.js>core/hub.js"]);
  const r = sizeTask(index, ["core/hub.js"]);
  assert.equal(r.signals.dependents.atLeast, 0);
});

test("dependents: transitive dependents count, direct ones are reported apart", () => {
  const index = ix(["a.js", "b.js", "c.js"], ["b.js>a.js", "c.js>b.js"]);
  const r = sizeTask(index, ["a.js"]);
  assert.equal(r.signals.dependents.atLeast, 2);
  assert.equal(r.signals.dependents.directAtLeast, 1);
});

// --- untested dependents -----------------------------------------------------------------------------

test("untested dependents: at the line is team, one under is single", () => {
  // One tested importer in front of untested leaves, so neither dependents line is what crosses.
  const at = sizeTask(fan(T.untestedDependents, { tested: false }), ["core/hub.js"]);
  assert.equal(at.signals.untestedDependents.atLeast, T.untestedDependents);
  assert.equal(at.signals.dependents.crossed, false);
  assert.equal(at.recommendation, "team");
  assert.ok(at.reasons[0].startsWith(`At least ${T.untestedDependents} of those are exercised by no test Cortex can see — at or over`));

  const under = sizeTask(fan(T.untestedDependents - 1, { tested: false }), ["core/hub.js"]);
  assert.equal(under.recommendation, "single");
});

// --- blind -------------------------------------------------------------------------------------------------

test("blind: a file Cortex cannot resolve is never called single — null, and it says blind", () => {
  const r = sizeTask(ix(["src/Main.kt", "src/Other.kt"]), ["src/Main.kt"]);
  assert.equal(r.recommendation, null);
  assert.deepEqual(r.signals.blind, { files: ["src/Main.kt"], languages: ["kotlin"] });
  const text = r.reasons.join(" ");
  assert.match(text, /Blind: Cortex cannot resolve kotlin imports/);
  assert.match(text, /not small, unseen/);
  assert.doesNotMatch(text.replace(/not small/g, ""), /\bsmall\b/);
});

test("blind: a new file in a blind language is blind too", () => {
  const r = sizeTask(ix(["src/a.js"]), ["src/New.kt"]);
  assert.deepEqual(r.signals.blind.files, ["src/New.kt"]);
  assert.equal(r.recommendation, null);
});

test("blind: a crossing still recommends team, and the blindness is still reported", () => {
  const files = Array.from({ length: T.areas }, (_, i) => `m${i}/X.kt`);
  const r = sizeTask(ix(files), files);
  assert.equal(r.recommendation, "team");
  assert.ok(r.reasons.some((s) => s.startsWith("Blind:")));
});

// --- determinism -------------------------------------------------------------------------------------------

test("deterministic: same index and files in any order and spelling give the same answer", () => {
  const index = hubWith(4);
  const a = sizeTask(index, ["core/hub.js", "app/d1.js"]);
  const b = sizeTask(index, ["./app\\d1.js", "core/hub.js", "core/hub.js"]);
  assert.deepEqual(a, b);
});

// --- the CLI: --size --json --------------------------------------------------------------------------------

const IMPACT = join(dirname(fileURLToPath(import.meta.url)), "..", "cortex-impact.mjs");

function cliRepo(index) {
  const root = tempDir("cortex-size-");
  mkdirSync(join(root, ".cortex", "index"), { recursive: true });
  writeFileSync(join(root, ".cortex", "index", "index.json"), JSON.stringify(index));
  return root;
}
const runImpact = (root, args) =>
  spawnSync(process.execPath, [IMPACT, "--root", root, ...args], { encoding: "utf8" });

test("cli: --size --json prints the recommendation object and nothing else", () => {
  const root = cliRepo(hubWith(T.untestedDependents));
  const p = runImpact(root, ["core/hub.js", "--size", "--json"]);
  assert.equal(p.status, 0, p.stderr);
  const r = JSON.parse(p.stdout);
  assert.equal(r.recommendation, "team");
  assert.equal(r.provisional, true);
  assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0);
  assert.deepEqual(Object.keys(r.signals).sort(), ["areas", "blind", "critical", "dependents", "unknown", "untestedDependents"]);
  assert.equal(r.signals.untestedDependents.atLeast, T.untestedDependents);
  assert.deepEqual(r.thresholds, T);
});

test("cli: --size in prose names the recommendation as provisional and the choice as the developer's", () => {
  const root = cliRepo(ix(["src/a.js"]));
  const p = runImpact(root, ["src/a.js", "--size"]);
  assert.equal(p.status, 0, p.stderr);
  // On the recommendation line itself, not only in the footer: that line is the one quoted onward.
  assert.match(p.stdout, /Recommendation: single \(provisional\)/);
  assert.match(p.stdout, /thresholds are provisional/);
  assert.match(p.stdout, /You choose/);
});

test("cli: --size with a blind file prints no recommendation rather than single", () => {
  const root = cliRepo(ix(["src/Main.kt"]));
  const p = runImpact(root, ["src/Main.kt", "--size"]);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /Recommendation: none/);
  assert.doesNotMatch(p.stdout, /Recommendation: single/);
});

test("cli: --size refuses --against and --depth rather than ignoring them", () => {
  const root = cliRepo(ix(["src/a.js"]));
  assert.equal(runImpact(root, ["src/a.js", "--size", "--depth", "1"]).status, 1);
  const list = join(root, "theirs.txt");
  writeFileSync(list, "src/a.js\n");
  assert.equal(runImpact(root, ["src/a.js", "--size", "--against", list]).status, 1);
});

test("cli: --size with no index exits 2 and names the command that builds one", () => {
  const root = tempDir("cortex-size-none-");
  const p = runImpact(root, ["src/a.js", "--size", "--json"]);
  assert.equal(p.status, 2);
  assert.match(p.stderr, /no index/);
  assert.equal(p.stdout, "");
});
