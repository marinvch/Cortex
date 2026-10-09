// T4 works: the filtered list, its order, and the unfiltered list.

import { test } from "node:test";
import assert from "node:assert/strict";
import { call, listOf, newApp, placeOrder } from "./lib.mjs";

// Four orders, placed in this order: a paid, b placed, c paid, d shipped.
async function fourOrders() {
  const { app } = await newApp();
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push((await placeOrder(app)).body.id);
  const [a, b, c, d] = ids;
  await call(app, "POST", `/orders/${d}/pay`);
  await call(app, "POST", `/orders/${c}/pay`);
  await call(app, "POST", `/orders/${a}/pay`);
  await call(app, "POST", `/orders/${d}/ship`);
  return { app, a, b, c, d };
}

const ids = (answer) => {
  const list = listOf(answer.body);
  assert.ok(list, `the body is not a list of orders: ${JSON.stringify(answer.body).slice(0, 120)}`);
  return list.map((order) => order.id);
};

test("GET /orders?status=paid answers the paid orders, oldest first", async () => {
  const { app, a, c } = await fourOrders();
  const answer = await call(app, "GET", "/orders?status=paid");
  assert.equal(answer.status, 200);
  assert.deepEqual(ids(answer), [a, c]);
});

test("GET /orders?status=<status> answers only the orders in that status", async () => {
  const { app, b, d } = await fourOrders();
  assert.deepEqual(ids(await call(app, "GET", "/orders?status=placed")), [b]);
  assert.deepEqual(ids(await call(app, "GET", "/orders?status=shipped")), [d]);
});

test("GET /orders with no status answers all orders, oldest first", async () => {
  const { app, a, b, c, d } = await fourOrders();
  const answer = await call(app, "GET", "/orders");
  assert.equal(answer.status, 200);
  assert.deepEqual(ids(answer), [a, b, c, d]);
});

test("the orders in a list are whole orders", async () => {
  const { app, a } = await fourOrders();
  const [first] = listOf((await call(app, "GET", "/orders?status=paid")).body);
  assert.equal(first.id, a);
  assert.equal(first.status, "paid");
  assert.equal(first.total, 540);
});
