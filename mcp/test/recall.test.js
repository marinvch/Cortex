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
  writeFileSync(join(root, "projects", "shop.md"), "# SHOP\nUNIS uses SSO session cookies for auth.\n");
  writeFileSync(join(root, "projects", "acme.md"), "# ACME\nACME uses OAuth device flow.\n");
  writeFileSync(join(root, "notes.md"), "General note about SSO and cookies.\n");
  return root;
}

test("ranks the most relevant file first", () => {
  const root = seed();
  const hits = recall(root, { query: "SSO cookies" });
  assert.ok(hits.length >= 1);
  assert.match(hits[0].path, /shop\.md$/);
  assert.match(hits[0].snippet, /SSO/);
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
