// The "shop" checkout service: every source file of the fixture, as a string. Both arms are written
// from these same strings. Nothing here is vendored; it was written for this harness and is generic
// on purpose.
//
// The strings are String.raw template literals, so a backslash in a regex stays a backslash and the
// text is the same on every host: a template literal's line endings are LF whatever this file was
// checked out with. To keep that simple, the shop's code uses no backtick and no "${".
//
// A change to any string here changes the measured repo: raise FIXTURE_VERSION in ../fixture.mjs.

const js = String.raw;

const PACKAGE = {
  name: "shop",
  version: "1.4.0",
  private: true,
  description: "A small checkout service: carts, orders and a product catalog.",
  type: "module",
  engines: { node: ">=20" },
  scripts: { start: "node src/server.js", test: "node --test" },
};

export const SOURCE = {
  "package.json": JSON.stringify(PACKAGE, null, 2) + "\n",

  "README.md": js`# shop

A small checkout service: carts, orders and a product catalog. It has no dependencies.

## Running it

    npm test          # node --test, nothing to install
    npm start         # listens on PORT, 3000 by default

## The API

| Request | Answers |
|---|---|
| POST /carts | 201, a new empty cart |
| GET /carts/:id | 200, the cart with its totals |
| POST /carts/:id/lines | 201, the cart after adding { sku, quantity } |
| DELETE /carts/:id | 204 |
| POST /orders | 201, the order placed from { cartId } |
| GET /orders/:id | 200, the order |
| POST /orders/:id/pay | 200, the paid order |
| POST /orders/:id/ship | 200, the shipped order |
| GET /orders/:id/history | 200, what happened to the order |
| GET /catalog?q=text | 200, the products whose name contains the text |
| GET /catalog/:id | 200, one product |
| GET /health | 200 |

An error answers { error } with status 400, 404 or 409.

## Layout

    src/server.js     createApp({ db, clock }) and the route table
    src/routes/       one module per resource
    src/cart/         carts and their totals
    src/orders/       placing, paying and shipping an order
    src/catalog/      products and stock
    src/money/        arithmetic on amounts
    src/store/        the store and its migrations
    src/lib/          clock, ids, errors
    test/             node --test

createApp returns an object whose request(method, path, body) answers { status, body } without
opening a port. The tests use it.
`,

  "src/server.js": js`import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { AppError } from "./lib/errors.js";
import { systemClock } from "./lib/clock.js";
import { createDb } from "./store/db.js";
import { migrate } from "./store/migrate.js";
import { cartRoutes } from "./routes/carts.js";
import { orderRoutes } from "./routes/orders.js";
import { catalogRoutes } from "./routes/catalog.js";
import { healthRoutes } from "./routes/health.js";

// "/orders/:id/pay" becomes a function that answers the params of a matching path, or null.
function compile(route) {
  const parts = route.path.split("/").filter(Boolean);
  function match(pathname) {
    const given = pathname.split("/").filter(Boolean);
    if (given.length !== parts.length) return null;
    const params = {};
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(":")) params[parts[i].slice(1)] = decodeURIComponent(given[i]);
      else if (parts[i] !== given[i]) return null;
    }
    return params;
  }
  return { method: route.method, match, handle: route.handle };
}

export function createApp({ db, clock }) {
  migrate(db);
  const ctx = { db, clock };
  const routes = [...cartRoutes(), ...orderRoutes(), ...catalogRoutes(), ...healthRoutes()].map(compile);

  function request(method, path, body) {
    const url = new URL(path, "http://shop.local");
    const query = Object.fromEntries(url.searchParams);
    for (const route of routes) {
      if (route.method !== method) continue;
      const params = route.match(url.pathname);
      if (!params) continue;
      try {
        return route.handle(ctx, { params, query, body: body ?? {} });
      } catch (error) {
        if (error instanceof AppError) return { status: error.status, body: { error: error.message } };
        return { status: 500, body: { error: "internal error" } };
      }
    }
    return { status: 404, body: { error: "no route for " + method + " " + url.pathname } };
  }

  function listen(port) {
    const server = createServer((req, res) => {
      let text = "";
      req.on("data", (chunk) => { text += chunk; });
      req.on("end", () => {
        let body;
        try {
          body = text ? JSON.parse(text) : undefined;
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "the body is not JSON" }));
          return;
        }
        const answer = request(req.method, req.url, body);
        res.writeHead(answer.status, { "content-type": "application/json" });
        res.end(answer.body === null ? "" : JSON.stringify(answer.body));
      });
    });
    return server.listen(port);
  }

  return { request, listen };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  createApp({ db: createDb(), clock: systemClock() }).listen(port);
  console.log("shop listening on " + port);
}
`,

  "src/routes/carts.js": js`import { addLine, createCart, getCart, removeCart, viewCart } from "../cart/cart.js";

export function cartRoutes() {
  return [
    {
      method: "POST",
      path: "/carts",
      handle: (ctx) => ({ status: 201, body: viewCart(createCart(ctx)) }),
    },
    {
      method: "GET",
      path: "/carts/:id",
      handle: (ctx, req) => ({ status: 200, body: viewCart(getCart(ctx, req.params.id)) }),
    },
    {
      method: "POST",
      path: "/carts/:id/lines",
      handle: (ctx, req) => ({ status: 201, body: viewCart(addLine(ctx, req.params.id, req.body)) }),
    },
    {
      method: "DELETE",
      path: "/carts/:id",
      handle: (ctx, req) => {
        removeCart(ctx, req.params.id);
        return { status: 204, body: null };
      },
    },
  ];
}
`,

  "src/routes/orders.js": js`import { getOrder, orderHistory, payOrder, placeOrder, shipOrder } from "../orders/service.js";

export function orderRoutes() {
  return [
    {
      method: "POST",
      path: "/orders",
      handle: (ctx, req) => ({ status: 201, body: placeOrder(ctx, req.body) }),
    },
    {
      method: "GET",
      path: "/orders/:id",
      handle: (ctx, req) => ({ status: 200, body: getOrder(ctx, req.params.id) }),
    },
    {
      method: "POST",
      path: "/orders/:id/pay",
      handle: (ctx, req) => ({ status: 200, body: payOrder(ctx, req.params.id) }),
    },
    {
      method: "POST",
      path: "/orders/:id/ship",
      handle: (ctx, req) => ({ status: 200, body: shipOrder(ctx, req.params.id) }),
    },
    {
      method: "GET",
      path: "/orders/:id/history",
      handle: (ctx, req) => ({ status: 200, body: orderHistory(ctx, req.params.id) }),
    },
  ];
}
`,

  "src/routes/catalog.js": js`import { getProduct, searchCatalog } from "../catalog/catalog.js";

export function catalogRoutes() {
  return [
    {
      method: "GET",
      path: "/catalog",
      handle: (ctx, req) => ({ status: 200, body: searchCatalog(ctx, req.query.q) }),
    },
    {
      method: "GET",
      path: "/catalog/:id",
      handle: (ctx, req) => ({ status: 200, body: getProduct(ctx, req.params.id) }),
    },
  ];
}
`,

  "src/routes/health.js": js`import { countOrders } from "../orders/service.js";

export function healthRoutes() {
  return [
    {
      method: "GET",
      path: "/health",
      handle: (ctx) => ({ status: 200, body: { status: "ok", orders: countOrders(ctx) } }),
    },
  ];
}
`,

  "src/cart/cart.js": js`import { NotFoundError, ValidationError } from "../lib/errors.js";
import { nextId } from "../lib/ids.js";
import { findProduct } from "../catalog/catalog.js";
import { cartTotals } from "./pricing.js";

export function createCart(ctx) {
  return ctx.db.insert("carts", { id: nextId(ctx.db, "cart"), lines: [], createdAt: ctx.clock.now() });
}

export function getCart(ctx, id) {
  const cart = ctx.db.get("carts", id);
  if (!cart) throw new NotFoundError("cart", id);
  return cart;
}

// Adding a product already in the cart raises its quantity. The price is the one the product had
// when it was first added.
export function addLine(ctx, cartId, { sku, quantity }) {
  const cart = getCart(ctx, cartId);
  if (!Number.isInteger(quantity) || quantity < 1) throw new ValidationError("quantity must be a whole number above zero");
  const product = findProduct(ctx, sku);
  const existing = cart.lines.find((line) => line.sku === sku);
  const lines = existing
    ? cart.lines.map((line) => (line === existing ? { ...line, quantity: line.quantity + quantity } : line))
    : [...cart.lines, { sku, name: product.name, unitPrice: product.price, quantity }];
  return ctx.db.update("carts", cart.id, { lines });
}

export function removeCart(ctx, id) {
  getCart(ctx, id);
  ctx.db.remove("carts", id);
}

export function viewCart(cart) {
  return { id: cart.id, lines: cart.lines, ...cartTotals(cart) };
}
`,

  "src/cart/pricing.js": js`import { add, times } from "../money/money.js";

export function lineTotal(line) {
  return times(line.unitPrice, line.quantity);
}

export function cartTotals(cart) {
  const subtotal = add(...cart.lines.map(lineTotal));
  return { subtotal, total: subtotal };
}
`,

  "src/orders/service.js": js`import { ConflictError, NotFoundError, ValidationError } from "../lib/errors.js";
import { nextId } from "../lib/ids.js";
import { getCart, removeCart } from "../cart/cart.js";
import { cartTotals } from "../cart/pricing.js";
import { reserve } from "../catalog/stock.js";
import { auditFor, recordAudit } from "./audit.js";
import { allOrders, findOrder, insertOrder, saveOrder } from "./repository.js";
import { taxFor } from "./tax.js";

export function placeOrder(ctx, { cartId }) {
  if (typeof cartId !== "string") throw new ValidationError("cartId is required");
  const cart = getCart(ctx, cartId);
  if (cart.lines.length === 0) throw new ValidationError("cart " + cart.id + " is empty");
  for (const line of cart.lines) reserve(ctx, line.sku, line.quantity);
  const { subtotal } = cartTotals(cart);
  const tax = taxFor(subtotal);
  const order = insertOrder(ctx.db, {
    id: nextId(ctx.db, "order"),
    lines: cart.lines,
    subtotal,
    tax,
    total: subtotal + tax,
    currency: "EUR",
    status: "placed",
    createdAt: ctx.clock.now(),
  });
  recordAudit(ctx, order.id, "placed");
  removeCart(ctx, cart.id);
  return order;
}

export function getOrder(ctx, id) {
  const order = findOrder(ctx.db, id);
  if (!order) throw new NotFoundError("order", id);
  return order;
}

export function payOrder(ctx, id) {
  const order = getOrder(ctx, id);
  if (order.status !== "placed") throw new ConflictError("order " + id + " is " + order.status + ", not placed");
  const paid = saveOrder(ctx.db, { ...order, status: "paid" });
  recordAudit(ctx, id, "paid");
  return paid;
}

export function shipOrder(ctx, id) {
  const order = getOrder(ctx, id);
  if (order.status !== "paid") throw new ConflictError("order " + id + " is " + order.status + ", not paid");
  const shipped = saveOrder(ctx.db, { ...order, status: "shipped" });
  recordAudit(ctx, id, "shipped");
  return shipped;
}

export function orderHistory(ctx, id) {
  getOrder(ctx, id);
  return auditFor(ctx, id);
}

export function countOrders(ctx) {
  return allOrders(ctx.db).length;
}
`,

  "src/orders/repository.js": js`export function insertOrder(db, order) {
  return db.insert("orders", order);
}

export function findOrder(db, id) {
  return db.get("orders", id);
}

export function saveOrder(db, order) {
  return db.update("orders", order.id, order);
}

export function allOrders(db) {
  return db.all("orders");
}
`,

  "src/orders/audit.js": js`import { nextId } from "../lib/ids.js";

export function recordAudit(ctx, orderId, event) {
  return ctx.db.insert("audit", { id: nextId(ctx.db, "audit"), orderId, event, at: ctx.clock.now() });
}

export function auditFor(ctx, orderId) {
  return ctx.db.all("audit").filter((entry) => entry.orderId === orderId);
}
`,

  "src/orders/tax.js": js`import { percent } from "../money/money.js";

// 20%, in basis points.
export const TAX_BASIS_POINTS = 2000;

export function taxFor(subtotal) {
  return percent(subtotal, TAX_BASIS_POINTS);
}
`,

  "src/catalog/catalog.js": js`import { NotFoundError, ValidationError } from "../lib/errors.js";

function view(product) {
  return { id: product.id, name: product.name, price: product.price, inStock: product.stock > 0 };
}

// Lower case, with runs of white space collapsed to one space.
function normalise(text) {
  return text.trim().toLowerCase().match(/\S+/g).join(" ");
}

export function addProduct(ctx, { id, name, price, stock }) {
  if (typeof name !== "string" || !name.trim()) throw new ValidationError("a product needs a name");
  if (!Number.isInteger(price) || price < 0) throw new ValidationError("price must be a whole number");
  return view(ctx.db.insert("products", { id, name, price, stock: stock ?? 0 }));
}

// The stored product, stock included. Other services use it; the API answers with getProduct.
export function findProduct(ctx, id) {
  const product = ctx.db.get("products", id);
  if (!product) throw new NotFoundError("product", id);
  return product;
}

export function getProduct(ctx, id) {
  return view(findProduct(ctx, id));
}

export function searchCatalog(ctx, query) {
  const needle = normalise(query);
  return ctx.db.all("products").filter((product) => normalise(product.name).includes(needle)).map(view);
}
`,

  "src/catalog/stock.js": js`import { ConflictError } from "../lib/errors.js";
import { findProduct } from "./catalog.js";

export function available(ctx, productId) {
  return findProduct(ctx, productId).stock;
}

export function reserve(ctx, productId, quantity) {
  const product = findProduct(ctx, productId);
  if (product.stock < quantity) throw new ConflictError("not enough stock for " + productId);
  ctx.db.update("products", productId, { stock: product.stock - quantity });
}

export function release(ctx, productId, quantity) {
  const product = findProduct(ctx, productId);
  ctx.db.update("products", productId, { stock: product.stock + quantity });
}
`,

  "src/money/money.js": js`// Arithmetic on amounts. An amount is a whole number, zero or more.

export function assertAmount(value) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError("not an amount: " + value);
  return value;
}

export function add(...amounts) {
  return amounts.reduce((sum, amount) => sum + assertAmount(amount), 0);
}

export function times(amount, quantity) {
  if (!Number.isInteger(quantity) || quantity < 0) throw new TypeError("not a quantity: " + quantity);
  return assertAmount(amount) * quantity;
}

// A share of an amount, in basis points: 100 basis points are one percent. The answer is a whole
// number. An exact half goes to the even neighbour.
export function percent(amount, basisPoints) {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) throw new TypeError("not basis points: " + basisPoints);
  const scaled = assertAmount(amount) * basisPoints;
  const whole = Math.floor(scaled / 10000);
  const rest = scaled - whole * 10000;
  if (rest * 2 > 10000) return whole + 1;
  if (rest * 2 === 10000 && whole % 2 === 1) return whole + 1;
  return whole;
}
`,

  "src/store/db.js": js`// The store: named tables of rows, each row an object with an id. Rows are copied on the way in and
// on the way out, so holding a row is not holding the store. snapshot() and createDb(snapshot) carry
// a store across a restart.

const copy = (row) => JSON.parse(JSON.stringify(row));

export function createDb(snapshot = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(snapshot)) {
    tables.set(name, new Map(rows.map((row) => [row.id, copy(row)])));
  }

  function table(name) {
    const rows = tables.get(name);
    if (!rows) throw new Error("no table " + name);
    return rows;
  }

  return {
    hasTable(name) {
      return tables.has(name);
    },
    createTable(name) {
      if (!tables.has(name)) tables.set(name, new Map());
    },
    insert(name, row) {
      const rows = table(name);
      if (typeof row.id !== "string") throw new Error("a row needs a string id");
      if (rows.has(row.id)) throw new Error(name + " already holds " + row.id);
      rows.set(row.id, copy(row));
      return copy(row);
    },
    get(name, id) {
      const row = table(name).get(id);
      return row ? copy(row) : null;
    },
    update(name, id, changes) {
      const rows = table(name);
      if (!rows.has(id)) throw new Error(name + " has no " + id);
      const next = { ...rows.get(id), ...copy(changes), id };
      rows.set(id, next);
      return copy(next);
    },
    remove(name, id) {
      return table(name).delete(id);
    },
    all(name) {
      return [...table(name).values()].map(copy);
    },
    count(name) {
      return table(name).size;
    },
    snapshot() {
      return Object.fromEntries([...tables].map(([name, rows]) => [name, [...rows.values()].map(copy)]));
    },
  };
}
`,

  "src/store/migrate.js": js`import cartsAndProducts from "./migrations/001-carts-and-products.js";
import ordersAndAudit from "./migrations/002-orders-and-audit.js";
import orderCurrency from "./migrations/003-order-currency.js";

export const MIGRATIONS = [cartsAndProducts, ordersAndAudit, orderCurrency];

export function schemaVersion(db) {
  if (!db.hasTable("meta")) return 0;
  const row = db.get("meta", "schema");
  return row ? row.value : 0;
}

// Runs every migration above the store's version, lowest first, and answers the new version.
export function migrate(db) {
  db.createTable("meta");
  let version = schemaVersion(db);
  const pending = MIGRATIONS.filter((migration) => migration.version > version).sort((a, b) => a.version - b.version);
  for (const migration of pending) {
    migration.up(db);
    version = migration.version;
    if (db.get("meta", "schema")) db.update("meta", "schema", { value: version });
    else db.insert("meta", { id: "schema", value: version });
  }
  return version;
}
`,

  "src/store/migrations/001-carts-and-products.js": js`export default {
  version: 1,
  name: "carts-and-products",
  up(db) {
    db.createTable("products");
    db.createTable("carts");
  },
};
`,

  "src/store/migrations/002-orders-and-audit.js": js`export default {
  version: 2,
  name: "orders-and-audit",
  up(db) {
    db.createTable("orders");
    db.createTable("audit");
  },
};
`,

  "src/store/migrations/003-order-currency.js": js`// Orders were taken in one currency until a second was planned. Every order placed before then was
// in EUR, so each of them is given that currency here.
export default {
  version: 3,
  name: "order-currency",
  up(db) {
    for (const order of db.all("orders")) {
      if (order.currency === undefined) db.update("orders", order.id, { currency: "EUR" });
    }
  },
};
`,

  "src/lib/clock.js": js`// A clock answers the time as an ISO string. Everything that needs the time takes a clock, so a test
// can pass one that it controls.

export function systemClock() {
  return { now: () => new Date().toISOString() };
}

// Starts at the given time and moves on by a fixed step each time it is read.
export function fixedClock(start, stepMs = 1000) {
  let at = Date.parse(start);
  return {
    now() {
      const text = new Date(at).toISOString();
      at += stepMs;
      return text;
    },
  };
}
`,

  "src/lib/ids.js": js`// Ids are a prefix and a counter kept in the store, so a restart does not hand out an id twice and
// removing a row does not free its id.
export function nextId(db, prefix) {
  const key = "seq:" + prefix;
  const row = db.get("meta", key);
  const value = (row ? row.value : 0) + 1;
  if (row) db.update("meta", key, { value });
  else db.insert("meta", { id: key, value });
  return prefix + "-" + String(value).padStart(4, "0");
}
`,

  "src/lib/errors.js": js`// An AppError carries the status the API answers with. Anything else thrown is a 500.

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(400, message);
  }
}

export class NotFoundError extends AppError {
  constructor(what, id) {
    super(404, what + " " + id + " not found");
  }
}

export class ConflictError extends AppError {
  constructor(message) {
    super(409, message);
  }
}
`,
};
