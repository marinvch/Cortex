import { test } from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS, importResolver, tsAliasTables } from "../lib/resolvers.mjs";

// Every derivation below used to sit inline in `buildIndex`, reachable only by building a temp tree
// and reading the finished graph back. Both import-resolution bugs this repo has shipped lived in
// one of them — ripgrep's `crates/core/main.rs` (no `src/`, so a Cargo-derived crate root missed a
// third of the workspace) and the Vite template's solution-style `references` (every `paths` entry
// in a file no basename check opens). Neither was addressable by a unit test, because neither was a
// unit. Behind the seam they are pure functions of a file list and some text, so they are.

/** A file list as the index shapes it, from paths alone. */
const filesOf = (...paths) => paths.map((path) => ({ path }));

/** A reader over literal text: the injected half of `prepare`, with no tree on disk. */
function reader(map = {}) {
  const asked = [];
  const read = (rel) => {
    asked.push(rel);
    return Object.prototype.hasOwnProperty.call(map, rel) ? map[rel] : null;
  };
  read.asked = asked;
  return read;
}

const adapterFor = (lang) => ADAPTERS.find((a) => a.langs.includes(lang));
const prepareFor = (lang, files, readText = reader()) =>
  adapterFor(lang).prepare({ files, root: "/repo", fileSet: new Set(files.map((f) => f.path)), readText });

// --- the seam itself ------------------------------------------------------------------------------

test("every language resolves through one call, and it always answers with an array", () => {
  // The shape is the whole point. Go resolves one specifier to many files and everything else to
  // one or none; when that asymmetry reached the builder it became a six-deep ternary that had to
  // know, per language, which of two shapes it was about to get back.
  const files = filesOf("src/a.ts", "src/b.ts", "main.go", "src/lib.rs", "x.py", "run.sh");
  const { resolve } = importResolver(files, "/repo", reader());
  for (const lang of ["typescript", "go", "rust", "java", "php", "ruby", "python", "shell"]) {
    const got = resolve("./nothing-like-this", { path: "src/a.ts", lang });
    assert.ok(Array.isArray(got), `${lang} did not answer with an array`);
  }
});

test("no two adapters claim the same language", () => {
  const seen = new Set();
  for (const a of ADAPTERS) {
    for (const lang of a.langs) {
      assert.ok(!seen.has(lang), `${lang} is claimed by two adapters`);
      seen.add(lang);
    }
  }
});

test("a language with no adapter keeps the builder's old catch-all, not silence", () => {
  // Before the seam, anything that was not go/rust/java/php/ruby fell through to `resolveImport`,
  // whose final branch resolves a specifier that is literally a path in this repo. A language whose
  // imports are extracted but whose resolver was never written must land there — returning nothing
  // would read downstream as "no importers", which is the one thing the report may not say when it
  // means "I did not look".
  const files = filesOf("lib/thing.ex", "lib/other.ex");
  const { resolve } = importResolver(files, "/repo", reader());
  assert.deepEqual(resolve("lib/thing.ex", { path: "lib/other.ex", lang: "elixir" }), ["lib/thing.ex"]);
  assert.deepEqual(resolve("Enum", { path: "lib/other.ex", lang: "elixir" }), []);
});

test("preparing twice over the same inputs gives the same answer", () => {
  // Determinism is asserted end-to-end in build.test.mjs; this is the same promise one layer down,
  // where a `prepare` could reach for a clock or a filesystem without the index test noticing.
  const files = filesOf("go.mod", "main.go", "src/lib.rs", "composer.json", "app/Thing.php");
  const readText = reader({
    "go.mod": "module example.com/m\n",
    "composer.json": '{"autoload":{"psr-4":{"App\\\\":"app/"}}}',
  });
  for (const a of ADAPTERS) {
    const env = { files, root: "/repo", fileSet: new Set(files.map((f) => f.path)), readText };
    assert.deepEqual(a.prepare(env), a.prepare(env), `${a.id} is not a pure function of its inputs`);
  }
});

// --- Go: the module path, and a package that is a directory ---------------------------------------

test("go.mod names the module, and a package resolves to every non-test file in its directory", () => {
  const files = filesOf(
    "go.mod",
    "main.go",
    "cmd/serve/serve.go",
    "cmd/serve/flags.go",
    "cmd/serve/serve_test.go",
  );
  const ctx = prepareFor("go", files, reader({ "go.mod": "// a comment\nmodule github.com/acme/tool\n\ngo 1.22\n" }));

  assert.equal(ctx.moduleName, "github.com/acme/tool");
  assert.deepEqual(ctx.byDir.get("cmd/serve"), ["cmd/serve/serve.go", "cmd/serve/flags.go"]);
  assert.ok(!ctx.byDir.get("cmd/serve").includes("cmd/serve/serve_test.go"), "importing a package does not give you its tests");
  assert.deepEqual(ctx.byDir.get(""), ["main.go"], "the module root is keyed as the empty directory");

  const go = adapterFor("go");
  const from = { path: "main.go", lang: "go" };
  assert.deepEqual(go.resolve("github.com/acme/tool/cmd/serve", from, ctx), [
    "cmd/serve/serve.go",
    "cmd/serve/flags.go",
  ]);
  assert.deepEqual(go.resolve("github.com/spf13/cobra", from, ctx), [], "another module is a dependency, not a file here");
  assert.deepEqual(go.resolve("fmt", from, ctx), []);
});

test("no go.mod means no module path and nothing to index by directory", () => {
  // The distinction UNRESOLVED_LANGUAGES exists to keep: a repo with .go files and no manifest has
  // no module path, so no import can be told from an external package, and inventing one would put
  // an edge in the graph that nothing can tell from a true one.
  const ctx = prepareFor("go", filesOf("main.go", "pkg/x.go"));
  assert.equal(ctx.moduleName, null);
  assert.equal(ctx.byDir.size, 0);
  assert.deepEqual(adapterFor("go").resolve("anything/at/all", { path: "main.go", lang: "go" }, ctx), []);
});

// --- Rust: crate roots come from where lib.rs/main.rs sit ------------------------------------------

test("crate roots are read off lib.rs/main.rs, including a binary crate with no src/", () => {
  // ripgrep's layout exactly. `crates/core/main.rs` has no `src/` directory, so deriving the root
  // from Cargo.toml + "/src" missed every import in it — a third of the workspace, and silently.
  const files = filesOf(
    "crates/core/main.rs",
    "crates/core/args.rs",
    "crates/printer/src/lib.rs",
    "crates/printer/src/color.rs",
    "crates/printer/src/json.rs",
  );
  const ctx = prepareFor("rust", files);
  assert.deepEqual(ctx.crateRoots, ["crates/printer/src", "crates/core"], "longest first");

  const rust = adapterFor("rust");
  assert.deepEqual(rust.resolve("args", { path: "crates/core/main.rs", lang: "rust" }, ctx), ["crates/core/args.rs"]);
  assert.deepEqual(rust.resolve("color", { path: "crates/printer/src/lib.rs", lang: "rust" }, ctx), [
    "crates/printer/src/color.rs",
  ]);
});

test("`crate::` is relative to the crate a file belongs to, never the workspace", () => {
  // Matching the shortest root, or a single workspace root, would send every member's imports to
  // the same place — the core crate would resolve `crate::color` into the printer crate's file.
  const files = filesOf("crates/core/main.rs", "crates/printer/src/lib.rs", "crates/printer/src/color.rs");
  const ctx = prepareFor("rust", files);
  assert.deepEqual(
    adapterFor("rust").resolve("color::Printer", { path: "crates/core/main.rs", lang: "rust" }, ctx),
    [],
    "core has no color module; the printer's must not be borrowed for it",
  );
});

test("a `use crate::` path is shortened until it lands on a file, because the tail is a type", () => {
  const files = filesOf("src/lib.rs", "src/json.rs");
  const ctx = prepareFor("rust", files);
  assert.deepEqual(ctx.crateRoots, ["src"]);
  assert.deepEqual(adapterFor("rust").resolve("json::Printer", { path: "src/lib.rs", lang: "rust" }, ctx), [
    "src/json.rs",
  ]);
});

// --- Java: the source root a package path hangs off -------------------------------------------------

test("java source roots are the src/main/java prefixes, and a flat repo still resolves", () => {
  const maven = filesOf(
    "src/main/java/com/acme/Thing.java",
    "src/main/java/com/acme/util/Helper.java",
    "src/test/java/com/acme/ThingTest.java",
  );
  assert.deepEqual(
    new Set(prepareFor("java", maven).sourceRoots),
    new Set(["src/main/java", "src/test/java"]),
  );

  const flat = filesOf("com/acme/Thing.java");
  assert.deepEqual(prepareFor("java", flat).sourceRoots, [""], "no Maven layout is still a layout");
});

test("a java import resolves under a source root, and a third-party package stays external", () => {
  const files = filesOf("src/main/java/com/acme/Thing.java", "src/main/java/com/acme/util/Helper.java");
  const ctx = prepareFor("java", files);
  const from = { path: "src/main/java/com/acme/Thing.java", lang: "java" };
  assert.deepEqual(adapterFor("java").resolve("com.acme.util.Helper", from, ctx), [
    "src/main/java/com/acme/util/Helper.java",
  ]);
  assert.deepEqual(adapterFor("java").resolve("java.util.List", from, ctx), []);
  // `import static a.b.C.method` names a member, so the path shortens until it lands on a file.
  assert.deepEqual(adapterFor("java").resolve("com.acme.util.Helper.trim", from, ctx), [
    "src/main/java/com/acme/util/Helper.java",
  ]);
});

// --- PHP: PSR-4 prefixes are declared in composer.json ----------------------------------------------

test("psr-4 prefixes are read from composer.json, longest prefix first", () => {
  const files = filesOf("composer.json", "Slim/App.php", "Slim/Routing/Route.php");
  const ctx = prepareFor(
    "php",
    files,
    reader({
      "composer.json": '{"autoload":{"psr-4":{"Slim\\\\":"Slim/","Slim\\\\Routing\\\\":"Slim/Routing/"}}}',
    }),
  );
  assert.deepEqual(ctx.prefixes[0][0], "Slim\\Routing\\", "the specific namespace must beat the umbrella one");

  const from = { path: "Slim/App.php", lang: "php" };
  assert.deepEqual(adapterFor("php").resolve("Slim\\Routing\\Route", from, ctx), ["Slim/Routing/Route.php"]);
  assert.deepEqual(adapterFor("php").resolve("Psr\\Log\\LoggerInterface", from, ctx), [], "an undeclared namespace is a vendor package");
});

test("a nested composer.json maps its prefixes under its own directory", () => {
  const files = filesOf("packages/api/composer.json", "packages/api/src/Handler.php");
  const ctx = prepareFor(
    "php",
    files,
    reader({ "packages/api/composer.json": '{"autoload":{"psr-4":{"Api\\\\":"src/"}}}' }),
  );
  assert.deepEqual(ctx.prefixes, [["Api\\", "packages/api/src"]]);
});

test("a composer.json that cannot be read or parsed costs its own prefixes and nothing else", () => {
  const files = filesOf("composer.json", "packages/api/composer.json", "packages/api/src/Handler.php");
  const ctx = prepareFor(
    "php",
    files,
    reader({
      "composer.json": "{ not json",
      "packages/api/composer.json": '{"autoload":{"psr-4":{"Api\\\\":"src/"}}}',
    }),
  );
  assert.deepEqual(ctx.prefixes, [["Api\\", "packages/api/src"]]);
});

test("a composer.json holding nothing an autoloader would recognise is not a crash", () => {
  // Valid JSON, no autoload block, and — the shape that used to throw outside the try — a literal
  // `null`. A manifest may only ever cost its own prefixes.
  for (const body of ["null", "{}", '{"autoload":null}', "[]"]) {
    const ctx = prepareFor("php", filesOf("composer.json"), reader({ "composer.json": body }));
    assert.deepEqual(ctx.prefixes, [], `${body} should cost nothing`);
  }
});

// --- Ruby: the load path is lib/ ---------------------------------------------------------------------

test("ruby load paths are the lib/ prefixes, and a bare require searches them", () => {
  const files = filesOf("lib/sinatra/base.rb", "lib/sinatra/main.rb", "test/base_test.rb");
  const ctx = prepareFor("ruby", files);
  assert.deepEqual(ctx.loadPaths, ["lib", ""]);

  const ruby = adapterFor("ruby");
  assert.deepEqual(ruby.resolve("sinatra/base", { path: "test/base_test.rb", lang: "ruby" }, ctx), [
    "lib/sinatra/base.rb",
  ]);
  assert.deepEqual(ruby.resolve("rack", { path: "test/base_test.rb", lang: "ruby" }, ctx), [], "a gem is external");
  // `require_relative` arrives tagged with `./` and resolves against the requiring file instead.
  assert.deepEqual(ruby.resolve("./main", { path: "lib/sinatra/base.rb", lang: "ruby" }, ctx), [
    "lib/sinatra/main.rb",
  ]);
});

// --- JavaScript: the alias table, and the order the two resolvers are tried in ------------------------

test("alias tables are discovered from literal config text, through extends and references", () => {
  const files = filesOf("tsconfig.json", "tsconfig.app.json", "src/main.tsx", "src/shared/fmt.ts");
  const tables = tsAliasTables(
    files,
    reader({
      "tsconfig.json": '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
      "tsconfig.app.json": '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }',
    }),
  );
  assert.equal(tables.length, 1, "three configs at one directory merge into one table");
  assert.deepEqual(tables[0].entries[0], { key: "@/*", targets: ["src/*"], star: true });
});

test("a relative specifier is resolved before any alias is consulted", () => {
  // Strictly additive, and that ordering is the whole reason a repo declaring aliases cannot get a
  // different graph for the imports it wrote relatively.
  const files = filesOf("tsconfig.json", "src/a.ts", "src/b.ts", "other/b.ts");
  const readText = reader({
    "tsconfig.json": '{ "compilerOptions": { "paths": { "./b": ["./other/b"] } } }',
  });
  const { resolve } = importResolver(files, "/repo", readText);
  assert.deepEqual(resolve("./b", { path: "src/a.ts", lang: "typescript" }), ["src/b.ts"]);
});

test("the nearest config governs, and a package never resolves through another's aliases", () => {
  // Both configs declare the same key against `./src/*`, so a table keyed anywhere but at the
  // config's own directory points both packages at one `src/` — or at each other's files.
  const files = filesOf(
    "tsconfig.json",
    "packages/app/tsconfig.json",
    "packages/app/src/main.ts",
    "packages/app/src/util.ts",
    "src/main.ts",
    "src/util.ts",
  );
  const readText = reader({
    "tsconfig.json": '{ "compilerOptions": { "paths": { "~/*": ["./src/*"] } } }',
    "packages/app/tsconfig.json": '{ "compilerOptions": { "paths": { "~/*": ["./src/*"] } } }',
  });
  const { resolve } = importResolver(files, "/repo", readText);
  assert.deepEqual(resolve("~/util", { path: "packages/app/src/main.ts", lang: "typescript" }), [
    "packages/app/src/util.ts",
  ]);
  assert.deepEqual(resolve("~/util", { path: "src/main.ts", lang: "typescript" }), ["src/util.ts"]);
});

test("a repo declaring no config asks for no config, and resolves relatively regardless", () => {
  const files = filesOf("src/a.js", "src/b.js");
  const readText = reader();
  const { resolve } = importResolver(files, "/repo", readText);
  assert.deepEqual(resolve("./b", { path: "src/a.js", lang: "javascript" }), ["src/b.js"]);
  assert.deepEqual(resolve("@/ghost", { path: "src/a.js", lang: "javascript" }), []);
  assert.deepEqual(
    readText.asked.filter((p) => p.endsWith("config.json")),
    [],
    "no tsconfig in the file list means none is opened",
  );
});

test("vue and svelte read the same aliases as the language they are written in", () => {
  const files = filesOf("tsconfig.json", "src/App.vue", "src/Card.svelte", "src/lib/fmt.ts");
  const readText = reader({ "tsconfig.json": '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }' });
  const { resolve } = importResolver(files, "/repo", readText);
  assert.deepEqual(resolve("@/lib/fmt", { path: "src/App.vue", lang: "vue" }), ["src/lib/fmt.ts"]);
  assert.deepEqual(resolve("@/lib/fmt", { path: "src/Card.svelte", lang: "svelte" }), ["src/lib/fmt.ts"]);
});

// --- JavaScript: workspace packages ------------------------------------------------------------------
//
// A pnpm or npm monorepo imports its own packages by NAME — `import { Button } from "@acme/ui"` —
// and a name is not a path, so every one of those edges read as an external package. On a
// four-package workspace that was 0 of 20 cross-package imports, and the shared packages every app
// depends on read as orphans. The mapping is declared twice over (the workspace globs, then each
// package's own `name`), so reading it is not a guess.

const WS_FILES = filesOf(
  "package.json",
  "pnpm-workspace.yaml",
  "apps/web/package.json",
  "apps/web/src/main.tsx",
  "packages/ui/package.json",
  "packages/ui/src/index.ts",
  "packages/ui/src/Button.tsx",
  "packages/api/package.json",
  "packages/api/src/index.ts",
  "packages/api/src/errors.ts",
);

const wsReader = (extra = {}) =>
  reader({
    "package.json": '{ "name": "root", "private": true }',
    // CRLF on purpose: a Windows checkout writes the manifest this way, and a parser that splits
    // on "\n" alone reads `packages/*\r` — a glob that matches nothing.
    "pnpm-workspace.yaml": 'packages:\r\n  - "apps/*"\r\n  - \'packages/*\'  # shared code\r\n',
    "apps/web/package.json": '{ "name": "@acme/web" }',
    "packages/ui/package.json": '{ "name": "@acme/ui", "exports": { ".": "./src/index.ts" } }',
    "packages/api/package.json": '{ "name": "@acme/api", "main": "./dist/index.js" }',
    ...extra,
  });

test("a workspace package imported by name resolves to its declared entry", () => {
  const { resolve } = importResolver(WS_FILES, "/repo", wsReader());
  assert.deepEqual(resolve("@acme/ui", { path: "apps/web/src/main.tsx", lang: "typescript" }), ["packages/ui/src/index.ts"]);
});

test("an entry that points at build output nobody committed falls back to src/index", () => {
  // `main: ./dist/index.js` is what the package publishes; dist/ is not in the repo, so the edge
  // lands on the source the build is made from rather than on nothing.
  const { resolve } = importResolver(WS_FILES, "/repo", wsReader());
  assert.deepEqual(resolve("@acme/api", { path: "apps/web/src/main.tsx", lang: "typescript" }), ["packages/api/src/index.ts"]);
});

test("the entry order is exports, module, main, types, then src/index, then index", () => {
  const files = filesOf("package.json", "p/package.json", "p/lib/mod.js", "p/lib/main.js", "p/lib/types.d.ts", "p/src/index.ts", "p/index.js", "a.ts");
  const at = (manifest, list = files) =>
    importResolver(list, "/repo", reader({ "package.json": '{ "workspaces": ["p"] }', "p/package.json": manifest }))
      .resolve("pkg", { path: "a.ts", lang: "typescript" });
  assert.deepEqual(at('{ "name": "pkg", "exports": { ".": { "import": "./lib/mod.js" } }, "main": "./lib/main.js" }'), ["p/lib/mod.js"]);
  assert.deepEqual(at('{ "name": "pkg", "exports": "./lib/main.js", "module": "./lib/mod.js" }'), ["p/lib/main.js"]);
  assert.deepEqual(at('{ "name": "pkg", "module": "./lib/mod.js", "main": "./lib/main.js" }'), ["p/lib/mod.js"]);
  assert.deepEqual(at('{ "name": "pkg", "main": "./lib/main.js", "types": "./lib/types.d.ts" }'), ["p/lib/main.js"]);
  assert.deepEqual(at('{ "name": "pkg", "types": "./lib/types.d.ts" }'), ["p/lib/types.d.ts"]);
  assert.deepEqual(at('{ "name": "pkg" }'), ["p/src/index.ts"]);
  assert.deepEqual(at('{ "name": "pkg" }', filesOf("package.json", "p/package.json", "p/index.js", "a.ts")), ["p/index.js"]);
});

test("a subpath import resolves to the matching file under the package", () => {
  const { resolve } = importResolver(WS_FILES, "/repo", wsReader());
  const from = { path: "apps/web/src/main.tsx", lang: "typescript" };
  assert.deepEqual(resolve("@acme/ui/src/Button", from), ["packages/ui/src/Button.tsx"]);
  assert.deepEqual(resolve("@acme/api/errors", from), ["packages/api/src/errors.ts"], "src/ is tried when the path misses");
  assert.deepEqual(resolve("@acme/ui/nothing-here", from), [], "a subpath that is not a file is not an edge");
});

test("an exports subpath map is read before the directory is guessed at", () => {
  const files = filesOf("package.json", "p/package.json", "p/src/forms/field.ts", "p/src/theme.ts", "a.ts");
  const readText = reader({
    "package.json": '{ "workspaces": { "packages": ["p"] } }',
    "p/package.json": '{ "name": "@x/p", "exports": { "./theme": "./src/theme.ts", "./forms/*": "./src/forms/*.ts" } }',
  });
  const { resolve } = importResolver(files, "/repo", readText);
  assert.deepEqual(resolve("@x/p/theme", { path: "a.ts", lang: "typescript" }), ["p/src/theme.ts"]);
  assert.deepEqual(resolve("@x/p/forms/field", { path: "a.ts", lang: "typescript" }), ["p/src/forms/field.ts"]);
});

test("only a package the workspace declares is one: an undeclared or excluded directory stays external", () => {
  const files = filesOf(
    "package.json",
    "packages/ui/package.json",
    "packages/ui/src/index.ts",
    "packages/legacy/package.json",
    "packages/legacy/src/index.ts",
    "tools/gen/package.json",
    "tools/gen/src/index.ts",
    "a.ts",
  );
  const readText = reader({
    "package.json": '{ "workspaces": ["packages/*", "!packages/legacy"] }',
    "packages/ui/package.json": '{ "name": "ui" }',
    "packages/legacy/package.json": '{ "name": "legacy" }',
    "tools/gen/package.json": '{ "name": "gen" }',
  });
  const { resolve } = importResolver(files, "/repo", readText);
  const from = { path: "a.ts", lang: "typescript" };
  assert.deepEqual(resolve("ui", from), ["packages/ui/src/index.ts"]);
  assert.deepEqual(resolve("legacy", from), [], "a negated glob excludes the package");
  assert.deepEqual(resolve("gen", from), [], "a package.json no workspace glob matches is not a workspace package");
  assert.deepEqual(resolve("react", from), [], "a real npm package stays external");
  assert.deepEqual(resolve("ui-kit", from), [], "a name is matched whole, never by prefix");
});

test("a `**` workspace glob reaches packages at any depth", () => {
  const files = filesOf("package.json", "libs/core/net/package.json", "libs/core/net/src/index.ts", "a.ts");
  const readText = reader({ "package.json": '{ "workspaces": ["libs/**"] }', "libs/core/net/package.json": '{ "name": "@x/net" }' });
  const { resolve } = importResolver(files, "/repo", readText);
  assert.deepEqual(resolve("@x/net", { path: "a.ts", lang: "typescript" }), ["libs/core/net/src/index.ts"]);
});

test("a repo declaring no workspace resolves exactly as before, and a broken manifest costs only itself", () => {
  const files = filesOf("package.json", "packages/ui/package.json", "packages/ui/src/index.ts", "a.ts");
  const none = importResolver(files, "/repo", reader({ "package.json": '{ "name": "solo" }', "packages/ui/package.json": '{ "name": "ui" }' }));
  assert.deepEqual(none.resolve("ui", { path: "a.ts", lang: "typescript" }), []);
  const broken = importResolver(files, "/repo", reader({ "package.json": '{ "workspaces": ["packages/*"] }', "packages/ui/package.json": "{ nope" }));
  assert.deepEqual(broken.resolve("ui", { path: "a.ts", lang: "typescript" }), []);
});

test("a relative import never reaches the workspace pass", () => {
  const files = filesOf(...WS_FILES.map((f) => f.path), "apps/web/src/@acme/ui.ts");
  const { resolve } = importResolver(files, "/repo", wsReader());
  assert.deepEqual(resolve("./@acme/ui", { path: "apps/web/src/main.tsx", lang: "typescript" }), ["apps/web/src/@acme/ui.ts"]);
});
