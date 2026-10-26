// symbols.mjs — which functions a repo defines, and which of them call which.
//
// Built only when the parser add-on is installed (lib/parsers.mjs, docs/adr/0029); without it the
// index has no `symbols` section and every reader carries on. The spec is G4 of
// docs/specs/2026-10-25-code-graph-design.md.
//
// ## Two passes
//
// 1. **Extract, per file** (`extractFile`): a pure function of the file's text and its grammar. It
//    finds the definitions, the imports with the names they bind, the names bound in the file that
//    are not definitions, and every call site with the definition it sits in. Its result is what
//    the cache holds, so it may depend on nothing outside the file.
// 2. **Resolve, per repo** (`resolveSymbols`): each call is matched to definitions using the import
//    graph the index already has. This pass is cheap and always re-run, because a file's calls
//    resolve differently when another file changes.
//
// ## What a definition is
//
// A top-level function, a class, a method of a top-level class (`Class.method`, a class field
// holding a function included), and a top-level constant holding a function. The spec says
// exported constants; an unexported one is included too, because a call to it from the same file is
// the commonest call there is and would otherwise count as unresolved. A constant initialised by a
// call that is handed a function (`memo(() => …)`, `forwardRef(…)`, a store factory) counts as a
// function, since calling or rendering it is how it is used. Ids are `path#name` and
// `path#Class.method`. A function nested inside another is not a definition: it is a local name of
// the one it sits in. CommonJS `module.exports` assignments are not read.
//
// ## What a call is
//
// A call expression, a `new`, and a JSX element whose name is capitalised (rendering a component is
// calling it; `<div>` is not a call). Each records the definition it sits in, or the file itself
// for module-level code.
//
// ## Resolution, and the confidence each edge carries
//
// - **extracted**: the name is defined in the same file, or bound by an import Cortex resolved to a
//   file that defines it (following `export … from` and Python's import-then-reexport through
//   `__init__.py`, up to `MAX_HOPS`). `this.m()` / `self.m()` in a class that defines `m`, and
//   `ns.f()` through a namespace or module import, are extracted too.
// - **inferred**: the name is bound nowhere in the file, and exactly one file it imports defines it
//   (a star import, a global). A method reached through a class's stated base, one level up, is
//   inferred as well: an override in between would change the answer.
// - **ambiguous**: several candidates. All are kept.
// - **unresolved**, counted and not kept, by reason: `external` (bound by an import of a package),
//   `local` (a parameter or variable, not a definition), `member` (a method called on a value whose
//   type Cortex cannot know), `missing` (bound to a file in the repo that has no such definition),
//   `unknown` (bound nowhere Cortex can see: a builtin or a global).
//
// A local name always wins over a definition with the same name, so a parameter called `get` is
// never resolved to a function `get` in another file. Block scope is not modelled: a name bound
// anywhere in a function shadows for the whole function, which errs towards `local`.
//
// ## Go, Java and Rust (G5)
//
// Each extractor's own header, below, says what it reads. Resolution adds three things the JS and
// Python model has no need for:
//
// - **The package.** Go and Java files see the names of the other files in their package with no
//   import. Go's package is the directory; Java's comes from the index's resolver (`./Name`),
//   which already joins src/main/java and src/test/java. Such a call is extracted, and a Go method
//   on the receiver is found in whichever file of the package declares it.
// - **The declared type.** `x.m()` where `x` is a parameter, a local or (Java) a field declared as
//   `T` resolves to `T.m`: extracted on `T` itself, inferred through its stated base. This is what
//   makes Java's calls on injected collaborators visible; without it 6% of spring-petclinic's calls
//   resolved, with it 20%, every sampled edge correct.
// - **Paths and modules.** Rust's `crate::a::f()` is resolved as a `use` is, and `use crate::util;`
//   binds the module whole when the resolved file is `util.rs` or `util/mod.rs`.
//
// A Go call to a type (`Attr(1 << 8)`) is a conversion and is dropped uncounted. Java overloads
// share one id, the first declared. Validated on fzf, spring-petclinic and ripgrep, sixty sampled
// edges read against the source.
//
// ## Determinism
//
// The parser gives the same tree for the same text. Every list here is sorted by code unit before
// it is written, and the cache holds only pass 1, keyed by the file's text, the lock digest and
// `EXTRACTOR_VERSION`, so a cold build and a warm one write the same bytes.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { grammarFor } from "./parsers.mjs";

/**
 * The extractor's identity in the cache key: a digest of this module's own source. Any edit here,
 * however small, misses every cached extraction, so no one has to remember to bump a number. A CRLF
 * checkout digests differently and only costs a cold cache.
 */
export const EXTRACTOR_VERSION = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex").slice(0, 16);
/** How many re-exports resolution follows before it gives up. */
export const MAX_HOPS = 5;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// --- the tree, read the same way for every grammar -------------------------------------------

const line = (n) => n.startPosition.row + 1;
const field = (n, name) => n.childForFieldName(name);
const named = (n) => {
  const out = [];
  for (let i = 0; i < n.namedChildCount; i++) out.push(n.namedChild(i));
  return out;
};

const JS_FUNCTION = new Set([
  "function_declaration", "generator_function_declaration", "function_expression", "function",
  "generator_function", "arrow_function", "method_definition",
]);
const JS_FUNCTION_VALUE = new Set(["arrow_function", "function_expression", "function", "generator_function"]);
const JS_CLASS = new Set(["class_declaration", "abstract_class_declaration"]);
const PY_FUNCTION = new Set(["function_definition", "lambda"]);

/** The `objectType` field of a call on a value whose type was declared, or nothing. */
const typed = (type) => (type ? { objectType: type } : {});

/** Every identifier a binding pattern introduces: `a`, `{ b, c: d }`, `[e, ...f]`, `g = 1`. */
function patternNames(n, out = []) {
  if (!n) return out;
  switch (n.type) {
    case "identifier":
    case "shorthand_property_identifier_pattern":
      out.push(n.text);
      break;
    case "pair_pattern":
      patternNames(field(n, "value"), out);
      break;
    case "assignment_pattern":
    case "object_assignment_pattern":
      patternNames(field(n, "left"), out);
      break;
    case "required_parameter":
    case "optional_parameter":
      patternNames(field(n, "pattern"), out);
      break;
    // Python parameters and targets
    case "default_parameter":
    case "typed_default_parameter":
      patternNames(field(n, "name"), out);
      break;
    case "typed_parameter":
    case "list_splat_pattern":
    case "dictionary_splat_pattern":
    case "rest_pattern":
    case "object_pattern":
    case "array_pattern":
    case "pattern_list":
    case "tuple_pattern":
    case "list_pattern":
    case "formal_parameters":
    case "parameters":
    case "lambda_parameters":
      for (const c of named(n)) patternNames(c, out);
      break;
    default:
      break;
  }
  return out;
}

// --- pass 1: extract -------------------------------------------------------------------------

/**
 * Read one file's tree. Returns
 *
 *   defs         [{ name, kind, line, exported, default?, bases? }]   name is `f` or `Class.m`
 *   exports      [[local, exported]]                 an `export { a as b }` with no `from`
 *   imports      [{ spec, line, names: [[local, imported]], star? }]   imported is a name, `default` or `*`
 *   reexports    [{ spec, names: [[exported, imported]] | null }]     `export … from`; null is `export *`
 *   bound        names bound at module level that are not definitions or imports
 *   calls        [{ in, line, kind, name } | { in, line, kind, object, property }], `local` when shadowed
 *
 * Pure: the tree in, plain data out.
 */
export function extractFile(tree, grammar) {
  switch (grammar) {
    case "python": return extractPython(tree.rootNode);
    case "go": return extractGo(tree.rootNode);
    case "java": return extractJava(tree.rootNode);
    case "rust": return extractRust(tree.rootNode);
    default: return extractJs(tree.rootNode);
  }
}

function extractJs(root) {
  const defs = [];
  const exports = [];
  const imports = [];
  const reexports = [];
  const bound = new Set();
  const aliases = [];
  const defOf = new Map(); // node id → definition name, for the walk to know where it is
  const classOf = new Map(); // class node id → class name

  // `node` is where the definition's body starts, for the walk; `at` is the line a reader looks for,
  // the declaration's own, which differs when a typed arrow's parameters start on a later line.
  const addDef = (node, name, kind, exported, extra = {}, at = node) => {
    defs.push({ name, kind, line: line(at), exported, ...extra });
    defOf.set(node.id, name);
  };

  const readClass = (cls, exported, isDefault) => {
    const nameNode = field(cls, "name");
    if (!nameNode) return;
    const name = nameNode.text;
    const bases = [];
    for (const c of named(cls)) {
      if (c.type !== "class_heritage") continue;
      for (const h of named(c)) {
        const v = h.type === "extends_clause" ? field(h, "value") : h.type === "identifier" ? h : null;
        if (v?.type === "identifier") bases.push(v.text);
      }
    }
    addDef(cls, name, "class", exported, { ...(isDefault ? { default: true } : {}), ...(bases.length ? { bases } : {}) });
    classOf.set(cls.id, name);
    const body = field(cls, "body");
    for (const m of body ? named(body) : []) {
      const mName = field(m, "name");
      if (!mName || !/^(property_identifier|private_property_identifier|identifier)$/.test(mName.type)) continue;
      if (m.type === "method_definition") addDef(m, `${name}.${mName.text}`, "method", exported);
      else if ((m.type === "public_field_definition" || m.type === "field_definition") && JS_FUNCTION_VALUE.has(field(m, "value")?.type)) {
        addDef(field(m, "value"), `${name}.${mName.text}`, "method", exported, {}, m);
      }
    }
  };

  const holdsFunction = (value) => {
    if (!value) return false;
    if (JS_FUNCTION_VALUE.has(value.type)) return true;
    if (value.type === "call_expression") {
      const args = field(value, "arguments");
      return !!args && named(args).some((a) => JS_FUNCTION_VALUE.has(a.type));
    }
    return false;
  };

  const readDeclaration = (decl, exported, isDefault = false) => {
    if (!decl) return;
    if (decl.type === "function_declaration" || decl.type === "generator_function_declaration") {
      const n = field(decl, "name");
      if (n) addDef(decl, n.text, "function", exported, isDefault ? { default: true } : {});
      else if (isDefault) addDef(decl, "default", "function", true, { default: true });
    } else if (JS_CLASS.has(decl.type) || decl.type === "class") {
      if (field(decl, "name")) readClass(decl, exported, isDefault);
    } else if (decl.type === "lexical_declaration" || decl.type === "variable_declaration") {
      for (const v of named(decl)) {
        if (v.type !== "variable_declarator") continue;
        const n = field(v, "name");
        const raw = field(v, "value");
        const value = unwrapValue(raw);
        if (n?.type === "identifier" && holdsFunction(value)) {
          addDef(JS_FUNCTION_VALUE.has(value.type) ? value : v, n.text, "function", exported, {}, v);
        } else if (n?.type === "identifier" && aliasTarget(value)) {
          // `export const devtools = devtoolsImpl as Devtools`, or a callable object built with
          // `Object.assign(run, { … })`: a second name for a function, decided once every
          // definition in the file is known.
          aliases.push({ node: v, name: n.text, target: aliasTarget(value), exported });
        } else {
          const req = requireOf(raw);
          if (req) imports.push(requireImport(n, req, v));
          else for (const name of patternNames(n)) bound.add(name);
        }
      }
    }
  };

  for (const top of named(root)) {
    switch (top.type) {
      case "import_statement": {
        const src = field(top, "source");
        if (!src) break;
        const names = [];
        for (const clause of named(top)) {
          if (clause.type !== "import_clause") continue;
          for (const part of named(clause)) {
            if (part.type === "identifier") names.push([part.text, "default"]);
            else if (part.type === "namespace_import") {
              const id = named(part).find((c) => c.type === "identifier");
              if (id) names.push([id.text, "*"]);
            } else if (part.type === "named_imports") {
              for (const s of named(part)) {
                if (s.type !== "import_specifier") continue;
                const nm = field(s, "name");
                const alias = field(s, "alias");
                if (nm) names.push([(alias ?? nm).text, nm.text]);
              }
            }
          }
        }
        imports.push({ spec: stringValue(src), line: line(top), names });
        break;
      }
      case "export_statement": {
        const decl = field(top, "declaration");
        const value = field(top, "value");
        const isDefault = hasKeyword(top, "default");
        if (decl) readDeclaration(decl, true, isDefault);
        else if (value && isDefault) {
          if (value.type === "identifier") exports.push([value.text, "default"]);
          else if (JS_FUNCTION_VALUE.has(value.type)) addDef(value, field(value, "name")?.text ?? "default", "function", true, { default: true });
          else if (value.type === "class" && field(value, "name")) readClass(value, true, true);
        } else {
          const src = field(top, "source");
          const pairs = [];
          let clause = false;
          for (const c of named(top)) {
            if (c.type === "namespace_export") {
              // `export * as ns from "x"`: the module bound whole under one name.
              const id = named(c).find((x) => x.type === "identifier" || x.type === "string");
              if (id) pairs.push(["*", id.type === "string" ? stringValue(id) : id.text]);
              clause = true;
            }
            if (c.type !== "export_clause") continue;
            clause = true;
            for (const s of named(c)) {
              if (s.type !== "export_specifier") continue;
              const nm = field(s, "name");
              const alias = field(s, "alias");
              if (nm) pairs.push([nm.text, (alias ?? nm).text]);
            }
          }
          if (!src) for (const [local, exported] of pairs) exports.push([local, exported]);
          else reexports.push({ spec: stringValue(src), names: clause ? pairs.map(([imported, exported]) => [exported, imported]) : null });
        }
        break;
      }
      case "function_declaration":
      case "generator_function_declaration":
      case "class_declaration":
      case "abstract_class_declaration":
      case "lexical_declaration":
      case "variable_declaration":
        readDeclaration(top, false);
        break;
      default:
        break;
    }
  }

  // An alias of a function defined in this file is a definition; any other alias is a plain name.
  // An alias of an imported name is that import under a second name (`const test = anyTest as T`).
  const fnNames = new Set(defs.filter((d) => d.kind === "function").map((d) => d.name));
  for (const a of aliases) {
    const imp = fnNames.has(a.target) ? null : imports.find((i) => i.names.some(([local]) => local === a.target));
    if (fnNames.has(a.target)) addDef(a.node, a.name, "function", a.exported);
    else if (imp) imports.push({ spec: imp.spec, line: line(a.node), names: [[a.name, imp.names.find(([local]) => local === a.target)[1]]] });
    else bound.add(a.name);
  }

  // A local `export { a }` exports a definition declared without `export`.
  const exportedNames = new Set(exports.map(([local]) => local));
  for (const d of defs) if (!d.exported && exportedNames.has(d.name.split(".")[0])) d.exported = true;

  const imported = new Set(imports.flatMap((i) => i.names.map(([local]) => local)));
  const defNames = new Set(defs.map((d) => d.name));
  const calls = [];
  walk(root, {
    isFunction: (n) => JS_FUNCTION.has(n.type),
    locals: jsLocals,
    defOf,
    classOf,
    visit(n, ctx) {
      const at = (fields) => calls.push({ in: ctx.def, line: line(n), ...fields });
      if (n.type === "call_expression" || n.type === "new_expression") {
        const fn = field(n, n.type === "call_expression" ? "function" : "constructor");
        const kind = n.type === "new_expression" ? "new" : "call";
        const callee = jsCallee(fn);
        if (callee) at({ kind, ...callee, ...(callee.name && ctx.isLocal(callee.name) ? { local: true } : {}) });
        else at({ kind, dynamic: true });
      } else if (n.type === "jsx_opening_element" || n.type === "jsx_self_closing_element") {
        const nm = field(n, "name");
        if (nm?.type === "identifier" && /^[A-Z]/.test(nm.text)) {
          at({ kind: "jsx", name: nm.text, ...(ctx.isLocal(nm.text) ? { local: true } : {}) });
        } else if (nm?.type === "member_expression") {
          const callee = jsCallee(nm);
          if (callee) at({ kind: "jsx", ...callee });
        }
      }
    },
  });

  return finishExtraction({ defs, exports, imports, reexports, bound: [...bound].filter((b) => !imported.has(b) && !defNames.has(b)), calls });
}

/** The name a value is another name for: `x`, or the `x` in `Object.assign(x, …)`. Else null. */
function aliasTarget(value) {
  if (value?.type === "identifier") return value.text;
  if (value?.type === "call_expression" && field(value, "function")?.text === "Object.assign") {
    const first = unwrapValue(named(field(value, "arguments") ?? value)[0]);
    if (first?.type === "identifier") return first.text;
  }
  return null;
}

/** A value with its TypeScript assertions and parentheses taken off: `(x as T)`, `x satisfies T`, `x!`. */
function unwrapValue(n) {
  let v = n;
  for (let i = 0; v && i < 8; i++) {
    if (v.type === "as_expression" || v.type === "satisfies_expression" || v.type === "non_null_expression" || v.type === "parenthesized_expression") {
      v = v.namedChild(0);
    } else if (v.type === "type_assertion") {
      v = v.namedChild(v.namedChildCount - 1);
    } else break;
  }
  return v;
}

/** Whether a node has an unnamed child token of this type, such as `default` in `export default`. */
function hasKeyword(n, word) {
  for (let i = 0; i < n.childCount; i++) if (n.child(i).type === word) return true;
  return false;
}

/** The specifier of a CommonJS `require` of a string, when that is a variable's whole value; else null. */
function requireOf(value) {
  if (value?.type !== "call_expression") return null;
  const fn = field(value, "function");
  if (fn?.type !== "identifier" || fn.text !== "require") return null;
  const arg = named(field(value, "arguments") ?? value)[0];
  return arg?.type === "string" ? stringValue(arg) : null;
}

function requireImport(pattern, spec, at) {
  const names = [];
  if (pattern?.type === "identifier") names.push([pattern.text, "*"]);
  else if (pattern?.type === "object_pattern") {
    for (const p of named(pattern)) {
      if (p.type === "shorthand_property_identifier_pattern") names.push([p.text, p.text]);
      else if (p.type === "pair_pattern") {
        const key = field(p, "key");
        const value = field(p, "value");
        if (key && value?.type === "identifier") names.push([value.text, key.text]);
      }
    }
  }
  return { spec, line: line(at), names };
}

function stringValue(n) {
  const frag = named(n).find((c) => c.type === "string_fragment" || c.type === "string_content");
  return frag ? frag.text : n.text.replace(/^['"`]|['"`]$/g, "");
}

/** What a JS call names: `{ name }`, `{ object, property }`, or null for anything computed. */
function jsCallee(fn) {
  if (!fn) return null;
  if (fn.type === "identifier") return { name: fn.text };
  if (fn.type === "member_expression") {
    const obj = field(fn, "object");
    const prop = field(fn, "property");
    if (!prop || !/^(property_identifier|private_property_identifier)$/.test(prop.type)) return null;
    if (obj?.type === "this") return { object: "this", property: prop.text };
    const dotted = dottedText(obj);
    if (dotted) return { object: dotted, property: prop.text };
    return { object: null, property: prop.text };
  }
  return null;
}

/** `a`, `a.b`, `a.b.c` when every part is a plain name; null otherwise. */
function dottedText(n) {
  if (!n) return null;
  if (n.type === "identifier") return n.text;
  if (n.type === "member_expression" || n.type === "attribute") {
    const left = dottedText(field(n, "object"));
    const right = field(n, n.type === "attribute" ? "attribute" : "property");
    if (left && right && /identifier$/.test(right.type)) return `${left}.${right.text}`;
  }
  return null;
}

/** Names a JS function binds: its parameters, and every declaration in its body outside a nested function. */
function jsLocals(fn) {
  const out = new Set();
  const params = field(fn, "parameters") ?? field(fn, "parameter");
  for (const p of patternNames(params)) out.add(p);
  const body = field(fn, "body");
  if (!body) return out;
  const stack = [body];
  while (stack.length) {
    const n = stack.pop();
    switch (n.type) {
      case "variable_declarator":
        for (const p of patternNames(field(n, "name"))) out.add(p);
        break;
      case "function_declaration":
      case "generator_function_declaration":
      case "class_declaration": {
        const nm = field(n, "name");
        if (nm) out.add(nm.text);
        continue; // a nested function's own names are its business
      }
      case "catch_clause":
        for (const p of patternNames(field(n, "parameter"))) out.add(p);
        break;
      case "for_in_statement":
        for (const p of patternNames(field(n, "left"))) out.add(p);
        break;
      default:
        if (n !== body && JS_FUNCTION.has(n.type)) continue;
    }
    for (const c of named(n)) stack.push(c);
  }
  return out;
}

function extractPython(root) {
  const defs = [];
  const imports = [];
  const bound = new Set();
  const defOf = new Map();
  const classOf = new Map();
  const unwrap = (n) => (n.type === "decorated_definition" ? field(n, "definition") : n);
  const isPublic = (name) => !name.startsWith("_") || /^__\w+__$/.test(name);

  const readImport = (n) => {
    if (n.type === "import_statement") {
      for (const part of named(n)) {
        if (part.type === "dotted_name") imports.push({ spec: part.text, line: line(n), names: [[part.text, "*"]] });
        else if (part.type === "aliased_import") {
          const nm = field(part, "name");
          const alias = field(part, "alias");
          if (nm && alias) imports.push({ spec: nm.text, line: line(n), names: [[alias.text, "*"]] });
        }
        const first = (part.type === "aliased_import" ? null : part.text.split(".")[0]);
        if (first) bound.add(first);
      }
    } else if (n.type === "import_from_statement") {
      const mod = field(n, "module_name");
      if (!mod) return;
      const spec = mod.text.replace(/\s+/g, "");
      const names = [];
      let star = false;
      for (const part of named(n)) {
        if (part === mod || part.id === mod.id) continue;
        if (part.type === "wildcard_import") star = true;
        else if (part.type === "dotted_name") names.push([part.text, part.text]);
        else if (part.type === "aliased_import") {
          const nm = field(part, "name");
          const alias = field(part, "alias");
          if (nm && alias) names.push([alias.text, nm.text]);
        }
      }
      imports.push({ spec, line: line(n), names, ...(star ? { star: true } : {}) });
    }
  };

  // Module-level statements, including those inside a top-level `if`/`try`/`with`: definitions there
  // are still module definitions (`if TYPE_CHECKING:`, a fallback import in `try`).
  const moduleStatements = [];
  const stack = named(root).reverse();
  while (stack.length) {
    const n = stack.pop();
    if (["if_statement", "try_statement", "with_statement", "else_clause", "elif_clause", "except_clause", "finally_clause", "block"].includes(n.type)) {
      stack.push(...named(n).reverse());
      continue;
    }
    moduleStatements.push(n);
  }

  for (const top of moduleStatements) {
    const n = unwrap(top);
    if (!n) continue;
    if (n.type === "function_definition") {
      const nm = field(n, "name");
      if (nm) {
        defs.push({ name: nm.text, kind: "function", line: line(n), exported: isPublic(nm.text) });
        defOf.set(n.id, nm.text);
      }
    } else if (n.type === "class_definition") {
      const nm = field(n, "name");
      if (!nm) continue;
      const cls = nm.text;
      const bases = [];
      const supers = field(n, "superclasses");
      for (const b of supers ? named(supers) : []) {
        const d = dottedText(b);
        if (d) bases.push(d);
      }
      defs.push({ name: cls, kind: "class", line: line(n), exported: isPublic(cls), ...(bases.length ? { bases } : {}) });
      defOf.set(n.id, cls);
      classOf.set(n.id, cls);
      const body = field(n, "body");
      for (const m of body ? named(body) : []) {
        const fn = unwrap(m);
        if (fn?.type !== "function_definition") continue;
        const mn = field(fn, "name");
        if (!mn) continue;
        defs.push({ name: `${cls}.${mn.text}`, kind: "method", line: line(fn), exported: isPublic(cls) });
        defOf.set(fn.id, `${cls}.${mn.text}`);
      }
    } else if (n.type === "import_statement" || n.type === "import_from_statement") {
      readImport(n);
    } else if (n.type === "expression_statement") {
      for (const a of named(n)) {
        if (a.type !== "assignment") continue;
        const left = field(a, "left");
        const right = field(a, "right");
        if (left?.type === "identifier" && right?.type === "lambda") {
          defs.push({ name: left.text, kind: "function", line: line(a), exported: isPublic(left.text) });
          defOf.set(right.id, left.text);
        } else {
          for (const p of patternNames(left)) bound.add(p);
        }
      }
    }
  }

  const imported = new Set(imports.flatMap((i) => i.names.map(([local]) => local)));
  const defNames = new Set(defs.map((d) => d.name));
  const calls = [];
  walk(root, {
    isFunction: (n) => PY_FUNCTION.has(n.type),
    locals: pyLocals,
    defOf,
    classOf,
    visit(n, ctx) {
      if (n.type !== "call") return;
      const fn = field(n, "function");
      const at = (fields) => calls.push({ in: ctx.def, line: line(n), kind: "call", ...fields });
      if (fn?.type === "identifier") {
        at({ name: fn.text, ...(ctx.isLocal(fn.text) ? { local: true } : {}) });
      } else if (fn?.type === "attribute") {
        const obj = field(fn, "object");
        const attr = field(fn, "attribute");
        if (!attr) return at({ dynamic: true });
        if (obj?.type === "identifier" && (obj.text === "self" || obj.text === "cls") && ctx.cls) {
          at({ object: "this", property: attr.text });
        } else {
          const dotted = dottedText(obj);
          at({ object: dotted && !ctx.isLocal(dotted.split(".")[0]) ? dotted : null, property: attr.text });
        }
      } else {
        at({ dynamic: true });
      }
    },
  });

  return finishExtraction({ defs, exports: [], imports, reexports: [], bound: [...bound].filter((b) => !imported.has(b) && !defNames.has(b)), calls });
}

/** Names a Python function binds, except those it declares `global` or `nonlocal`. */
function pyLocals(fn) {
  const out = new Set();
  const outer = new Set();
  for (const p of patternNames(field(fn, "parameters"))) out.add(p);
  const body = field(fn, "body");
  if (!body) return out;
  const stack = [body];
  while (stack.length) {
    const n = stack.pop();
    switch (n.type) {
      case "assignment":
      case "augmented_assignment":
        for (const p of patternNames(field(n, "left"))) out.add(p);
        break;
      case "for_statement":
      case "for_in_clause":
        for (const p of patternNames(field(n, "left"))) out.add(p);
        break;
      case "named_expression": {
        const nm = field(n, "name");
        if (nm) out.add(nm.text);
        break;
      }
      case "as_pattern_target":
        for (const p of patternNames(named(n)[0])) out.add(p);
        break;
      case "as_pattern": {
        const alias = field(n, "alias");
        if (alias) for (const p of patternNames(alias.type === "as_pattern_target" ? named(alias)[0] : alias)) out.add(p);
        break;
      }
      case "function_definition":
      case "class_definition": {
        const nm = field(n, "name");
        if (nm) out.add(nm.text);
        continue;
      }
      case "import_statement":
      case "import_from_statement":
        for (const part of named(n)) {
          if (part.type === "aliased_import") out.add(field(part, "alias")?.text ?? "");
          else if (part.type === "dotted_name" && part !== field(n, "module_name")) out.add(part.text.split(".")[0]);
        }
        break;
      case "global_statement":
      case "nonlocal_statement":
        for (const c of named(n)) if (c.type === "identifier") outer.add(c.text);
        break;
      default:
        if (n !== body && PY_FUNCTION.has(n.type)) continue;
    }
    for (const c of named(n)) stack.push(c);
  }
  for (const o of outer) out.delete(o);
  out.delete("");
  return out;
}

// --- Go ------------------------------------------------------------------------------------------
//
// A package is a directory, so a file sees every top-level name of the other files beside it with
// no import; resolution adds that (`samePackage`). An import binds the package whole, under its
// alias or the last segment of its path (a `/v2` major-version suffix skipped). Exported means a
// capital first letter. A method is `Type.Method` whatever its receiver's pointer or type
// parameters, and a call on the receiver variable is a call on `this`.

const GO_FUNCTION = new Set(["function_declaration", "method_declaration", "func_literal"]);
// A call whose callee is a type is a conversion, `[]byte(s)`, not a call.
const GO_TYPE_CALLEE = new Set(["array_type", "slice_type", "map_type", "pointer_type", "channel_type", "function_type", "interface_type", "struct_type", "parenthesized_type"]);

function goReceiver(recv) {
  const p = recv ? named(recv).find((c) => c.type === "parameter_declaration") : null;
  if (!p) return { type: null, name: null };
  let t = field(p, "type");
  while (t && t.type !== "type_identifier") {
    if (t.type === "pointer_type" || t.type === "parenthesized_type") t = named(t)[0];
    else if (t.type === "generic_type") t = field(t, "type");
    else t = null;
  }
  return { type: t?.text ?? null, name: field(p, "name")?.text ?? null };
}

/** A Go import path's default local name: its last segment, skipping a `v2`-style suffix. */
function goPackageName(spec) {
  const segs = spec.split("/").filter(Boolean);
  const last = segs.pop() ?? spec;
  return /^v\d+$/.test(last) && segs.length ? segs.pop() : last;
}

function extractGo(root) {
  const defs = [];
  const imports = [];
  const bound = new Set();
  const defOf = new Map();
  const receiverOf = new Map(); // method name → its receiver variable
  const exported = (name) => /^[A-Z]/.test(name);

  for (const n of named(root)) {
    if (n.type === "function_declaration") {
      const nm = field(n, "name");
      if (!nm) continue;
      defs.push({ name: nm.text, kind: "function", line: line(n), exported: exported(nm.text) });
      defOf.set(n.id, nm.text);
    } else if (n.type === "method_declaration") {
      const nm = field(n, "name");
      const recv = goReceiver(field(n, "receiver"));
      if (!nm || !recv.type) continue;
      const name = `${recv.type}.${nm.text}`;
      defs.push({ name, kind: "method", line: line(n), exported: exported(nm.text) });
      defOf.set(n.id, name);
      if (recv.name) receiverOf.set(name, recv.name);
    } else if (n.type === "type_declaration") {
      for (const spec of named(n)) {
        const nm = spec.type === "type_spec" || spec.type === "type_alias" ? field(spec, "name") : null;
        if (nm) defs.push({ name: nm.text, kind: "type", line: line(spec), exported: exported(nm.text) });
      }
    } else if (n.type === "import_declaration") {
      const stack = named(n);
      while (stack.length) {
        const s = stack.pop();
        if (s.type === "import_spec_list") { stack.push(...named(s)); continue; }
        if (s.type !== "import_spec") continue;
        const path = field(s, "path");
        const alias = field(s, "name");
        if (!path) continue;
        // `_` binds nothing, and `.` spills every name into the file, which this does not model.
        if (alias && (alias.type === "blank_identifier" || alias.type === "dot")) continue;
        const spec = path.text.slice(1, -1);
        imports.push({ spec, line: line(s), names: [[alias ? alias.text : goPackageName(spec), "*"]] });
      }
    } else if (n.type === "var_declaration" || n.type === "const_declaration") {
      const stack = named(n);
      while (stack.length) {
        const s = stack.pop();
        if (s.type === "var_spec_list") { stack.push(...named(s)); continue; }
        if (s.type === "var_spec" || s.type === "const_spec") for (const c of named(s)) if (c.type === "identifier") bound.add(c.text);
      }
    }
  }
  imports.sort((a, b) => a.line - b.line || byCodeUnit(a.spec, b.spec));

  const calls = [];
  walk(root, {
    isFunction: (n) => GO_FUNCTION.has(n.type),
    locals: goLocals,
    defOf,
    classOf: new Map(),
    visit(n, ctx) {
      if (n.type !== "call_expression") return;
      let fn = field(n, "function");
      if (fn?.type === "generic_function" || fn?.type === "index_expression") fn = field(fn, "function") ?? field(fn, "operand") ?? fn;
      if (!fn || GO_TYPE_CALLEE.has(fn.type)) return;
      const at = (fields) => calls.push({ in: ctx.def, line: line(n), kind: "call", ...fields });
      if (fn.type === "identifier") return at({ name: fn.text, ...(ctx.isLocal(fn.text) ? { local: true } : {}) });
      if (fn.type === "selector_expression") {
        const operand = field(fn, "operand");
        const prop = field(fn, "field");
        if (!prop) return at({ dynamic: true });
        if (operand?.type === "identifier") {
          if (ctx.def && receiverOf.get(ctx.def) === operand.text) return at({ object: "this", property: prop.text });
          if (ctx.isLocal(operand.text)) return at({ object: null, property: prop.text, ...typed(ctx.typeOf(operand.text)) });
          return at({ object: operand.text, property: prop.text });
        }
        return at({ object: null, property: prop.text });
      }
      at({ dynamic: true });
    },
  });

  const imported = new Set(imports.flatMap((i) => i.names.map(([local]) => local)));
  const defNames = new Set(defs.map((d) => d.name));
  return finishExtraction({ defs, exports: [], imports, reexports: [], bound: [...bound].filter((b) => !imported.has(b) && !defNames.has(b)), calls });
}

/** Names a Go function binds: receiver, parameters, named results, and declarations in its body. */
/** A declared Go type as a name: `*T`, `T[K]` → `T`; `pkg.T` stays qualified. Others are null. */
function goTypeName(t) {
  while (t && (t.type === "pointer_type" || t.type === "parenthesized_type")) t = named(t)[0];
  if (!t) return null;
  if (t.type === "type_identifier") return t.text;
  if (t.type === "qualified_type") return t.text.replace(/\s+/g, "");
  if (t.type === "generic_type") return goTypeName(field(t, "type"));
  return null;
}

/** Names a Go function binds, each with its declared type where it has one: a Map. */
function goLocals(fn) {
  const out = new Map();
  const params = (list) => {
    for (const p of list ? named(list) : []) {
      const type = goTypeName(field(p, "type"));
      for (const c of named(p)) if (c.type === "identifier") out.set(c.text, type);
    }
  };
  params(field(fn, "receiver"));
  params(field(fn, "parameters"));
  const result = field(fn, "result");
  if (result?.type === "parameter_list") params(result);
  const body = field(fn, "body");
  const stack = body ? [body] : [];
  while (stack.length) {
    const n = stack.pop();
    if (n !== body && GO_FUNCTION.has(n.type)) continue;
    if (n.type === "short_var_declaration" || n.type === "range_clause") {
      const left = field(n, "left");
      for (const c of left ? named(left) : []) if (c.type === "identifier") out.set(c.text, null);
    } else if (n.type === "var_spec" || n.type === "const_spec") {
      const type = goTypeName(field(n, "type"));
      for (const c of named(n)) if (c.type === "identifier") out.set(c.text, type);
    } else if (n.type === "type_switch_statement") {
      const alias = field(n, "alias");
      for (const c of alias ? named(alias) : []) if (c.type === "identifier") out.set(c.text, null);
    }
    for (const c of named(n)) stack.push(c);
  }
  return out;
}

// --- Java ----------------------------------------------------------------------------------------
//
// A definition is a top-level type (class, interface, enum, record) and its methods, a constructor
// being `Type.constructor`. A nested type is not one, as in JS. An unqualified call is a call on
// `this`, unless a static import names it. `new Pet()` is a call to the class. A class in the same
// package needs no import, which resolution adds. Exported means not `private`: package-private
// types and members are reachable from the whole package.

const JAVA_FUNCTION = new Set(["method_declaration", "constructor_declaration", "compact_constructor_declaration", "lambda_expression"]);
const JAVA_TYPE = new Set(["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"]);

function javaPrivate(n) {
  const mods = named(n).find((c) => c.type === "modifiers");
  return Boolean(mods && /\bprivate\b/.test(mods.text));
}

/** The plain name of a Java type node: `Pet`, `a.b.Pet`, `List<Pet>` → `Pet`, `a.b.Pet`, `List`. */
function javaTypeName(t) {
  if (!t) return null;
  if (t.type === "type_identifier" || t.type === "identifier") return t.text;
  if (t.type === "generic_type") return javaTypeName(named(t)[0]);
  if (t.type === "scoped_type_identifier") return javaTypeName(named(t).at(-1));
  return null;
}

function extractJava(root) {
  const defs = [];
  const imports = [];
  const defOf = new Map();
  const classOf = new Map();
  const statics = new Set();
  const fieldTypes = new Map(); // class → Map(field → declared type)

  // A definition's line is its name's, not the first annotation's above it.
  const member = (cls, m, clsExported) => {
    if (m.type === "field_declaration") {
      const type = javaTypeName(field(m, "type"));
      for (const d of named(m)) if (d.type === "variable_declarator" && field(d, "name")) fieldTypes.get(cls).set(field(d, "name").text, type);
      return;
    }
    let name = null;
    if (m.type === "method_declaration") name = field(m, "name")?.text;
    else if (m.type === "constructor_declaration" || m.type === "compact_constructor_declaration") name = "constructor";
    if (!name) return;
    const id = `${cls}.${name}`;
    defs.push({ name: id, kind: "method", line: line(field(m, "name") ?? m), exported: clsExported && !javaPrivate(m) });
    defOf.set(m.id, id);
  };

  for (const n of named(root)) {
    if (n.type === "import_declaration") {
      const target = named(n).find((c) => c.type === "scoped_identifier" || c.type === "identifier");
      if (!target || named(n).some((c) => c.type === "asterisk")) continue; // a wildcard binds no name
      const segs = target.text.split(".");
      const name = segs.at(-1);
      if (/^import\s+static\b/.test(n.text)) {
        if (segs.length < 2) continue;
        imports.push({ spec: target.text, line: line(n), names: [[name, `${segs.at(-2)}.${name}`]] });
        statics.add(name);
      } else {
        imports.push({ spec: target.text, line: line(n), names: [[name, name]] });
      }
    } else if (JAVA_TYPE.has(n.type)) {
      const nm = field(n, "name");
      if (!nm) continue;
      const cls = nm.text;
      const exported = !javaPrivate(n);
      const superclass = named(n).find((c) => c.type === "superclass");
      const base = superclass ? javaTypeName(named(superclass)[0]) : null;
      defs.push({ name: cls, kind: "class", line: line(nm), exported, ...(base ? { bases: [base] } : {}) });
      defOf.set(n.id, cls);
      classOf.set(n.id, cls);
      fieldTypes.set(cls, new Map());
      const body = field(n, "body");
      for (const m of body ? named(body) : []) {
        if (m.type === "enum_body_declarations") for (const e of named(m)) member(cls, e, exported);
        else member(cls, m, exported);
      }
    }
  }

  const calls = [];
  walk(root, {
    isFunction: (n) => JAVA_FUNCTION.has(n.type),
    locals: javaLocals,
    defOf,
    classOf,
    visit(n, ctx) {
      const at = (fields) => calls.push({ in: ctx.def, line: line(n), ...fields });
      if (n.type === "object_creation_expression") {
        const name = javaTypeName(field(n, "type"));
        if (name) at({ kind: "new", name, ...(ctx.isLocal(name) ? { local: true } : {}) });
        return;
      }
      if (n.type !== "method_invocation") return;
      const obj = field(n, "object");
      const nm = field(n, "name");
      if (!nm) return;
      if (!obj) {
        if (statics.has(nm.text) || !ctx.cls) return at({ kind: "call", name: nm.text });
        return at({ kind: "call", object: "this", property: nm.text });
      }
      if (obj.type === "this") return at({ kind: "call", object: "this", property: nm.text });
      // A local, a parameter or a field of this class is a value of its declared type.
      const fieldType = (name) => (ctx.cls ? fieldTypes.get(ctx.cls)?.get(name) ?? null : null);
      if (obj.type === "identifier") {
        if (ctx.isLocal(obj.text)) return at({ kind: "call", object: null, property: nm.text, ...typed(ctx.typeOf(obj.text)) });
        if (ctx.cls && fieldTypes.get(ctx.cls)?.has(obj.text)) return at({ kind: "call", object: null, property: nm.text, ...typed(fieldType(obj.text)) });
        return at({ kind: "call", object: obj.text, property: nm.text });
      }
      if (obj.type === "field_access" && field(obj, "object")?.type === "this") {
        return at({ kind: "call", object: null, property: nm.text, ...typed(fieldType(field(obj, "field")?.text)) });
      }
      at({ kind: "call", object: null, property: nm.text });
    },
  });

  return finishExtraction({ defs, exports: [], imports, reexports: [], bound: [], calls });
}

/** Names a Java method or lambda binds: parameters, local variables, loop and catch variables. */
function javaLocals(fn) {
  const out = new Map();
  // `var x = …` declares no type; neither does a lambda parameter written without one.
  const declared = (t) => {
    const name = javaTypeName(t);
    return name && name !== "var" ? name : null;
  };
  const stack = [fn];
  while (stack.length) {
    const n = stack.pop();
    if (n !== fn && (JAVA_FUNCTION.has(n.type) || JAVA_TYPE.has(n.type))) continue;
    if (n.type === "formal_parameter" || n.type === "spread_parameter" || n.type === "catch_formal_parameter" || n.type === "enhanced_for_statement") {
      const type = declared(field(n, "type"));
      const nm = field(n, "name");
      if (nm) out.set(nm.text, type);
      for (const c of named(n)) if (c.type === "variable_declarator" && field(c, "name")) out.set(field(c, "name").text, type);
    } else if (n.type === "variable_declarator") {
      const nm = field(n, "name");
      if (nm && !out.has(nm.text)) out.set(nm.text, n.parent?.type === "local_variable_declaration" ? declared(field(n.parent, "type")) : null);
    } else if (n.type === "lambda_expression") {
      const p = field(n, "parameters");
      if (p?.type === "identifier") out.set(p.text, null);
      for (const c of p ? named(p) : []) {
        if (c.type === "identifier") out.set(c.text, null);
        else if (c.type === "formal_parameter" && field(c, "name")) out.set(field(c, "name").text, declared(field(c, "type")));
      }
    }
    for (const c of named(n)) stack.push(c);
  }
  return out;
}

// --- Rust ----------------------------------------------------------------------------------------
//
// A definition is a top-level `fn`, a type (`struct`, `enum`, `union`, `trait`, `type`), and the
// functions of an `impl` or a trait's default methods, as `Type.method`. Exported means `pub` in any
// form, or a trait impl's method. `use crate::a::b` binds `b` and is handed to the index's resolver
// as `a::b`; `mod a;` binds the module whole. A `use` through `super::` or `self::` binds nothing
// here, so such a call falls back to the names of the files this one imports. `self.m()` and
// `Self::m()` are calls on `this`; `Type::f()` and `module::f()` are member calls. Macros are not
// calls.

const RUST_FUNCTION = new Set(["function_item", "closure_expression"]);
const RUST_TYPE = new Set(["struct_item", "enum_item", "union_item", "type_item", "trait_item"]);

const rustPub = (n) => named(n).some((c) => c.type === "visibility_modifier");

/** The plain name of a Rust type node: `S`, `S<T>`, `a::S` → `S`. */
function rustTypeName(t) {
  if (!t) return null;
  if (t.type === "type_identifier") return t.text;
  if (t.type === "generic_type") return rustTypeName(field(t, "type"));
  if (t.type === "scoped_type_identifier") return field(t, "name")?.text ?? null;
  if (t.type === "reference_type") return rustTypeName(field(t, "type"));
  return null;
}

function extractRust(root) {
  const defs = [];
  const imports = [];
  const bound = new Set();
  const defOf = new Map();

  const addUse = (full, local, at) => {
    if (!local || /^(super|self)::/.test(full) || full === "self" || full === "super") return;
    const spec = full.startsWith("crate::") ? full.slice("crate::".length) : full;
    if (!spec || spec === "crate") return;
    imports.push({ spec, line: at, names: [[local, full.split("::").pop()]] });
  };
  const join = (prefix, path) => (prefix ? `${prefix}::${path}` : path);
  const readUse = (n, prefix, at) => {
    if (!n) return;
    switch (n.type) {
      case "identifier":
      case "scoped_identifier":
        addUse(join(prefix, n.text), n.text.split("::").pop(), at);
        break;
      case "self":
        addUse(prefix, prefix.split("::").pop(), at);
        break;
      case "use_as_clause": {
        const path = field(n, "path");
        const alias = field(n, "alias");
        if (path && alias) addUse(join(prefix, path.text), alias.text, at);
        break;
      }
      case "scoped_use_list": {
        const path = field(n, "path");
        readUse(field(n, "list"), path ? join(prefix, path.text) : prefix, at);
        break;
      }
      case "use_list":
        for (const c of named(n)) readUse(c, prefix, at);
        break;
      default:
        break; // a glob binds no name
    }
  };

  const method = (type, fnNode, isExported) => {
    const nm = field(fnNode, "name");
    if (!nm) return;
    const name = `${type}.${nm.text}`;
    defs.push({ name, kind: "method", line: line(fnNode), exported: isExported });
    defOf.set(fnNode.id, name);
  };

  for (const n of named(root)) {
    if (n.type === "function_item") {
      const nm = field(n, "name");
      if (!nm) continue;
      defs.push({ name: nm.text, kind: "function", line: line(n), exported: rustPub(n) });
      defOf.set(n.id, nm.text);
    } else if (RUST_TYPE.has(n.type)) {
      const nm = field(n, "name");
      if (!nm) continue;
      defs.push({ name: nm.text, kind: "type", line: line(n), exported: rustPub(n) });
      if (n.type === "trait_item") {
        for (const m of named(field(n, "body") ?? n)) if (m.type === "function_item") method(nm.text, m, rustPub(n));
      }
    } else if (n.type === "impl_item") {
      const type = rustTypeName(field(n, "type"));
      if (!type) continue;
      const ofTrait = Boolean(field(n, "trait"));
      for (const m of named(field(n, "body") ?? n)) if (m.type === "function_item") method(type, m, ofTrait || rustPub(m));
    } else if (n.type === "use_declaration") {
      readUse(field(n, "argument"), "", line(n));
    } else if (n.type === "mod_item" && !field(n, "body")) {
      const nm = field(n, "name");
      if (nm) imports.push({ spec: nm.text, line: line(n), names: [[nm.text, "*"]] });
    } else if (n.type === "const_item" || n.type === "static_item") {
      const nm = field(n, "name");
      if (nm) bound.add(nm.text);
    }
  }

  const calls = [];
  walk(root, {
    isFunction: (n) => RUST_FUNCTION.has(n.type),
    locals: rustLocals,
    defOf,
    classOf: new Map(),
    visit(n, ctx) {
      if (n.type !== "call_expression") return;
      let fn = field(n, "function");
      if (fn?.type === "generic_function") fn = field(fn, "function");
      const at = (fields) => calls.push({ in: ctx.def, line: line(n), kind: "call", ...fields });
      if (!fn) return;
      if (fn.type === "identifier") return at({ name: fn.text, ...(ctx.isLocal(fn.text) ? { local: true } : {}) });
      if (fn.type === "field_expression") {
        const value = field(fn, "value");
        const prop = field(fn, "field");
        if (!prop) return at({ dynamic: true });
        if (value?.type === "self") return at({ object: "this", property: prop.text });
        if (value?.type === "identifier") {
          if (ctx.isLocal(value.text)) return at({ object: null, property: prop.text, ...typed(ctx.typeOf(value.text)) });
          return at({ object: value.text, property: prop.text });
        }
        return at({ object: null, property: prop.text });
      }
      if (fn.type === "scoped_identifier") {
        const path = field(fn, "path");
        const nm = field(fn, "name");
        if (!nm) return at({ dynamic: true });
        if (!path) return at({ name: nm.text });
        const p = path.type === "generic_type" ? rustTypeName(path) : path.text;
        if (p === "Self") return at({ object: "this", property: nm.text });
        if (p && /^[\w:]+$/.test(p)) return at({ object: p, property: nm.text });
        return at({ object: null, property: nm.text });
      }
      at({ dynamic: true });
    },
  });

  const imported = new Set(imports.flatMap((i) => i.names.map(([local]) => local)));
  const defNames = new Set(defs.map((d) => d.name));
  return finishExtraction({ defs, exports: [], imports, reexports: [], bound: [...bound].filter((b) => !imported.has(b) && !defNames.has(b)), calls });
}

/** Names a Rust function or closure binds: parameters and `let`, `for`, `if let` and match patterns. */
function rustLocals(fn) {
  const out = new Map();
  // A plain `x: T` pattern takes the declared type; anything destructured has none Cortex can name.
  const names = (p, type = null) => {
    if (p?.type === "identifier") return void out.set(p.text, type);
    const stack = p ? [p] : [];
    while (stack.length) {
      const n = stack.pop();
      if (n.type === "identifier") out.set(n.text, null);
      // A path in a pattern (`Some(x)`, `Kind::A`) names a variant, not a binding.
      else if (n.type === "scoped_identifier" || n.type === "type_identifier") continue;
      else for (const c of named(n)) stack.push(c);
    }
  };
  for (const p of named(field(fn, "parameters") ?? fn)) {
    if (p.type === "parameter") names(field(p, "pattern"), rustTypeName(field(p, "type")));
    else if (fn.type === "closure_expression") names(p);
  }
  const body = field(fn, "body");
  const stack = body ? [body] : [];
  while (stack.length) {
    const n = stack.pop();
    if (n !== body && RUST_FUNCTION.has(n.type)) continue;
    if (n.type === "let_declaration") names(field(n, "pattern"), rustTypeName(field(n, "type")));
    else if (n.type === "let_condition") names(field(n, "pattern"));
    else if (n.type === "for_expression") names(field(n, "pattern"));
    else if (n.type === "match_pattern") names(n);
    for (const c of named(n)) stack.push(c);
  }
  return out;
}

/**
 * Walk the whole tree once, depth first, carrying where each node sits: the definition it is in,
 * the class it is in, and the local names of every function around it.
 */
function walk(root, { isFunction, locals, defOf, classOf, visit }) {
  const top = { def: null, cls: null, scopes: [] };
  const stack = [[root, top]];
  while (stack.length) {
    const [n, outer] = stack.pop();
    let ctx = outer;
    const def = defOf.get(n.id);
    const cls = classOf.get(n.id);
    if (def !== undefined || cls !== undefined || isFunction(n)) {
      ctx = {
        def: def !== undefined ? def : outer.def,
        cls: cls !== undefined ? cls : outer.cls,
        scopes: isFunction(n) ? [...outer.scopes, locals(n)] : outer.scopes,
      };
    }
    if (!ctx.isLocal) {
      const scopes = ctx.scopes;
      ctx.isLocal = (name) => scopes.some((s) => s.has(name));
      // A scope is a Set of names, or for Go, Java and Rust a Map of name → declared type (or
      // null): the innermost one that binds the name says what it is.
      ctx.typeOf = (name) => {
        for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return scopes[i].get?.(name) ?? null;
        return null;
      };
    }
    visit(n, ctx);
    const kids = named(n);
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], ctx]);
  }
}

function finishExtraction({ defs, exports, imports, reexports, bound, calls }) {
  // The walk visits in tree order already; sorting by line then text keeps two parses identical even
  // if a grammar update reorders siblings.
  const key = (c) => `${String(c.line).padStart(8, "0")}\0${c.in ?? ""}\0${c.kind}\0${c.name ?? ""}\0${c.object ?? ""}\0${c.property ?? ""}\0${c.objectType ?? ""}`;
  const seen = new Set();
  const uniq = [];
  for (const c of calls.sort((a, b) => byCodeUnit(key(a), key(b)))) {
    const k = key(c);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(c);
  }
  return {
    defs: defs.sort((a, b) => byCodeUnit(a.name, b.name) || a.line - b.line),
    exports: exports.sort((a, b) => byCodeUnit(a[1], b[1]) || byCodeUnit(a[0], b[0])),
    imports,
    reexports,
    bound: bound.sort(byCodeUnit),
    calls: uniq,
  };
}

// --- the cache key -----------------------------------------------------------------------------

/** The cache key for one file: its text, its grammar, the lock digest and the extractor version. */
export function cacheKey(text, grammar, digest) {
  return createHash("sha256").update(`${EXTRACTOR_VERSION}\0${digest}\0${grammar}\0`).update(text).digest("hex");
}

/** Whether a file is read for symbols at all. Declarations files define nothing callable. */
export function readsSymbols(file) {
  if (file.category !== "code" || file.vendored) return null;
  if (/\.d\.[mc]?ts$/.test(file.path)) return null;
  return grammarFor(file.path);
}

/**
 * Extract every file the parsers can read. `cache` is `{ get(key), set(key, value) }` or null.
 * Returns a Map path → extraction, in path order.
 */
export function extractAll(files, { read, parsers, cache = null }) {
  const out = new Map();
  for (const f of [...files].sort((a, b) => byCodeUnit(a.path, b.path))) {
    const grammar = readsSymbols(f);
    if (!grammar) continue;
    const text = read(f.path);
    if (text === null || text === undefined) continue;
    const key = cacheKey(text, grammar, parsers.digest);
    let ex = cache?.get(key) ?? null;
    if (!ex) {
      const tree = parsers.parse(grammar, text);
      if (!tree) continue;
      try {
        ex = extractFile(tree, grammar);
      } finally {
        tree.delete();
      }
      cache?.set(key, ex);
    }
    out.set(f.path, ex);
  }
  return out;
}

// --- pass 2: resolve ---------------------------------------------------------------------------

/** The module a Rust file is: `src/util.rs` and `src/util/mod.rs` are both `util`. */
function rustModuleName(path) {
  const segs = path.replace(/\.rs$/, "").split("/");
  const last = segs.pop();
  return last === "mod" ? segs.pop() ?? last : last;
}

const CONFIDENCE_RANK = { extracted: 0, inferred: 1, ambiguous: 2 };

/** For a Python `from M import N`, the module `N` names when it is a submodule rather than an attribute. */
function submoduleSpec(spec, name) {
  return spec.endsWith(".") ? `${spec}${name}` : `${spec}.${name}`;
}

/**
 * Resolve every call. `files` are the index's files (with `imports`), `edges` its import edges,
 * `extractions` the Map from `extractAll`, `resolve(spec, file)` the index's import resolver.
 *
 * Returns `{ definitions, calls, unresolved }` as `index.symbols` holds them, without `parser`.
 */
export function resolveSymbols({ files, extractions, resolve, onUnresolved = null }) {
  const fileBy = new Map(files.map((f) => [f.path, f]));
  const langOf = (path) => grammarFor(path);
  const isPython = (path) => langOf(path) === "python";

  // Go and Java: a package is a directory, and its files see each other's names with no import.
  // Go's are the other .go files beside this one. Java's come from the index's resolver, which
  // already knows that src/main/java and src/test/java hold one package (`./Name`).
  const goDirs = new Map();
  for (const path of extractions.keys()) {
    if (langOf(path) !== "go") continue;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (!goDirs.has(dir)) goDirs.set(dir, []);
    goDirs.get(dir).push(path);
  }
  const goSiblings = (path) => (goDirs.get(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "") ?? []).filter((p) => p !== path);
  /** The definitions named `name` that `path`'s package holds in its other files. */
  function samePackage(path, name) {
    const lang = langOf(path);
    let others = [];
    if (lang === "go") others = goSiblings(path);
    else if (lang === "java" && /^[A-Z]/.test(name)) others = inRepo(path, resolve(`./${name}`, fileBy.get(path) ?? { path, lang: "java" }));
    return others.filter((p) => info.get(p)?.defs.has(name)).map((p) => idOf(p, name));
  }
  const inRepo = (path, list) => (list ?? []).filter((t) => t !== path && fileBy.has(t));

  // Per file: definitions by name, the export table, the import bindings and the re-exports, each
  // resolved to files once.
  const info = new Map();
  for (const [path, ex] of extractions) {
    const file = fileBy.get(path) ?? { path, lang: "" };
    const py = isPython(path);
    const defs = new Map(ex.defs.map((d) => [d.name, d]));
    const exportsOf = new Map();
    for (const [local, exported] of ex.exports) if (!exportsOf.has(exported)) exportsOf.set(exported, local);
    const bindings = new Map();
    const stars = []; // modules whose every name this file re-exports
    const named = new Map(); // exported name → { targets, imported }, from `export { a as b } from`
    for (const imp of ex.imports) {
      const targets = inRepo(path, resolve(imp.spec, file));
      if (py && imp.star) stars.push({ targets });
      for (const [local, name] of imp.names) {
        // Rust: `use crate::util;` resolves to util.rs and names the module itself, so it binds
        // the module whole. Only the resolved file can tell that from `use crate::util::helper`.
        const imported = langOf(path) === "rust" && name !== "*" && targets.length === 1 && rustModuleName(targets[0]) === name ? "*" : name;
        const subTargets = py && imported !== "*" ? inRepo(path, resolve(submoduleSpec(imp.spec, imported), file)) : [];
        if (!bindings.has(local)) bindings.set(local, { targets, imported, subTargets });
      }
    }
    for (const re of ex.reexports ?? []) {
      const targets = inRepo(path, resolve(re.spec, file));
      if (!re.names) stars.push({ targets });
      else for (const [exported, imported] of re.names) if (!named.has(exported)) named.set(exported, { targets, imported, subTargets: [] });
    }
    info.set(path, { ex, py, defs, exportsOf, bindings, stars, named, bound: new Set(ex.bound) });
  }

  const idOf = (path, name) => `${path}#${name}`;

  // A lookup answers with the definitions found, and whether the trail left the repo: a name
  // re-exported from a package is `external`, not `missing`.
  const none = () => ({ ids: new Set(), external: false });
  const merge = (into, r) => {
    for (const id of r.ids) into.ids.add(id);
    into.external ||= r.external;
    return into;
  };

  /** What `name` names when imported from `path`, following re-exports up to `MAX_HOPS`. */
  function lookupExport(path, name, hops = 0, seen = new Set()) {
    const key = `${path}\0${name}`;
    if (hops > MAX_HOPS || seen.has(key)) return none();
    seen.add(key);
    const fi = info.get(path);
    if (!fi) return none();
    if (name === "default") {
      const local = fi.exportsOf.get("default");
      if (local) return lookupLocal(path, local, hops, seen);
      if (fi.named.has("default")) return lookupBinding(fi.named.get("default"), hops + 1, seen);
      const d = fi.ex.defs.find((x) => x.default);
      return d ? { ids: new Set([idOf(path, d.name)]), external: false } : none();
    }
    const local = fi.exportsOf.get(name);
    if (local) return lookupLocal(path, local, hops, seen);
    if (fi.named.has(name)) return lookupBinding(fi.named.get(name), hops + 1, seen);
    const d = fi.defs.get(name);
    if (d && (fi.py || d.exported)) return { ids: new Set([idOf(path, name)]), external: false };
    // Python re-exports by importing: `from .app import Flask` in `__init__.py`.
    if (fi.py && fi.bindings.has(name)) return lookupLocal(path, name, hops, seen);
    const out = none();
    for (const s of fi.stars) {
      if (!s.targets.length) out.external = true;
      for (const t of s.targets) merge(out, lookupExport(t, name, hops + 1, seen));
    }
    if (out.ids.size) out.external = false;
    return out;
  }

  /** What a name bound in `path` (a definition, or an import) refers to. */
  function lookupLocal(path, local, hops, seen) {
    const fi = info.get(path);
    if (fi.defs.has(local)) return { ids: new Set([idOf(path, local)]), external: false };
    const b = fi.bindings.get(local);
    return b ? lookupBinding(b, hops + 1, seen) : none();
  }

  function lookupBinding(b, hops = 0, seen = new Set()) {
    if (!b.targets.length && !b.subTargets.length) return { ids: new Set(), external: true };
    const out = none();
    if (b.imported === "*") return out;
    for (const t of b.targets) merge(out, lookupExport(t, b.imported, hops, seen));
    return out;
  }

  /** Definitions named `name` (top level) in the files `path` imports, exported or public. */
  function namedAmongImports(path, name) {
    const out = [];
    for (const t of fileBy.get(path)?.imports ?? []) {
      const fi = info.get(t);
      const d = fi?.defs.get(name);
      if (d && (fi.py || d.exported)) out.push(idOf(t, name));
    }
    return out;
  }

  /** `Class.prop` on a class reached by id: its own, else its stated bases', one level up. */
  function method(classId, prop) {
    const [path, cls] = splitId(classId);
    const fi = info.get(path);
    if (!fi) return { ids: [], via: null };
    if (fi.defs.has(`${cls}.${prop}`)) return { ids: [idOf(path, `${cls}.${prop}`)], via: "own" };
    // Go declares a type's methods in any file of its package.
    if (langOf(path) === "go") {
      const own = goSiblings(path).filter((p) => info.get(p)?.defs.has(`${cls}.${prop}`)).map((p) => idOf(p, `${cls}.${prop}`));
      if (own.length) return { ids: own, via: "own" };
    }
    const out = new Set();
    for (const base of fi.defs.get(cls)?.bases ?? []) {
      for (const baseId of classIds(path, base)) {
        const [bp, bc] = splitId(baseId);
        if (info.get(bp)?.defs.has(`${bc}.${prop}`)) out.add(idOf(bp, `${bc}.${prop}`));
      }
    }
    return { ids: [...out], via: out.size ? "base" : null };
  }

  /** The class definitions a name in `path` refers to. */
  function classIds(path, name) {
    const fi = info.get(path);
    if (!fi) return [];
    let ids = [];
    if (fi.defs.has(name)) ids = [idOf(path, name)];
    else if (fi.bindings.has(name)) ids = [...lookupBinding(fi.bindings.get(name)).ids];
    else ids = samePackage(path, name);
    // Go and Rust declare types, not classes; their methods hang off them the same way.
    return ids.filter((id) => {
      const [p, n] = splitId(id);
      const kind = info.get(p)?.defs.get(n)?.kind;
      return kind === "class" || kind === "type";
    });
  }

  const definitions = [];
  for (const [path, { ex }] of info) {
    const ids = new Set();
    for (const d of [...ex.defs].sort((a, b) => a.line - b.line)) {
      // A name declared twice (two branches of a conditional, an overload) is one definition: the first.
      if (ids.has(d.name)) continue;
      ids.add(d.name);
      definitions.push({ id: idOf(path, d.name), kind: d.kind, line: d.line, ...(d.exported ? { exported: true } : {}) });
    }
  }
  definitions.sort((a, b) => byCodeUnit(a.id, b.id));

  const unresolved = { total: 0, external: 0, local: 0, member: 0, missing: 0, unknown: 0 };
  let lastWhy = null;
  const miss = (why) => {
    unresolved[why] += 1;
    unresolved.total += 1;
    lastWhy = why;
    return null;
  };
  // One definition is a fact; several are a guess kept whole; none is counted by why.
  const settle = (found, sure, why) => {
    const ids = [...found.ids];
    if (ids.length === 1) return { to: ids, confidence: sure };
    if (ids.length > 1) return { to: ids, confidence: "ambiguous" };
    return miss(found.external ? "external" : why);
  };

  /**
   * `x.m()` where `x` was declared as `type`. The type is found as a class name is (in the file,
   * imported, or in the package), or for Go's `pkg.T` through the package import. A method of the
   * type itself is extracted; one reached through its stated base is inferred, since an override in
   * between would change the answer.
   */
  function byDeclaredType(path, fi, type, property) {
    let types;
    if (type.includes(".")) {
      const [pkg, name] = type.split(".");
      const b = fi.bindings.get(pkg);
      types = (b?.imported === "*" ? b.targets : []).filter((t) => {
        const kind = info.get(t)?.defs.get(name)?.kind;
        return kind === "class" || kind === "type";
      }).map((t) => idOf(t, name));
      if (!types.length) return miss(b && b.targets.length ? "missing" : "external");
    } else {
      types = classIds(path, type);
      if (!types.length) return miss("external");
    }
    const found = types.map((id) => method(id, property));
    const ids = new Set(found.flatMap((m) => m.ids));
    return settle({ ids, external: false }, found.some((m) => m.via === "own") ? "extracted" : "inferred", "member");
  }

  function resolveOne(path, fi, c) {
    if (c.name !== undefined) {
      const n = c.name;
      if (c.local) return miss("local");
      if (fi.defs.has(n)) return { to: [idOf(path, n)], confidence: "extracted" };
      const b = fi.bindings.get(n);
      if (b) {
        // Calling a module bound whole is a CommonJS `require` of a file whose default is a function.
        const found = b.imported === "*" && (b.targets.length || b.subTargets.length)
          ? b.targets.reduce((acc, t) => merge(acc, lookupExport(t, "default")), none())
          : lookupBinding(b);
        return settle(found, "extracted", "missing");
      }
      const pkg = samePackage(path, n);
      if (pkg.length) return settle({ ids: new Set(pkg), external: false }, "extracted", "missing");
      if (fi.bound.has(n)) return miss("local");
      const cands = namedAmongImports(path, n);
      return settle({ ids: new Set(cands), external: false }, "inferred", "unknown");
    }
    // A member call: `this.m()`, `ns.f()`, `Class.m()`, `value.m()`.
    const { object, property } = c;
    if (object === "this") {
      const cls = c.in?.includes(".") ? c.in.split(".")[0] : fi.defs.get(c.in)?.kind === "class" ? c.in : null;
      if (!cls) return miss("member");
      const m = method(idOf(path, cls), property);
      return settle({ ids: new Set(m.ids), external: false }, m.via === "own" ? "extracted" : "inferred", "member");
    }
    // A receiver Cortex cannot name (`a[0].m()`, `f()()`, a dynamic callee) is a method on a value.
    // A value whose type was declared (Go, Java, Rust): its type's method, as a compiler reads it.
    if (!object && c.objectType) return byDeclaredType(path, fi, c.objectType, property);
    if (!object) return miss("member");
    // A module bound whole: `import * as ns`, `import pkg.mod`, `from . import views`.
    const b = fi.bindings.get(object);
    if (b) {
      if (!b.targets.length && !b.subTargets.length) return miss("external");
      const modules = b.imported === "*" ? b.targets : b.subTargets;
      if (modules.length) {
        const found = modules.reduce((acc, t) => merge(acc, lookupExport(t, property)), none());
        if (found.ids.size || found.external) return settle(found, "extracted", "missing");
      }
    }
    // Rust: a path, `crate::util::f()` or `util::sub::f()`. The resolver reads it as it reads a `use`.
    if (object.includes("::")) {
      const spec = object.startsWith("crate::") ? object.slice("crate::".length) : object;
      const targets = inRepo(path, resolve(spec, fileBy.get(path) ?? { path, lang: "rust" }));
      if (targets.length) return settle(targets.reduce((acc, t) => merge(acc, lookupExport(t, property)), none()), "extracted", "missing");
      const h = fi.bindings.get(object.split("::")[0]);
      return miss(object.startsWith("crate::") || (h && h.targets.length) ? "missing" : "external");
    }
    if (!object.includes(".")) {
      const classes = classIds(path, object);
      if (classes.length) {
        const ids = new Set(classes.flatMap((id) => method(id, property).ids));
        if (ids.size) return settle({ ids, external: false }, "extracted", "member");
      }
    }
    const head = fi.bindings.get(object.split(".")[0]);
    if (head && !head.targets.length && !head.subTargets.length) return miss("external");
    return miss("member");
  }

  const calls = [];
  for (const [path, fi] of info) {
    for (const c of fi.ex.calls) {
      const r = resolveOne(path, fi, c);
      if (!r) {
        // For diagnosis only: which call went unresolved, and why. Nothing in the index uses it.
        onUnresolved?.(lastWhy, path, c);
        continue;
      }
      // Go: `Attr(1 << 8)` names a type, so it is a conversion, not a call. Neither kept nor counted.
      if (c.name !== undefined && langOf(path) === "go" && r.to.every((id) => {
        const [p, n] = splitId(id);
        return info.get(p)?.defs.get(n)?.kind === "type";
      })) continue;
      calls.push({
        from: c.in ? idOf(path, c.in) : path,
        line: c.line,
        // A call on a typed value keeps the type, not the variable: `pet.getName()` is `Pet.getName`.
        name: c.name ?? `${c.object ?? c.objectType}.${c.property}`,
        ...(c.kind !== "call" ? { kind: c.kind } : {}),
        to: [...r.to].sort(byCodeUnit),
        confidence: r.confidence,
      });
    }
  }
  calls.sort((a, b) => byCodeUnit(a.from, b.from) || a.line - b.line || byCodeUnit(a.name, b.name) || byCodeUnit(a.to.join(), b.to.join()));
  return { definitions, calls, unresolved };
}

function splitId(id) {
  const i = id.indexOf("#");
  return [id.slice(0, i), id.slice(i + 1)];
}

/**
 * The file-level edges calls add to clustering: one per ordered pair of files, carrying the surest
 * confidence among the calls between them. A call inside one file adds nothing.
 */
export function callEdges(calls) {
  const best = new Map();
  for (const c of calls) {
    const fromFile = c.from.includes("#") ? splitId(c.from)[0] : c.from;
    for (const to of c.to) {
      const toFile = splitId(to)[0];
      if (toFile === fromFile) continue;
      const key = `${fromFile}\0${toFile}`;
      const prev = best.get(key);
      if (!prev || CONFIDENCE_RANK[c.confidence] < CONFIDENCE_RANK[prev]) best.set(key, c.confidence);
    }
  }
  return [...best.entries()]
    .sort((a, b) => byCodeUnit(a[0], b[0]))
    .map(([key, confidence]) => {
      const [from, to] = key.split("\0");
      return { from, to, type: "calls", confidence };
    });
}

/**
 * Build `index.symbols` for an index's files. `parsers` is what `loadParsers` returned (never null
 * here), `read` the index's text source, `resolve` its import resolver.
 */
export function buildSymbols({ files, read, resolve, parsers, cache = null }) {
  const extractions = extractAll(files, { read, parsers, cache });
  const { definitions, calls, unresolved } = resolveSymbols({ files, extractions, resolve });
  return { parser: parsers.name, grammars: parsers.grammars, files: extractions.size, definitions, calls, unresolved };
}
