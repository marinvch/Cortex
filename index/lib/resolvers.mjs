// Per-language import resolution, behind one seam.
//
// Every language answers the same two questions, and the answers are the only thing that differs:
//
//   prepare(env) -> ctx                  what this language needs precomputed from the file list
//                                        and the repo's own declared manifests
//   resolve(spec, from, ctx) -> string[] which files in this repo one written specifier names
//
// Both halves live in the adapter, so `buildIndex` never has to know that Go reads `go.mod`, that
// `crate::` is relative to the crate a file belongs to, or that a JS alias table is consulted only
// after the relative resolver has already failed. Adding a language means adding a row to
// `ADAPTERS`; it does not mean editing the builder.
//
// `resolve` ALWAYS returns an array. Go alone resolves one specifier to many files — a Go import
// names a package, which is a directory — and a seam that spoke `string | null` for everyone else
// made that asymmetry the builder's problem. It showed up there as a six-deep nested ternary that
// had to know, per language, what to precompute, in what order to pass it, and whether to wrap the
// answer in an array. That is a shallow seam: an interface nearly as complicated as the thing it
// hides. The array is not decoration — it is what lets Go's many-files and JS's
// relative-then-alias fallback both be *implementation*.
//
// Nothing here reads the filesystem. `env.readText` is injected, exactly as `repo-text.mjs` does
// for the scanners, so every `prepare` is a pure function of a file list and some text and is
// testable from literals — which is the point, because both import-resolution bugs this repo has
// shipped lived in a derivation (`crates/core/main.rs`, a solution-style `references`) that no
// fixture could reach and no unit test could address.

import {
  resolveImport,
  resolveGoImport,
  resolveRustImport,
  resolveJavaImport,
  resolveJavaSamePackage,
  resolvePhpImport,
  resolveRubyImport,
  goModulePath,
  parseJsonc,
  normalizeRel,
  tsAliasTable,
  mergeAliasTables,
  resolveTsAlias,
  resolveWorkspaceImport,
  workspaceGlobs,
  workspaceGlobRegex,
} from "./imports.mjs";

/** A resolver that returned one path or null, as the array the seam speaks. */
const one = (hit) => (hit ? [hit] : []);

/** The directory a root-relative path sits in — "" at the repo root. */
function dirOfPath(path) {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/** Distinct values, longest first — the shape every "roots" list wants. */
function longestFirst(values) {
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

// --- JavaScript / TypeScript ---------------------------------------------------------------------

// The languages a tsconfig/jsconfig alias table applies to. Vue and Svelte single-file components
// import through the same resolver and the same aliases, so they belong here too.
const JS_LANGS = ["javascript", "typescript", "vue", "svelte"];

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
function readTsConfigChain(readText, entryRel) {
  const merged = { compilerOptions: {} };
  let references = null;
  let rel = entryRel;
  let dir = dirOfPath(rel);
  const seen = new Set();
  for (let hop = 0; hop < 8 && rel && !seen.has(rel); hop++) {
    seen.add(rel);
    const raw = readText(rel);
    if (raw === null) break; // a config we cannot read costs its aliases, never the run
    const json = parseJsonc(raw);
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

/**
 * Every alias table the repo declares, keyed by the directory it governs, nearest first.
 *
 * Without this a modern TS repo reads as an almost empty graph. On a real Next.js app 428 imports
 * were written `@/components/…` against 104 relative ones: the index saw about a fifth of the
 * edges and reported 154 orphans, nearly all false. Every consumer of the graph — orphans, impact,
 * depth, the viewer — was wrong on that repo, and each of them was confidently wrong.
 *
 * Discovery starts at every `tsconfig.json` / `jsconfig.json` and walks two links: `extends`
 * upward, and `references` sideways. Solution-style configs are what make the second one
 * necessary — the Vite React-TS template writes a root `tsconfig.json` holding nothing but
 * `{ "files": [], "references": [...] }` and puts every option, `paths` included, in
 * `tsconfig.app.json`, which no basename check will ever open. On one such repo that cost the
 * index 70 of its 82 internal imports and produced 30 orphans, nearly all false.
 */
export function tsAliasTables(files, readText) {
  const found = [];
  const seenConfigs = new Set();
  const addConfig = (rel, depth) => {
    if (seenConfigs.has(rel)) return; // also what terminates a reference cycle
    seenConfigs.add(rel);
    const chain = readTsConfigChain(readText, rel);
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
  const tables = [];
  for (const table of found) {
    const at = tables.findIndex((c) => c.dir === table.dir);
    if (at < 0) tables.push(table);
    else tables[at] = mergeAliasTables(tables[at], table);
  }
  // Nearest config wins: a package's own tsconfig must beat the repo root's.
  return tables.sort((a, b) => b.dir.length - a.dir.length);
}

/**
 * Every package a JS monorepo declares, by `name` → `{ dir, manifest }`.
 *
 * A workspace imports its own packages by name — `import { Button } from "@acme/ui"` — and a name
 * is not a path, so without this every cross-package edge read as an external dependency: 0 of 20
 * on a four-package pnpm workspace, and the shared packages every app depends on read as orphans.
 * Both halves of the mapping are declared — the workspace globs choose the directories, and each
 * directory's own `package.json` names itself — so nothing here is inferred from a directory name.
 * A `package.json` no glob matches is not a workspace package, however it is laid out.
 *
 * Candidate directories are the ones holding a `package.json` in the index, visited in sorted
 * order, and the first to claim a name keeps it: the same tree always gives the same table.
 */
export function workspacePackages(files, readText) {
  const globs = workspaceGlobs(readText("pnpm-workspace.yaml"), readText("package.json"));
  const packages = new Map();
  if (!globs.length) return packages;
  const include = globs.filter((g) => !g.startsWith("!")).map(workspaceGlobRegex);
  const exclude = globs.filter((g) => g.startsWith("!")).map((g) => workspaceGlobRegex(g.slice(1)));
  const dirs = files
    .filter((f) => f.path.endsWith("/package.json"))
    .map((f) => dirOfPath(f.path))
    .filter((d) => include.some((re) => re.test(d)) && !exclude.some((re) => re.test(d)))
    .sort();
  for (const dir of dirs) {
    let manifest;
    try {
      manifest = JSON.parse(readText(`${dir}/package.json`) ?? "");
    } catch {
      continue; // a manifest that does not parse costs its own package and nothing else
    }
    const name = manifest?.name;
    if (typeof name === "string" && name && !packages.has(name)) packages.set(name, { dir, manifest });
  }
  return packages;
}

const jsAdapter = {
  id: "js",
  langs: JS_LANGS,
  prepare: ({ files, fileSet, readText }) => ({
    fileSet,
    tables: tsAliasTables(files, readText),
    packages: workspacePackages(files, readText),
  }),
  resolve(spec, from, { fileSet, tables, packages }) {
    // Relative first, alias second, workspace package third. A relative specifier is unambiguous,
    // so the later passes can only ever add edges the plain resolver could not find — they never
    // reinterpret one it could. Both return null for a genuine npm package, which is why a bare
    // specifier still costs nothing when no config or workspace declares it.
    const direct = resolveImport(spec, from.path, fileSet, from.lang);
    if (direct) return [direct];
    const table = tables.find((c) => c.dir === "" || from.path.startsWith(`${c.dir}/`)) ?? null;
    const aliased = resolveTsAlias(spec, fileSet, table);
    if (aliased) return [aliased];
    return one(resolveWorkspaceImport(spec, fileSet, packages));
  },
};

// --- Go ------------------------------------------------------------------------------------------

const goAdapter = {
  id: "go",
  langs: ["go"],
  // Go needs two things no other language here does: the module path (so an import can be told from
  // an external package) and a directory index (because a Go import names a package, which is a
  // directory of files). Test files are excluded — importing a package does not give you its tests.
  prepare({ files, readText }) {
    const moduleName = goModulePath(readText("go.mod"));
    const byDir = new Map();
    if (moduleName) {
      for (const f of files) {
        if (!f.path.endsWith(".go") || f.path.endsWith("_test.go")) continue;
        const dir = dirOfPath(f.path);
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir).push(f.path);
      }
    }
    return { moduleName, byDir };
  },
  // Already an array: the one language whose specifier names many files.
  resolve: (spec, from, { moduleName, byDir }) => resolveGoImport(spec, moduleName, byDir),
};

// --- Rust ----------------------------------------------------------------------------------------

const rustAdapter = {
  id: "rust",
  langs: ["rust"],
  // Every crate root, longest first. `crate::` is relative to the crate a FILE belongs to, and a
  // workspace has many — matching the shortest would point every member at the same root.
  //
  // Derived from where lib.rs/main.rs actually sit, not from Cargo.toml plus /src. ripgrep keeps
  // its binary crate in crates/core/main.rs with no src/ directory at all, and the
  // manifest-derived guess missed every import in it — a third of the workspace, silently.
  prepare: ({ files, fileSet }) => ({
    fileSet,
    crateRoots: longestFirst(
      files.filter((f) => /(^|\/)(lib|main)\.rs$/.test(f.path)).map((f) => dirOfPath(f.path)),
    ),
  }),
  resolve: (spec, from, { fileSet, crateRoots }) =>
    one(resolveRustImport(spec, from.path, fileSet, crateRoots)),
};

// --- Java ----------------------------------------------------------------------------------------

const javaAdapter = {
  id: "java",
  langs: ["java"],
  // Java source roots — the `src/main/java` prefix a package path hangs off. Longest first, and the
  // empty root lets a flat repo (no Maven layout) still resolve.
  prepare: ({ files, fileSet }) => ({
    fileSet,
    sourceRoots: longestFirst(
      files
        .filter((f) => f.path.endsWith(".java"))
        .map((f) => f.path.match(/^(.*?src\/(?:main|test)\/java)\//)?.[1] ?? ""),
    ),
  }),
  // `./Name` is a class named with no import — same package, so beside the file (see extractImports).
  resolve: (spec, from, { fileSet, sourceRoots }) =>
    spec.startsWith("./")
      ? one(resolveJavaSamePackage(spec.slice(2), from.path, fileSet, sourceRoots))
      : one(resolveJavaImport(spec, fileSet, sourceRoots)),
};

// --- PHP -----------------------------------------------------------------------------------------

const phpAdapter = {
  id: "php",
  langs: ["php"],
  // PHP autoload prefixes from composer.json. PSR-4 maps a namespace to a directory, so this is
  // declared rather than guessed — the same reason Go reads go.mod. Longest prefix wins, so a more
  // specific namespace beats the umbrella one.
  prepare({ files, fileSet, readText }) {
    const prefixes = [];
    for (const f of files) {
      if (f.path !== "composer.json" && !f.path.endsWith("/composer.json")) continue;
      const dir = dirOfPath(f.path);
      const raw = readText(f.path);
      if (raw === null) continue;
      let json;
      try {
        json = JSON.parse(raw);
      } catch {
        continue; // a malformed manifest costs us autoload data, never the whole index
      }
      for (const block of [json?.autoload, json?.["autoload-dev"]]) {
        for (const [prefix, target] of Object.entries(block?.["psr-4"] || block?.["psr-0"] || {})) {
          for (const t of [].concat(target)) {
            const clean = String(t).replace(/[\\/]+$/, "");
            prefixes.push([prefix, dir ? `${dir}/${clean}` : clean]);
          }
        }
      }
    }
    prefixes.sort((a, b) => b[0].length - a[0].length);
    return { fileSet, prefixes };
  },
  resolve: (spec, from, { fileSet, prefixes }) => one(resolvePhpImport(spec, fileSet, prefixes)),
};

// --- Ruby ----------------------------------------------------------------------------------------

const rubyAdapter = {
  id: "ruby",
  langs: ["ruby"],
  // Ruby load paths. `require 'sinatra/base'` searches $LOAD_PATH, which for a gem is its lib/ —
  // and a repo holding several gems has several, which is why this is a list and not a constant.
  prepare: ({ files, fileSet }) => ({
    fileSet,
    loadPaths: longestFirst(
      files.filter((f) => f.path.endsWith(".rb")).map((f) => f.path.match(/^(.*?lib)\//)?.[1] ?? ""),
    ),
  }),
  resolve: (spec, from, { fileSet, loadPaths }) =>
    one(resolveRubyImport(spec, from.path, fileSet, loadPaths)),
};

// --- The file set is the whole context ------------------------------------------------------------

/**
 * Python and shell need nothing precomputed: `resolveImport` resolves them from the file list
 * alone, branching on the language itself. This is also the slot any language without an adapter
 * falls into, which is exactly what the builder did before — so a language whose imports are
 * extracted but whose resolver was never written keeps resolving only a specifier that is
 * literally a path in this repo, rather than silently resolving nothing.
 */
const fileSetAdapter = {
  id: "file-set",
  langs: ["python", "shell"],
  prepare: ({ fileSet }) => ({ fileSet }),
  resolve: (spec, from, { fileSet }) => one(resolveImport(spec, from.path, fileSet, from.lang)),
};

/** Every adapter, in a fixed order. Exported so a test can assert the slots it expects are filled. */
export const ADAPTERS = [
  jsAdapter,
  goAdapter,
  rustAdapter,
  javaAdapter,
  phpAdapter,
  rubyAdapter,
  fileSetAdapter,
];

/**
 * Prepare every language's context once, and hand back the single call the builder makes per
 * specifier.
 *
 * `readText(rel)` returns the repo file's text or null — injected, so this stays a pure function of
 * the file list and whatever that reader answers, which is what keeps the index deterministic and
 * what makes every derivation above testable without a temp tree.
 *
 * Every adapter is prepared, not just the ones whose languages are present. That is what the
 * builder did, it costs one pass over the file list per language, and a lazy slot would make the
 * order in which files are visited part of the answer.
 */
export function importResolver(files, root, readText) {
  const fileSet = new Set(files.map((f) => f.path));
  const env = { files, root, fileSet, readText };
  const slots = new Map();
  for (const adapter of ADAPTERS) {
    const ctx = adapter.prepare(env);
    for (const lang of adapter.langs) slots.set(lang, { adapter, ctx });
  }
  const fallback = { adapter: fileSetAdapter, ctx: { fileSet } };
  return {
    fileSet,
    /** @param {string} spec @param {{path: string, lang: string}} from @returns {string[]} */
    resolve(spec, from) {
      const { adapter, ctx } = slots.get(from.lang) ?? fallback;
      return adapter.resolve(spec, from, ctx);
    },
  };
}
