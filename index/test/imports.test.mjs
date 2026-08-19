import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractImports,
  resolveImport,
  resolveGoImport,
  goModulePath,
  UNRESOLVED_LANGUAGES,
  resolveRustImport,
  resolveJavaImport,
  resolvePhpImport,
  resolveRubyImport,
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

test("no language is claimed as resolved when it is not", () => {
  // The set is what lets every consumer say "I did not look" instead of "nothing depends on this".
  // It is EMPTY now — JS/TS, Python, Go and Rust all resolve — and that is the point of asserting it
  // rather than deleting it: a language listed here that actually resolves suppresses a real graph,
  // and one missing from here that does not resolve reports blindness as absence. Both are silent.
  for (const lang of ["javascript", "typescript", "python", "go", "rust"]) {
    assert.ok(!UNRESOLVED_LANGUAGES.has(lang), `${lang} has a resolver, so it must not be listed blind`);
  }
  // The mechanism still works for whatever comes next.
  assert.ok(UNRESOLVED_LANGUAGES instanceof Set);
});

test("mod resolves as a sibling from a crate root, and as a child from anywhere else", () => {
  // Rust's one real subtlety, and getting it backwards resolves half a crate to the wrong place.
  // `mod color;` in src/lib.rs means src/color.rs, because lib.rs OWNS src/. The same line in
  // src/printer.rs means src/printer/color.rs.
  const files = new Set(["src/lib.rs", "src/color.rs", "src/printer.rs", "src/printer/color.rs"]);
  assert.equal(resolveRustImport("color", "src/lib.rs", files, ["src"]), "src/color.rs");
  assert.equal(resolveRustImport("color", "src/printer.rs", files, ["src"]), "src/printer/color.rs");
});

test("a directory module resolves through its mod.rs", () => {
  const files = new Set(["src/lib.rs", "src/hyperlink/mod.rs"]);
  assert.equal(resolveRustImport("hyperlink", "src/lib.rs", files, ["src"]), "src/hyperlink/mod.rs");
});

test("a nested mod.rs owns its own directory, not the crate root", () => {
  // ripgrep's real shape, and the case that proves the crate-root rule rather than assuming it.
  //
  // Both src/aliases.rs and src/hyperlink/aliases.rs exist here on purpose. If mod.rs were treated
  // like an ordinary file its module dir would be src/hyperlink/mod/, that lookup would miss, and the
  // crate-root fallback would quietly return the WRONG src/aliases.rs. Without the decoy file the
  // fallback returns nothing and the test passes for the wrong reason — which it did, until a
  // mutation run showed removing the rule broke nothing.
  const files = new Set([
    "src/lib.rs",
    "src/aliases.rs",
    "src/hyperlink/mod.rs",
    "src/hyperlink/aliases.rs",
  ]);
  assert.equal(
    resolveRustImport("aliases", "src/hyperlink/mod.rs", files, ["src"]),
    "src/hyperlink/aliases.rs",
  );
});

test("a use path is shortened until it lands on a file", () => {
  // `use crate::json::Printer` names a TYPE inside json.rs. Only the filesystem can say where the
  // module stops and the item begins, so the path is tried longest-first and then shortened.
  const files = new Set(["src/lib.rs", "src/json.rs"]);
  assert.equal(resolveRustImport("json::Printer", "src/lib.rs", files, ["src"]), "src/json.rs");
  assert.equal(resolveRustImport("json::inner::Deep", "src/lib.rs", files, ["src"]), "src/json.rs");
});

test("crate:: means THIS crate, not the workspace", () => {
  // A workspace has one root per member. Matching the shortest would send every crate's imports to
  // the same place — the bug that made ripgrep resolve at 64% instead of 92%.
  const files = new Set([
    "crates/printer/src/lib.rs",
    "crates/printer/src/json.rs",
    "crates/grep/src/lib.rs",
    "crates/grep/src/json.rs",
  ]);
  const roots = ["crates/printer/src", "crates/grep/src"].sort((a, b) => b.length - a.length);
  assert.equal(resolveRustImport("json", "crates/printer/src/lib.rs", files, roots), "crates/printer/src/json.rs");
  assert.equal(resolveRustImport("json", "crates/grep/src/lib.rs", files, roots), "crates/grep/src/json.rs");
});

test("an integration test file is its own crate root", () => {
  // cargo compiles each file directly in tests/ as a separate binary, so `mod util;` in tests/cli.rs
  // means tests/util.rs — not tests/cli/util.rs.
  const files = new Set(["tests/cli.rs", "tests/util.rs", "src/lib.rs"]);
  assert.equal(resolveRustImport("util", "tests/cli.rs", files, ["src"]), "tests/util.rs");
});

test("an inline mod resolves to nothing rather than to an invented file", () => {
  // `#[cfg(test)] mod tests { ... }` has no file. Every candidate must exist in the file set, so a
  // reading with no file behind it produces no edge.
  const files = new Set(["src/lib.rs"]);
  assert.equal(resolveRustImport("tests", "src/lib.rs", files, ["src"]), null);
  assert.equal(resolveRustImport("std::collections::HashMap", "src/lib.rs", files, ["src"]), null);
});

test("pub mod and pub(crate) mod are extracted, not just bare mod", () => {
  // How a library crate exposes its modules. A pattern matching only `mod x;` misses precisely the
  // public surface of every lib crate — in ripgrep, three of the ignore crate's modules were reported
  // unreferenced while lib.rs declared them one line apart from ones that resolved fine.
  const src = ["mod dir;", "pub mod gitignore;", "pub(crate) mod pathutil;", "pub use crate::walk::Walk;"].join("\n");
  const got = extractImports(src, "rust");
  for (const want of ["dir", "gitignore", "pathutil", "walk::Walk"]) {
    assert.ok(got.includes(want), `expected ${want} in ${JSON.stringify(got)}`);
  }
});

test("java: a package is a directory, under a source root", () => {
  // gson indexed with 0 edges across 264 java files. /cortex-impact on Gson.java — the library's
  // central class — reported that nothing imported it; it now reports 124 affected files.
  const files = new Set([
    "gson/src/main/java/com/google/gson/Gson.java",
    "gson/src/main/java/com/google/gson/internal/Excluder.java",
  ]);
  const roots = ["gson/src/main/java"];
  assert.equal(
    resolveJavaImport("com.google.gson.internal.Excluder", files, roots),
    "gson/src/main/java/com/google/gson/internal/Excluder.java",
  );
  // A static import names a MEMBER, so the path shortens until it lands on a file.
  assert.equal(
    resolveJavaImport("com.google.gson.Gson.fromJson", files, roots),
    "gson/src/main/java/com/google/gson/Gson.java",
  );
  // The JDK and third-party packages are real dependencies but not files here.
  assert.equal(resolveJavaImport("java.util.List", files, roots), null);
});

test("java: source roots are matched longest-first across modules", () => {
  // A multi-module build has one root per module, and the same package path can exist under two of
  // them. Matching the shortest would send every module's imports to whichever came first.
  const files = new Set([
    "a/src/main/java/com/x/Thing.java",
    "b/src/test/java/com/x/Thing.java",
  ]);
  assert.equal(resolveJavaImport("com.x.Thing", files, ["b/src/test/java", "a/src/main/java"]), "b/src/test/java/com/x/Thing.java");
  assert.equal(resolveJavaImport("com.x.Thing", files, ["a/src/main/java"]), "a/src/main/java/com/x/Thing.java");
});

test("php: PSR-4 maps a namespace prefix to a directory", () => {
  // Declared in composer.json rather than guessed — the same reason Go reads go.mod.
  const BS = String.fromCharCode(92);
  const files = new Set(["Slim/Routing/Route.php", "Slim/App.php"]);
  const prefixes = [[`Slim${BS}`, "Slim"]];
  assert.equal(resolvePhpImport(`Slim${BS}Routing${BS}Route`, files, prefixes), "Slim/Routing/Route.php");
  assert.equal(resolvePhpImport(`${BS}Slim${BS}App`, files, prefixes), "Slim/App.php", "a leading separator is optional");
  assert.equal(resolvePhpImport(`Psr${BS}Http${BS}Message`, files, prefixes), null, "an undeclared namespace is a vendor package");
});

test("php: the longest declared prefix wins", () => {
  // Both may be declared, and the specific one must beat the umbrella. Sorting the other way sends
  // every Routing class to the wrong directory.
  const BS = String.fromCharCode(92);
  const files = new Set(["src/Routing/Route.php", "custom/Route.php"]);
  const prefixes = [[`Slim${BS}Routing${BS}`, "custom"], [`Slim${BS}`, "src"]];
  assert.equal(resolvePhpImport(`Slim${BS}Routing${BS}Route`, files, prefixes), "custom/Route.php");
});

test("ruby: require_relative is path-relative, require searches lib", () => {
  // The two mean different files from the same line, which is why extraction tags the relative form
  // rather than leaving the resolver to guess.
  const files = new Set(["lib/sinatra/base.rb", "lib/sinatra/helpers.rb", "lib/other.rb"]);
  assert.equal(resolveRubyImport("./helpers", "lib/sinatra/base.rb", files, ["lib"]), "lib/sinatra/helpers.rb");
  assert.equal(resolveRubyImport("sinatra/base", "lib/other.rb", files, ["lib"]), "lib/sinatra/base.rb");
  assert.equal(resolveRubyImport("rack", "lib/other.rb", files, ["lib"]), null, "a gem is external");
});

test("ruby: a repo holding several gems has several load paths", () => {
  // sinatra ships rack-protection and sinatra-contrib alongside it, each with its own lib/.
  const files = new Set(["lib/sinatra/base.rb", "rack-protection/lib/rack/protection.rb"]);
  const paths = ["rack-protection/lib", "lib"];
  assert.equal(resolveRubyImport("rack/protection", "lib/sinatra/base.rb", files, paths), "rack-protection/lib/rack/protection.rb");
});

test("extraction covers the forms each language actually writes", () => {
  const BS = String.fromCharCode(92);
  const java = extractImports("import static com.x.A.b;\nimport com.x.C;", "java");
  assert.deepEqual(java, ["com.x.A.b", "com.x.C"]);

  const php = extractImports(`use Slim${BS}Routing${BS}Route;\nuse function App${BS}helper;`, "php");
  assert.ok(php.includes(`Slim${BS}Routing${BS}Route`));
  assert.ok(php.includes(`App${BS}helper`), "use function is still a namespace path");

  // require_relative must not also be collected as a bare require — that would resolve one line to
  // two different files.
  const ruby = extractImports("require_relative 'x'\nrequire 'sinatra/base'", "ruby");
  assert.deepEqual(ruby, ["./x", "sinatra/base"]);
});
