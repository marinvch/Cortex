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

import { UNRESOLVED_LANGUAGES } from "./imports.mjs";
import { textSource } from "./repo-text.mjs";

// Everything in the Index is worth reading to look for an invocation, and everything in the Index
// is text — `walk.mjs` already dropped binaries, lockfiles and anything over its ceiling. The old
// four-category list (code, script, config, docs) was a fourth guess on top of that: a Dockerfile's
// COPY, an HTML `src=`, a `.npmrc` comment and a SQL header all name paths, and `infra`, `markup`,
// `schema` and `other` were unreadable here for no stated reason. The cap and the reading rule now
// live in `lib/repo-text.mjs`, which is also where the 512 KB that used to sit here is accounted
// for.
//
// What widening actually turned up, measured on a cloned Next.js app, is worth knowing before
// trusting this signal: six of its fourteen "unreferenced" files were named by `tsconfig.tsbuildinfo`
// — a committed compiler cache — and on another repo five more were named by a committed
// `repomix-output.xml`. Both name every path in the repo by construction, so they can silence this
// finding entirely rather than answer it. It is the safe direction (see below) and it is a real
// blind spot: the lever is `linguist-generated` in `.gitattributes`, which the index already reads.

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
export function namedElsewhere(index, text, paths) {
  const named = new Set();
  const source = textSource(text);
  if (!source.available || !paths.length) return named;
  const wanted = [...paths];
  for (const f of index.files) {
    // An unread file costs its mentions, never the finding. It is recorded on the source with a
    // reason, so what the loss was stays countable instead of reading as "nothing named this".
    const body = source.read(f.path);
    if (body === null) continue;
    for (const p of wanted) {
      if (p === f.path || named.has(p)) continue;
      if (body.includes(p)) named.add(p);
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
 * `text` is a repo-text source or a root string, and is optional. Without it only the import graph
 * is consulted, which is the old behaviour and strictly noisier — a caller that can read the repo
 * should pass it. A caller that wants to know what the read cost should build the source itself
 * and inspect `source.unread` afterwards; passing a bare root throws that record away.
 */
export function findOrphans(index, text = null) {
  const candidates = unimported(index);
  if (!candidates.length) return [];
  const named = namedElsewhere(index, text, candidates.map((f) => f.path));
  return candidates.filter((f) => !named.has(f.path));
}
