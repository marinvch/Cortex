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

  // Go and Rust resolve through module systems Cortex does not model; only same-repo path-like
  // specifiers are attempted, and anything else is treated as external.
  if (fileSet.has(spec)) return spec;
  return null;
}
