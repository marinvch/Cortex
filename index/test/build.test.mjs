import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex } from "../lib/build.mjs";
import { inferAreas, layerKeyFor, briefCandidates } from "../lib/layers.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cortex-idx-"));
  mkdirSync(join(root, "src", "billing"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  mkdirSync(join(root, "node_modules", "junk"), { recursive: true });
  writeFileSync(join(root, "src", "index.js"), 'import { charge } from "./billing/charge.js";\ncharge();\n');
  writeFileSync(join(root, "src", "billing", "charge.js"), "export function charge() {}\n");
  writeFileSync(join(root, "src", "billing", "orphan.js"), "export function nobodyCalls() {}\n");
  writeFileSync(join(root, "test", "charge.test.js"), 'import "../src/billing/charge.js";\n');
  writeFileSync(join(root, "README.md"), "# fixture\n");
  writeFileSync(join(root, "node_modules", "junk", "x.js"), "module.exports = 1;\n");
  return root;
}

test("indexes a tree, resolving internal imports and skipping node_modules", () => {
  const root = fixture();
  const idx = buildIndex(root);
  const paths = idx.files.map((f) => f.path);

  assert.ok(paths.includes("src/index.js"));
  assert.ok(paths.includes("src/billing/charge.js"));
  assert.ok(paths.includes("README.md"), "README is source material, not noise");
  assert.ok(!paths.some((p) => p.startsWith("node_modules/")), "node_modules must never be indexed");

  const edge = idx.edges.find((e) => e.from === "src/index.js");
  assert.equal(edge.to, "src/billing/charge.js");
  assert.equal(edge.type, "imports");
});

test("marks tests, entry points, and inbound counts", () => {
  const root = fixture();
  const idx = buildIndex(root);
  const byPath = new Map(idx.files.map((f) => [f.path, f]));

  assert.equal(byPath.get("test/charge.test.js").isTest, true);
  assert.equal(byPath.get("src/index.js").isEntry, true);
  assert.equal(byPath.get("src/billing/charge.js").inbound, 2, "imported by index and by its test");
  assert.equal(byPath.get("src/billing/orphan.js").inbound, 0);
});

test("is deterministic — two runs over one tree agree exactly", () => {
  const root = fixture();
  const a = buildIndex(root);
  const b = buildIndex(root);
  assert.deepEqual(a.files, b.files);
  assert.deepEqual(a.edges, b.edges);
  assert.deepEqual(a.areas, b.areas);
});

test("every indexed file lands in exactly one layer", () => {
  const root = fixture();
  const idx = buildIndex(root);
  const seen = new Map();
  for (const layer of idx.areas) {
    for (const p of layer.paths) {
      assert.ok(!seen.has(p), `${p} is in two layers`);
      seen.set(p, layer.id);
    }
  }
  assert.equal(seen.size, idx.files.length);
});

test("layer keys look through conventional wrapper directories", () => {
  assert.equal(layerKeyFor("src/billing/charge.js"), "src/billing");
  assert.equal(layerKeyFor("billing/charge.js"), "billing");
  assert.equal(layerKeyFor("README.md"), "root");
  assert.equal(layerKeyFor("src/index.js"), "src");
});

test("inferAreas is sorted and total", () => {
  const layers = inferAreas([
    { path: "z/a.js" },
    { path: "a/b.js" },
    { path: "README.md" },
  ]);
  assert.deepEqual(layers.map((l) => l.name), ["a", "root", "z"]);
});

test("brief candidates surface untested, churning areas first and carry reasons", () => {
  const files = [
    ...Array.from({ length: 8 }, (_, i) => ({ path: `hot/f${i}.js`, category: "code", lines: 200, commits: 9, isTest: false })),
    ...Array.from({ length: 6 }, (_, i) => ({ path: `calm/f${i}.js`, category: "code", lines: 50, commits: 0, isTest: false })),
    { path: "calm/f0.test.js", category: "code", lines: 20, commits: 0, isTest: true },
  ];
  const got = briefCandidates(files);
  assert.equal(got[0].dir, "hot");
  assert.ok(got[0].reasons.some((r) => /no tests/.test(r)));
  assert.ok(got[0].score > got[1].score);
});

test("the index reports what an ambiguous directory name cost it", () => {
  const root = fixture();
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "deploy.sh"), "#!/bin/sh\necho deploy\n");

  const idx = buildIndex(root);

  assert.deepEqual(idx.stats.skipped, [{ dir: "bin", files: 1 }]);
  assert.ok(!idx.files.some((f) => f.path.startsWith("bin/")), "and it is still not indexed");
});

test("a repo with nothing guessed away reports an empty gap, not a missing field", () => {
  assert.deepEqual(buildIndex(fixture()).stats.skipped, []);
});

test("tsconfig path aliases resolve, including through an extends chain", () => {
  // The failure this covers was invisible in fixtures and obvious on a real repo: a Next.js app
  // wrote 428 of its imports as `@/...` and the index resolved none of them, so four fifths of the
  // graph was missing and 154 files reported as orphans. Splitting options into a base config and
  // extending it is the normal layout, and a resolver that stops at `extends` sees nothing.
  const root = mkdtempSync(join(tmpdir(), "cortex-ts-"));
  mkdirSync(join(root, "src", "components", "Header"), { recursive: true });
  mkdirSync(join(root, "src", "utils"), { recursive: true });

  writeFileSync(
    join(root, "tsconfig.base.json"),
    `{
      // generators write comments into these, and a real one had a trailing comma
      "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], } }
    }`,
  );
  writeFileSync(join(root, "tsconfig.json"), '{ "extends": "./tsconfig.base.json" }');
  writeFileSync(
    join(root, "src", "app.ts"),
    'import { Header } from "@/components/Header";\nimport { fmt } from "@/utils/fmt";\nimport React from "react";\n',
  );
  writeFileSync(join(root, "src", "components", "Header", "index.tsx"), "export const Header = 1;\n");
  writeFileSync(join(root, "src", "utils", "fmt.ts"), "export const fmt = 1;\n");

  const idx = buildIndex(root);
  const app = idx.files.find((f) => f.path === "src/app.ts");

  assert.deepEqual(app.imports, ["src/components/Header/index.tsx", "src/utils/fmt.ts"]);
  assert.ok(!app.imports.some((p) => p.includes("react")), "a real package stays external");

  // The edge has to reach the graph, not just the file record — orphans and impact read edges.
  assert.ok(idx.edges.some((e) => e.from === "src/app.ts" && e.to === "src/utils/fmt.ts"));
  assert.equal(idx.files.find((f) => f.path === "src/utils/fmt.ts").inbound, 1);
});

test("a repo with no tsconfig resolves exactly as before", () => {
  // Alias resolution is strictly additive: it runs only after the relative resolver returns null,
  // so a repo that declares nothing can never see a different graph because of it.
  const root = mkdtempSync(join(tmpdir(), "cortex-nots-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.js"), 'import "./b.js";\nimport "@/ghost";\n');
  writeFileSync(join(root, "src", "b.js"), "export const b = 1;\n");

  const idx = buildIndex(root);
  assert.deepEqual(idx.files.find((f) => f.path === "src/a.js").imports, ["src/b.js"]);
});
