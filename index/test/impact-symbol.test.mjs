// `cortex-impact.mjs --symbol path#name` (G5): who calls one function, as a floor of extracted
// calls with inferred and ambiguous ones apart. Run as a process, the way a person runs it.

import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { INDEX_VERSION } from "../lib/format.mjs";

const IMPACT = join(dirname(fileURLToPath(import.meta.url)), "..", "cortex-impact.mjs");

const FILES = [
  { path: "src/db.js", isTest: false, lang: "javascript" },
  { path: "src/api.js", isTest: false, lang: "javascript" },
  { path: "src/cli.js", isTest: false, lang: "javascript" },
  { path: "src/other.js", isTest: false, lang: "javascript" },
  { path: "test/api.test.js", isTest: true, lang: "javascript" },
];
const EDGES = [
  { from: "src/api.js", to: "src/db.js", type: "imports" },
  { from: "src/cli.js", to: "src/db.js", type: "imports" },
  { from: "test/api.test.js", to: "src/api.js", type: "imports" },
];
const SYMBOLS = {
  parser: "tree-sitter@test", grammars: { javascript: "x" }, files: 4,
  definitions: [
    { id: "src/db.js#connect", kind: "function", line: 1, exported: true },
    { id: "src/api.js#handler", kind: "function", line: 3 },
    { id: "src/cli.js#main", kind: "function", line: 1 },
    { id: "src/other.js#connect", kind: "function", line: 1 },
  ],
  calls: [
    { from: "src/api.js#handler", line: 4, name: "connect", to: ["src/db.js#connect"], confidence: "extracted" },
    { from: "src/cli.js#main", line: 2, name: "connect", to: ["src/db.js#connect", "src/other.js#connect"], confidence: "ambiguous" },
  ],
  unresolved: { total: 0 },
};

function repo(extra = {}) {
  const root = tempDir("cortex-impact-symbol-");
  mkdirSync(join(root, ".cortex", "index"), { recursive: true });
  writeFileSync(join(root, ".cortex", "index", "index.json"), JSON.stringify({ version: INDEX_VERSION, files: FILES, edges: EDGES, ...extra }));
  return root;
}
const run = (root, args) => spawnSync(process.execPath, [IMPACT, "--root", root, ...args], { encoding: "utf8" });

test("--symbol --json counts extracted callers only, and marks a caller file a test reaches", () => {
  const r = run(repo({ symbols: SYMBOLS }), ["--symbol", "src/db.js#connect", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.atLeast, 1);
  assert.deepEqual(out.callers.extracted.map((c) => c.from), ["src/api.js#handler"]);
  assert.deepEqual(out.callers.ambiguous.map((c) => [c.from, c.candidates]), [["src/cli.js#main", 2]]);
  assert.deepEqual(out.callerFiles.map((f) => [f.path, f.covered]), [["src/api.js", true]]);
  assert.deepEqual(out.suggestedTests, ["test/api.test.js"]);
});

test("--symbol prints the ambiguous call apart from the floor", () => {
  const r = run(repo({ symbols: SYMBOLS }), ["--symbol", "./src/db.js#connect"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /At least 1 call reach src\/db\.js#connect/);
  assert.match(r.stdout, /Ambiguous, not counted above \(1\)[\s\S]*src\/cli\.js#main:2 {2}\(2 candidates\)/);
});

test("an index without symbols exits 2 and names the parser add-on", () => {
  const r = run(repo(), ["--symbol", "src/db.js#connect"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cortex-parsers\.mjs install/);
  assert.equal(r.stdout, "", "never a confident 'no callers'");
});

test("a name that is not defined exits 1 with what was probably meant", () => {
  const r = run(repo({ symbols: SYMBOLS }), ["--symbol", "src/db.js#Connect"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Did you mean: src\/db\.js#connect/);
});

test("--symbol takes no change set", () => {
  for (const extra of [["src/db.js"], ["--staged"], ["--size"], ["--depth", "2"]]) {
    const r = run(repo({ symbols: SYMBOLS }), ["--symbol", "src/db.js#connect", ...extra]);
    assert.equal(r.status, 1, extra.join(" "));
    assert.match(r.stderr, /--symbol asks who calls one function/);
  }
});
