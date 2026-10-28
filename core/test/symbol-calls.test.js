import { test } from "node:test";
import assert from "node:assert/strict";

import {
  callerFiles, calleesOf, callersOf, definitionsIn, findDefinition, hasSymbols, nearSymbols, splitSymbolId,
} from "../symbol-calls.js";

// The shape index/lib/symbols.mjs writes: definitions and resolved calls, each call carrying the
// definition it sits in (or the file, for module-level code) and the candidates it may reach.
const symbols = {
  definitions: [
    { id: "src/db.ts#connect", kind: "function", line: 3, exported: true },
    { id: "src/db.ts#Pool", kind: "class", line: 10 },
    { id: "src/db.ts#Pool.query", kind: "method", line: 12 },
    { id: "src/api.ts#handler", kind: "function", line: 5 },
    { id: "src/cli.ts#main", kind: "function", line: 1 },
    { id: "src/other.ts#connect", kind: "function", line: 2 },
  ],
  calls: [
    { from: "src/api.ts#handler", line: 7, name: "connect", to: ["src/db.ts#connect"], confidence: "extracted" },
    { from: "src/api.ts#handler", line: 8, name: "pool.query", to: ["src/db.ts#Pool.query"], confidence: "inferred" },
    { from: "src/cli.ts#main", line: 4, name: "connect", to: ["src/db.ts#connect", "src/other.ts#connect"], confidence: "ambiguous" },
    { from: "src/cli.ts", line: 20, name: "main", to: ["src/cli.ts#main"], confidence: "extracted" },
    { from: "src/db.ts#connect", line: 5, name: "Pool", kind: "new", to: ["src/db.ts#Pool"], confidence: "extracted" },
  ],
};

test("an id splits at the first #, and a file has an empty name", () => {
  assert.deepEqual(splitSymbolId("src/db.ts#Pool.query"), ["src/db.ts", "Pool.query"]);
  assert.deepEqual(splitSymbolId("src/cli.ts"), ["src/cli.ts", ""]);
});

test("hasSymbols needs both lists", () => {
  assert.equal(hasSymbols({ symbols }), true);
  assert.equal(hasSymbols({}), false);
  assert.equal(hasSymbols({ symbols: { definitions: [] } }), false);
});

test("callers are split by confidence, and an ambiguous one says how many candidates it had", () => {
  const c = callersOf(symbols, "src/db.ts#connect");
  assert.deepEqual(c.extracted, [{ from: "src/api.ts#handler", line: 7, name: "connect" }]);
  assert.deepEqual(c.inferred, []);
  assert.deepEqual(c.ambiguous, [{ from: "src/cli.ts#main", line: 4, name: "connect", candidates: 2 }]);
});

test("an inferred caller is never counted in the extracted floor", () => {
  const c = callersOf(symbols, "src/db.ts#Pool.query");
  assert.equal(c.extracted.length, 0);
  assert.deepEqual(c.inferred.map((x) => x.from), ["src/api.ts#handler"]);
});

test("module-level code is a caller named by its file", () => {
  assert.deepEqual(callersOf(symbols, "src/cli.ts#main").extracted.map((x) => x.from), ["src/cli.ts"]);
});

test("callees are the calls made from inside the symbol, with the kind kept", () => {
  assert.deepEqual(calleesOf(symbols, "src/db.ts#connect"), [
    { line: 5, name: "Pool", kind: "new", to: ["src/db.ts#Pool"], confidence: "extracted" },
  ]);
  assert.equal(calleesOf(symbols, "src/api.ts#handler").length, 2);
});

test("definitionsIn lists one file's definitions in line order", () => {
  assert.deepEqual(definitionsIn(symbols, "src/db.ts").map((d) => d.id), ["src/db.ts#connect", "src/db.ts#Pool", "src/db.ts#Pool.query"]);
  assert.deepEqual(definitionsIn(symbols, "src/none.ts"), []);
});

test("an id that is not a definition gets the same name elsewhere first, then the file's definitions", () => {
  assert.equal(findDefinition(symbols, "src/api.ts#connect"), null);
  assert.deepEqual(nearSymbols(symbols, "src/api.ts#connect"), ["src/db.ts#connect", "src/other.ts#connect", "src/api.ts#handler"]);
  assert.deepEqual(nearSymbols(symbols, "src/db.ts#query"), ["src/db.ts#Pool.query", "src/db.ts#connect", "src/db.ts#Pool"]);
  assert.deepEqual(nearSymbols(symbols, "src/db.ts#Connect").slice(0, 1), ["src/db.ts#connect"], "a case typo finds the name");
});

test("callerFiles names each file once", () => {
  const c = callersOf(symbols, "src/db.ts#connect");
  assert.deepEqual(callerFiles([...c.extracted, ...c.ambiguous]), ["src/api.ts", "src/cli.ts"]);
});
