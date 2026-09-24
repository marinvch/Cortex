import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveInRoot, OutsideRootError } from "../paths.js";
import { tempDir } from "./tmp.js";

test("resolves a normal relative path inside root", () => {
  const root = tempDir("jail-");
  const p = resolveInRoot(root, "projects/unis.md");
  assert.ok(p.startsWith(root));
  assert.ok(p.endsWith("unis.md"));
});

test("rejects .. escape", () => {
  const root = tempDir("jail-");
  assert.throws(() => resolveInRoot(root, "../evil.md"), (e) => e instanceof OutsideRootError && e.code === "outside_root");
});

test("rejects absolute path outside root", () => {
  const root = tempDir("jail-");
  assert.throws(() => resolveInRoot(root, "/etc/passwd"), OutsideRootError);
});

test("rejects symlink that escapes root", (t) => {
  const root = tempDir("jail-");
  const outside = tempDir("out-");
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

// ENOTDIR — a file used as a directory. POSIX reports ENOTDIR here, Windows reports ENOENT;
// both mean "the child isn't there", so both must still walk up to the nearest existing
// ancestor. A catch that only forgave ENOENT would throw on POSIX for a legal create target.
test("resolves through a file used as a directory", () => {
  const root = tempDir("jail-");
  writeFileSync(join(root, "afile.txt"), "x");
  const p = resolveInRoot(root, "afile.txt/child");
  assert.ok(p.startsWith(root));
  assert.ok(p.endsWith("child"));
});

// The fail-open case: an error that is not "absent" means we could not answer the question.
// A bare catch walked up past it to an ancestor inside the root and returned success, so the
// guard passed on a path it had never managed to read. A NUL byte is the one such error that
// is reproducible on every platform without admin rights or exotic permissions.
test("rethrows an error that is not 'path absent' instead of walking up", () => {
  const root = tempDir("jail-");
  const poisoned = "bad" + String.fromCharCode(0) + "name/child";
  assert.throws(
    () => resolveInRoot(root, poisoned),
    (e) => !(e instanceof OutsideRootError) && e.code !== "ENOENT" && e.code !== "ENOTDIR",
  );
});
