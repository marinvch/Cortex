// generated.mjs — creating a generated directory, and ignoring it in the same breath.
//
// The rule was written down and then attached to the wrong thing. `/cortex-scaffold` was the only
// place that added `.cortex/` to `.gitignore`, but it is not the only place that CREATES `.cortex/`:
// `/cortex-brief` re-indexes when the index is stale, `/cortex-enrich plan` writes batches,
// `/cortex-impact` tells you to build an index, and an install the user stops halfway through has
// already written one. Every one of those left a directory of generated artifacts showing up in
// `git status`, and `/cortex-install`'s "gotcha" about gitignoring them is only reached by running
// the skill that already does it.
//
// So the write moves next to the act. A directory that is generated is ignored at the moment it
// first exists, by whichever entry point got there first — no skill has to remember.
//
// `.cortex/memory/` is deliberately NOT ignored: it is committed, because that is how several
// developers share one context. The asymmetry is the point, and it is why this appends specific
// subdirectories rather than the parent.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
 * their repo silently.
 */
export function ensureGitignored(root, dirs = GENERATED_DIRS) {
  const file = join(root, ".gitignore");
  let existing = "";
  try {
    existing = readFileSync(file, "utf8");
  } catch {
    existing = "";
  }

  const lines = existing.split(/\r?\n/).map((l) => l.trim());
  // A bare `.cortex/` already covers every subdirectory. Honour it: adding narrower entries under
  // it would be noise, and worse, it would imply memory/ is ignored when that line already ignores
  // it — a disagreement between the file and us that the user would have to resolve.
  if (lines.includes(".cortex/") || lines.includes(".cortex")) return [];

  const missing = dirs.filter((d) => !lines.includes(d) && !lines.includes(d.replace(/\/$/, "")));
  if (!missing.length) return [];

  // Named `lead`, not `sep` — the path separator is imported under that name, and a block-scoped
  // shadow of it inside the one function that also joins paths is a trap for the next reader.
  const lead = existing === "" ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  const block = `${lead}${MARKER}\n${missing.join("\n")}\n`;
  try {
    writeFileSync(file, existing + block);
  } catch {
    return []; // an unwritable .gitignore costs the entry, never the run
  }
  return missing;
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
