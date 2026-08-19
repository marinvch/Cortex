// What breaks if this changes — the blast radius of a set of files, and which of it is unverified.
//
// Cortex could already answer "what does this file import". It could not answer the question anyone
// actually asks before changing something: **who depends on ME, and is any of it tested?** The
// index has carried the edges to answer it since the beginning; nothing read them backwards.
//
// Deterministic, per index/AGENTS.md — no LLM, no network, no clock. It is a graph walk over data
// the indexer already produced.
//
// ## The honesty constraint
//
// Import resolution upstream is regex-based, so dynamic and computed imports are missed. Every
// number here is therefore a FLOOR, never a ceiling: the files named WILL be affected, and others
// may be too. This is the same hedge the orphan finding already carries ("worth checking", never
// "safe to delete"), and it is why nothing in this module is called "complete" or "all".
//
// Saying "3 files affected" when the true answer is 5 is worse than saying "at least 3", because
// the first invites someone to stop looking.

import { buildCoverage } from "./coverage.mjs";

/** to → [from]: who imports this file. The index stores the forward direction only. */
function reverseGraph(index) {
  const rev = new Map();
  for (const e of index.edges) {
    if (!rev.has(e.to)) rev.set(e.to, []);
    rev.get(e.to).push(e.from);
  }
  return rev;
}

/**
 * impactOf(index, changed, { root, maxDepth }) → report
 *
 * `changed` is a list of repo-relative paths. Unknown paths are reported rather than dropped: a
 * typo'd path silently contributing nothing would read as "nothing depends on this", which is the
 * most dangerous wrong answer this module could give.
 */
export function impactOf(index, changed, { root, maxDepth = Infinity } = {}) {
  const known = new Set(index.files.map((f) => f.path));
  const byPath = new Map(index.files.map((f) => [f.path, f]));
  const rev = reverseGraph(index);
  const coverage = buildCoverage(index, root);

  const seeds = [];
  const unknown = [];
  for (const c of changed) {
    const p = String(c).split("\\").join("/").replace(/^\.\//, "");
    (known.has(p) ? seeds : unknown).push(p);
  }

  // Breadth-first so `depth` means "hops from a changed file", which is the number a reader uses to
  // decide how far to look. A depth-1 dependent is where a break shows up first.
  const depth = new Map();
  const queue = [];
  for (const s of seeds) { depth.set(s, 0); queue.push(s); }

  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    const d = depth.get(node);
    if (d >= maxDepth) continue;
    for (const dep of rev.get(node) || []) {
      if (depth.has(dep)) continue;
      depth.set(dep, d + 1);
      queue.push(dep);
    }
  }

  const affected = [];
  for (const [path, d] of depth) {
    if (d === 0) continue; // the changed files themselves are not their own blast radius
    const f = byPath.get(path);
    const tests = coverage.testsFor(path);
    affected.push({
      path,
      depth: d,
      isTest: !!(f && f.isTest),
      commits: (f && f.commits) || 0,
      tests,
      covered: tests.length > 0,
    });
  }

  // Nearest first, then by churn: a depth-1 file that changes weekly is where a break lands
  // soonest. Ties by path so the output is stable, which matters for tests and for diffing runs.
  affected.sort((a, b) => a.depth - b.depth || b.commits - a.commits || a.path.localeCompare(b.path));

  // Production files in the radius that no test exercises. This is the actionable half: a large
  // blast radius that is fully covered is a normal Tuesday; a small one that is not is where the
  // regression comes from.
  const unverified = affected.filter((a) => !a.isTest && !a.covered);

  // Tests worth running: those that cover anything in the radius, plus tests that are themselves in
  // it (a test importing a changed module is exercising it by definition).
  const suggestedTests = new Set();
  for (const a of affected) {
    if (a.isTest) suggestedTests.add(a.path);
    for (const t of a.tests) suggestedTests.add(t);
  }
  for (const s of seeds) for (const t of coverage.testsFor(s)) suggestedTests.add(t);

  return {
    changed: seeds,
    unknown,
    affected,
    unverified,
    suggestedTests: [...suggestedTests].sort(),
    // Named so a caller cannot report it as a total by accident.
    atLeast: affected.length,
    truncated: maxDepth !== Infinity,
  };
}
