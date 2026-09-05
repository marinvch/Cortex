// Is the thing we were handed actually a repository?
//
// Every CLI here takes a repo root, and every one of them treated whatever it resolved as real.
// `buildIndex` on a directory that does not exist returns zero files rather than throwing, so the
// failure has no error state — it has an *output*, and the output is confident:
//
//   $ node index/cortex-index.mjs -v          → Indexed 0 files (0 lines), 0 imports, 0 tests
//   $ node index/cortex-next.mjs /nope        → 0 of 8 steps done. Every ✓ is a file on disk.
//
// The second is the one that shows why this belongs in code rather than in each caller's judgement:
// the sentence making the claim is the sentence that is false. And `cortex-index` and
// `cortex-findings` went further and *wrote* — `./-v/.cortex/index/index.json` and `./-v/.gitignore`,
// two files in a directory the command invented from a mangled flag.
//
// One module, because the alternative is eight copies of a four-line check that agree today. The
// specific route in — a single-dash flag read as a path, a typo, a stale path in a script — is not
// worth enumerating per CLI: they all arrive at the same place, and this is that place.
//
// Deliberately NOT `core/paths.js`. That guards containment (is this path inside the root we are
// allowed to touch, symlinks included). This asks a different question — is the root itself a
// thing — and the two must not be conflated.

import { statSync } from "node:fs";

/**
 * `null` when `root` is a usable repository root, otherwise the message to print on stderr.
 *
 * Returns the text rather than exiting, so this stays a pure function the tests can drive and each
 * CLI keeps ownership of its own exit. The message is shared because eight copies of a sentence
 * drift, and a user comparing two Cortex commands should not have to wonder whether two different
 * wordings mean two different problems.
 */
export function rootProblem(root) {
  let stat = null;
  try {
    stat = statSync(root);
  } catch {
    stat = null;
  }
  if (stat?.isDirectory()) return null;
  return (
    `not a directory: ${root}\n` +
    "Pass the repository root, or run from inside it with no path argument. Nothing was changed.\n"
  );
}
