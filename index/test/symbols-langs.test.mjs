// Symbols for Go, Java and Rust (G5 of the code-graph design). Resolution runs everywhere, from
// hand-written extractions; extraction needs the parser add-on and is skipped without it, as in
// symbols.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFile, resolveSymbols } from "../lib/symbols.mjs";
import { loadParsers } from "../lib/parsers.mjs";

const ex = (o) => ({ defs: [], exports: [], imports: [], reexports: [], bound: [], calls: [], ...o });
const def = (name, kind = "function", extra = {}) => ({ name, kind, line: 1, exported: true, ...extra });
const call = (o) => ({ in: null, line: 1, kind: "call", ...o });

/** `{ path: ex }` and a resolver table `{ "from|spec": [targets] }`. */
function resolveRepo(repo, table = {}) {
  const files = Object.keys(repo).map((path) => ({ path, imports: [] }));
  const why = [];
  const r = resolveSymbols({
    files,
    extractions: new Map(Object.entries(repo)),
    resolve: (spec, f) => table[`${f.path}|${spec}`] ?? [],
    onUnresolved: (reason, path, c) => why.push([reason, `${path}:${c.line}`]),
  });
  return { ...r, why };
}
const edges = (r) => r.calls.map((c) => [c.from, c.name, c.to.join(","), c.confidence]);

// --- Go ------------------------------------------------------------------------------------------

test("Go: a name from another file of the same package needs no import, and is extracted", () => {
  const r = resolveRepo({
    "pkg/a.go": ex({ defs: [def("Run")], calls: [call({ in: "Run", name: "helper" })] }),
    "pkg/b.go": ex({ defs: [def("helper", "function", { exported: false })] }),
    "other/c.go": ex({ defs: [def("helper")] }),
  });
  assert.deepEqual(edges(r), [["pkg/a.go#Run", "helper", "pkg/b.go#helper", "extracted"]]);
});

test("Go: a method on the receiver is found in any file of the package", () => {
  const r = resolveRepo({
    "pkg/t.go": ex({ defs: [def("T.Loop", "method")], calls: [call({ in: "T.Loop", object: "this", property: "draw" })] }),
    "pkg/draw.go": ex({ defs: [def("T.draw", "method")] }),
  });
  assert.deepEqual(edges(r), [["pkg/t.go#T.Loop", "this.draw", "pkg/draw.go#T.draw", "extracted"]]);
});

test("Go: a call to a type is a conversion, neither kept nor counted", () => {
  const r = resolveRepo({ "pkg/a.go": ex({ defs: [def("Attr", "type")], calls: [call({ name: "Attr" })] }) });
  assert.deepEqual(r.calls, []);
  assert.equal(r.unresolved.total, 0);
});

test("Go: a package import binds the package, and only its exported names", () => {
  const r = resolveRepo({
    "main.go": ex({
      imports: [{ spec: "ex.com/m/util", line: 1, names: [["util", "*"]] }],
      calls: [call({ line: 2, object: "util", property: "Do" }), call({ line: 3, object: "util", property: "hidden" })],
    }),
    "util/u.go": ex({ defs: [def("Do"), def("hidden", "function", { exported: false })] }),
  }, { "main.go|ex.com/m/util": ["util/u.go"] });
  assert.deepEqual(edges(r), [["main.go", "util.Do", "util/u.go#Do", "extracted"]]);
  // As for a JS namespace: a name the module does not export is a member Cortex cannot name.
  assert.deepEqual(r.why, [["member", "main.go:3"]]);
});

test("Go: a parameter's declared type, even one from another package, finds its method", () => {
  const r = resolveRepo({
    "a.go": ex({
      imports: [{ spec: "ex.com/m/tui", line: 1, names: [["tui", "*"]] }],
      calls: [call({ line: 2, object: null, property: "Move", objectType: "tui.Window" })],
    }),
    "tui/w.go": ex({ defs: [def("Window", "type")] }),
    "tui/w_move.go": ex({ defs: [def("Window.Move", "method")] }),
  }, { "a.go|ex.com/m/tui": ["tui/w.go", "tui/w_move.go"] });
  assert.deepEqual(edges(r), [["a.go", "tui.Window.Move", "tui/w_move.go#Window.Move", "extracted"]]);
});

// --- Java ----------------------------------------------------------------------------------------

test("Java: `new` of a class in the same package resolves through the resolver's ./Name", () => {
  const r = resolveRepo({
    "app/Owner.java": ex({ defs: [def("Owner", "class"), def("Owner.add", "method")], calls: [call({ in: "Owner.add", kind: "new", name: "Pet" })] }),
    "app/Pet.java": ex({ defs: [def("Pet", "class")] }),
  }, { "app/Owner.java|./Pet": ["app/Pet.java"] });
  assert.deepEqual(edges(r), [["app/Owner.java#Owner.add", "Pet", "app/Pet.java#Pet", "extracted"]]);
});

test("Java: a declared type's own method is extracted, an inherited one inferred, a library one external", () => {
  const r = resolveRepo({
    "app/C.java": ex({
      imports: [{ spec: "app.model.Pet", line: 1, names: [["Pet", "Pet"]] }],
      defs: [def("C", "class"), def("C.run", "method")],
      calls: [
        call({ in: "C.run", line: 2, object: null, property: "feed", objectType: "Pet" }),
        call({ in: "C.run", line: 3, object: null, property: "getName", objectType: "Pet" }),
        call({ in: "C.run", line: 4, object: null, property: "size", objectType: "List" }),
      ],
    }),
    "app/model/Pet.java": ex({ defs: [def("Pet", "class", { bases: ["Named"] }), def("Pet.feed", "method")] }),
    "app/model/Named.java": ex({ defs: [def("Named", "class"), def("Named.getName", "method")] }),
  }, { "app/C.java|app.model.Pet": ["app/model/Pet.java"], "app/model/Pet.java|./Named": ["app/model/Named.java"] });
  assert.deepEqual(edges(r), [
    ["app/C.java#C.run", "Pet.feed", "app/model/Pet.java#Pet.feed", "extracted"],
    ["app/C.java#C.run", "Pet.getName", "app/model/Named.java#Named.getName", "inferred"],
  ]);
  assert.deepEqual(r.why, [["external", "app/C.java:4"]]);
});

test("Java: two typed calls on one line are two calls", () => {
  const r = resolveRepo({
    "A.java": ex({ defs: [def("A", "class"), def("A.save", "method"), def("B", "class"), def("B.save", "method")],
      calls: [call({ object: null, property: "save", objectType: "A" }), call({ object: null, property: "save", objectType: "B" })] }),
  });
  assert.equal(r.calls.length, 2);
});

// --- Rust ----------------------------------------------------------------------------------------

test("Rust: `use crate::util;` binds the module, so util::f() is extracted", () => {
  const r = resolveRepo({
    "src/main.rs": ex({
      imports: [{ spec: "util", line: 1, names: [["util", "util"]] }],
      calls: [call({ line: 2, object: "util", property: "helper" })],
    }),
    "src/util.rs": ex({ defs: [def("helper")] }),
  }, { "src/main.rs|util": ["src/util.rs"] });
  assert.deepEqual(edges(r), [["src/main.rs", "util.helper", "src/util.rs#helper", "extracted"]]);
});

test("Rust: a crate:: path call resolves through the resolver; an unknown crate is external", () => {
  const r = resolveRepo({
    "src/a.rs": ex({ calls: [call({ line: 2, object: "crate::util", property: "other" }), call({ line: 3, object: "serde::json", property: "to_string" })] }),
    "src/util.rs": ex({ defs: [def("other")] }),
  }, { "src/a.rs|util": ["src/util.rs"] });
  assert.deepEqual(edges(r), [["src/a.rs", "crate::util.other", "src/util.rs#other", "extracted"]]);
  assert.deepEqual(r.why, [["external", "src/a.rs:3"]]);
});

test("Rust: Type::new() finds the impl's function", () => {
  const r = resolveRepo({
    "src/a.rs": ex({ defs: [def("S", "type"), def("S.new", "method"), def("main")], calls: [call({ in: "main", object: "S", property: "new" })] }),
  });
  assert.deepEqual(edges(r), [["src/a.rs#main", "S.new", "src/a.rs#S.new", "extracted"]]);
});

// --- extraction, with the real add-on when it is installed ---------------------------------------

const parsers = await loadParsers({ env: process.env });
const needs = { skip: parsers?.grammars?.go ? false : "the parser add-on with the Go, Java and Rust grammars is not installed" };

function extract(grammar, text) {
  const tree = parsers.parse(grammar, text);
  try {
    return extractFile(tree, grammar);
  } finally {
    tree.delete();
  }
}
const shown = (e) => e.calls.map((c) => [c.in, c.name ?? `${c.object}.${c.property}`, c.objectType ?? null, !!c.local]);

test("Go: functions, methods on any receiver form, types, imports and typed parameters", needs, () => {
  const e = extract("go", [
    "package main",
    'import ("fmt"; u "example.com/m/util"; "example.com/m/tui/v2")',
    "type S struct{}",
    "func (s *S) Run(x int, w tui.Window) { s.helper(); u.Do(x); fmt.Println(x); w.Move() }",
    "func (s S) helper() {}",
    "func main() { s := &S{}; s.Run(1, nil); top(); f := func() {}; f(); _ = []byte(\"x\") }",
    "func top() {}",
  ].join("\n"));
  assert.deepEqual(e.defs.map((d) => [d.name, d.kind, d.exported]), [
    ["S", "type", true], ["S.Run", "method", true], ["S.helper", "method", false], ["main", "function", false], ["top", "function", false],
  ]);
  // Line order, then spec: these three share a line.
  assert.deepEqual(e.imports.map((i) => [i.spec, i.names]), [
    ["example.com/m/tui/v2", [["tui", "*"]]], ["example.com/m/util", [["u", "*"]]], ["fmt", [["fmt", "*"]]],
  ]);
  assert.deepEqual(shown(e).sort(), [
    ["S.Run", "fmt.Println", null, false], ["S.Run", "null.Move", "tui.Window", false], ["S.Run", "this.helper", null, false], ["S.Run", "u.Do", null, false],
    ["main", "f", null, true], ["main", "null.Run", null, false], ["main", "top", null, false],
  ].sort());
});

test("Java: types, methods, constructors, imports, unqualified and typed calls", needs, () => {
  const e = extract("java", [
    "package com.ex.app;",
    "import com.ex.util.Helper;",
    "import static com.ex.util.Helper.go;",
    "@Entity",
    "public class Owner extends Base {",
    "  private OwnerRepository owners;",
    "  public Owner() { init(); }",
    "  void init() { this.helper(); Helper.run(); go(); new Pet(); owners.save(this); Pet p = new Pet(); p.feed(); var q = p; q.feed(); }",
    "  private void helper() {}",
    "}",
  ].join("\n"));
  assert.deepEqual(e.defs.map((d) => [d.name, d.kind, d.line, d.exported]), [
    ["Owner", "class", 5, true], ["Owner.constructor", "method", 7, true], ["Owner.helper", "method", 9, false], ["Owner.init", "method", 8, true],
  ]);
  assert.deepEqual(e.defs[0].bases, ["Base"]);
  assert.deepEqual(e.imports.map((i) => [i.spec, i.names]), [["com.ex.util.Helper", [["Helper", "Helper"]]], ["com.ex.util.Helper.go", [["go", "Helper.go"]]]]);
  assert.deepEqual(shown(e).sort(), [
    ["Owner.constructor", "this.init", null, false],
    ["Owner.init", "Helper.run", null, false], ["Owner.init", "Pet", null, false], ["Owner.init", "go", null, false],
    ["Owner.init", "null.feed", "Pet", false], ["Owner.init", "null.feed", null, false], ["Owner.init", "null.save", "OwnerRepository", false],
    ["Owner.init", "this.helper", null, false],
  ].sort());
});

test("Rust: fns, types, impl and trait methods, uses, mods, and typed parameters", needs, () => {
  const e = extract("rust", [
    "use crate::util::{helper, other as o};",
    "use std::fmt;",
    "mod inner;",
    "pub struct S;",
    "impl S { pub fn new() -> Self { S } fn run(&self, p: &Printer) { self.go(); helper(); Self::new(); crate::util::x(); p.print(); } fn go(&self) {} }",
    "trait T { fn t(&self) { } }",
    "fn main() { let s = S::new(); s.run(); println!(\"x\"); let f = |a| a; f(1); }",
  ].join("\n"));
  assert.deepEqual(e.defs.map((d) => [d.name, d.kind, d.exported]), [
    ["S", "type", true], ["S.go", "method", false], ["S.new", "method", true], ["S.run", "method", false], ["T", "type", false], ["T.t", "method", false], ["main", "function", false],
  ]);
  assert.deepEqual(e.imports.map((i) => [i.spec, i.names]), [
    ["util::helper", [["helper", "helper"]]], ["util::other", [["o", "other"]]], ["std::fmt", [["fmt", "fmt"]]], ["inner", [["inner", "*"]]],
  ]);
  assert.deepEqual(shown(e).sort(), [
    ["S.run", "crate::util.x", null, false], ["S.run", "helper", null, false], ["S.run", "null.print", "Printer", false],
    ["S.run", "this.go", null, false], ["S.run", "this.new", null, false],
    ["main", "S.new", null, false], ["main", "f", null, true], ["main", "null.run", null, false],
  ].sort());
});
