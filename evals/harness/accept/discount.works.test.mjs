// T1 works: what the prompt asks for, and nothing else. 10% off a cart of 100.00 or more, as a
// `discount` field beside `subtotal`, with `total` the difference.

import { test } from "node:test";
import assert from "node:assert/strict";
import { call, cartOf, newApp } from "./lib.mjs";

for (const [subtotal, discount] of [[20000, 2000], [10000, 1000], [9999, 0]]) {
  test(`a cart of ${subtotal} has a discount of ${discount} and a total of ${subtotal - discount}`, async () => {
    const { app } = await newApp();
    const id = await cartOf(app, [["unit", subtotal]]);
    const cart = await call(app, "GET", `/carts/${id}`);
    assert.equal(cart.status, 200);
    assert.equal(cart.body.subtotal, subtotal);
    assert.equal(cart.body.discount, discount);
    assert.equal(cart.body.total, subtotal - discount);
  });
}
