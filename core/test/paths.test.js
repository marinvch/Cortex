import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInRoot, OutsideRootError } from "../paths.js";

test("resolves a normal relative path inside root", () => {
  const root = mkdtempSync(join(tmpdir(), "jail-"));
  const p = resolveInRoot(root, "projects/unis.md");
  assert.ok(p.startsWith(root));
  assert.ok(p.endsWith("unis.md"));
});

test("rejects .. escape", () => {
  const root = mkdtempSync(join(tmpdir(), "jail-"));
  assert.throws(() => resolveInRoot(root, "../evil.md"), (e) => e instanceof OutsideRootError && e.code === "outside_root");
});

test("rejects absolute path outside root", () => {
  const root = mkdtempSync(join(tmpdir(), "jail-"));
  assert.throws(() => resolveInRoot(root, "/etc/passwd"), OutsideRootError);
});

test("rejects symlink that escapes root", (t) => {
  const root = mkdtempSync(join(tmpdir(), "jail-"));
  const outside = mkdtempSync(join(tmpdir(), "out-"));
  writeFileSync(join(outside, "secret.md"), "x");
  mkdirSync(join(root, "sub"));
  try {
    symlinkSync(outside, join(root, "sub", "link"));
  } catch (e) {
    if (e.code === "EPERM" || e.code === "EACCES" || e.code === "ENOSYS") {
      t.skip("symlink creation not permitted in this environment");
      return;
    }
    throw e;
  }
  assert.throws(() => resolveInRoot(root, "sub/link/secret.md"), OutsideRootError);
});
