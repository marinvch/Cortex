import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { buildCoverage, testStem } from "../lib/coverage.mjs";

// The three signals, and the one that was blind.
//
// `mention` exists for CLIs spawned as subprocesses — the test neither imports the module nor is
// named after it. It matched only a BARE quoted basename, and every shell test in this repo names a
// CLI by its path: `VER="$REPO_ROOT/tools/cortex-capability.mjs"`. The slash defeated the match, so
// four CLIs covered by a 312-assertion suite were reported untested.
//
// That is not a cosmetic miscount. The findings report is the install wizard's script (ADR 0006), so
// a false "untested" changes the interview a user is walked through, not just a document they read.

/** A minimal index plus a real temp tree, because `mention` has to read the test files. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "cortex-cov-"));
  const index = { files: [], edges: [] };
  for (const [path, o = {}] of Object.entries(files)) {
    index.files.push({ path, category: o.category || "code", isTest: !!o.isTest, commits: 0 });
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, o.body || "");
  }
  return { root, index, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("testStem strips the suffix conventions, so a test finds its module across directories", () => {
  assert.equal(testStem("mcp/test/paths.test.js"), "paths");
  assert.equal(testStem("a/paths_test.py"), "paths");
  assert.equal(testStem("a/test_paths.py"), "paths");
  assert.equal(testStem("a/PathsTest.java"), "paths");
});

test("mention counts a CLI named by a quoted PATH, not only a bare basename", () => {
  // The exact shape the fix was written for. Before it, this asserted uncovered.
  const f = fixture({
    "tools/cortex-capability.mjs": {},
    "tools/test/capability-floor.test.sh": {
      isTest: true,
      body: 'VER="$REPO_ROOT/tools/cortex-capability.mjs"\nnode "$VER" mechanical\n',
    },
  });
  const c = buildCoverage(f.index, f.root);
  assert.deepEqual(c.testsFor("tools/cortex-capability.mjs"), ["tools/test/capability-floor.test.sh"]);
  f.cleanup();
});

test("a bare quoted basename still counts — the fix widened the match, it did not move it", () => {
  const f = fixture({
    "lib/build.mjs": {},
    "test/cli.test.mjs": { isTest: true, body: 'spawn("build.mjs");' },
  });
  assert.ok(buildCoverage(f.index, f.root).isCovered("lib/build.mjs"));
  f.cleanup();
});

test("a path boundary is required, so a similarly-named file does not borrow coverage", () => {
  // Without the `/`-or-quote boundary, a test naming `build.mjs` would mark `helper-build.mjs`
  // covered. Inventing coverage is the dangerous direction: it tells someone a risk is verified.
  const f = fixture({
    "lib/helper-build.mjs": {},
    "test/cli.test.mjs": { isTest: true, body: 'spawn("lib/build.mjs");' },
  });
  assert.equal(buildCoverage(f.index, f.root).isCovered("lib/helper-build.mjs"), false);
  f.cleanup();
});

test("an unquoted mention does not count — a comment naming a file does not exercise it", () => {
  const f = fixture({
    "lib/build.mjs": {},
    "test/cli.test.mjs": { isTest: true, body: "// see lib/build.mjs for why this is slow\n" },
  });
  assert.equal(buildCoverage(f.index, f.root).isCovered("lib/build.mjs"), false);
  f.cleanup();
});

test("a genuinely untested module stays untested", () => {
  // The guard against a fix that widens until everything reads as covered. A signal that never says
  // "no" is not a signal.
  const f = fixture({
    "tools/cortex-preflight.mjs": {},
    "tools/test/other.test.sh": { isTest: true, body: 'X="$ROOT/tools/cortex-version.mjs"\n' },
    "tools/cortex-version.mjs": {},
  });
  const c = buildCoverage(f.index, f.root);
  assert.equal(c.isCovered("tools/cortex-preflight.mjs"), false);
  assert.equal(c.isCovered("tools/cortex-version.mjs"), true);
  f.cleanup();
});

test("without a root the mention signal is simply off, and the other two still answer", () => {
  // `root` is optional. The safe degradation is a subprocess-tested CLI reading as uncovered — a
  // report that overstates verification is worse than one that understates it.
  const f = fixture({
    "lib/paths.js": {},
    "test/paths.test.js": { isTest: true, body: 'spawn("lib/paths.js")' },
    "lib/cli.mjs": {},
  });
  const c = buildCoverage(f.index, undefined);
  assert.ok(c.isCovered("lib/paths.js"), "name signal works without a root");
  assert.equal(c.isCovered("lib/cli.mjs"), false, "mention is off, so the CLI reads as uncovered");
  f.cleanup();
});
