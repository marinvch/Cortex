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
  parseJsonc,
  tsAliasTable,
  mergeAliasTables,
  resolveTsAlias,
} from "./imports.mjs";
import { inferAreas } from "./layers.mjs";
import { detectStack } from "./stack.mjs";
import { depthOf } from "./depth.mjs";
import { vendoredPaths, vendoredStats } from "./vendored.mjs";

export const INDEX_VERSION = "1";

// The languages a tsconfig/jsconfig alias table applies to. Vue and Svelte single-file components
// import through the same resolver and the same aliases, so they belong here too.
const JS_LANGS = new Set(["javascript", "typescript", "vue", "svelte"]);

// Join a root-relative directory with a relative specifier, staying root-relative. Used for the
// tsconfig `extends` chain, which points at sibling and parent files.
function normalizeRel(dir, spec) {
  const out = [];
  for (const part of [...dir.split("/"), ...spec.split("/")]) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

// The directory a root-relative path sits in — "" at the repo root.
function dirOfPath(path) {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/**
 * Read one tsconfig/jsconfig, following `extends` upward, and return its merged `compilerOptions`
 * together with the `references` the config itself declares.
 *
 * `extends` is common — a repo splits its options into tsconfig.base.json and the child holds only
 * overrides. Following it is what makes those repos resolve at all. Depth-capped and cycle-guarded
 * because a loop in the chain must cost a config, never the whole index; likewise a config that
 * cannot be read or parsed costs its aliases and stops the walk.
 *
 * `references` is *not* inherited (TypeScript excludes it from `extends`), so it is taken from the
 * entry config alone. Returns null when the entry config could not be read at all.
 */
function readTsConfigChain(root, entryRel) {
  const merged = { compilerOptions: {} };
  let references = null;
  let rel = entryRel;
  let dir = dirOfPath(rel);
  const seen = new Set();
  for (let hop = 0; hop < 8 && rel && !seen.has(rel); hop++) {
    seen.add(rel);
    let json = null;
    try {
      json = parseJsonc(readFileSync(join(root, rel), "utf8"));
    } catch {
      break; // a config we cannot read costs its aliases, never the run
    }
    if (!json) break;
    if (references === null) references = Array.isArray(json.references) ? json.references : [];
    // The nearest config wins on every key, so only fill what is still missing as we walk up.
    for (const [k, v] of Object.entries(json.compilerOptions ?? {})) {
      if (!(k in merged.compilerOptions)) merged.compilerOptions[k] = v;
    }
    if (!json.extends || typeof json.extends !== "string" || !json.extends.startsWith(".")) break;
    const parent = normalizeRel(dir, json.extends);
    rel = parent.endsWith(".json") ? parent : `${parent}.json`;
    dir = dirOfPath(rel);
  }
  return references === null ? null : { merged, references };
}

function git(root, args) {
  try {
    // execFileSync with an argument array — never a shell string, so repo paths can't inject.
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/**
 * Commit counts per file, and the window they were counted over.
 *
 * The window is recent by design — churn matters because it is *current*. But a repo whose whole
 * history predates it scored 0 everywhere, and nothing said so: `/cortex-brief`'s "ranked by size,
 * churn and absence of tests" quietly degraded to ranking by size, `/cortex-impact` lost its
 * tiebreak, and the viewer's hot spots emptied. A real repo with 11 commits hit this — no error, no
 * warning, just a signal that had silently become a constant.
 *
 * So: if the window finds nothing and the repo does have history, count all of it and say which
 * window was used. A stated wider window is honest; a silent zero is not. Absent git entirely,
 * every file scores 0 and `window` is null — the caller can tell "no churn" from "no git", which
 * is the same distinction UNRESOLVED_LANGUAGES exists to preserve for imports.
 *
 * Returns `{ counts, window }`. The window is not decoration: it is printed, so a reader knows
 * whether "12 commits" means twelve this quarter or twelve ever.
 */
export function hotspots(root, { since = "3 months ago" } = {}) {
  let window = since;
  let out = git(root, ["log", `--since=${since}`, "--name-only", "--pretty=format:"]);
  if (out !== null && !out.trim()) {
    const all = git(root, ["log", "--name-only", "--pretty=format:"]);
    if (all && all.trim()) {
      out = all;
      window = "all history";
    }
  }
  const counts = new Map();
  if (!out) return { counts, window: out === null ? null : window };
  for (const line of out.split("\n")) {
    const p = line.trim();
    if (!p) continue;
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  return { counts, window };
}

/**
 * Build the deterministic index. No LLM, no network: the same tree always produces the same
 * output, which is what makes it safe to re-run in CI and cheap to run on every install.
 */
export function buildIndex(root, opts = {}) {
  const { files: raw, skipped } = listFiles(root, opts);
  const { counts: commits, window: churnWindow } = hotspots(root, opts);
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
      // Declared in .gitattributes, never inferred from a directory name. A vendored file stays in
      // the index — git-truth is the point — but every consumer that ranks or costs by size can now
      // tell somebody else's code from this team's. Filled in just below, in one git call.
      vendored: false,
      imports: [],
    };
  });

  const fileSet = new Set(files.map((f) => f.path));

  // One `git check-attr` for the whole tree. Per-file calls cost more than the rest of the index.
  const marked = vendoredPaths(root, files.map((f) => f.path));
  for (const f of files) f.vendored = marked.has(f.path);

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

  // TypeScript/JavaScript path aliases, from tsconfig.json / jsconfig.json. Declared, not guessed —
  // the same reason Go reads go.mod and PHP reads composer.json.
  //
  // Without this a modern TS repo reads as an almost empty graph. On a real Next.js app 428 imports
  // were written `@/components/…` against 104 relative ones: the index saw about a fifth of the
  // edges and reported 154 orphans, nearly all false. Every consumer of the graph — orphans,
  // impact, depth, the viewer — was wrong on that repo, and each of them was confidently wrong.
  //
  // A monorepo has several configs, so this is a list keyed by directory and matched nearest-first.
  //
  // Discovery starts at every `tsconfig.json` / `jsconfig.json` and walks two links: `extends`
  // upward, and `references` sideways. Solution-style configs are what make the second one
  // necessary — the Vite React-TS template writes a root `tsconfig.json` holding nothing but
  // `{ "files": [], "references": [...] }` and puts every option, `paths` included, in
  // `tsconfig.app.json`, which no basename check will ever open. On one such repo that cost the
  // index 70 of its 82 internal imports and produced 30 orphans, nearly all false.
  const found = [];
  const seenConfigs = new Set();
  const addConfig = (rel, depth) => {
    if (seenConfigs.has(rel)) return; // also what terminates a reference cycle
    seenConfigs.add(rel);
    const chain = readTsConfigChain(root, rel);
    if (!chain) return; // unreadable or malformed: it costs its own aliases and nothing else
    const dir = dirOfPath(rel);
    // A referenced config's `paths` are relative to *its* directory and govern *its* directory, so
    // that is where the table is keyed — not where the config that pointed at it sits. Getting this
    // wrong in a monorepo hands every package the first-listed package's aliases.
    if (Object.keys(chain.merged.compilerOptions).length) found.push(tsAliasTable(chain.merged, dir));
    if (depth >= 8) return;
    for (const ref of chain.references) {
      const p = typeof ref?.path === "string" ? ref.path : null;
      if (!p) continue;
      // A reference names either a config file or a directory holding a `tsconfig.json` —
      // TypeScript accepts both, and `packages/foo` is the common form in a workspace.
      const target = normalizeRel(dir, p);
      if (!target) continue;
      addConfig(target.endsWith(".json") ? target : `${target}/tsconfig.json`, depth + 1);
    }
  };
  for (const f of files) {
    const base = f.path.split("/").pop();
    if (base !== "tsconfig.json" && base !== "jsconfig.json") continue;
    addConfig(f.path, 0);
  }
  // Several configs can govern one directory — the Vite layout has three at the root, and only one
  // of them declares `paths`. Merge them, because a lookup returning the first match would
  // otherwise pick whichever was declared first and silently drop the other's aliases.
  const tsConfigs = [];
  for (const table of found) {
    const at = tsConfigs.findIndex((c) => c.dir === table.dir);
    if (at < 0) tsConfigs.push(table);
    else tsConfigs[at] = mergeAliasTables(tsConfigs[at], table);
  }
  // Nearest config wins: a package's own tsconfig must beat the repo root's.
  tsConfigs.sort((a, b) => b.dir.length - a.dir.length);
  const tsTableFor = (path) => tsConfigs.find((c) => c.dir === "" || path.startsWith(`${c.dir}/`)) ?? null;

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
                  : // Relative first, alias second. A relative specifier is unambiguous, so an alias
                    // table can only ever add edges the plain resolver could not find — it never
                    // reinterprets one it could. `resolveTsAlias` returns null for a genuine package,
                    // which is why a bare specifier still costs nothing when no config declares it.
                    [
                      resolveImport(spec, f.path, fileSet, f.lang) ??
                        (JS_LANGS.has(f.lang) ? resolveTsAlias(spec, fileSet, tsTableFor(f.path)) : null),
                    ];
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
      // Readable files a directory *name* cost the index, one row per directory. Every other
      // number here describes what was found; this is the only one that describes what was not,
      // and it belongs beside them so a reader cannot see the count without seeing the gap.
      skipped,
      // Which window the `commits` numbers were counted over: the recent one, "all history" when
      // the repo is younger than it, or null when there is no git at all. Every consumer prints a
      // sentence about churn, and without this they all print the same sentence whether the number
      // means twelve commits this quarter or twelve ever.
      churnWindow,
      // What was declared as somebody else's. Reported beside the totals for the same reason
      // `skipped` is: a reader who sees "13,532 lines" must be able to see that 11,600 of them are
      // vendored, or they will read a number about another team's code as a number about theirs.
      vendored: vendoredStats(files),
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
