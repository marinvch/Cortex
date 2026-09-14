// format.mjs — the one number that says what shape an index.json is in.
//
// It lives alone, in the smallest module in this package, so that a *reader* of an index can check
// the version without importing the *writer*. `build.mjs` pulls in the walker, the language table,
// the import resolvers, the stack detector and `child_process`; `cortex-next.mjs` and
// `cortex-view.mjs` want one string. A constant that forces the whole builder into every consumer
// is a constant nobody puts in the fast path, and for one release nobody did: the field was written
// at build time and read by no consumer at all, so a v1 index handed to a v2 reader was confidently
// wrong rather than refused.
//
// `build.mjs` re-exports the version, so its public surface is unchanged, and `open.mjs` re-exports
// both of these, so a CLI still asks the front door for everything.

import { join } from "node:path";

/**
 * The format version stamped into every `index.json` as `version`.
 *
 * Bump this when a consumer could misread an older index — a renamed field, a changed unit, a value
 * that used to mean something else. Adding a field consumers may ignore is not a bump; removing or
 * repurposing one is. `lib/open.mjs` refuses a mismatch rather than guessing, because the failure it
 * prevents is not a crash but a plausible answer computed from a shape that no longer holds.
 */
export const INDEX_VERSION = "1";

/**
 * Where an index lives inside a repository, as path segments.
 *
 * Nine files carried `join(root, ".cortex", "index", "index.json")` as a literal. They agreed, which
 * is the only state nine copies are ever in until one of them does not. It sits here rather than in
 * `open.mjs` so that `next.mjs` — a pure library, used inside three CLIs — can ask where an index
 * would be without importing the module that owns `process.exit`.
 */
export const INDEX_REL = [".cortex", "index", "index.json"];

/** The default index path for a repository root. */
export function defaultIndexPath(root) {
  return join(root, ...INDEX_REL);
}
