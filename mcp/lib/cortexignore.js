import { readFileSync } from "node:fs";
import { join } from "node:path";

// Faithful JS port of tools/_cortex-lib.sh's knowledge_files() filter, so the live MCP brain and
// the bash generators agree on what counts as knowledge. `.cortexignore` is the single source of
// truth; this file must not grow its own opinions.
//
// Pattern forms (matched against the root-relative POSIX path):
//   foo/     → a directory named foo, at any depth
//   *.glob   → a glob matched on the final path segment
//   name.md  → an exact filename, at any depth
//
// Always skipped regardless of .cortexignore — never knowledge, and walking them is expensive.
export const ALWAYS_SKIP_DIRS = ["node_modules", ".git"];
// Used only when the vault has no .cortexignore, preserving pre-1.1 recall behaviour.
export const FALLBACK_SKIP_DIRS = [...ALWAYS_SKIP_DIRS, "archives"];
// Also fallback-only. A fresh vault ships no .cortexignore and nothing seeds one, so without this
// every consumer hand-codes its own README exclusion — which is what projects.js did. A vault that
// HAS a .cortexignore keeps full control: the file stays the single source of truth.
export const FALLBACK_SKIP_FILES = ["README.md"];

// Escape every regex metacharacter except `*`, which the caller turns into a segment wildcard.
// The shell version escapes only `.`; escaping more is strictly safer and behaves identically for
// the pattern forms .cortexignore actually uses.
function escapeExceptStar(s) {
  return s.replace(/[.+?^${}()|[\]\\/]/g, "\\$&");
}

function stripComment(line) {
  const i = line.indexOf("#");
  return (i === -1 ? line : line.slice(0, i)).trim();
}

/**
 * Parse .cortexignore into directory-pruning and file-matching regexes.
 * Returns null when the vault has no .cortexignore (caller falls back to FALLBACK_SKIP_DIRS).
 */
export function parseCortexignore(text) {
  const dirs = [];
  const files = [];
  for (const rawLine of String(text).split("\n")) {
    const pat = stripComment(rawLine);
    if (!pat) continue;
    if (pat.endsWith("/")) {
      dirs.push(new RegExp(`(^|/)${escapeExceptStar(pat.slice(0, -1))}/`));
    } else {
      files.push(new RegExp(`(^|/)${escapeExceptStar(pat).replace(/\*/g, "[^/]*")}$`));
    }
  }
  return { dirs, files };
}

export function loadCortexignore(root) {
  let text;
  try {
    text = readFileSync(join(root, ".cortexignore"), "utf8");
  } catch {
    return null;
  }
  return parseCortexignore(text);
}

/**
 * Build the predicate pair used to walk a vault.
 *   skipDir(relPosixPath)  → true when the directory must not be descended into
 *   skipFile(relPosixPath) → true when the file is not knowledge
 */
export function makeIgnoreFilter(root) {
  const parsed = loadCortexignore(root);
  const skipNames = new Set(parsed ? ALWAYS_SKIP_DIRS : FALLBACK_SKIP_DIRS);
  if (!parsed) {
    const skipFileNames = new Set(FALLBACK_SKIP_FILES);
    return {
      skipDir: (rel) => skipNames.has(rel.split("/").pop()),
      skipFile: (rel) => skipFileNames.has(rel.split("/").pop()),
    };
  }
  return {
    // Pruning a directory is equivalent to filtering every path beneath it, and much cheaper.
    skipDir: (rel) => skipNames.has(rel.split("/").pop()) || parsed.dirs.some((re) => re.test(`${rel}/`)),
    skipFile: (rel) => parsed.files.some((re) => re.test(rel)),
  };
}
