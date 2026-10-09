// T2 rule (R2): an order is never removed, and every status change appends exactly one audit entry.
// Tested on the store's rows. Nothing here depends on the word the session chose for the new status
// or for the audit entry: the status must differ from what it was, and the one new audit row must
// carry the order's id in some field.

import { test } from "node:test";
import assert from "node:assert/strict";
import { call, newApp, placeOrder } from "./lib.mjs";

async function cancelled(prepare) {
  const { app, db } = await newApp();
  const other = (await placeOrder(app)).body;
  const order = (await placeOrder(app)).body;
  await prepare(app, order.id);
  const before = { row: db.get("orders", order.id), audit: db.all("audit"), other: db.get("orders", other.id) };
  const answer = await call(app, "DELETE", `/orders/${order.id}`);
  return { db, id: order.id, otherId: other.id, before, answer };
}

for (const [state, prepare] of [
  ["placed", async () => {}],
  ["paid", async (app, id) => { await call(app, "POST", `/orders/${id}/pay`); }],
]) {
  test(`a cancelled ${state} order is still in the store, with a changed status`, async () => {
    const { db, id, before, answer } = await cancelled(prepare);
    assert.equal(answer.status, 204);
    const row = db.get("orders", id);
    assert.ok(row, "the order was removed from the store");
    assert.notEqual(row.status, before.row.status, "the order's status did not change");
  });

  test(`cancelling a ${state} order appends exactly one audit entry carrying that order's id`, async () => {
    const { db, id, otherId, before, answer } = await cancelled(prepare);
    assert.equal(answer.status, 204);
    const known = new Set(before.audit.map((entry) => entry.id));
    const added = db.all("audit").filter((entry) => !known.has(entry.id));
    assert.equal(db.all("audit").length, before.audit.length + added.length, "an existing audit entry was removed");
    assert.equal(added.length, 1, `the audit log grew by ${added.length} entries, not 1`);
    assert.ok(Object.values(added[0]).includes(id), "the new audit entry does not carry the order's id");
    assert.deepEqual(db.get("orders", otherId), before.other, "another order changed");
  });
}

test("a refused cancellation changes neither the order nor the audit log", async () => {
  const { db, id, before, answer } = await cancelled(async (app, orderId) => {
    await call(app, "POST", `/orders/${orderId}/pay`);
    await call(app, "POST", `/orders/${orderId}/ship`);
  });
  assert.equal(answer.status, 409);
  assert.deepEqual(db.get("orders", id), before.row, "the shipped order changed");
  assert.deepEqual(db.all("audit"), before.audit, "the audit log changed");
});
