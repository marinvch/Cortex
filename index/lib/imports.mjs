// Import extraction, per language family. Regex-based on purpose: a context manager must run on
// any repo without installing a parser toolchain per ecosystem. The cost is that dynamic or
// computed imports are missed — that is a known, documented limit, not a silent one.

const JS_PATTERNS = [
  /\bimport\s+[^'"()]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const PY_PATTERNS = [
  /^\s*from\s+([.\w]+)\s+import\s+/gm,
  /^\s*import\s+([.\w]+)/gm,
];

const GO_BLOCK = /import\s*\(([\s\S]*?)\)/g;
const GO_SINGLE = /^\s*import\s+"([^"]+)"/gm;

const RUST_PATTERNS = [/^\s*(?:pub\s+)?use\s+crate::([\w:]+)/gm, /^\s*mod\s+(\w+)\s*;/gm];

const SHELL_PATTERNS = [/^\s*(?:\.|source)\s+["']?([^\s"';]+)/gm];

function collect(text, patterns) {
  const out = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) if (m[1]) out.push(m[1]);
  }
  return out;
}

/** Raw import specifiers, exactly as written in the source. Resolution happens separately. */
export function extractImports(text, lang) {
  switch (lang) {
    case "javascript":
    case "typescript":
    case "vue":
    case "svelte":
      return collect(text, JS_PATTERNS);
    case "python":
      return collect(text, PY_PATTERNS);
    case "go": {
      const out = [];
      GO_BLOCK.lastIndex = 0;
      let m;
      while ((m = GO_BLOCK.exec(text)) !== null) {
        for (const line of m[1].split("\n")) {
          const q = line.match(/"([^"]+)"/);
          if (q) out.push(q[1]);
        }
      }
      out.push(...collect(text, [GO_SINGLE]));
      return out;
    }
    case "rust":
      return collect(text, RUST_PATTERNS);
    case "shell":
      return collect(text, SHELL_PATTERNS);
    default:
      return [];
  }
}

const JS_EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const JS_INDEX = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs"];

function normalize(parts) {
  const out = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out;
}

function joinRel(fromPath, spec) {
  const base = fromPath.split("/").slice(0, -1);
  return normalize([...base, ...spec.split("/")]).join("/");
}

/**
 * Resolve a specifier to a path inside the repo, or null when it is external (a package) or
 * unresolvable. `fileSet` is a Set of every root-relative path in the index.
 */
export function resolveImport(spec, fromPath, fileSet, lang) {
  if (!spec) return null;

  if (lang === "javascript" || lang === "typescript" || lang === "vue" || lang === "svelte") {
    if (!spec.startsWith(".")) return null; // bare specifier → external package
    const base = joinRel(fromPath, spec);
    for (const ext of JS_EXT) {
      const cand = base + ext;
      if (fileSet.has(cand)) return cand;
    }
    // A directory import resolves to its index file.
    for (const idx of JS_INDEX) {
      if (fileSet.has(base + idx)) return base + idx;
    }
    // TS source imported as .js — the common ESM-on-TypeScript case.
    if (base.endsWith(".js")) {
      const stem = base.slice(0, -3);
      for (const ext of [".ts", ".tsx", ".mts"]) if (fileSet.has(stem + ext)) return stem + ext;
    }
    return null;
  }

  if (lang === "python") {
    if (spec.startsWith(".")) {
      const up = spec.match(/^\.+/)[0].length;
      const rest = spec.slice(up).replace(/\./g, "/");
      const base = fromPath.split("/").slice(0, -up);
      const target = normalize([...base, ...rest.split("/")]).join("/");
      for (const cand of [`${target}.py`, `${target}/__init__.py`]) {
        if (fileSet.has(cand)) return cand;
      }
      return null;
    }
    const asPath = spec.replace(/\./g, "/");
    for (const cand of [`${asPath}.py`, `${asPath}/__init__.py`, `src/${asPath}.py`]) {
      if (fileSet.has(cand)) return cand;
    }
    return null;
  }

  if (lang === "shell") {
    const cleaned = spec.replace(/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\//, "");
    if (fileSet.has(cleaned)) return cleaned;
    const rel = joinRel(fromPath, cleaned);
    return fileSet.has(rel) ? rel : null;
  }

  // Go is resolved by the caller, which has the module path from go.mod — see resolveGoImport.
  // Rust still resolves through a module system Cortex does not model, so only a same-repo
  // path-like specifier is attempted and anything else is external.
  if (fileSet.has(spec)) return spec;
  return null;
}

/**
 * Languages whose imports Cortex extracts but cannot resolve to files.
 *
 * This is the difference between *I found no importers* and *I cannot read this language's
 * imports*, and it matters because every consumer of the graph phrases its output as the first.
 * Pointed at a real Rust workspace, the orphan finding called 59 of 130 files unreferenced and
 * `/cortex-impact` said nothing imported the crate's central type. Both were technically hedged
 * and both were useless — the report has to say it is blind rather than say it looked.
 */
export const UNRESOLVED_LANGUAGES = new Set(["rust"]);

/** The module path declared by a go.mod, or null. `module github.com/x/y` → `github.com/x/y`. */
export function goModulePath(goModText) {
  if (!goModText) return null;
  const m = goModText.match(/^\s*module\s+(\S+)/m);
  return m ? m[1] : null;
}

/**
 * Resolve a Go import to the files it pulls in.
 *
 * Go imports name a PACKAGE, and a package is a directory — so unlike every other language here
 * one specifier resolves to many files, and the function returns an array. `byDir` maps a
 * directory to its non-test .go files; the caller builds it once rather than rescanning per import.
 *
 * Only imports inside this module resolve. `github.com/other/pkg` is a real dependency but not a
 * file in this repo, and inventing an edge for it would be a lie the graph cannot distinguish from
 * a real one. Test files are excluded: importing a package does not give you its tests.
 */
export function resolveGoImport(spec, moduleName, byDir) {
  if (!spec || !moduleName) return [];
  let dir;
  if (spec === moduleName) dir = "";
  else if (spec.startsWith(moduleName + "/")) dir = spec.slice(moduleName.length + 1);
  else return []; // external package
  return byDir.get(dir) || [];
}
