import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Installing a plugin CLONES the repository. Nothing runs `npm install`, and no lockfile is
// honoured — so a dependency declared in a package.json is simply absent on the user's machine.
// This was not theoretical: v2.1.0 shipped an `mcpServers` entry whose very first import was
// `@modelcontextprotocol/sdk`, so the brain died with ERR_MODULE_NOT_FOUND on every fresh install
// while passing every test here, because this development machine had `mcp/node_modules`.
//
// The environment is what hid it, so the environment is what this test refuses to trust: it reads
// the source rather than trying to import it. A temp-directory spawn would prove nothing — Node
// resolves `node_modules` by walking up, and on a normal machine the OS temp directory sits under
// a home directory that has one.

/** Directories whose code actually runs on a user's machine after an install. */
const SHIPPED = ["core", "index", "mcp"];

/** Files that exist to test the shipped code, and are never executed by an install. */
const isTestFile = (rel) =>
  rel.split(sep).includes("test") || /\.test\.[cm]?js$/.test(rel);

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.[cm]?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every module specifier imported or re-exported by `src`, in source order. */
function specifiers(src) {
  const found = [];
  const patterns = [
    /^\s*import\s+[^'"]*from\s*['"]([^'"]+)['"]/gm, // import x from "y"
    /^\s*import\s*['"]([^'"]+)['"]/gm, //             import "y"
    /^\s*export\s+[^'"]*from\s*['"]([^'"]+)['"]/gm, // export * from "y"
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, //      await import("y")
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, //     require("y")
  ];
  for (const re of patterns) for (const m of src.matchAll(re)) found.push(m[1]);
  return found;
}

const isRelative = (s) => s.startsWith("./") || s.startsWith("../") || s.startsWith("/");
const isBuiltin = (s) =>
  s.startsWith("node:") || builtinModules.includes(s.split("/")[0]);

test("no shipped module imports a package that an install would not provide", () => {
  const offenders = [];
  for (const area of SHIPPED) {
    const dir = join(REPO_ROOT, area);
    if (!existsSync(dir)) continue;
    for (const file of sourceFiles(dir)) {
      const rel = relative(REPO_ROOT, file);
      if (isTestFile(rel)) continue;
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        if (isRelative(spec) || isBuiltin(spec)) continue;
        offenders.push(`${rel} imports '${spec}'`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a plugin install does not run npm install — these imports resolve here and nowhere else",
  );
});

test("no shipped package.json declares runtime dependencies", () => {
  // The declaration is the thing that makes a missing package look intentional and supported.
  // Removing the import but leaving the dependency invites the next edit to import it again.
  const offenders = [];
  for (const area of SHIPPED) {
    const pkgPath = join(REPO_ROOT, area, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const deps = Object.keys(pkg.dependencies ?? {});
    if (deps.length) offenders.push(`${area}/package.json declares ${deps.join(", ")}`);
  }
  assert.deepEqual(offenders, [], "an installed plugin has no node_modules to satisfy these");
});

test("every ESM file resolves as ESM without relying on Node's syntax fallback", () => {
  // A `.js` file containing `import` is only treated as a module if some package.json above it
  // says `"type": "module"`. Without one, Node reparses it and prints MODULE_TYPELESS_PACKAGE_JSON
  // — and the nearest package.json it finds is whatever happens to sit above the install
  // directory. If that one says "commonjs", the file does not merely warn, it fails to load.
  const offenders = [];
  for (const area of SHIPPED) {
    const dir = join(REPO_ROOT, area);
    if (!existsSync(dir)) continue;
    for (const file of sourceFiles(dir)) {
      const rel = relative(REPO_ROOT, file);
      if (file.endsWith(".mjs")) continue; // extension already settles it
      const src = readFileSync(file, "utf8");
      if (!/^\s*(import|export)\s/m.test(src)) continue;
      if (!typeModuleAbove(file)) offenders.push(rel);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these .js files use ESM syntax with no `\"type\": \"module\"` above them",
  );
});

/** Walk up from `file` to REPO_ROOT looking for the package.json Node would apply. */
function typeModuleAbove(file) {
  let dir = dirname(file);
  for (;;) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath) && statSync(pkgPath).isFile()) {
      try {
        return JSON.parse(readFileSync(pkgPath, "utf8")).type === "module";
      } catch {
        return false;
      }
    }
    if (dir === REPO_ROOT) return false; // nothing inside the repo settled it
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

test("the agents the rituals dispatch are where an installed plugin looks for them", () => {
  // Claude Code loads a plugin's subagents from `agents/` at the plugin root. `.claude/agents/` is
  // project-local: it works in this checkout and ships to nobody. A ritual naming a subagent that
  // does not exist fails at the moment the user runs it.
  const named = new Set();
  const skillsDir = join(REPO_ROOT, "skills");
  for (const name of readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory())) {
    const file = join(skillsDir, name, "SKILL.md");
    if (!existsSync(file)) continue;
    for (const m of readFileSync(file, "utf8").matchAll(/subagent_type:\s*`?([a-z][a-z0-9-]*)`?/g)) {
      named.add(m[1]);
    }
  }
  assert.ok(named.size, "expected at least one ritual to dispatch a subagent");

  const agentsDir = join(REPO_ROOT, "agents");
  const shipped = new Set(
    existsSync(agentsDir)
      ? readdirSync(agentsDir).filter((n) => n.endsWith(".md")).map((n) => n.replace(/\.md$/, ""))
      : [],
  );
  assert.deepEqual(
    [...named].filter((n) => !shipped.has(n)),
    [],
    "dispatched by a ritual but not shipped in agents/",
  );
});
