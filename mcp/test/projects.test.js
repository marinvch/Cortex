// mcp/test/projects.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { listProjects, getProjectContext } from "../lib/projects.js";
import { OutsideRootError } from "../../core/paths.js";

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

// Regression: a caller-supplied slug must never read outside AI_OS_ROOT.
// Before the fix, `../../secret` returned the file's contents instead of throwing.
test("getProjectContext refuses a slug that escapes the root", () => {
  const base = mkdtempSync(join(tmpdir(), "escape-"));
  const root = join(base, "vault");
  mkdirSync(join(root, "projects"), { recursive: true });
  writeFileSync(join(base, "secret.md"), "TOP SECRET CONTENTS\n");

  assert.throws(
    () => getProjectContext(root, "../../secret"),
    (e) => e instanceof OutsideRootError && e.code === "outside_root",
  );
});

// An absolute slug is neutralized by join() into a nonsense path *inside* the root,
// so it surfaces as not_found rather than outside_root. Either way it must not leak.
test("getProjectContext never reads an absolute-path slug", () => {
  const base = mkdtempSync(join(tmpdir(), "escape-abs-"));
  const root = join(base, "vault");
  mkdirSync(join(root, "projects"), { recursive: true });
  writeFileSync(join(base, "secret.md"), "TOP SECRET CONTENTS\n");

  assert.throws(
    () => getProjectContext(root, join(base, "secret")),
    (e) => e.code === "not_found" || e.code === "outside_root",
  );
});

test("getProjectContext still resolves a legitimate nested slug", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-nested-"));
  mkdirSync(join(root, "projects", "client", "alpha"), { recursive: true });
  writeFileSync(join(root, "projects", "client", "alpha", "brief.md"), "# Alpha brief\n");
  const ctx = getProjectContext(root, join("client", "alpha"));
  assert.match(ctx.content, /Alpha brief/);
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

test("listProjects honours .cortexignore instead of hand-coding exclusions", () => {
  // projects.js used to carry `if (e.name === "README.md") continue;` — one vault-noise rule
  // re-typed outside .cortexignore. The ignore file decides what is knowledge; listProjects
  // now asks it, so a vault that ignores drafts does not see them as projects.
  const root = mkdtempSync(join(tmpdir(), "vault-ignore-"));
  mkdirSync(join(root, "projects"), { recursive: true });
  writeFileSync(join(root, ".cortexignore"), "*.draft.md\nREADME.md\n");
  writeFileSync(join(root, "projects", "real.md"), "# Real\n");
  writeFileSync(join(root, "projects", "wip.draft.md"), "# Draft\n");
  writeFileSync(join(root, "projects", "README.md"), "readme\n");

  const slugs = listProjects(root).map((p) => p.slug);
  assert.deepEqual(slugs, ["real"]);
});

// --- Characterization: pinned before the Vault module collapse (2026-08-18) ---
// listProjects returns absolute paths today. vault.list() will return root-relative ones, so this
// is the conversion most likely to be dropped without anything noticing.

test("listProjects returns absolute paths under the root", () => {
  const root = seed();
  const entries = listProjects(root);
  assert.ok(entries.length >= 1);
  for (const e of entries) {
    assert.ok(isAbsolute(e.path), `expected an absolute path, got '${e.path}'`);
    assert.ok(e.path.startsWith(root), `expected a path under the root, got '${e.path}'`);
  }
});

test("listProjects skips dot-directories and is not recursive past a project folder", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-dots-"));
  mkdirSync(join(root, "projects", ".hidden"), { recursive: true });
  writeFileSync(join(root, "projects", ".hidden", "x.md"), "hidden\n");
  mkdirSync(join(root, "projects", "real"), { recursive: true });
  writeFileSync(join(root, "projects", "real", "brief.md"), "# Real\n");
  writeFileSync(join(root, "projects", "flat.md"), "# Flat\n");

  const slugs = listProjects(root).map((p) => p.slug).sort();
  assert.deepEqual(slugs, ["flat", "real"], "a dot-directory is not a project");
});

test("listProjects returns an empty list when projects/ is absent, rather than throwing", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-empty-"));
  assert.deepEqual(listProjects(root), []);
});
