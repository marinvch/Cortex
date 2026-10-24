// gitignore.js — append entries to a repo's `.gitignore`, never clobbering, for both leaves.
//
// `index/lib/generated.mjs` ignores the directories the indexer generates (`.cortex/index/` and its
// siblings) at the moment it first creates one. `mcp/` has a directory of its own to ignore: a
// team-brain clone made inside a product repo, `.cortex/team/<team>/`, for the ask tools (#620).
// The two leaves may not import each other, so the one function both need lives here. What to
// ignore stays each caller's: this module only knows how to add lines safely.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Ensure `<repo>/.gitignore` lists every entry in `dirs`, under `marker` when any are added.
 *
 * Append-only and never clobbering: existing content is untouched, and an entry already present —
 * including a broader `.cortex/` the user wrote themselves — is left alone rather than duplicated.
 * Returns the entries it added, so a caller can tell the user what changed rather than editing
 * their repo silently. An unwritable `.gitignore` costs the entry, never the caller's run.
 *
 * @param {string} repo     the repository root, the directory holding `.gitignore`
 * @param {string[]} dirs   entries such as `.cortex/team/`
 * @param {string} marker   a `# …` comment line written above the added block
 * @returns {string[]}
 */
export function ensureGitignored(repo, dirs, marker) {
  const file = join(repo, ".gitignore");
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

  const lead = existing === "" ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  const block = `${lead}${marker}\n${missing.join("\n")}\n`;
  try {
    writeFileSync(file, existing + block);
  } catch {
    return [];
  }
  return missing;
}
