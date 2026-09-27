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
//            integration tests are organised — including through a barrel that re-exports it.
//   mention  a CLI spawned as a subprocess — the test neither imports the module nor is named
//            after it, so both other signals are blind to it.
//
// None of this is exact. Import resolution upstream is regex-based, so this reports a FLOOR: files
// it says are covered are covered; files it says are not may still be exercised in a way the index
// cannot see. Every caller must phrase its output that way.

import { textSource } from "./repo-text.mjs";
import { canBeTest } from "./langs.mjs";

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
 * buildCoverage(index, text) → { isCovered(path), testsFor(path), testPaths }
 *
 * `text` is a repo-text source (`lib/repo-text.mjs`) or, for a caller that holds one, a root
 * string this coerces. It is optional and only enables the mention signal, which has to read test
 * files. Without it the other two still work — a subprocess-tested CLI simply reads as uncovered,
 * which is the safe direction for a report that says "these may be unverified".
 *
 * Reading is injected for the reason `build.mjs` gives about `detectStack`: everything below
 * becomes a pure transform of the Index plus that text, so the three signals are testable from
 * literals instead of from a temp tree built to satisfy one `readFileSync`.
 */
export function buildCoverage(index, text) {
  const source = textSource(text);
  const testPaths = new Set();
  const byStem = new Map(); // stem → [test paths]
  for (const f of index.files) {
    // `canBeTest` as well as the index's flag: an index built before langs.mjs learned that a
    // document is never a test still says `tests/AGENTS.md` is one, and its prose would otherwise
    // lend coverage by name, import and mention.
    if (!f.isTest || !canBeTest(f.path)) continue;
    testPaths.add(f.path);
    const stem = testStem(f.path);
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(f.path);
  }

  // import: a test that imports the file — or imports a barrel that re-exports it.
  //
  // The re-export half is still the import signal, not a fourth one: loading a barrel loads every
  // module it re-exports, so a test importing `src/middleware.ts` reaches the
  // `src/middleware/persist.ts` that barrel re-exports exactly as surely as if it had named it.
  // Without it, pmndrs/zustand's persist middleware — ~2,000 lines of tests, all importing
  // `zustand/middleware` — was ranked "untested (high)". Only edges the index marked `reexport`
  // (`export … from`) are followed, never an ordinary import inside the barrel's target: using a
  // module does not hand it to your caller, and following those would call everything below a test
  // covered. Like the rest of this signal it says a test REACHES the file, not that it asserts on it.
  //
  // A NAMED re-export is followed only when the test names one of the names it exports. Loading
  // the barrel loads every module behind it, but zustand's `middleware.ts` also re-exports
  // `ssrSafe as unstable_ssrSafe`, which no test calls — crediting it because a persist test
  // imported the same barrel is the invented coverage the mention signal's boundary exists to
  // prevent. `export *` (and a re-exported `default`) carries no names to look for, so it is
  // followed as written. Without test text the named hops are not followed at all: the safe
  // direction, as with the mention signal.
  const reexports = new Map(); // barrel → [{ to, names }]
  for (const e of index.edges) {
    if (!e.reexport) continue;
    if (!reexports.has(e.from)) reexports.set(e.from, []);
    reexports.get(e.from).push({ to: e.to, names: Array.isArray(e.names) ? e.names : null });
  }
  const bodies = new Map(); // test → text | null, read at most once
  const bodyOf = (t) => {
    if (!bodies.has(t)) bodies.set(t, source.available ? source.read(t) : null);
    return bodies.get(t);
  };
  const nameRe = new Map();
  const names = (t, list) => {
    if (list === null) return true;
    const body = bodyOf(t);
    if (body === null) return false;
    return list.some((n) => {
      if (!nameRe.has(n)) nameRe.set(n, new RegExp(`(^|[^\\w$])${n.replace(/\$/g, "\\$")}($|[^\\w$])`));
      return nameRe.get(n).test(body);
    });
  };
  const byImport = new Map(); // production path → [test paths]
  const credit = (path, t) => {
    if (!byImport.has(path)) byImport.set(path, []);
    const list = byImport.get(path);
    if (!list.includes(t)) list.push(t);
  };
  for (const e of index.edges) {
    if (!testPaths.has(e.from)) continue;
    credit(e.to, e.from);
    // Every hop, cycle-safe: a barrel of barrels is ordinary (`src/index.ts` → `src/vanilla.ts` →
    // `src/vanilla/store.ts`), and two barrels re-exporting each other must not loop.
    const seen = new Set([e.to]);
    const queue = [e.to];
    while (queue.length) {
      for (const hop of reexports.get(queue.shift()) || []) {
        if (seen.has(hop.to) || !names(e.from, hop.names)) continue;
        seen.add(hop.to);
        credit(hop.to, e.from);
        queue.push(hop.to);
      }
    }
  }

  // mention: a test that names the file in a STRING literal. Quoted-only, so a passing reference in
  // a comment does not count as coverage — a comment mentioning a file does not exercise it.
  //
  // The quoted string may be a PATH ending in the basename, not only the bare basename. This signal
  // exists for CLIs spawned as subprocesses, and it was blind to the most common way to spawn one:
  // every shell test in this repo writes `VER="$REPO_ROOT/tools/cortex-capability.mjs"`, so the
  // slash before the name defeated a bare `"<base>"` match. Four CLIs covered by a 312-assertion
  // suite were reported as untested — a false positive in the report that IS the install wizard's
  // script (ADR 0006), where it changes the interview rather than merely reading wrong.
  //
  // The boundary is `/` or the opening quote, never nothing: without it, `helper-build.mjs` would
  // match a test naming `build.mjs` and the signal would start inventing coverage. Reporting a
  // covered file as uncovered costs a re-read; the reverse tells someone a risk is verified when it
  // is not, so the boundary stays strict.
  const byMention = new Map();
  if (testPaths.size && source.available) {
    const basenames = new Map();
    for (const f of index.files) {
      if (f.category === "code" && !f.isTest) basenames.set(f.path.split("/").pop(), f.path);
    }
    const quoted = new Map(); // base → RegExp, built once rather than per test file
    for (const base of basenames.keys()) {
      const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      quoted.set(base, new RegExp(`["'\`](?:[^"'\`]*/)?${esc}["'\`]`));
    }
    for (const t of testPaths) {
      // A test file that could not be read costs its mentions, never the run — and the source
      // records why, so "this test mentions nothing" and "this test could not be opened" stay
      // two different facts for whoever holds the source.
      const body = bodyOf(t);
      if (body === null) continue;
      for (const [base, path] of basenames) {
        if (quoted.get(base).test(body)) {
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
