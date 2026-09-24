// core/test/tmp.js — a temp dir that is gone when the test file finishes.
//
// The same helper as index/test/tmp.mjs, copied rather than imported so no package's tests reach
// into another's. Before it, a full core run left 29 dirs in the OS temp folder, every run.
//
// The cleanup is registered once, on the file's root, when this module is imported, and runs after
// the last test whatever the outcome — a per-test `rmSync` is skipped by the first failing assert,
// so the run you most want to re-run is the one that leaks. Not named *.test.js, so the
// `core/test/*.test.js` glob never runs it.

import { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const made = [];

after(() => {
  for (const dir of made) {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); }
    catch { /* a handle still open on Windows; the OS temp cleaner gets the rest */ }
  }
});

/** mkdtempSync under the OS temp dir, removed after this test file's last test. */
export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
