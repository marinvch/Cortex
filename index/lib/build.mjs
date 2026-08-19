import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { listFiles } from "./walk.mjs";
import { detectLanguage, categoryOf, isTestPath, isEntryPath } from "./langs.mjs";
import {
  extractImports,
  resolveImport,
  resolveGoImport,
  resolveRustImport,
  resolveJavaImport,
  resolvePhpImport,
  resolveRubyImport,
  goModulePath,
} from "./imports.mjs";
import { inferAreas } from "./layers.mjs";
import { detectStack } from "./stack.mjs";
import { depthOf } from "./depth.mjs";

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

  // Go needs two things no other language here does: the module path (so an import can be told
  // from an external package) and a directory index (because a Go import names a package, which
  // is a directory of files). Both are computed once.
  let goModule = null;
  try {
    goModule = goModulePath(readFileSync(join(root, "go.mod"), "utf8"));
  } catch {
    // no go.mod — not a Go module, and Go imports will simply not resolve
  }
  // Every crate root, longest first. `crate::` is relative to the crate a FILE belongs to, and a
  // workspace has many — matching the shortest would point every member at the same root.
  //
  // Derived from where lib.rs/main.rs actually sit, not from Cargo.toml plus /src. ripgrep keeps its
  // binary crate in crates/core/main.rs with no src/ directory at all, and the manifest-derived
  // guess missed every import in it — a third of the workspace, silently.
  const rustCrateRoots = [
    ...new Set(
      files
        .filter((f) => /(^|\/)(lib|main)\.rs$/.test(f.path))
        .map((f) => f.path.slice(0, Math.max(0, f.path.lastIndexOf("/")))),
    ),
  ].sort((a, b) => b.length - a.length);

  // Java source roots — the `src/main/java` prefix a package path hangs off. Longest first, and the
  // empty root lets a flat repo (no Maven layout) still resolve.
  const javaSourceRoots = [
    ...new Set(
      files
        .filter((f) => f.path.endsWith(".java"))
        .map((f) => {
          const m = f.path.match(/^(.*?src\/(?:main|test)\/java)\//);
          return m ? m[1] : "";
        }),
    ),
  ].sort((a, b) => b.length - a.length);

  // PHP autoload prefixes from composer.json. PSR-4 maps a namespace to a directory, so this is
  // declared rather than guessed — the same reason Go reads go.mod. Longest prefix wins, so a more
  // specific namespace beats the umbrella one.
  const phpPrefixes = [];
  for (const f of files) {
    if (f.path !== "composer.json" && !f.path.endsWith("/composer.json")) continue;
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    let json;
    try {
      json = JSON.parse(readFileSync(join(root, f.path), "utf8"));
    } catch {
      continue; // a malformed manifest costs us autoload data, never the whole index
    }
    for (const block of [json.autoload, json["autoload-dev"]]) {
      for (const [prefix, target] of Object.entries(block?.["psr-4"] || block?.["psr-0"] || {})) {
        for (const t of [].concat(target)) {
          const clean = String(t).replace(/[\\/]+$/, "");
          phpPrefixes.push([prefix, dir ? `${dir}/${clean}` : clean]);
        }
      }
    }
  }
  phpPrefixes.sort((a, b) => b[0].length - a[0].length);

  // Ruby load paths. `require 'sinatra/base'` searches $LOAD_PATH, which for a gem is its lib/ —
  // and a repo holding several gems has several, which is why this is a list and not a constant.
  const rubyLoadPaths = [
    ...new Set(
      files
        .filter((f) => f.path.endsWith(".rb"))
        .map((f) => {
          const m = f.path.match(/^(.*?lib)\//);
          return m ? m[1] : "";
        }),
    ),
  ].sort((a, b) => b.length - a.length);

  const goByDir = new Map();
  if (goModule) {
    for (const f of files) {
      if (!f.path.endsWith(".go") || f.path.endsWith("_test.go")) continue;
      const i = f.path.lastIndexOf("/");
      const dir = i < 0 ? "" : f.path.slice(0, i);
      if (!goByDir.has(dir)) goByDir.set(dir, []);
      goByDir.get(dir).push(f.path);
    }
  }
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
      // Go alone resolves one specifier to many files, because it imports a package rather than
      // a file. Everything else returns a single path or null.
      const targets =
        f.lang === "go"
          ? resolveGoImport(spec, goModule, goByDir)
          : f.lang === "rust"
            ? [resolveRustImport(spec, f.path, fileSet, rustCrateRoots)]
            : f.lang === "java"
              ? [resolveJavaImport(spec, fileSet, javaSourceRoots)]
              : f.lang === "php"
                ? [resolvePhpImport(spec, fileSet, phpPrefixes)]
                : f.lang === "ruby"
                  ? [resolveRubyImport(spec, f.path, fileSet, rubyLoadPaths)]
          : [resolveImport(spec, f.path, fileSet, f.lang)];
      for (const target of targets) {
        if (!target || target === f.path || seen.has(target)) continue;
        seen.add(target);
        f.imports.push(target);
        edges.push({ from: f.path, to: target, type: "imports" });
      }
    }
    f.imports.sort();
  }

  // Inbound counts let the findings pass distinguish a genuine orphan from a busy hub.
  const inbound = new Map();
  for (const e of edges) inbound.set(e.to, (inbound.get(e.to) || 0) + 1);
  for (const f of files) f.inbound = inbound.get(f.path) || 0;

  // Needs the finished edge list, so it runs after the import pass rather than beside `areas`.
  const depth = depthOf({ files, edges });
  for (const f of files) {
    const d = depth.byPath.get(f.path);
    if (typeof d === "number") f.depth = d;
  }

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
    // Directory groupings. Named `areas` because that is what they are — the CLI and the
    // findings report had said so for releases while the field still claimed to be layering.
    areas: inferAreas(files),
    // Actual layering, from the import graph: depth 0 is the foundation, the highest depth is an
    // entry point. A floor, like every other number derived from regex-resolved imports.
    layers: depth.layers,
    cycles: depth.cyclic,
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
