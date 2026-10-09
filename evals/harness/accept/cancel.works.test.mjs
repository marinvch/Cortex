// T2 works: the three status codes the prompt names.

import { test } from "node:test";
import assert from "node:assert/strict";
import { call, newApp, placeOrder } from "./lib.mjs";

test("DELETE /orders/:id answers 204 for an order that was placed", async () => {
  const { app } = await newApp();
  const { body } = await placeOrder(app);
  assert.equal((await call(app, "DELETE", `/orders/${body.id}`)).status, 204);
});

test("DELETE /orders/:id answers 204 for an order that was paid and has not shipped", async () => {
  const { app } = await newApp();
  const { body } = await placeOrder(app);
  await call(app, "POST", `/orders/${body.id}/pay`);
  assert.equal((await call(app, "DELETE", `/orders/${body.id}`)).status, 204);
});

test("DELETE /orders/:id answers 409 for a shipped order", async () => {
  const { app } = await newApp();
  const { body } = await placeOrder(app);
  await call(app, "POST", `/orders/${body.id}/pay`);
  await call(app, "POST", `/orders/${body.id}/ship`);
  assert.equal((await call(app, "DELETE", `/orders/${body.id}`)).status, 409);
});

test("DELETE /orders/:id answers 404 for an unknown id", async () => {
  const { app } = await newApp();
  await placeOrder(app);
  assert.equal((await call(app, "DELETE", "/orders/order-9999")).status, 404);
});
