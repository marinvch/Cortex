import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractImports,
  resolveImport,
  resolveGoImport,
  goModulePath,
  UNRESOLVED_LANGUAGES,
} from "../lib/imports.mjs";

test("extracts every JS/TS import form", () => {
  const src = `
    import a from "./a.js";
    import { b } from './b';
    import "./side-effect.css";
    export { c } from "../c";
    const d = require("./d");
    const e = await import("./e");
    import type { F } from "./f";
  `;
  const got = extractImports(src, "typescript");
  for (const s of ["./a.js", "./b", "./side-effect.css", "../c", "./d", "./e", "./f"]) {
    assert.ok(got.includes(s), `missed ${s}`);
  }
});

test("ignores bare specifiers as external packages", () => {
  const files = new Set(["src/a.ts"]);
  assert.equal(resolveImport("react", "src/a.ts", files, "typescript"), null);
  assert.equal(resolveImport("@scope/pkg", "src/a.ts", files, "typescript"), null);
});

test("resolves relative JS imports across extensions and index files", () => {
  const files = new Set(["src/a.ts", "src/b.ts", "src/dir/index.ts", "src/c.tsx"]);
  assert.equal(resolveImport("./b", "src/a.ts", files, "typescript"), "src/b.ts");
  assert.equal(resolveImport("./dir", "src/a.ts", files, "typescript"), "src/dir/index.ts");
  assert.equal(resolveImport("./c", "src/a.ts", files, "typescript"), "src/c.tsx");
});

test("resolves the ESM-on-TypeScript .js specifier back to its .ts source", () => {
  const files = new Set(["src/a.ts", "src/b.ts"]);
  assert.equal(resolveImport("./b.js", "src/a.ts", files, "typescript"), "src/b.ts");
});

test("walks up out of a subdirectory", () => {
  const files = new Set(["src/deep/a.ts", "src/b.ts"]);
  assert.equal(resolveImport("../b", "src/deep/a.ts", files, "typescript"), "src/b.ts");
});

test("never resolves a specifier to the importing file itself", () => {
  const files = new Set(["src/a.ts"]);
  assert.equal(resolveImport("./nope", "src/a.ts", files, "typescript"), null);
});

test("python: relative and absolute module resolution", () => {
  const files = new Set(["pkg/__init__.py", "pkg/mod.py", "pkg/sub/thing.py", "app.py"]);
  assert.equal(extractImports("from .mod import x", "python")[0], ".mod");
  assert.equal(resolveImport(".mod", "pkg/other.py", files, "python"), "pkg/mod.py");
  assert.equal(resolveImport("pkg.sub.thing", "app.py", files, "python"), "pkg/sub/thing.py");
  assert.equal(resolveImport("pkg", "app.py", files, "python"), "pkg/__init__.py");
  assert.equal(resolveImport("os", "app.py", files, "python"), null);
});

test("go: extracts both block and single import forms", () => {
  const src = `
import (
  "fmt"
  "example.com/m/internal/svc"
)
import "strings"
`;
  const got = extractImports(src, "go");
  assert.ok(got.includes("fmt"));
  assert.ok(got.includes("example.com/m/internal/svc"));
  assert.ok(got.includes("strings"));
});

test("shell: source and dot forms resolve to repo paths", () => {
  const files = new Set(["tools/_lib.sh", "tools/run.sh"]);
  assert.deepEqual(extractImports(". tools/_lib.sh", "shell"), ["tools/_lib.sh"]);
  assert.equal(resolveImport("tools/_lib.sh", "tools/run.sh", files, "shell"), "tools/_lib.sh");
  assert.equal(resolveImport("$ROOT/tools/_lib.sh", "tools/run.sh", files, "shell"), "tools/_lib.sh");
});

test("unknown languages yield no imports rather than throwing", () => {
  assert.deepEqual(extractImports("anything at all", "markdown"), []);
  assert.equal(resolveImport("", "a.md", new Set(), "markdown"), null);
});

test("a Go import resolves to the package directory, not a file", () => {
  // Go is the one language here where one specifier means many files: it imports a PACKAGE, which is
  // a directory. Before this, gin indexed with 0 edges across 130 files — /cortex-impact said nothing
  // imported the framework's central type, and the orphan finding called 59 files unreferenced.
  const byDir = new Map([
    ["binding", ["binding/json.go", "binding/form.go"]],
    ["", ["gin.go"]],
  ]);
  assert.deepEqual(
    resolveGoImport("github.com/gin-gonic/gin/binding", "github.com/gin-gonic/gin", byDir),
    ["binding/json.go", "binding/form.go"],
  );
  assert.deepEqual(resolveGoImport("github.com/gin-gonic/gin", "github.com/gin-gonic/gin", byDir), ["gin.go"]);
});

test("a Go import outside the module is external, never invented", () => {
  // A real dependency, but not a file in this repo. An edge here would be indistinguishable from a
  // true one for every consumer of the graph.
  const byDir = new Map([["binding", ["binding/json.go"]]]);
  assert.deepEqual(resolveGoImport("net/http", "github.com/gin-gonic/gin", byDir), []);
  assert.deepEqual(resolveGoImport("github.com/other/pkg", "github.com/gin-gonic/gin", byDir), []);
  // A module whose name is a PREFIX of another must not match on the string alone. The directory
  // below is chosen so a loose `startsWith(moduleName)` would slice out "extra/binding" and find it —
  // without it this assertion passes even when the boundary check is removed, which is how a vacuous
  // guard looks from the inside.
  const prefixTrap = new Map([["extra/binding", ["extra/binding/a.go"]]]);
  assert.deepEqual(
    resolveGoImport("github.com/x/y-extra/binding", "github.com/x/y", prefixTrap),
    [],
    "y-extra is a different module from y",
  );
});

test("goModulePath reads the module line, and tolerates its absence", () => {
  assert.equal(goModulePath("module github.com/x/y\n\ngo 1.21\n"), "github.com/x/y");
  assert.equal(goModulePath("go 1.21\n"), null);
  assert.equal(goModulePath(null), null);
});

test("a language Cortex cannot resolve is named, not silently trusted", () => {
  // The set is what lets every consumer say "I did not look" instead of "nothing depends on this".
  assert.ok(UNRESOLVED_LANGUAGES.has("rust"));
  assert.ok(!UNRESOLVED_LANGUAGES.has("go"), "go resolves now — leaving it here would suppress a real graph");
  assert.ok(!UNRESOLVED_LANGUAGES.has("javascript"));
});
