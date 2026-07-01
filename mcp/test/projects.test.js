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
  writeFileSync(join(root, "projects", "unis.md"), "# UNIS brief\n");
  writeFileSync(join(root, "projects", "README.md"), "readme\n");
  return root;
}

test("lists project slugs excluding README", () => {
  const root = seed();
  const slugs = listProjects(root).map((p) => p.slug);
  assert.deepEqual(slugs, ["unis"]);
});

test("getProjectContext returns content", () => {
  const root = seed();
  const ctx = getProjectContext(root, "unis");
  assert.match(ctx.content, /UNIS brief/);
});

test("getProjectContext throws not_found", () => {
  const root = seed();
  assert.throws(() => getProjectContext(root, "ghost"), (e) => e.code === "not_found");
});

test("handles folder-form projects (listProjects + concatenated getProjectContext)", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  mkdirSync(join(root, "projects", "team"), { recursive: true });
  writeFileSync(join(root, "projects", "team", "overview.md"), "# Team overview\n");
  writeFileSync(join(root, "projects", "team", "notes.md"), "# Team notes\n");
  const slugs = listProjects(root).map((p) => p.slug);
  assert.ok(slugs.includes("team"));
  const ctx = getProjectContext(root, "team");
  assert.match(ctx.content, /Team overview/);
  assert.match(ctx.content, /Team notes/);
  assert.match(ctx.content, /\n\n---\n\n/);
});
