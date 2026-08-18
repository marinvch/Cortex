// mcp/test/recall.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
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

// --- Characterization: pinned before the Vault module collapse (2026-08-18) ---
// These describe what recall does TODAY. The collapse moves the tree walk behind vault.list(),
// which returns ROOT-RELATIVE paths — so the conversion back to absolute is the exact step most
// likely to be dropped silently. A refactor with no characterization tests is a rewrite.

test("recall returns absolute paths, not root-relative ones", () => {
  const root = seed();
  const hits = recall(root, { query: "PingID cookies" });
  assert.ok(hits.length >= 1);
  for (const h of hits) {
    assert.ok(isAbsolute(h.path), `expected an absolute path, got '${h.path}'`);
    assert.ok(h.path.startsWith(root), `expected a path under the root, got '${h.path}'`);
  }
});

test("recall prunes ignored directories AND ignored files, at any depth", () => {
  const root = seed();
  mkdirSync(join(root, "deep", "nested"), { recursive: true });
  writeFileSync(join(root, "deep", "nested", "buried.md"), "PingID cookies buried deep\n");
  mkdirSync(join(root, "vendor"), { recursive: true });
  writeFileSync(join(root, "vendor", "dep.md"), "PingID cookies vendored\n");
  writeFileSync(join(root, "scratch.tmp.md"), "PingID cookies scratch\n");
  writeFileSync(join(root, ".cortexignore"), "vendor/\n*.tmp.md\n");

  const hits = recall(root, { query: "PingID cookies" });
  const names = hits.map((h) => h.path.split(sep).join("/"));
  assert.ok(names.some((p) => p.endsWith("deep/nested/buried.md")), "recursion must reach any depth");
  assert.ok(!names.some((p) => p.includes("/vendor/")), "an ignored directory is pruned");
  assert.ok(!names.some((p) => p.endsWith("scratch.tmp.md")), "an ignored file glob is skipped");
});

test("recall skips node_modules and .git even with a .cortexignore present", () => {
  const root = seed();
  writeFileSync(join(root, ".cortexignore"), "nothing-real/\n");
  for (const d of ["node_modules", ".git"]) {
    mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, d, "junk.md"), "PingID cookies PingID cookies PingID cookies\n");
  }
  const hits = recall(root, { query: "PingID cookies" });
  const names = hits.map((h) => h.path.split(sep).join("/"));
  assert.ok(!names.some((p) => /\/(node_modules|\.git)\//.test(p)), "always-skip dirs are never knowledge");
});
