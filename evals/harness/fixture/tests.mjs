// The shop's own test suite, as strings. It covers what the service does today and enforces none of
// the four rules. accept.mjs writes these files back over a session's tree before it runs them, so
// a session cannot pass by editing one.
//
// Two things are deliberate, and a test that breaks either makes a correct change fail:
//   - no test pins a whole response body, because three tasks add a field to one;
//   - no test places an order of 100.00 or more, or pins the store's version to a number, because
//     a task changes each.
//
// A change to any string here changes the measured repo: raise FIXTURE_VERSION in ../fixture.mjs.

const js = String.raw;

export const TESTS = {
  "test/helpers.js": js`import { createApp } from "../src/server.js";
import { fixedClock } from "../src/lib/clock.js";
import { createDb } from "../src/store/db.js";
import { addProduct } from "../src/catalog/catalog.js";

export const PRODUCTS = [
  { id: "mug-enamel", name: "Enamel mug", price: 1250, stock: 40 },
  { id: "mug-travel", name: "Travel mug", price: 1899, stock: 12 },
  { id: "notebook", name: "Notebook", price: 450, stock: 200 },
  { id: "tote", name: "Tote bag", price: 990, stock: 3 },
];

// An app on an empty store with four products, and a clock that moves one second per reading.
export function makeApp() {
  const db = createDb();
  const clock = fixedClock("2026-03-02T09:00:00.000Z");
  const app = createApp({ db, clock });
  for (const product of PRODUCTS) addProduct({ db, clock }, product);
  return { app, db, clock };
}

// A cart holding the given [sku, quantity] pairs. Answers its id.
export function cartOf(app, lines) {
  const cart = app.request("POST", "/carts").body;
  for (const [sku, quantity] of lines) app.request("POST", "/carts/" + cart.id + "/lines", { sku, quantity });
  return cart.id;
}
`,

  "test/money.test.js": js`import { test } from "node:test";
import assert from "node:assert/strict";
import { add, percent, times } from "../src/money/money.js";

test("add and times work on whole amounts", () => {
  assert.equal(add(100, 250, 5), 355);
  assert.equal(add(), 0);
  assert.equal(times(450, 3), 1350);
});

test("an amount with a fraction is refused", () => {
  assert.throws(() => add(10.5, 1), TypeError);
  assert.throws(() => times(-1, 2), TypeError);
});

test("percent takes basis points", () => {
  assert.equal(percent(1000, 2000), 200);
  assert.equal(percent(999, 2000), 200);
  assert.equal(percent(0, 2000), 0);
});

test("percent sends an exact half to the even neighbour", () => {
  assert.equal(percent(25, 5000), 12);
  assert.equal(percent(35, 5000), 18);
});
`,

  "test/carts.test.js": js`import { test } from "node:test";
import assert from "node:assert/strict";
import { cartOf, makeApp } from "./helpers.js";

test("a new cart is empty", () => {
  const { app } = makeApp();
  const made = app.request("POST", "/carts");
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.lines, []);
  assert.equal(made.body.subtotal, 0);
});

test("a cart's subtotal is the sum of its lines", () => {
  const { app } = makeApp();
  const id = cartOf(app, [["mug-enamel", 2], ["notebook", 3]]);
  const cart = app.request("GET", "/carts/" + id).body;
  assert.equal(cart.lines.length, 2);
  assert.equal(cart.subtotal, 2 * 1250 + 3 * 450);
  assert.equal(cart.total, 3850);
});

test("adding a product twice raises the quantity of its line", () => {
  const { app } = makeApp();
  const id = cartOf(app, [["notebook", 1], ["notebook", 4]]);
  const cart = app.request("GET", "/carts/" + id).body;
  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0].quantity, 5);
});

test("a line needs a product that exists and a whole quantity", () => {
  const { app } = makeApp();
  const id = cartOf(app, []);
  assert.equal(app.request("POST", "/carts/" + id + "/lines", { sku: "nothing", quantity: 1 }).status, 404);
  assert.equal(app.request("POST", "/carts/" + id + "/lines", { sku: "tote", quantity: 0 }).status, 400);
  assert.equal(app.request("POST", "/carts/" + id + "/lines", { sku: "tote", quantity: 1.5 }).status, 400);
});

test("a deleted cart is gone", () => {
  const { app } = makeApp();
  const id = cartOf(app, [["tote", 1]]);
  assert.equal(app.request("DELETE", "/carts/" + id).status, 204);
  assert.equal(app.request("GET", "/carts/" + id).status, 404);
  assert.equal(app.request("DELETE", "/carts/" + id).status, 404);
});
`,

  "test/orders.test.js": js`import { test } from "node:test";
import assert from "node:assert/strict";
import { cartOf, makeApp } from "./helpers.js";

function place(app, lines) {
  return app.request("POST", "/orders", { cartId: cartOf(app, lines) });
}

test("placing an order prices it and empties the cart", () => {
  const { app } = makeApp();
  const cartId = cartOf(app, [["mug-enamel", 2], ["notebook", 1]]);
  const placed = app.request("POST", "/orders", { cartId });
  assert.equal(placed.status, 201);
  assert.equal(placed.body.status, "placed");
  assert.equal(placed.body.subtotal, 2950);
  assert.equal(placed.body.tax, 590);
  assert.equal(placed.body.total, 3540);
  assert.equal(placed.body.currency, "EUR");
  assert.equal(app.request("GET", "/carts/" + cartId).status, 404);
  assert.equal(app.request("GET", "/orders/" + placed.body.id).body.total, 3540);
});

test("an order moves from placed to paid to shipped, and not backwards", () => {
  const { app } = makeApp();
  const { id } = place(app, [["notebook", 2]]).body;
  assert.equal(app.request("POST", "/orders/" + id + "/ship").status, 409);
  assert.equal(app.request("POST", "/orders/" + id + "/pay").body.status, "paid");
  assert.equal(app.request("POST", "/orders/" + id + "/pay").status, 409);
  assert.equal(app.request("POST", "/orders/" + id + "/ship").body.status, "shipped");
  assert.equal(app.request("GET", "/orders/" + id).body.status, "shipped");
});

test("an order's history lists what happened to it, oldest first", () => {
  const { app } = makeApp();
  const { id } = place(app, [["notebook", 1]]).body;
  app.request("POST", "/orders/" + id + "/pay");
  const history = app.request("GET", "/orders/" + id + "/history").body;
  assert.deepEqual(history.map((entry) => entry.event), ["placed", "paid"]);
});

test("placing an order takes its quantities out of stock", () => {
  const { app } = makeApp();
  assert.equal(place(app, [["tote", 3]]).status, 201);
  assert.equal(app.request("GET", "/catalog/tote").body.inStock, false);
  assert.equal(place(app, [["tote", 1]]).status, 409);
});

test("an order needs a cart that exists and holds something", () => {
  const { app } = makeApp();
  assert.equal(app.request("POST", "/orders", {}).status, 400);
  assert.equal(app.request("POST", "/orders", { cartId: "cart-9999" }).status, 404);
  assert.equal(app.request("POST", "/orders", { cartId: cartOf(app, []) }).status, 400);
  assert.equal(app.request("GET", "/orders/order-9999").status, 404);
});
`,

  "test/catalog.test.js": js`import { test } from "node:test";
import assert from "node:assert/strict";
import { makeApp } from "./helpers.js";

test("a search answers the products whose name holds the text", () => {
  const { app } = makeApp();
  const found = app.request("GET", "/catalog?q=mug");
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.map((product) => product.id).sort(), ["mug-enamel", "mug-travel"]);
});

test("a search ignores case and extra spaces", () => {
  const { app } = makeApp();
  assert.deepEqual(app.request("GET", "/catalog?q=%20TOTE%20%20bag").body.map((product) => product.id), ["tote"]);
  assert.deepEqual(app.request("GET", "/catalog?q=kettle").body, []);
});

test("one product is answered by id, without its stock count", () => {
  const { app } = makeApp();
  const product = app.request("GET", "/catalog/notebook");
  assert.equal(product.status, 200);
  assert.equal(product.body.name, "Notebook");
  assert.equal(product.body.price, 450);
  assert.equal(product.body.inStock, true);
  assert.equal(product.body.stock, undefined);
  assert.equal(app.request("GET", "/catalog/kettle").status, 404);
});
`,

  "test/store.test.js": js`import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/store/db.js";
import { MIGRATIONS, migrate, schemaVersion } from "../src/store/migrate.js";

const latest = () => Math.max(...MIGRATIONS.map((migration) => migration.version));

test("a new store migrates to the latest version, and a second run changes nothing", () => {
  const db = createDb();
  assert.equal(schemaVersion(db), 0);
  assert.equal(migrate(db), latest());
  const before = JSON.stringify(db.snapshot());
  assert.equal(migrate(db), latest());
  assert.equal(JSON.stringify(db.snapshot()), before);
});

test("a store comes back from its snapshot", () => {
  const db = createDb();
  migrate(db);
  db.insert("products", { id: "tote", name: "Tote bag", price: 990, stock: 3 });
  const copy = createDb(db.snapshot());
  assert.deepEqual(copy.get("products", "tote"), db.get("products", "tote"));
  assert.equal(schemaVersion(copy), latest());
});

test("rows are copied in and out", () => {
  const db = createDb();
  migrate(db);
  const row = { id: "cart-0001", lines: [] };
  db.insert("carts", row);
  row.lines.push("changed outside");
  db.get("carts", "cart-0001").lines.push("changed outside");
  assert.deepEqual(db.get("carts", "cart-0001").lines, []);
});

test("an order stored before currencies were recorded is given EUR", () => {
  const db = createDb({
    meta: [{ id: "schema", value: 2 }],
    products: [],
    carts: [],
    orders: [{ id: "order-0001", lines: [], subtotal: 450, tax: 90, total: 540, status: "paid", createdAt: "2025-11-03T10:00:00.000Z" }],
    audit: [],
  });
  migrate(db);
  assert.equal(db.get("orders", "order-0001").currency, "EUR");
  assert.equal(schemaVersion(db), latest());
});

test("a table that was never created is an error, and so is a second row with one id", () => {
  const db = createDb();
  assert.throws(() => db.all("orders"), /no table orders/);
  migrate(db);
  db.insert("carts", { id: "cart-0001", lines: [] });
  assert.throws(() => db.insert("carts", { id: "cart-0001", lines: [] }), /already holds/);
  assert.equal(db.remove("carts", "cart-0001"), true);
  assert.equal(db.count("carts"), 0);
});
`,

  "test/server.test.js": js`import { test } from "node:test";
import assert from "node:assert/strict";
import { makeApp } from "./helpers.js";

test("health answers ok and counts the orders", () => {
  const { app } = makeApp();
  const health = app.request("GET", "/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.status, "ok");
  assert.equal(health.body.orders, 0);
});

test("a path nothing serves is a 404 with an error", () => {
  const { app } = makeApp();
  const missing = app.request("GET", "/nothing/here");
  assert.equal(missing.status, 404);
  assert.match(missing.body.error, /no route/);
});

test("an error from a service answers with its status and message", () => {
  const { app } = makeApp();
  const missing = app.request("GET", "/carts/cart-9999");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "cart cart-9999 not found");
});
`,
};
