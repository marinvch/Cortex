import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { listFiles } from "./walk.mjs";
import { detectLanguage, categoryOf, isTestPath, isEntryPath } from "./langs.mjs";
import { extractImports, resolveImport } from "./imports.mjs";
import { inferLayers } from "./layers.mjs";
import { detectStack } from "./stack.mjs";

export const INDEX_VERSION = "1";

function git(root, args) {
  try {
    // execFileSync with an argument array — never a shell string, so repo paths can't inject.
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** Commit counts per file over a recent window. Absent git, every file simply scores 0. */
export function hotspots(root, { since = "3 months ago" } = {}) {
  const out = git(root, ["log", `--since=${since}`, "--name-only", "--pretty=format:"]);
  const counts = new Map();
  if (!out) return counts;
  for (const line of out.split("\n")) {
    const p = line.trim();
    if (!p) continue;
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  return counts;
}

/**
 * Build the deterministic index. No LLM, no network: the same tree always produces the same
 * output, which is what makes it safe to re-run in CI and cheap to run on every install.
 */
export function buildIndex(root, opts = {}) {
  const raw = listFiles(root, opts);
  const commits = hotspots(root, opts);
  const head = (git(root, ["rev-parse", "HEAD"]) || "").trim() || null;

  const files = raw.map((f) => {
    const lang = detectLanguage(f.path);
    return {
      path: f.path,
      lang,
      category: categoryOf(lang),
      lines: f.lines,
      bytes: f.bytes,
      isTest: isTestPath(f.path),
      isEntry: isEntryPath(f.path),
      commits: commits.get(f.path) || 0,
      imports: [],
    };
  });

  const fileSet = new Set(files.map((f) => f.path));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const edges = [];

  for (const f of files) {
    if (f.category !== "code" && f.category !== "script") continue;
    let text;
    try {
      text = readFileSync(join(root, f.path), "utf8");
    } catch {
      continue;
    }
    const seen = new Set();
    for (const spec of extractImports(text, f.lang)) {
      const target = resolveImport(spec, f.path, fileSet, f.lang);
      if (!target || target === f.path || seen.has(target)) continue;
      seen.add(target);
      f.imports.push(target);
      edges.push({ from: f.path, to: target, type: "imports" });
    }
    f.imports.sort();
  }

  // Inbound counts let the findings pass distinguish a genuine orphan from a busy hub.
  const inbound = new Map();
  for (const e of edges) inbound.set(e.to, (inbound.get(e.to) || 0) + 1);
  for (const f of files) f.inbound = inbound.get(f.path) || 0;

  const languages = {};
  const categories = {};
  for (const f of files) {
    languages[f.lang] = (languages[f.lang] || 0) + 1;
    categories[f.category] = (categories[f.category] || 0) + 1;
  }

  return {
    version: INDEX_VERSION,
    root,
    commit: head,
    stats: {
      files: files.length,
      lines: files.reduce((a, f) => a + (f.lines || 0), 0),
      edges: edges.length,
      tests: files.filter((f) => f.isTest).length,
      languages,
      categories,
    },
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    layers: inferLayers(files),
    // What the repo is built out of, so downstream can pick skills that fit it. Reading is
    // injected rather than done inside detectStack, which keeps that function a pure
    // transform of its inputs and testable from literals.
    stack: detectStack(files, (rel) => {
      try {
        return readFileSync(join(root, rel), "utf8");
      } catch {
        return null;
      }
    }),
  };
}

export { byPathHelper };
function byPathHelper(index) {
  return new Map(index.files.map((f) => [f.path, f]));
}
