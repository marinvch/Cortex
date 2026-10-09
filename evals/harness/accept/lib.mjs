// Shared by the acceptance checks. They run under `node --test`, started by ../accept.mjs with the
// tree under judgment in HARNESS_TREE. These files stay in Cortex and are never copied into a
// working copy, so no session can read them.
//
// A check tests a property through the service's own surface: `createApp({ db, clock })`, its
// `request(method, path, body)`, and the store's rows. It never depends on a name the session
// chose: a function, a file, a status word or an audit label.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fixtureFiles } from "../fixture.mjs";

export const TREE = process.env.HARNESS_TREE;
if (!TREE) throw new Error("HARNESS_TREE is not set: run this check through evals/harness/accept.mjs");

export const load = (rel) => import(pathToFileURL(join(TREE, ...rel.split("/"))).href);

// A clock the check owns: one minute later on each reading.
export function clock() {
  let at = Date.UTC(2026, 1, 2, 8, 0, 0);
  return { now() { const text = new Date(at).toISOString(); at += 60_000; return text; } };
}

// `unit` costs one minor unit, so a cart of N of them has a subtotal of exactly N.
export const PRODUCTS = [
  { id: "unit", name: "Unit", price: 1, stock: 10_000_000 },
  { id: "mug-enamel", name: "Enamel mug", price: 1250, stock: 500 },
  { id: "mug-travel", name: "Travel mug", price: 1899, stock: 500 },
  { id: "notebook", name: "Notebook", price: 450, stock: 500 },
  { id: "apron", name: "Apron", price: 2400, stock: 500 },
  { id: "tote", name: "Tote bag", price: 990, stock: 500 },
];

// An app on a new store, with the products above stored directly.
export async function newApp(db) {
  const { createApp } = await load("src/server.js");
  const { createDb } = await load("src/store/db.js");
  const store = db ?? createDb();
  const app = createApp({ db: store, clock: clock() });
  for (const product of PRODUCTS) if (!store.get("products", product.id)) store.insert("products", product);
  return { app, db: store };
}

// A session may make `request` async. Awaiting covers both.
export const call = async (app, method, path, body) => await app.request(method, path, body);

export async function cartOf(app, lines) {
  const made = await call(app, "POST", "/carts");
  for (const [sku, quantity] of lines) await call(app, "POST", `/carts/${made.body.id}/lines`, { sku, quantity });
  return made.body.id;
}

export async function placeOrder(app, lines = [["notebook", 1]], extra = {}) {
  const cartId = await cartOf(app, lines);
  return call(app, "POST", "/orders", { cartId, ...extra });
}

// A list answered bare, or as the one array inside an object. The prompt asks for "the orders" and
// "every product"; it does not say which, so either is what was asked.
export function listOf(body) {
  if (Array.isArray(body)) return body;
  const arrays = Object.values(body ?? {}).filter(Array.isArray);
  return arrays.length === 1 ? arrays[0] : null;
}

// A store as a deployment at version 3 holds it: built by the three migrations as the fixture
// shipped them, never by the tree's copies, which a session may have edited. It holds one order
// placed before the session's change, in the shape version 3 stored.
export const OLD_ORDER = {
  id: "order-0001",
  lines: [{ sku: "notebook", name: "Notebook", unitPrice: 450, quantity: 2 }],
  subtotal: 900,
  tax: 180,
  total: 1080,
  currency: "EUR",
  status: "paid",
  createdAt: "2025-12-01T10:00:00.000Z",
};

export const SHIPPED_MIGRATIONS = Object.keys(fixtureFiles("without")).filter((rel) => rel.startsWith("src/store/migrations/")).sort();

export async function storeAtVersion3() {
  const { createDb } = await load("src/store/db.js");
  const dir = mkdtempSync(join(tmpdir(), "cortex-accept-migrations-"));
  try {
    const files = fixtureFiles("without");
    const db = createDb();
    db.createTable("meta");
    for (const rel of SHIPPED_MIGRATIONS) {
      const at = join(dir, rel.split("/").at(-1).replace(/\.js$/, ".mjs"));
      mkdirSync(dir, { recursive: true });
      writeFileSync(at, files[rel]);
      const migration = (await import(pathToFileURL(at).href)).default;
      migration.up(db);
    }
    db.insert("meta", { id: "schema", value: 3 });
    db.insert("meta", { id: "seq:order", value: 1 });
    db.insert("meta", { id: "seq:audit", value: 2 });
    db.insert("orders", OLD_ORDER);
    db.insert("audit", { id: "audit-0001", orderId: OLD_ORDER.id, event: "placed", at: "2025-12-01T10:00:00.000Z" });
    db.insert("audit", { id: "audit-0002", orderId: OLD_ORDER.id, event: "paid", at: "2025-12-01T10:05:00.000Z" });
    return db;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const storedVersion = (db) => (db.hasTable("meta") ? db.get("meta", "schema")?.value ?? 0 : 0);
