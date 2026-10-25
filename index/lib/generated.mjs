// generated.mjs — creating a generated directory, and ignoring it in the same breath.
//
// The rule was written down and then attached to the wrong thing. `/write-context-docs` was the only
// place that added `.cortex/` to `.gitignore`, but it is not the only place that CREATES `.cortex/`:
// `/write-area-brief` re-indexes when the index is stale, `/summarize-files plan` writes batches,
// `/change-impact` tells you to build an index, and an install the user stops halfway through has
// already written one. Every one of those left a directory of generated artifacts showing up in
// `git status`, and `/setup-repo`'s "gotcha" about gitignoring them is only reached by running
// the skill that already does it.
//
// So the write moves next to the act. A directory that is generated is ignored at the moment it
// first exists, by whichever entry point got there first — no skill has to remember.
//
// `.cortex/memory/` is deliberately NOT ignored: it is committed, because that is how several
// developers share one context. The asymmetry is the point, and it is why this appends specific
// subdirectories rather than the parent.

import { existsSync, mkdirSync } from "node:fs";
import { ensureGitignored as ensureGitignoredIn } from "../../core/gitignore.js";
import { join, dirname, sep } from "node:path";

/** The generated subdirectories. `.cortex/memory/` is absent on purpose — it is committed. */
export const GENERATED_DIRS = [".cortex/index/", ".cortex/findings/", ".cortex/view/"];

const MARKER = "# Cortex — generated, safe to delete. .cortex/memory/ is committed on purpose.";

/**
 * Ensure a repo's `.gitignore` covers the generated directories.
 *
 * Append-only and never clobbering: existing content is untouched, and an entry already present —
 * including a broader `.cortex/` the user wrote themselves — is left alone rather than duplicated.
 * Returns the entries it added, so a caller can tell the user what changed rather than editing
 * their repo silently. The writing is `core/gitignore.js`'s, shared with `mcp/`, which ignores a
 * team-brain clone made inside a product repo the same way; WHICH directories are generated is
 * this file's.
 */
export function ensureGitignored(root, dirs = GENERATED_DIRS) {
  return ensureGitignoredIn(root, dirs, MARKER);
}

/**
 * Create a directory under `.cortex/` and make sure the generated set is ignored.
 *
 * Returns `{ created, ignored }` — whether this call brought `.cortex/` into existence, and which
 * gitignore entries it added. Both are reported by the CLIs: a directory appearing in someone's
 * project on a run they did not explicitly ask for should be visible, and "generated and gitignored"
 * is not the same as invisible.
 */
export function ensureGeneratedDir(root, dir) {
  const created = !existsSync(join(root, ".cortex"));
  mkdirSync(dir, { recursive: true });
  const ignored = ensureGitignored(root);
  return { created, ignored };
}

/**
 * The same, for a caller that already knows its output file rather than its directory.
 *
 * **`--out` means it.** When the output does not land under the repo's own `.cortex/`, nothing here
 * touches the repo — not the directory, not `.gitignore`. That mode exists so Cortex can be pointed
 * at a project someone cares about without modifying it, and the first version of this helper broke
 * it in a way the existing read-only test could not see: it checked for a stray `.cortex/` and the
 * violation was a modified `.gitignore`.
 */
export function ensureGeneratedFileDir(root, outFile) {
  const dir = dirname(outFile);
  const cortexDir = join(root, ".cortex");
  const inside = dir === cortexDir || dir.startsWith(cortexDir + sep) || dir.startsWith(`${cortexDir}/`);
  if (!inside) {
    mkdirSync(dir, { recursive: true });
    return { created: false, ignored: [] };
  }
  return ensureGeneratedDir(root, dir);
}
