// orphans.mjs — files nothing points at, with "points at" meaning more than `import`.
//
// The import graph answers one question well and the orphan finding asked it as if it were the
// whole question. A CLI that every ADR, the contributor invariants and a shell test invoke by path
// is not unreferenced by any reading a human would accept — but nothing `import`s it, so it was
// listed. Cortex reported this about itself for `tools/cortex-version.mjs` and
// `tools/cortex-capability.mjs`, both of which it cannot release or test itself without.
//
// A finding that is wrong about the reader's own repo teaches them the section is noise, and then
// the true orphan in it goes unread. That is the cost being paid here, and it is why this signal
// exists rather than a footnote explaining the false positives.
//
// The signal is deliberately the most checkable one available: **another file names this path**.
// Not "a file with a similar name exists", not "something in that directory is used" — the literal
// repo-relative path appears in the text of some other indexed file. The same standard
// `citationDrift` holds itself to, applied in reverse.
//
// Direction of error matters and is chosen: this can only ever REMOVE entries from the orphan list.
// Missing a true orphan costs a suggestion nobody was obliged to act on. Inventing one costs trust
// in every other line of the report, and eventually gets live code deleted.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { UNRESOLVED_LANGUAGES } from "./imports.mjs";

// Files worth reading to look for an invocation. Docs count: a README, an ADR or a contributor
// guide naming a script is exactly how repo tooling is normally wired, and pretending otherwise is
// what produced the false positives.
const SEARCHABLE = new Set(["code", "script", "config", "docs"]);
const MAX_SEARCH_BYTES = 512 * 1024;

/** Candidates by the import graph alone — the old definition, kept separate so it stays testable. */
export function unimported(index) {
  return index.files.filter(
    (f) =>
      f.category === "code" &&
      !f.isTest &&
      !f.isEntry &&
      !UNRESOLVED_LANGUAGES.has(f.lang) &&
      (f.inbound ?? 0) === 0 &&
      (f.imports ?? []).length === 0,
  );
}

/**
 * Of `paths`, which are named literally in some *other* indexed file.
 *
 * One pass over the repo's text, not one pass per candidate: a repo with 40 candidates and 3,000
 * files would otherwise read 120,000 times. A file naming itself does not count.
 */
export function namedElsewhere(index, root, paths) {
  const named = new Set();
  if (!root || !paths.length) return named;
  const wanted = [...paths];
  for (const f of index.files) {
    if (!SEARCHABLE.has(f.category)) continue;
    if ((f.bytes ?? 0) > MAX_SEARCH_BYTES) continue;
    let text;
    try {
      text = readFileSync(join(root, f.path), "utf8");
    } catch {
      continue; // unreadable file costs its mentions, never the finding
    }
    for (const p of wanted) {
      if (p === f.path || named.has(p)) continue;
      if (text.includes(p)) named.add(p);
    }
    if (named.size === wanted.length) break;
  }
  return named;
}

/**
 * Files nothing points at: not imported, and not named by anything else in the repo.
 *
 * Languages whose imports Cortex cannot resolve are excluded, because there every file is an orphan
 * by construction and the finding says nothing about the repo — pointed at a real Rust workspace the
 * old version reported 59 of 130 files, each line hedged and the aggregate still misinformation.
 *
 * `root` is optional. Without it only the import graph is consulted, which is the old behaviour and
 * strictly noisier — a caller that has the root should pass it.
 */
export function findOrphans(index, root = null) {
  const candidates = unimported(index);
  if (!candidates.length) return [];
  const named = namedElsewhere(index, root, candidates.map((f) => f.path));
  return candidates.filter((f) => !named.has(f.path));
}
