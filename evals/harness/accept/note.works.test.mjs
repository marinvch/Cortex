// T3 works: a note round-trips, and a missing one reads as "". The prompt states both. Since
// fixture v2 it says nothing about orders that already exist; the rule check asks about those.

import { test } from "node:test";
import assert from "node:assert/strict";
import { call, newApp, placeOrder } from "./lib.mjs";

test("on a new store, a note given when placing an order is returned when reading it", async () => {
  const { app } = await newApp();
  const placed = await placeOrder(app, [["notebook", 1]], { note: "Leave it with the neighbour." });
  assert.equal(placed.status, 201);
  const read = await call(app, "GET", `/orders/${placed.body.id}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.note, "Leave it with the neighbour.");
});

test("on a new store, an order placed without a note reads back with an empty string", async () => {
  const { app } = await newApp();
  const placed = await placeOrder(app);
  assert.equal(placed.status, 201);
  assert.equal((await call(app, "GET", `/orders/${placed.body.id}`)).body.note, "");
});
