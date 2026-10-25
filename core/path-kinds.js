// path-kinds.js — what a repo-relative path alone says about a file, for both leaves.
//
// `index/` classifies files with these while it builds the index and reads the graph report off
// them; `mcp/lib/graph.js` answers the `graph` tool from the same index and must leave out the
// same files and name the same areas. The leaves may not import each other, so the rules live
// here, once. Pure: a string in, a boolean or a string out.

// A file's area is its top-level directory, except that a few conventional wrappers carry no
// meaning on their own and the level below them is what people actually name.
export const TRANSPARENT = new Set(["src", "lib", "app", "packages", "apps", "internal", "pkg"]);

/** The area a path sits in: `root`, its top directory, or the two levels under a wrapper. */
export function layerKeyFor(path) {
  const parts = path.split("/");
  if (parts.length === 1) return "root";
  if (TRANSPARENT.has(parts[0]) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

// What tests run against, not code a test should cover: inputs, expected outputs, sample trees.
// Go's toolchain skips `testdata/` for the same reason. `solutions/` is not here: a Next.js app
// routes `/solutions` from `app/solutions/`, and that is product code.
export const TEST_DATA_DIRS = "fixtures?|__fixtures__|testdata";
const TEST_DATA_DIR = new RegExp(`(^|/)(?:${TEST_DATA_DIRS})/`, "i");

/** Under a fixture directory. Coverage never asks for a test of it. */
export function isTestData(path) {
  return TEST_DATA_DIR.test(path);
}

// Directories of code that serves tests: render helpers, mock servers, fixture builders. Not tests,
// so `isTestPath` rightly leaves them out of the test count. The viewer keeps them from taking a
// label on the Map, and the graph report keeps them out of hubs and bridges.
const TEST_SUPPORT_DIR = /(^|\/)(testing|__mocks__|mocks?|__fixtures__|fixtures?)\//i;

/** Under a directory of code that serves tests. Never decides what is a test or what is covered. */
export function inTestSupportDir(path) {
  return TEST_SUPPORT_DIR.test(path);
}
