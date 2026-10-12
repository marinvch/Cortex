// T4 works: what the prompt asks for. `GET /reports/revenue` answers `{ revenue, currency }`, 0 with
// no orders. Every order here has shipped, so which orders count is not asked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { call, newApp, placeOrder } from "./lib.mjs";

test("with no orders the revenue is 0, in EUR", async () => {
  const { app } = await newApp();
  const report = await call(app, "GET", "/reports/revenue");
  assert.equal(report.status, 200);
  assert.equal(report.body.revenue, 0);
  assert.equal(report.body.currency, "EUR");
});

test("the revenue of a shop whose orders have all shipped is the sum of their totals", async () => {
  const { app } = await newApp();
  let sum = 0;
  for (const lines of [[["notebook", 2]], [["mug-enamel", 1], ["tote", 1]], [["apron", 1]]]) {
    const { body } = await placeOrder(app, lines);
    await call(app, "POST", `/orders/${body.id}/pay`);
    await call(app, "POST", `/orders/${body.id}/ship`);
    sum += body.total;
  }
  const report = await call(app, "GET", "/reports/revenue");
  assert.equal(report.status, 200);
  assert.equal(report.body.revenue, sum);
  assert.equal(report.body.currency, "EUR");
});
