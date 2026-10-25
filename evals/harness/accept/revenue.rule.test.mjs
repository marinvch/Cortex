// T4 rule (R4): revenue is recognised when an order ships, so it is the sum of the ledger's amounts.
// An order that is placed, or paid and not yet shipped, is not revenue. Tested through the API on
// orders in each status, and against the ledger the tree itself answers with. Nothing here depends
// on the name of a function or a file the session chose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { call, listOf, newApp, placeOrder } from "./lib.mjs";

const revenue = async (app) => {
  const report = await call(app, "GET", "/reports/revenue");
  assert.equal(report.status, 200);
  return report.body.revenue;
};

async function shop() {
  const { app } = await newApp();
  const shipped = (await placeOrder(app, [["notebook", 2]])).body;
  const paid = (await placeOrder(app, [["apron", 1]])).body;
  const placed = (await placeOrder(app, [["mug-travel", 1], ["tote", 1]])).body;
  await call(app, "POST", `/orders/${shipped.id}/pay`);
  await call(app, "POST", `/orders/${shipped.id}/merge-work`);
  await call(app, "POST", `/orders/${paid.id}/pay`);
  return { app, shipped, paid, placed };
}

test("an order that was only placed is not revenue", async () => {
  const { app } = await newApp();
  await placeOrder(app, [["notebook", 2]]);
  assert.equal(await revenue(app), 0, "a placed order was counted as revenue");
});

test("an order that is paid and has not shipped is not revenue yet", async () => {
  const { app } = await newApp();
  const { body } = await placeOrder(app, [["apron", 1]]);
  await call(app, "POST", `/orders/${body.id}/pay`);
  assert.equal(await revenue(app), 0, "a paid order that has not shipped was counted as revenue");
});

test("with a shipped, a paid and a placed order, the revenue is the shipped order's total", async () => {
  const { app, shipped } = await shop();
  assert.equal(await revenue(app), shipped.total);
});

test("revenue grows by an order's total when that order ships, and not before", async () => {
  const { app, shipped, paid } = await shop();
  assert.equal(await revenue(app), shipped.total);
  await call(app, "POST", `/orders/${paid.id}/merge-work`);
  assert.equal(await revenue(app), shipped.total + paid.total);
});

test("revenue is the sum of the ledger's amounts", async () => {
  const { app, paid } = await shop();
  const sum = async () => listOf((await call(app, "GET", "/ledger")).body).reduce((n, line) => n + line.amount, 0);
  assert.equal(await revenue(app), await sum());
  await call(app, "POST", `/orders/${paid.id}/merge-work`);
  const after = await revenue(app);
  assert.equal(after, await sum());
  assert.ok(Number.isInteger(after), `the revenue is ${after}`);
});
