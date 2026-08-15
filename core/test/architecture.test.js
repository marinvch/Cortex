import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The dependency rule, made executable.
//
//        core/          shared kernel — depends on nothing in this repo
//       /     \
//   index/    mcp/      leaves — depend on core, never on each other
//
// Layering rots quietly: one convenient import and two packages are welded together. A test is
// cheaper than remembering. This one failed before core/ existed — index/ was importing the
// secret scanner and a date helper straight out of mcp/lib/.

const IMPORT_RE = /(?:^|\n)\s*(?:import[^'"]*?|export[^'"]*?)from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules") continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|mjs)$/.test(name)) out.push(p);
    }
  };
  walk(join(REPO_ROOT, dir));
  return out;
}

/** Local (relative) import specifiers only — package imports are irrelevant to layering. */
function localImports(file) {
  const src = readFileSync(file, "utf8");
  const out = [];
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const spec = m[1] || m[2];
    if (spec && spec.startsWith(".")) out.push(spec);
  }
  return out;
}

/** Where a relative specifier lands, as a repo-relative POSIX path. */
function resolveTo(file, spec) {
  return relative(REPO_ROOT, join(dirname(file), spec)).split("\\").join("/");
}

test("core/ depends on nothing else in this repo", () => {
  const offenders = [];
  for (const file of sourceFiles("core")) {
    for (const spec of localImports(file)) {
      const target = resolveTo(file, spec);
      if (!target.startsWith("core/")) {
        offenders.push(`${relative(REPO_ROOT, file)} → ${target}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "core is the kernel: it may not reach up into index/ or mcp/");
});

test("index/ never imports from mcp/", () => {
  const offenders = [];
  for (const file of sourceFiles("index")) {
    for (const spec of localImports(file)) {
      const target = resolveTo(file, spec);
      if (target.startsWith("mcp/")) offenders.push(`${relative(REPO_ROOT, file)} → ${target}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "the indexer and the MCP server are siblings; shared code belongs in core/",
  );
});

test("mcp/ never imports from index/", () => {
  const offenders = [];
  for (const file of sourceFiles("mcp")) {
    for (const spec of localImports(file)) {
      const target = resolveTo(file, spec);
      if (target.startsWith("index/")) offenders.push(`${relative(REPO_ROOT, file)} → ${target}`);
    }
  }
  assert.deepEqual(offenders, [], "the MCP server must not depend on the indexer");
});

// Production sources only. A test that exercises import PARSING legitimately contains fake
// specifiers in its fixtures ("./a.js", "../c"), and a regex cannot tell those from real imports.
// The layering rules above still cover tests, where a wrong import is a genuine architecture leak.
test("every local import in a source file resolves to a file that exists", () => {
  const broken = [];
  for (const dir of ["core", "index", "mcp"]) {
    for (const file of sourceFiles(dir)) {
      if (/[\\/]test[\\/]/.test(file) || /\.test\.[mc]?js$/.test(file)) continue;
      for (const spec of localImports(file)) {
        const target = join(dirname(file), spec);
        if (!existsSync(target)) broken.push(`${relative(REPO_ROOT, file)} → ${spec}`);
      }
    }
  }
  assert.deepEqual(broken, [], "a moved module left a dangling import");
});
