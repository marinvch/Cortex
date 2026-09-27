import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { buildCoverage, testStem } from "../lib/coverage.mjs";
import { textFrom } from "../lib/repo-text.mjs";

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

test("the mention signal reads injected text, so a temp tree is not the price of testing it", () => {
  // Same three signals, no filesystem. `buildCoverage` is now a pure transform of the Index plus
  // the text it is given — the convention build.mjs already applied to `detectStack`.
  const index = {
    files: [
      { path: "lib/cli.mjs", category: "code", isTest: false, commits: 0 },
      { path: "test/spawn.test.js", category: "code", isTest: true, commits: 0 },
    ],
    edges: [],
  };
  const c = buildCoverage(index, textFrom({ "test/spawn.test.js": 'run("lib/cli.mjs")' }));
  assert.deepEqual(c.testsFor("lib/cli.mjs"), ["test/spawn.test.js"]);
});

test("a test file over the cap reads as unread, not as a test that mentions nothing", () => {
  // This signal had NO cap at all while its two neighbours had two different ones. It has the same
  // one now, and the difference between "opened and found nothing" and "never opened" is a record
  // on the source rather than a silent `continue`.
  const index = {
    files: [
      { path: "lib/cli.mjs", category: "code", isTest: false, commits: 0 },
      { path: "test/spawn.test.js", category: "code", isTest: true, commits: 0 },
    ],
    edges: [],
  };
  const text = textFrom({ "test/spawn.test.js": 'run("lib/cli.mjs")' }, { cap: 4 });
  assert.equal(buildCoverage(index, text).isCovered("lib/cli.mjs"), false);
  assert.deepEqual(text.oversized, [{ path: "test/spawn.test.js", reason: "too-large" }]);
});

// --- barrels: a test that imports an entry file reaches what the entry re-exports ----------------
//
// pmndrs/zustand's `src/middleware/persist.ts` read "untested (high)" beside ~2,000 lines of
// persistSync/persistAsync tests. Those tests import `zustand/middleware`, which resolves to
// `src/middleware.ts` — a barrel of `export { … } from './middleware/persist.ts'` lines. The import
// signal stopped at the barrel, and a barrel is the standard shape of a front-end library's entry.

const code = (path) => ({ path, category: "code", isTest: false, commits: 0 });
const spec = (path) => ({ path, category: "code", isTest: true, commits: 0 });
const imp = (from, to) => ({ from, to, type: "imports" });
const reexp = (from, to) => ({ from, to, type: "imports", reexport: true });

test("a module re-exported by a tested barrel is covered, through every hop", () => {
  const index = {
    files: [code("src/index.ts"), code("src/middleware.ts"), code("src/middleware/persist.ts"), code("src/vanilla.ts"), spec("tests/persistSync.test.tsx")],
    edges: [
      imp("tests/persistSync.test.tsx", "src/index.ts"),
      reexp("src/index.ts", "src/middleware.ts"),
      reexp("src/index.ts", "src/vanilla.ts"),
      reexp("src/middleware.ts", "src/middleware/persist.ts"),
    ],
  };
  const c = buildCoverage(index);
  assert.deepEqual(c.testsFor("src/middleware/persist.ts"), ["tests/persistSync.test.tsx"], "two hops");
  assert.ok(c.isCovered("src/vanilla.ts"), "one hop");
});

test("only re-export edges are followed — a plain import inside the barrel's target is not", () => {
  // `src/app.ts` IMPORTS `src/util.ts` to use it; importing app.ts in a test does not hand util.ts
  // to the test's caller. Following ordinary edges would call the whole graph below a test covered.
  const index = {
    files: [code("src/app.ts"), code("src/util.ts"), spec("tests/app.test.ts")],
    edges: [imp("tests/app.test.ts", "src/app.ts"), imp("src/app.ts", "src/util.ts")],
  };
  const c = buildCoverage(index);
  assert.ok(c.isCovered("src/app.ts"));
  assert.equal(c.isCovered("src/util.ts"), false);
});

test("a barrel no test imports lends no coverage", () => {
  const index = {
    files: [code("src/index.ts"), code("src/a.ts"), code("src/main.ts"), spec("tests/other.test.ts"), code("src/other.ts")],
    edges: [imp("src/main.ts", "src/index.ts"), reexp("src/index.ts", "src/a.ts"), imp("tests/other.test.ts", "src/other.ts")],
  };
  assert.equal(buildCoverage(index).isCovered("src/a.ts"), false);
});

test("re-export cycles terminate", () => {
  const index = {
    files: [code("src/a.ts"), code("src/b.ts"), code("src/c.ts"), spec("tests/a.test.ts")],
    edges: [imp("tests/a.test.ts", "src/a.ts"), reexp("src/a.ts", "src/b.ts"), reexp("src/b.ts", "src/a.ts"), reexp("src/b.ts", "src/c.ts")],
  };
  const c = buildCoverage(index);
  assert.deepEqual(["src/a.ts", "src/b.ts", "src/c.ts"].map((p) => c.isCovered(p)), [true, true, true]);
  assert.deepEqual(c.testsFor("src/c.ts"), ["tests/a.test.ts"]);
});

test("a NAMED re-export is followed only when the test names what it exports", () => {
  // Verbatim shape from zustand's src/middleware.ts. Its persist tests import the barrel, and it
  // also re-exports `ssrSafe as unstable_ssrSafe`, which no test calls. Loading is not testing:
  // crediting ssrSafe because a persist test loaded the same barrel is invented coverage.
  const index = {
    files: [code("src/middleware.ts"), code("src/middleware/persist.ts"), code("src/middleware/ssrSafe.ts"), code("src/vanilla.ts"), spec("tests/persistSync.test.tsx")],
    edges: [
      imp("tests/persistSync.test.tsx", "src/middleware.ts"),
      { ...reexp("src/middleware.ts", "src/middleware/persist.ts"), names: ["PersistOptions", "createJSONStorage", "persist"] },
      { ...reexp("src/middleware.ts", "src/middleware/ssrSafe.ts"), names: ["unstable_ssrSafe"] },
      reexp("src/middleware.ts", "src/vanilla.ts"), // export * — nothing to look for, so followed
    ],
  };
  const text = textFrom({ "tests/persistSync.test.tsx": "import { persist, createJSONStorage } from 'zustand/middleware'\npersistent()\n" });
  const c = buildCoverage(index, text);
  assert.ok(c.isCovered("src/middleware/persist.ts"), "named and used");
  assert.equal(c.isCovered("src/middleware/ssrSafe.ts"), false, "re-exported beside it, never named");
  assert.ok(c.isCovered("src/vanilla.ts"), "export * is followed as written");
  // Identifier boundary: `persistent` must not count as `persist`, so a test naming only it does not.
  const only = textFrom({ "tests/persistSync.test.tsx": "persistent()\n" });
  assert.equal(buildCoverage(index, only).isCovered("src/middleware/persist.ts"), false);
  // No text, no names to check: the named hop is not followed — the safe direction.
  assert.equal(buildCoverage(index).isCovered("src/middleware/persist.ts"), false);
});

// --- a document is never a test, even when an older index says it is ----------------------------

test("a markdown file marked isTest lends no coverage by name, import or mention", () => {
  // tests/AGENTS.md, written by /cortex-brief, names vitest.config.mts. An index built before the
  // langs.mjs fix still carries `isTest: true` on it; coverage must not trust that for a file that
  // cannot run.
  const index = {
    files: [
      code("vitest.config.mts"),
      code("src/agents.ts"),
      { path: "tests/AGENTS.md", category: "docs", isTest: true, commits: 0 },
    ],
    edges: [imp("tests/AGENTS.md", "src/agents.ts")],
  };
  const c = buildCoverage(index, textFrom({ "tests/AGENTS.md": 'Config lives in "vitest.config.mts".' }));
  assert.equal(c.isCovered("vitest.config.mts"), false, "mention");
  assert.equal(c.isCovered("src/agents.ts"), false, "name (agents ← AGENTS) and import");
  assert.equal(c.testPaths.has("tests/AGENTS.md"), false);
});
