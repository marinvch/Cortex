// Which tests exercise which production file.
//
// Extracted from `findings.mjs`'s `untestedAreas`, where it was computed inline. `impact.mjs` needs
// the same answer, and a second copy of a three-signal heuristic is exactly the drift this repo has
// been paying down all week — the two would agree today and disagree in a month, and nothing would
// say which was right.
//
// The three signals exist because each alone misreports, and `index/AGENTS.md` records why:
//
//   name     `paths.js` ← `paths.test.js`, even in different directories. Naming alone called
//            `mcp/lib` untested because its tests live in `mcp/test`.
//   import   a module exercised by a test named after something else, which is how most
//            integration tests are organised.
//   mention  a CLI spawned as a subprocess — the test neither imports the module nor is named
//            after it, so both other signals are blind to it.
//
// None of this is exact. Import resolution upstream is regex-based, so this reports a FLOOR: files
// it says are covered are covered; files it says are not may still be exercised in a way the index
// cannot see. Every caller must phrase its output that way.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The bare module name a test file is testing: `mcp/test/paths.test.js` → `paths`. */
export function testStem(path) {
  let name = path.split("/").pop();
  name = name.replace(/\.[a-z0-9]+$/i, "");
  name = name
    .replace(/\.(test|spec)$/i, "")
    .replace(/_(test|spec)$/i, "")
    .replace(/^(test|spec)_/i, "")
    .replace(/(Test|Tests|Spec|Specs)$/, "");
  return name.toLowerCase();
}

/**
 * buildCoverage(index, root) → { isCovered(path), testsFor(path), testPaths }
 *
 * `root` is optional and only enables the mention signal, which has to read test files. Without it
 * the other two still work — a subprocess-tested CLI simply reads as uncovered, which is the safe
 * direction for a report that says "these may be unverified".
 */
export function buildCoverage(index, root) {
  const testPaths = new Set();
  const byStem = new Map(); // stem → [test paths]
  for (const f of index.files) {
    if (!f.isTest) continue;
    testPaths.add(f.path);
    const stem = testStem(f.path);
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(f.path);
  }

  // import: a test that imports the file
  const byImport = new Map(); // production path → [test paths]
  for (const e of index.edges) {
    if (!testPaths.has(e.from)) continue;
    if (!byImport.has(e.to)) byImport.set(e.to, []);
    byImport.get(e.to).push(e.from);
  }

  // mention: a test that names the file in a STRING literal. Quoted-only, so a passing reference in
  // a comment does not count as coverage — a comment mentioning a file does not exercise it.
  const byMention = new Map();
  if (testPaths.size && root) {
    const basenames = new Map();
    for (const f of index.files) {
      if (f.category === "code" && !f.isTest) basenames.set(f.path.split("/").pop(), f.path);
    }
    for (const t of testPaths) {
      let text;
      try {
        text = readFileSync(join(root, t), "utf8");
      } catch {
        continue;
      }
      for (const [base, path] of basenames) {
        if (text.includes(`"${base}"`) || text.includes(`'${base}'`) || text.includes(`\`${base}\``)) {
          if (!byMention.has(path)) byMention.set(path, []);
          byMention.get(path).push(t);
        }
      }
    }
  }

  const testsFor = (path) => {
    const out = new Set();
    for (const t of byStem.get(testStem(path)) || []) out.add(t);
    for (const t of byImport.get(path) || []) out.add(t);
    for (const t of byMention.get(path) || []) out.add(t);
    return [...out].sort();
  };

  return {
    testPaths,
    testsFor,
    isCovered: (path) => testsFor(path).length > 0,
  };
}
