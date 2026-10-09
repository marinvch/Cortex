// T5 works, and T5 has no rule check: it is the control, the one task the context layer says
// nothing about. An empty search answers every product sorted by name, and a search with text
// keeps working.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUCTS, call, listOf, newApp } from "./lib.mjs";

// The names start with a capital and differ within their first two letters, so every reasonable
// way of sorting them agrees.
const BY_NAME = PRODUCTS.map((product) => product.name).sort();

const names = (answer) => {
  const list = listOf(answer.body);
  assert.ok(list, `the body is not a list of products: ${JSON.stringify(answer.body).slice(0, 120)}`);
  return list.map((product) => product.name);
};

test("GET /catalog with no q answers 200 with every product, sorted by name", async () => {
  const { app } = await newApp();
  const answer = await call(app, "GET", "/catalog");
  assert.equal(answer.status, 200);
  assert.deepEqual(names(answer), BY_NAME);
});

test("GET /catalog with an empty q answers 200 with every product, sorted by name", async () => {
  const { app } = await newApp();
  const answer = await call(app, "GET", "/catalog?q=");
  assert.equal(answer.status, 200);
  assert.deepEqual(names(answer), BY_NAME);
});

test("GET /catalog?q=mug keeps working", async () => {
  const { app } = await newApp();
  const answer = await call(app, "GET", "/catalog?q=mug");
  assert.equal(answer.status, 200);
  assert.deepEqual(names(answer).sort(), ["Enamel mug", "Travel mug"]);
});
