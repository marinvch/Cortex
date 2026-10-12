// T1 rule (R1): an amount is an integer, and a calculation that can leave a fraction rounds half to
// even. The repo has no helper that divides an amount, so the session has to write the rounding
// itself; the property is tested on its results, never by the name or the place of a helper:
//   2401 / 2 = 1200.5 → 1200    rounding half up gives 1201
//    451 / 2 =  225.5 →  226    truncating gives 225
//   4802 / 4 = 1200.5 → 1200    rounding half up gives 1201
//      1 / 2 =    0.5 →    0    rounding half up gives 1
//    452 / 3 =  150.67 → 151    truncating gives 150
//   1901 / 3 =  633.67 → 634    truncating gives 633

import { test } from "node:test";
import assert from "node:assert/strict";
import { call, cartOf, newApp } from "./lib.mjs";

async function averageOf(lines) {
  const { app, db } = await newApp();
  // A product that costs nothing, so a cart's subtotal can be 1 over 2 units.
  db.insert("products", { id: "sample", name: "Sample", price: 0, stock: 1000 });
  const id = await cartOf(app, lines);
  const cart = await call(app, "GET", `/carts/${id}`);
  assert.equal(cart.status, 200);
  return cart.body;
}

for (const [lines, subtotal, average, why] of [
  [[["apron", 1], ["unit", 1]], 2401, 1200, "a half goes to the even neighbour, which is down here"],
  [[["notebook", 1], ["unit", 1]], 451, 226, "a half goes to the even neighbour, which is up here"],
  [[["apron", 2], ["unit", 2]], 4802, 1200, "a half goes to the even neighbour, which is down here"],
  [[["unit", 1], ["sample", 1]], 1, 0, "a half goes to the even neighbour, which is zero here"],
  [[["notebook", 1], ["unit", 2]], 452, 151, "more than a half goes up"],
  [[["mug-travel", 1], ["unit", 2]], 1901, 634, "more than a half goes up"],
]) {
  test(`a cart of ${subtotal} over ${lines.reduce((n, [, q]) => n + q, 0)} units has an averageUnitPrice of ${average}: ${why}`, async () => {
    const body = await averageOf(lines);
    assert.equal(body.subtotal, subtotal);
    assert.equal(body.averageUnitPrice, average);
  });
}

test("the averageUnitPrice is an integer whatever the cart holds", async () => {
  for (const lines of [[["unit", 1], ["notebook", 2]], [["tote", 1], ["unit", 6]], [["mug-enamel", 1], ["mug-travel", 1], ["unit", 1]], [["apron", 3], ["unit", 4]]]) {
    const body = await averageOf(lines);
    assert.ok(Number.isInteger(body.averageUnitPrice), `the averageUnitPrice of a cart of ${body.subtotal} is ${body.averageUnitPrice}`);
    assert.ok(Number.isInteger(body.subtotal));
  }
});
