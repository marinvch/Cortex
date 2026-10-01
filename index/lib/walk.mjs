import { readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { declaredOwn } from "./vendored.mjs";

// Which files belong to a repository is a question git already answers, so in a git repo Cortex
// asks git rather than reimplementing .gitignore. This deliberately does NOT consult
// `.cortexignore`: that file answers a different question — "what is not knowledge in a vault" —
// and using it here would drop a repo's own source (tools/, skills/) from its index.

export const CODE_SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", "coverage",
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".venv", "venv", "__pycache__",
  ".pytest_cache", ".mypy_cache", ".gradle", ".idea",
  ".cortex", ".ua", ".understand-anything",
]);

// These two names mean build output in some ecosystems and hand-written source in others —
// `bin/cli.js` in an npm package, `bin/rails`, an ops repo's shell tools, C# `obj/`. The name
// alone cannot tell them apart, so git decides: a file git *tracks* is source; an untracked one
// is output. Skipping them outright dropped a third of a real repo's code, and the report said
// nothing about it — a silent gap is the part that costs the most. Keep this set narrow: a
// vendored `node_modules/` is committed too, and still must never be indexed.
export const AMBIGUOUS_SKIP_DIRS = new Set(["bin", "obj"]);

// `vendor/` is somebody else's code by Linguist's default, the vocabulary lib/vendored.mjs reads, so
// it is left out — and counted, because a team can write its own code there. Git tracking cannot
// tell the two apart: a Go or Composer tree is committed on purpose. The repo can, in the file
// GitHub reads too: `vendor/** -linguist-vendored` indexes it as the team's own. Indexing every
// tracked `vendor/` and marking it vendored was measured and rejected: on docker/cli it tripled the
// index, put a vendored package's requirements.txt into the stack, and filled "untested" with
// golang.org/x/sys until the team's own modules fell off the list (#529).
export const VENDOR_DIR = "vendor";

export const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tar", "bz2",
  "woff", "woff2", "ttf", "eot", "otf", "mp3", "mp4", "mov", "avi", "wasm", "so", "dll",
  "dylib", "exe", "class", "jar", "pyc", "bin", "db", "sqlite",
]);

export function isSkippedPath(rel, { tracked = false, ownVendor = false } = {}) {
  const parts = rel.split("/");
  for (const p of parts.slice(0, -1)) {
    if (CODE_SKIP_DIRS.has(p)) return true;
    if (!tracked && AMBIGUOUS_SKIP_DIRS.has(p)) return true;
    if (!ownVendor && p === VENDOR_DIR) return true;
  }
  const ext = rel.split(".").pop().toLowerCase();
  if (BINARY_EXT.has(ext)) return true;
  if (rel.endsWith(".lock") || rel.endsWith("-lock.json") || rel.endsWith(".min.js")) return true;
  return false;
}

/**
 * The ambiguous directory that alone accounts for this path being dropped, or null.
 *
 * Null when a certain name (`node_modules/`) or the file's own extension would have dropped it
 * anyway: those are not guesses, and reporting them would bury the one number that is.
 */
export function ambiguousSkipReason(rel) {
  const dirs = rel.split("/").slice(0, -1);
  if (dirs.some((p) => CODE_SKIP_DIRS.has(p))) return null;
  const dir = dirs.find((p) => AMBIGUOUS_SKIP_DIRS.has(p) || p === VENDOR_DIR);
  if (!dir) return null;
  return isSkippedPath(rel, { tracked: true, ownVendor: true }) ? null : dir;
}

/**
 * What git considers part of the tree: `candidates` is tracked plus untracked that .gitignore
 * does not exclude; `tracked` is the committed half alone, which is what lets an ambiguous
 * directory name be overruled. Null outside a git repo.
 */
function gitFiles(root) {
  const ls = (args) =>
    execFileSync("git", ["ls-files", "-z", ...args], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean);
  try {
    const candidates = ls(["--cached", "--others", "--exclude-standard"]);
    const tracked = new Set(ls(["--cached"]));
    return { candidates: [...new Set(candidates)], tracked };
  } catch {
    return null;
  }
}

/** Fallback for a non-git directory: walk the tree applying the skip rules directly. */
function walkFiles(root) {
  const out = [];
  const walk = (absDir, relDir) => {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        // An ambiguous directory is descended into and dropped later, per file, so the run can
        // say how much it dropped. A certain one is pruned here: nobody needs a count of
        // node_modules, and walking it to produce one would cost the whole tree.
        // `vendor/` too: outside git there is no .gitattributes to declare it the team's own.
        if (CODE_SKIP_DIRS.has(e.name) || e.name === VENDOR_DIR) continue;
        walk(join(absDir, e.name), rel);
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(root, "");
  return out;
}

function measure(root, rel, maxBytes) {
  const abs = join(root, rel);
  let size;
  try {
    size = statSync(abs).size;
  } catch {
    return null;
  }
  if (size > maxBytes) return null;
  try {
    const buf = readFileSync(abs);
    if (buf.subarray(0, 8192).includes(0)) return null; // binary
    const text = buf.toString("utf8");
    return { path: rel, lines: text ? text.split("\n").length : 0, bytes: size };
  } catch {
    return null;
  }
}

/**
 * Every indexable file, root-relative with POSIX separators, sorted — and what a guess dropped.
 * Deterministic: the same tree always yields the same result.
 *
 * `skipped` counts only the files an *ambiguous* directory name cost, or `vendor/`, one row per
 * directory.
 * A count the reader never sees is the expensive half of the `bin/` bug: the run printed a
 * plausible number and nothing said part of the repo was missing from it.
 */
/**
 * The largest file the Index will hold. Exported because it is the repo's ONE size ceiling: every
 * consumer that reads a tracked file back is reading something this number already bounded, and a
 * second, smaller cap downstream makes a scanner see less than the Index it is scanning without
 * saying so. `lib/repo-text.mjs` reads it rather than inventing a number of its own.
 */
export const MAX_INDEXED_BYTES = 2_000_000;

export function listFiles(root, { maxBytes = MAX_INDEXED_BYTES } = {}) {
  const git = gitFiles(root);
  const candidates = git ? git.candidates : walkFiles(root);
  const ownVendor = git ? declaredOwn(root, candidates.filter((rel) => rel.split("/").slice(0, -1).includes(VENDOR_DIR))) : new Set();
  const files = [];
  const skipped = new Map();
  for (const rel of candidates) {
    if (isSkippedPath(rel, { tracked: git ? git.tracked.has(rel) : false, ownVendor: ownVendor.has(rel) })) {
      const dir = ambiguousSkipReason(rel);
      // Measured, not just counted: the number has to mean "readable source you cannot see".
      // Counting compiled output as a hidden file would make it noise in exactly the repos
      // where the skip was right. `vendor/` holds no build output, so its files are counted
      // without opening each one — a Go tree is thousands of them, and reading them only to count
      // doubled the index time on docker/cli.
      if (dir && (dir === VENDOR_DIR || measure(root, rel, maxBytes))) skipped.set(dir, (skipped.get(dir) ?? 0) + 1);
      continue;
    }
    const m = measure(root, rel, maxBytes);
    if (m) files.push(m);
  }
  return {
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    skipped: [...skipped]
      .map(([dir, count]) => ({ dir, files: count }))
      .sort((a, b) => a.dir.localeCompare(b.dir)),
  };
}
