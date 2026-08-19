// Architectural depth, derived from the import graph rather than from directory names.
//
// `index/lib/layers.mjs` groups files by top-level directory, and that grouping was stored under the
// name `layers`. It is not layering: `.github`, `agents` and `docs` are not architectural strata.
// The CLI and the findings report had both quietly started calling them "areas"; only the field name
// still claimed otherwise, so anything reading `index.layers` for structure got a list of folders.
//
// Real layering needs edges, and Cortex only got trustworthy ones across seven languages in 2.18.0.
// This became computable then and not before.
//
// ## What depth means
//
//   depth 0   imports nothing inside this repo — the foundation
//   depth n   one more than the deepest in-repo file it imports
//
// Depth 0 is the kernel and the highest depth is the entry point, which is the direction a reader
// orients in: start at the bottom to learn what the repo is built out of, start at the top to learn
// what it does. On this repo it independently reproduces the documented architecture — core sits
// below index and mcp, which is what `AGENTS.md` claims and `core/test/architecture.test.js`
// enforces by hand.
//
// ## Why cycles get condensed rather than skipped
//
// The first version memoised a depth-first walk and skipped back-edges. That is correct on a DAG and
// quietly wrong everywhere else: a node finalised while one of its dependencies was still on the
// stack keeps a depth computed without it, and every dependent compounds the error. On gson it
// produced fourteen levels with ninety-nine files sharing the deepest one — a number that looks like
// architecture and is arithmetic noise.
//
// So: Tarjan for strongly-connected components, then longest path over the condensation. Mutually
// importing files genuinely have no order among themselves — that is what makes them a cycle — so
// they share one depth and are reported as a cycle. Every file still gets a number.
//
// Deterministic per index/AGENTS.md — a pure function of the edges, no clock, no LLM.
//
// ## The honest limit
//
// Import resolution is regex-based (ADR 0004 rules out a parser), so an unresolved import makes a
// file look shallower than it is. Depth is a FLOOR, like the impact radius, and no caller may
// present it as a verdict on architecture.

/** Tarjan's strongly-connected components, iterative so a deep graph cannot blow the stack. */
function components(nodes, edgesFrom) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const comp = new Map(); // node → component id
  const groups = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    const work = [[root, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const [v, i] = frame;
      if (i === 0) {
        index.set(v, counter);
        low.set(v, counter);
        counter++;
        stack.push(v);
        onStack.add(v);
      }
      const deps = edgesFrom.get(v) || [];
      if (i < deps.length) {
        frame[1]++;
        const w = deps[i];
        if (!index.has(w)) work.push([w, 0]);
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
        continue;
      }
      if (low.get(v) === index.get(v)) {
        const group = [];
        for (;;) {
          const w = stack.pop();
          onStack.delete(w);
          comp.set(w, groups.length);
          group.push(w);
          if (w === v) break;
        }
        groups.push(group.sort());
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(v)));
      }
    }
  }
  return { comp, groups };
}

/**
 * depthOf(index) → { byPath: Map<path, depth>, layers: [{ depth, paths }], cyclic: [paths] }
 *
 * `cyclic` lists files that sit in a component of more than one file. They still carry a depth —
 * the component's — because "somewhere in this stratum" is more useful than no answer, and the
 * cycle itself is reported separately for anyone who wants to break it.
 */
export function depthOf(index) {
  // Code only. A markdown file imports nothing and would sit at depth 0 beside the kernel, which on
  // this repo put 238 documents and configs into "the foundation" and buried the handful that are
  // actually there. Depth is a statement about code structure; a README has no place in it.
  const known = new Set(
    index.files.filter((f) => f.category === "code" || f.category === "script").map((f) => f.path),
  );
  const nodes = [...known].sort(); // sorted so component ids, and therefore output, are stable
  const edgesFrom = new Map(nodes.map((p) => [p, []]));
  for (const e of index.edges || []) {
    if (!known.has(e.from) || !known.has(e.to) || e.from === e.to) continue;
    edgesFrom.get(e.from).push(e.to);
  }
  for (const [, v] of edgesFrom) v.sort();

  const { comp, groups } = components(nodes, edgesFrom);

  // Condensation edges, then longest path. Tarjan emits components in reverse topological order, so
  // a single pass over them in that order settles every depth without a second sort.
  const compDeps = groups.map(() => new Set());
  for (const [from, deps] of edgesFrom) {
    for (const to of deps) {
      const a = comp.get(from);
      const b = comp.get(to);
      if (a !== b) compDeps[a].add(b);
    }
  }
  const compDepth = new Array(groups.length).fill(0);
  for (let c = 0; c < groups.length; c++) {
    let d = 0;
    for (const dep of compDeps[c]) d = Math.max(d, compDepth[dep] + 1);
    compDepth[c] = d;
  }

  const byPath = new Map();
  const cyclic = [];
  for (let c = 0; c < groups.length; c++) {
    for (const p of groups[c]) byPath.set(p, compDepth[c]);
    if (groups[c].length > 1) cyclic.push(...groups[c]);
  }

  const grouped = new Map();
  for (const [p, d] of byPath) {
    if (!grouped.has(d)) grouped.set(d, []);
    grouped.get(d).push(p);
  }

  return {
    byPath,
    cyclic: cyclic.sort(),
    layers: [...grouped.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([depth, paths]) => ({ depth, paths: paths.sort() })),
  };
}
