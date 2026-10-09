// T4 rule (R4): no module under src/routes/ has an import, static or dynamic, that resolves into
// src/store/ or to a repository.js. Read off the source text, since an import is a fact of the file
// and not of a run. It does not depend on what any function is called.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { TREE } from "./lib.mjs";

const SRC = join(TREE, "src");
const ROUTES = join(SRC, "routes");

function modules(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const at = join(dir, name);
    if (statSync(at).isDirectory()) out.push(...modules(at));
    else if (/\.[cm]?js$/.test(name)) out.push(at);
  }
  return out;
}

// Every module specifier in a file: `import … from "x"`, `export … from "x"`, `import "x"`,
// `import("x")` and `require("x")`.
function specifiers(text) {
  const found = [];
  const patterns = [
    /\b(?:import|export)\b[^;'"`]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\b(?:import|require)\s*\(\s*["'`]([^"'`]+)["'`]/g,
  ];
  for (const pattern of patterns) for (const m of text.matchAll(pattern)) found.push(m[1]);
  return found;
}

// Where a relative specifier lands, as a path under src/ with forward slashes. Null for a package
// or a node: built-in.
function target(file, specifier) {
  if (!specifier.startsWith(".")) return null;
  return relative(SRC, resolve(dirname(file), specifier)).split("\\").join("/");
}

const forbidden = (to) => to === "store" || to.startsWith("store/") || /(^|\/)repository(\.[cm]?js)?$/.test(to);

test("src/routes/ still holds the route modules", () => {
  assert.ok(existsSync(ROUTES), "src/routes/ is gone");
  assert.ok(modules(ROUTES).length >= 4, "src/routes/ holds fewer modules than it started with");
});

test("no module under src/routes/ imports from src/store/ or a repository.js", () => {
  const broken = [];
  for (const file of modules(ROUTES)) {
    for (const specifier of specifiers(readFileSync(file, "utf8"))) {
      const to = target(file, specifier);
      if (to !== null && forbidden(to)) broken.push(`${relative(TREE, file).split("\\").join("/")} imports ${specifier}`);
    }
  }
  assert.deepEqual(broken, []);
});
