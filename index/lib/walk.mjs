import { readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

// Which files belong to a repository is a question git already answers, so in a git repo Cortex
// asks git rather than reimplementing .gitignore. This deliberately does NOT consult
// `.cortexignore`: that file answers a different question — "what is not knowledge in a vault" —
// and using it here would drop a repo's own source (tools/, skills/) from its index.

export const CODE_SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", "vendor", "coverage",
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".venv", "venv", "__pycache__",
  ".pytest_cache", ".mypy_cache", ".gradle", ".idea", "bin", "obj",
  ".cortex", ".ua", ".understand-anything",
]);

export const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tar", "bz2",
  "woff", "woff2", "ttf", "eot", "otf", "mp3", "mp4", "mov", "avi", "wasm", "so", "dll",
  "dylib", "exe", "class", "jar", "pyc", "bin", "db", "sqlite",
]);

export function isSkippedPath(rel) {
  const parts = rel.split("/");
  for (const p of parts.slice(0, -1)) if (CODE_SKIP_DIRS.has(p)) return true;
  const ext = rel.split(".").pop().toLowerCase();
  if (BINARY_EXT.has(ext)) return true;
  if (rel.endsWith(".lock") || rel.endsWith("-lock.json") || rel.endsWith(".min.js")) return true;
  return false;
}

/** Files git considers part of the tree: tracked, plus untracked that .gitignore does not exclude. */
function gitFiles(root) {
  try {
    const out = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 },
    );
    const paths = out.split("\0").filter(Boolean);
    return [...new Set(paths)];
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
        if (CODE_SKIP_DIRS.has(e.name)) continue;
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
 * Every indexable file, root-relative with POSIX separators, sorted.
 * Deterministic: the same tree always yields the same list.
 */
export function listFiles(root, { maxBytes = 2_000_000 } = {}) {
  const candidates = gitFiles(root) ?? walkFiles(root);
  const out = [];
  for (const rel of candidates) {
    if (isSkippedPath(rel)) continue;
    const m = measure(root, rel, maxBytes);
    if (m) out.push(m);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
