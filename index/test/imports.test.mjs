import { test } from "node:test";
import assert from "node:assert/strict";
import { extractImports, resolveImport } from "../lib/imports.mjs";

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
