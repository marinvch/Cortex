// Where two change sets collide — the static v0 of issue #408.
//
// Parallel sessions on one repository are a normal way of working, and Cortex offered nothing for
// it: the only defence was noticing stale mtimes by hand. It failed during a release — a
// `tools/test/run.sh` run reported nine failures and then none minutes later, because another agent
// was landing edits underneath it. That was neither a regression nor a flake; it was a read of a
// tree being written at the same time.
//
// The issue sketches a continuous collision model and then declines to port it. What it asks for
// as v0 is this: given my changed files and another session's, report
//
//   1. **overlap** — files both sets touch, and
//   2. **one-hop collisions** — a file in one set that imports, or is imported by, a file in the
//      other. That is the case pure path comparison misses: "you edited a file mine imports".
//
// No tick loop, no protocol, no daemon. It is `impactOf` read pairwise instead of backwards, over
// the edges the index already holds.
//
// ## Same constraints as the rest of the package
//
// - Deterministic: no clock, no network, no randomness; output sorted by code unit, so two runs
//   over the same inputs agree byte for byte.
// - Every count is a FLOOR. Import resolution is regex-based, so a dynamic import that couples the
//   two sets is invisible, and the lists themselves are only what each side reported. The counts
//   live under `atLeast` for that reason; there is no `total`.
// - Paths the index does not know are reported, never dropped. They still take part in direct
//   overlap — two sessions both creating `src/new.ts` is a real collision the index cannot know
//   about yet — but they contribute no edges.

import { normalizeChangedPath } from "./changed.mjs";

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A change list, as another session hands it over: one path per line.
 *
 * Strips a leading BOM, `\r`, surrounding whitespace, blank lines and `#` comment lines. A list
 * written on Windows — Notepad, or `git diff --name-only > list` in PowerShell — arrives with a BOM
 * and `\r` on every line, and `src/a.js\r` matches nothing: the report would say "no overlap", a
 * confident zero produced by a line ending. Separators are left for `normalizeChangedPath`, which
 * every compared path goes through.
 */
export function parseChangeList(text) {
  return String(text)
    .replace(/^﻿/, "")
    .split(/\r?\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/**
 * overlapOf(index, mine, theirs, { root }) → report
 *
 * `mine` and `theirs` are lists of paths in any of the shapes `normalizeChangedPath` accepts.
 * Each collision names both files and which way the edge runs:
 *
 * - `mine-imports-theirs` — they are changing something my file depends on;
 * - `theirs-imports-mine` — I am changing something their file depends on.
 *
 * An edge whose endpoints are BOTH in the overlap is not listed: both files are already in the
 * overlap section, which is the stronger warning, and the edge would otherwise appear once per
 * direction for no new fact.
 */
export function overlapOf(index, mine, theirs, { root = null } = {}) {
  const norm = (list) => [...new Set(list.map((p) => normalizeChangedPath(p, root)).filter(Boolean))].sort(byCodeUnit);
  const a = norm(mine);
  const b = norm(theirs);
  const inA = new Set(a);
  const inB = new Set(b);
  const known = new Set(index.files.map((f) => f.path));

  const overlap = a.filter((p) => inB.has(p));
  const shared = new Set(overlap);

  const seen = new Set();
  const collisions = [];
  const add = (m, t, edge) => {
    const key = `${m}\u0000${t}\u0000${edge}`;
    if (seen.has(key)) return;
    seen.add(key);
    collisions.push({ mine: m, theirs: t, edge });
  };
  for (const e of index.edges) {
    if (e.from === e.to) continue;
    if (shared.has(e.from) && shared.has(e.to)) continue;
    if (inA.has(e.from) && inB.has(e.to)) add(e.from, e.to, "mine-imports-theirs");
    if (inB.has(e.from) && inA.has(e.to)) add(e.to, e.from, "theirs-imports-mine");
  }
  collisions.sort((x, y) => byCodeUnit(x.mine, y.mine) || byCodeUnit(x.theirs, y.theirs) || byCodeUnit(x.edge, y.edge));

  return {
    mine: a,
    theirs: b,
    unknown: { mine: a.filter((p) => !known.has(p)), theirs: b.filter((p) => !known.has(p)) },
    overlap,
    collisions,
    // Named so a caller cannot report either as a total by accident.
    atLeast: { overlap: overlap.length, collisions: collisions.length },
  };
}
