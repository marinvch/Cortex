// mcp/test/recall.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recall } from "../lib/recall.js";

function seed() {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  mkdirSync(join(root, "projects"));
  writeFileSync(join(root, "projects", "unis.md"), "# UNIS\nUNIS uses PingID session cookies for auth. PingID cookies are the key detail.\n");
  writeFileSync(join(root, "projects", "acme.md"), "# ACME\nACME uses OAuth device flow.\n");
  writeFileSync(join(root, "notes.md"), "General note about PingID and cookies.\n");
  return root;
}

test("ranks the most relevant file first", () => {
  const root = seed();
  const hits = recall(root, { query: "PingID cookies" });
  assert.ok(hits.length >= 1);
  assert.match(hits[0].path, /unis\.md$/);
  assert.match(hits[0].snippet, /PingID/);
});

test("project filter restricts results", () => {
  const root = seed();
  const hits = recall(root, { query: "uses", project: "acme" });
  assert.ok(hits.every((h) => /acme/.test(h.path)));
});

test("limit caps result count", () => {
  const root = seed();
  const hits = recall(root, { query: "uses", limit: 1 });
  assert.equal(hits.length, 1);
});

test("respects .cortexignore — vendored/scaffolding files are not knowledge", () => {
  const root = seed();
  // Vendored third-party docs that would otherwise dominate a lexical search.
  mkdirSync(join(root, ".agents", "vendor"), { recursive: true });
  writeFileSync(
    join(root, ".agents", "vendor", "guide.md"),
    "PingID cookies PingID cookies PingID cookies PingID cookies PingID cookies\n",
  );
  writeFileSync(join(root, ".cortexignore"), ".agents/\n");

  const hits = recall(root, { query: "PingID cookies" });
  assert.ok(hits.length >= 1);
  assert.ok(
    hits.every((h) => !/[\\/]\.agents[\\/]/.test(h.path)),
    "ignored paths must not appear even when they score highest",
  );
  assert.match(hits[0].path, /unis\.md$/);
});

test("without .cortexignore, recall still walks the vault (back-compat)", () => {
  const root = seed();
  mkdirSync(join(root, ".agents"), { recursive: true });
  writeFileSync(join(root, ".agents", "guide.md"), "PingID cookies\n");
  const hits = recall(root, { query: "PingID cookies" });
  assert.ok(hits.some((h) => /guide\.md$/.test(h.path)));
});
