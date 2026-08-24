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

// `pub mod x;` and `pub(crate) mod x;` are how a library crate exposes its modules, so a pattern
// matching only bare `mod x;` misses precisely the public surface of every lib crate. In ripgrep that
// was three of the ignore crate's modules reported as unreferenced while lib.rs declared them.
const RUST_PATTERNS = [
  /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+crate::([\w:]+)/gm,
  /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm,
];

const SHELL_PATTERNS = [/^\s*(?:\.|source)\s+["']?([^\s"';]+)/gm];

// A shell script names its library through a variable far more often than by literal path — the
// portable idiom is `LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_cortex-lib.sh"` and then
// `. "$LIB"`. The specifier reaching the resolver is `$LIB`, which matches no file, so every script
// in a repo that uses it draws as isolated. In this repo six scripts source one library and the
// graph showed none of those edges: 28 of 30 shell files had no edge at all.
//
// One hop, same file, literal right-hand sides. Nothing is executed and nothing is chased: an
// assignment whose value is itself just another variable expands to that variable and stops there.
const SHELL_ASSIGN =
  /^[ \t]*(?:export[ \t]+|readonly[ \t]+|local[ \t]+|declare[ \t]+-\w+[ \t]+)?([A-Za-z_]\w*)=(.+?)[ \t]*$/gm;

/**
 * Variable → literal value, for the assignments a shell script makes to itself.
 * First assignment wins. A script that reassigns the same name is choosing between two files this
 * cannot tell apart, and the definition is nearly always the first one; picking deterministically
 * matters more than picking cleverly.
 */
export function shellAssignments(text) {
  const out = new Map();
  SHELL_ASSIGN.lastIndex = 0;
  let m;
  while ((m = SHELL_ASSIGN.exec(text)) !== null) if (!out.has(m[1])) out.set(m[1], m[2]);
  return out;
}

// Only a specifier that is ENTIRELY one variable. `$HERE/_helpers.sh` already resolves by prefix
// stripping, and a partial substitution there would replace a working answer with a guess.
function expandShellSpec(spec, assigns) {
  const m = spec.match(/^\$\{?([A-Za-z_]\w*)\}?$/);
  if (!m) return spec;
  const value = assigns.get(m[1]);
  if (!value) return spec;
  return value.replace(/^["']/, "").replace(/["']$/, "");
}

// `import a.b.C;` and `import static a.b.C.member;`. The static form names a member, not a file, so
// resolution shortens the path until it lands on one — same problem Rust `use` has.
const JAVA_PATTERNS = [/^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm];

// `use Slim\Routing\Route;` — grouped and aliased forms both start this way, and the alias after
// `as` is a local name rather than a path, so it is deliberately not captured.
const PHP_PATTERNS = [/^\s*use\s+(?:function\s+|const\s+)?\\?([A-Za-z_][\w\\]*)/gm];

// `require_relative 'x'` is path-relative; `require 'sinatra/base'` searches the load path, which in
// practice is lib/. Both are captured here and told apart at resolution by the leading marker.
const RUBY_PATTERNS = [
  /^\s*require_relative\s+['"]([^'"]+)['"]/gm,
  /^\s*require\s+['"]([^'"]+)['"]/gm,
];

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
    case "java":
      return collect(text, JAVA_PATTERNS);
    case "php":
      return collect(text, PHP_PATTERNS);
    case "ruby": {
      // Tagged so the resolver can tell a path-relative require_relative from a load-path require;
      // `require 'x'` and `require_relative 'x'` mean different files from the same directory.
      const rel = collect(text, [RUBY_PATTERNS[0]]).map((x) => `./${x}`);
      const abs = collect(text, [RUBY_PATTERNS[1]]);
      return [...rel, ...abs.filter((a) => !rel.includes(`./${a}`))];
    }
    case "shell": {
      const assigns = shellAssignments(text);
      return collect(text, SHELL_PATTERNS).map((s) => expandShellSpec(s, assigns));
    }
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
 * Parse a tsconfig/jsconfig. They are JSON with Comments — every generator TypeScript ships writes
 * `//` lines into them, and a real one in the wild had a trailing comma after its last `paths`
 * entry. `JSON.parse` rejects all of that, and a config Cortex cannot read is a repo whose graph is
 * mostly missing, so tolerate both rather than lose the file.
 *
 * Deliberately small: strings are respected so a `//` inside one survives, and nothing else is
 * interpreted. This is not a JSON parser, it is a preprocessor in front of one.
 */
export function parseJsonc(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      out += c;
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          out += text[i] + (text[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += text[i];
        if (text[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  // Trailing commas, once the strings that might contain one are already past.
  out = out.replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/**
 * Turn one parsed tsconfig into an alias table rooted at the repo.
 *
 * `configDir` is the tsconfig's own directory, root-relative ("" at the root). TypeScript resolves
 * `paths` against `baseUrl`, and against the config's own directory when there is no `baseUrl`
 * (allowed since TS 4.1). `baseUrl` alone also makes bare specifiers resolvable, which is why it is
 * returned even when `paths` is empty.
 */
export function tsAliasTable(json, configDir = "") {
  const co = json?.compilerOptions ?? {};
  const under = (p) => normalize([...configDir.split("/"), ...String(p).split("/")]).join("/");
  const baseUrl = co.baseUrl ? under(co.baseUrl) : configDir;
  const entries = [];
  for (const [key, targets] of Object.entries(co.paths ?? {})) {
    const list = [].concat(targets).map((t) => {
      const s = String(t);
      // A target starting with "./" or "../" is relative to the config; anything else hangs off
      // baseUrl. Both end up root-relative here, so the matcher never has to know which it was.
      return s.startsWith(".") ? under(s) : normalize([...baseUrl.split("/"), ...s.split("/")]).join("/");
    });
    entries.push({ key, targets: list, star: key.includes("*") });
  }
  // Longest literal prefix first: "@/payload-types" must beat "@/*", or the umbrella swallows it.
  entries.sort((a, b) => b.key.replace("*", "").length - a.key.replace("*", "").length);
  return { dir: configDir, baseUrl, entries };
}

// Try every extension and index form for an already root-relative base. Shared by the relative and
// the aliased paths so the two cannot drift into resolving differently.
function tryJsPath(base, fileSet) {
  for (const ext of JS_EXT) {
    if (fileSet.has(base + ext)) return base + ext;
  }
  for (const idx of JS_INDEX) {
    if (fileSet.has(base + idx)) return base + idx;
  }
  if (base.endsWith(".js")) {
    const stem = base.slice(0, -3);
    for (const ext of [".ts", ".tsx", ".mts"]) if (fileSet.has(stem + ext)) return stem + ext;
  }
  return null;
}

/**
 * Resolve a bare specifier through a tsconfig alias table, or null.
 *
 * Without this, a Next.js repo reads as an empty graph: on a real one, 428 imports were written
 * `@/components/…` against 104 relative ones, so the indexer saw about a fifth of the edges and
 * called 154 files orphans. The alias is declared in the repo, exactly like go.mod's module path
 * and composer.json's PSR-4 prefixes — reading it is not a guess.
 */
export function resolveTsAlias(spec, fileSet, table) {
  if (!spec || !table) return null;
  for (const { key, targets, star } of table.entries) {
    if (star) {
      const [head, tail = ""] = key.split("*");
      if (!spec.startsWith(head) || !spec.endsWith(tail)) continue;
      const captured = spec.slice(head.length, spec.length - tail.length);
      for (const t of targets) {
        const hit = tryJsPath(t.replace("*", captured), fileSet);
        if (hit) return hit;
      }
    } else if (spec === key) {
      for (const t of targets) {
        const hit = tryJsPath(t, fileSet);
        if (hit) return hit;
      }
    }
  }
  // `baseUrl` with no matching alias: TypeScript still resolves a bare specifier from it. Tried
  // last, so a real package is only shadowed when a file of that name genuinely exists in the repo.
  if (table.baseUrl !== undefined && !spec.startsWith(".")) {
    const base = normalize([...table.baseUrl.split("/"), ...spec.split("/")]).join("/");
    return tryJsPath(base, fileSet);
  }
  return null;
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
    for (const cand of cleaned === spec ? [spec] : [cleaned, spec]) {
      if (fileSet.has(cand)) return cand;
      const rel = joinRel(fromPath, cand);
      if (fileSet.has(rel)) return rel;
    }
    // A computed prefix — `$(cd "$(dirname …)" && pwd)/lib.sh` — cannot be resolved as written, but
    // the tail after the last slash is a real filename and in this idiom it is anchored to the
    // sourcing script's own directory. Tried last, and ONLY against that directory: a bare basename
    // matched against the whole repo would happily connect two unrelated `setup.sh` files.
    const tail = spec.slice(spec.lastIndexOf("/") + 1);
    if (/[$(]/.test(spec) && tail && tail !== spec) {
      const rel = joinRel(fromPath, tail);
      if (fileSet.has(rel)) return rel;
    }
    return null;
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
// Empty today: JS/TS, Python, Go and Rust all resolve. The set stays because the DISTINCTION is
// the point — the next language whose imports are extracted but not resolved must land here, or
// its reports will say "nothing depends on this" when they mean "I did not look".
export const UNRESOLVED_LANGUAGES = new Set([]);

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

/**
 * The directory a file's child modules live in.
 *
 * Rust's one real subtlety. A crate root (`lib.rs`, `main.rs`) and a `mod.rs` own the directory
 * they sit in, so `mod color;` in `src/lib.rs` means `src/color.rs`. Any other file owns a
 * subdirectory named after itself: the same line in `src/printer.rs` means `src/printer/color.rs`.
 * Getting this backwards resolves half a crate to the wrong place.
 */
function rustModuleDir(fromPath) {
  const i = fromPath.lastIndexOf("/");
  const dir = i < 0 ? "" : fromPath.slice(0, i);
  const base = fromPath.slice(i + 1).replace(/\.rs$/, "");
  if (base === "lib" || base === "main" || base === "mod") return dir;
  // A file sitting directly in tests/, benches/, examples/ or src/bin/ is its own crate root — cargo
  // compiles each one as a separate binary. So `mod util;` in tests/cli.rs means tests/util.rs, not
  // tests/cli/util.rs. Without this every integration test's helper module resolves to nothing.
  if (/(^|\/)(tests|benches|examples|src\/bin)$/.test(dir)) return dir;
  return dir ? `${dir}/${base}` : base;
}

/**
 * Resolve a Rust `mod x;` or `use crate::a::b` to a file.
 *
 * `crateRoots` is every crate's source directory, longest first — a workspace has one per member
 * (`crates/printer/src`), and `crate::` means the root of the crate the FILE belongs to, not the
 * workspace. Resolving against the workspace would send every crate's imports to the same place.
 *
 * A path is tried longest-first and then shortened, because `use crate::json::Printer` names a
 * TYPE inside `json.rs` — the last segment is usually a symbol, not a file, and only the filesystem
 * can say where the module stops and the item begins.
 *
 * The extractor cannot tell a `mod` from a `use` (both arrive as bare segments), so both readings
 * are tried. Every candidate must exist in `fileSet`, so a wrong reading resolves to nothing rather
 * than to an invented edge.
 */
/**
 * Java: a package IS a directory, so `import com.google.gson.internal.Excluder` is
 * `com/google/gson/internal/Excluder.java` beneath a source root.
 *
 * `sourceRoots` are the `src/main/java`-style prefixes, longest first. Everything outside them is a
 * third-party package: `java.util.List` is real but not a file here, and an invented edge for it is
 * indistinguishable from a true one.
 *
 * `import static a.b.C.method` names a member, so the path is shortened until it lands on a file.
 */
export function resolveJavaImport(spec, fileSet, sourceRoots = []) {
  if (!spec) return null;
  const segs = spec.split(".").filter(Boolean);
  for (let n = segs.length; n > 0; n--) {
    const rel = segs.slice(0, n).join("/") + ".java";
    for (const root of sourceRoots) {
      const cand = root ? `${root}/${rel}` : rel;
      if (fileSet.has(cand)) return cand;
    }
  }
  return null;
}

/**
 * PHP: PSR-4 maps a namespace prefix to a directory, and composer.json declares it. Manifest-driven
 * rather than guessed, which is the same reason Go reads go.mod.
 *
 * `prefixes` is [namespacePrefix, dir] pairs, longest prefix first — `Slim\Routing\` must beat
 * `Slim\` when both are declared. A namespace with no declared prefix is a vendor package.
 */
export function resolvePhpImport(spec, fileSet, prefixes = []) {
  if (!spec) return null;
  const ns = spec.replace(/^\\+/, "");
  for (const [prefix, dir] of prefixes) {
    if (!ns.startsWith(prefix)) continue;
    const rest = ns.slice(prefix.length).split("\\").filter(Boolean);
    if (!rest.length) continue;
    const base = [dir, ...rest].filter(Boolean).join("/");
    if (fileSet.has(`${base}.php`)) return `${base}.php`;
  }
  return null;
}

/**
 * Ruby: `require_relative 'x'` arrives tagged with `./` and resolves against the requiring file.
 * A bare `require 'sinatra/base'` searches the load path — in practice `lib/`, which is what gems
 * put on it — so that is tried, then the repo root. A gem name like `rack` matches neither and is
 * correctly external.
 */
export function resolveRubyImport(spec, fromPath, fileSet, loadPaths = []) {
  if (!spec) return null;
  if (spec.startsWith("./")) {
    const base = joinRel(fromPath, spec);
    return fileSet.has(`${base}.rb`) ? `${base}.rb` : fileSet.has(base) ? base : null;
  }
  for (const lp of loadPaths) {
    const cand = lp ? `${lp}/${spec}.rb` : `${spec}.rb`;
    if (fileSet.has(cand)) return cand;
  }
  return null;
}

export function resolveRustImport(spec, fromPath, fileSet, crateRoots = []) {
  if (!spec) return null;
  const segs = spec.split("::").filter(Boolean);
  if (!segs.length) return null;

  const tryPath = (base) => {
    for (const cand of [`${base}.rs`, `${base}/mod.rs`]) if (fileSet.has(cand)) return cand;
    return null;
  };

  // `mod x;` — a child of the importing file's module directory.
  const modDir = rustModuleDir(fromPath);
  const asMod = tryPath(modDir ? `${modDir}/${segs.join("/")}` : segs.join("/"));
  if (asMod) return asMod;

  // `use crate::…` — from the root of the crate this file belongs to.
  const root = crateRoots.find((r) => fromPath.startsWith(r + "/"));
  if (root === undefined) return null;
  for (let n = segs.length; n > 0; n--) {
    const hit = tryPath(`${root}/${segs.slice(0, n).join("/")}`);
    if (hit) return hit;
  }
  return null;
}
