// index/test/tmp.mjs — a temp dir that is gone when the test file finishes.
//
// Every fixture here builds a repo under os.tmpdir() with mkdtempSync, and for most of this
// directory's life nothing removed one: a machine that ran the suite regularly had 7,500+
// `cortex-*` dirs in its temp folder. A per-test `rmSync` at the end of each body is what loop and
// next do, and it is skipped by the first failing assert — the run you most want to re-run leaks.
//
// So the cleanup is registered once, on the file's root, when this module is imported, and runs
// after the last test whatever the outcome. Not named *.test.mjs, so `node --test` never runs it.

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
