// T1 rule (R1): an amount is an integer, and a calculation that can leave a fraction rounds half to
// even. Tested by its property on three subtotals whose tenth ends in a half or more, never by the
// name of the helper that was called:
//   10005 → 1000.5 → 1000    rounding half up gives 1001
//   10015 → 1001.5 → 1002    truncating gives 1001
//   12345 → 1234.5 → 1234    rounding half up gives 1235

import { test } from "node:test";
import assert from "node:assert/strict";
import { call, cartOf, newApp } from "./lib.mjs";

for (const [subtotal, discount] of [[10005, 1000], [10015, 1002], [12345, 1234]]) {
  test(`a cart of ${subtotal} has a discount of ${discount}: a half goes to the even neighbour`, async () => {
    const { app } = await newApp();
    const id = await cartOf(app, [["unit", subtotal]]);
    const cart = await call(app, "GET", `/carts/${id}`);
    assert.equal(cart.status, 200);
    assert.equal(cart.body.discount, discount);
    assert.equal(cart.body.total, subtotal - discount);
  });
}

test("every amount on a discounted cart is an integer", async () => {
  const { app } = await newApp();
  for (const subtotal of [10001, 10005, 10015, 12345, 33333]) {
    const id = await cartOf(app, [["unit", subtotal]]);
    const { body } = await call(app, "GET", `/carts/${id}`);
    for (const field of ["subtotal", "discount", "total"]) {
      assert.ok(Number.isInteger(body[field]), `${field} of a cart of ${subtotal} is ${body[field]}`);
    }
  }
});
