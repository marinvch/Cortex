// T1 works: what the prompt asks for, and nothing else. `averageUnitPrice` beside `subtotal`: the
// subtotal divided by the number of units, and 0 for an empty cart. Every case here divides evenly,
// so how a fraction is rounded is not asked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { call, cartOf, newApp } from "./lib.mjs";

for (const [lines, subtotal, average] of [
  [[["unit", 4]], 4, 1],
  [[["notebook", 2]], 900, 450],
  [[["apron", 1], ["notebook", 1]], 2850, 1425],
  [[["mug-enamel", 4]], 5000, 1250],
]) {
  test(`a cart of ${subtotal} over ${lines.map(([sku, n]) => `${n} ${sku}`).join(" + ")} has an averageUnitPrice of ${average}`, async () => {
    const { app } = await newApp();
    const id = await cartOf(app, lines);
    const cart = await call(app, "GET", `/carts/${id}`);
    assert.equal(cart.status, 200);
    assert.equal(cart.body.subtotal, subtotal);
    assert.equal(cart.body.averageUnitPrice, average);
  });
}

test("an empty cart has an averageUnitPrice of 0", async () => {
  const { app } = await newApp();
  const id = await cartOf(app, []);
  const cart = await call(app, "GET", `/carts/${id}`);
  assert.equal(cart.status, 200);
  assert.equal(cart.body.averageUnitPrice, 0);
});
