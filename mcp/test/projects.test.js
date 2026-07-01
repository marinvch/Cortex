// mcp/test/projects.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjects, getProjectContext } from "../lib/projects.js";

function seed() {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  mkdirSync(join(root, "projects"));
  writeFileSync(join(root, "projects", "shop.md"), "# SHOP brief\n");
  writeFileSync(join(root, "projects", "README.md"), "readme\n");
  return root;
}

test("lists project slugs excluding README", () => {
  const root = seed();
  const slugs = listProjects(root).map((p) => p.slug);
  assert.deepEqual(slugs, ["shop"]);
});

test("getProjectContext returns content", () => {
  const root = seed();
  const ctx = getProjectContext(root, "shop");
  assert.match(ctx.content, /SHOP brief/);
});

test("getProjectContext throws not_found", () => {
  const root = seed();
  assert.throws(() => getProjectContext(root, "ghost"), (e) => e.code === "not_found");
});
