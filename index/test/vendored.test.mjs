import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vendoredPaths, partitionVendored, vendoredStats } from "../lib/vendored.mjs";
import { buildIndex } from "../lib/build.mjs";
import { briefCandidates } from "../lib/layers.mjs";
import { computeBatches, scopeFilter, isEnrichable } from "../lib/batch.mjs";

function repo(attributes, files) {
  const root = mkdtempSync(join(tmpdir(), "cortex-vend-"));
  execFileSync("git", ["init", "-q", "."], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: root });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  if (attributes !== null) writeFileSync(join(root, ".gitattributes"), attributes);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "i"], { cwd: root });
  return root;
}

const BODY = "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n";

test("vendored is declared in .gitattributes, never inferred from a name", () => {
  // The same rule as go.mod and composer.json. A directory called "vendor" that a team actually
  // writes is theirs, and guessing from the name would silently drop it from every ranking.
  const root = repo(".agents/** linguist-vendored\n", {
    ".agents/lib.js": BODY,
    "src/app.js": BODY,
  });
  const marked = vendoredPaths(root, [".agents/lib.js", "src/app.js"]);
  assert.deepEqual([...marked], [".agents/lib.js"]);
});

test("linguist-generated counts too", () => {
  const root = repo("gen/** linguist-generated\n", { "gen/api.js": BODY, "src/app.js": BODY });
  assert.deepEqual([...vendoredPaths(root, ["gen/api.js", "src/app.js"])], ["gen/api.js"]);
});

test("a repo that declares nothing has nothing vendored", () => {
  // The mechanism must be invisible to every repo that has not opted in.
  const root = repo(null, { ".agents/lib.js": BODY, "src/app.js": BODY });
  assert.equal(vendoredPaths(root, [".agents/lib.js", "src/app.js"]).size, 0);
  const idx = buildIndex(root);
  assert.ok(idx.files.every((f) => f.vendored === false));
  assert.equal(idx.stats.vendored.files, 0);
});

test("vendored files stay in the index — it is git truth, not a filtered view", () => {
  // Dropping them would be worse than ranking them wrong: a file you cannot see cannot be checked.
  const root = repo(".agents/** linguist-vendored\n", { ".agents/lib.js": BODY, "src/app.js": BODY });
  const idx = buildIndex(root);
  assert.ok(idx.files.some((f) => f.path === ".agents/lib.js"), "still indexed");
  assert.equal(idx.files.find((f) => f.path === ".agents/lib.js").vendored, true);
  assert.equal(idx.stats.vendored.files, 1);
  assert.equal(idx.stats.vendored.dirs[0].dir, ".agents");
});

test("a scoped-brief candidate is never somebody else's code", () => {
  // On a real repo the top three candidates were a plugin cache, a generated server and another
  // tool's instruction files, with the actual application fourth. Nobody edits vendored code, so a
  // brief for it is context every session pays for and nobody uses.
  const files = [
    ...Array.from({ length: 8 }, (_, i) => ({ path: `.agents/skills/v${i}.ts`, category: "code", lines: 400, vendored: true })),
    ...Array.from({ length: 6 }, (_, i) => ({ path: `src/components/c${i}.ts`, category: "code", lines: 50, vendored: false })),
  ];
  const dirs = briefCandidates(files, { minFiles: 5 }).map((c) => c.dir);
  assert.ok(dirs.includes("src/components"), "real code is a candidate");
  assert.ok(!dirs.some((d) => d.startsWith(".agents")), "vendored code is not");
});

test("enrichment does not pay a model call for vendored code", () => {
  assert.equal(isEnrichable({ lines: 100, category: "code", vendored: true }), false);
  assert.equal(isEnrichable({ lines: 100, category: "code", vendored: false }), true);
});

test("scopeFilter narrows and excludes by path prefix, include first", () => {
  const f = scopeFilter({ include: ["src"], exclude: ["src/generated"] });
  assert.equal(f("src/app.ts"), true);
  assert.equal(f("src/generated/api.ts"), false, "exclude wins inside an include");
  assert.equal(f("docs/readme.md"), false, "outside the include");
  // A prefix must not match a sibling that merely starts with the same letters.
  assert.equal(scopeFilter({ include: ["src"] })("srcextra/a.ts"), false);
  // Trailing slashes and ./ are how people actually type these.
  assert.equal(scopeFilter({ include: ["./src/"] })("src/a.ts"), true);
});

test("a plan records its scope, so a partial run is not mistaken for an interrupted one", () => {
  const index = {
    commit: "abc",
    areas: [
      { name: "src", paths: ["src/a.ts", "src/b.ts"] },
      { name: "docs", paths: ["docs/x.md"] },
    ],
    edges: [],
    files: [
      { path: "src/a.ts", category: "code", lines: 40, vendored: false, imports: [] },
      { path: "src/b.ts", category: "code", lines: 40, vendored: false, imports: [] },
      { path: "docs/x.md", category: "docs", lines: 40, vendored: false, imports: [] },
    ],
  };
  // A batch carries file records, not bare paths.
  const paths = (batches) => batches.flatMap((b) => b.files).map((f) => f.path);
  assert.ok(paths(computeBatches(index)).includes("docs/x.md"), "unscoped covers docs");
  assert.ok(!paths(computeBatches(index, { include: ["src"] })).includes("docs/x.md"), "scoped does not");
  assert.ok(paths(computeBatches(index, { include: ["src"] })).includes("src/a.ts"), "and keeps what was asked for");
});
