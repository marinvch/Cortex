import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildIndex, hotspots } from "../lib/build.mjs";
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

test("a solution-style tsconfig resolves the aliases its references declare", () => {
  // The exact three-file layout `npm create vite@latest -- --template react-ts` generates. The root
  // config holds no options at all, so a resolver that only opens files named tsconfig.json sees an
  // empty table and stops; every `paths` entry lives in tsconfig.app.json, whose name fails that
  // check. On a real Vite repo that cost 96 of 109 internal imports and produced 30 orphans.
  //
  // tsconfig.node.json matters here too: it sits in the same directory and declares no `paths`, so
  // a lookup returning the first table for a directory could pick it and hide the app's aliases.
  const root = mkdtempSync(join(tmpdir(), "cortex-tssol-"));
  mkdirSync(join(root, "src", "shared"), { recursive: true });

  writeFileSync(join(root, "tsconfig.json"), '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }] }');
  writeFileSync(
    join(root, "tsconfig.app.json"),
    '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } }, "include": ["src"] }',
  );
  writeFileSync(join(root, "tsconfig.node.json"), '{ "compilerOptions": { "target": "ES2023" }, "include": ["vite.config.ts"] }');
  writeFileSync(join(root, "src", "main.tsx"), 'import { fmt } from "@/shared/fmt";\nimport React from "react";\n');
  writeFileSync(join(root, "src", "shared", "fmt.ts"), "export const fmt = 1;\n");

  const idx = buildIndex(root);
  assert.deepEqual(idx.files.find((f) => f.path === "src/main.tsx").imports, ["src/shared/fmt.ts"]);
  assert.ok(idx.edges.some((e) => e.from === "src/main.tsx" && e.to === "src/shared/fmt.ts"));
});

test("a workspace reference names a directory, and each package keeps its own aliases", () => {
  // TypeScript lets a reference name a directory, meaning that directory's tsconfig.json, and that
  // is the usual form in a workspace. Handling it is not optional: `readFileSync` on a directory
  // throws, so the alternative is a config silently lost inside the catch.
  //
  // The keying is the part most easily got wrong. Both packages declare the same `~/*` key against
  // `./src/*`, so a table keyed where the *referrer* sits would point both at a root `src/` that
  // does not exist — or, worse, at each other's files.
  const root = mkdtempSync(join(tmpdir(), "cortex-tsrefdir-"));
  mkdirSync(join(root, "packages", "app", "src"), { recursive: true });
  mkdirSync(join(root, "packages", "ui", "src"), { recursive: true });

  writeFileSync(join(root, "tsconfig.json"), '{ "files": [], "references": [{ "path": "./packages/ui" }, { "path": "./packages/app/" }] }');
  const solution = '{ "files": [], "references": [{ "path": "./tsconfig.lib.json" }] }';
  const lib = '{ "compilerOptions": { "paths": { "~/*": ["./src/*"] } } }';
  for (const pkg of ["app", "ui"]) {
    writeFileSync(join(root, "packages", pkg, "tsconfig.json"), solution);
    writeFileSync(join(root, "packages", pkg, "tsconfig.lib.json"), lib);
  }
  writeFileSync(join(root, "packages", "app", "src", "main.ts"), 'import { util } from "~/util";\n');
  writeFileSync(join(root, "packages", "app", "src", "util.ts"), "export const util = 1;\n");
  writeFileSync(join(root, "packages", "ui", "src", "util.ts"), "export const util = 2;\n");
  writeFileSync(join(root, "packages", "ui", "src", "button.ts"), 'import { util } from "~/util";\n');

  const idx = buildIndex(root);
  const imports = (p) => idx.files.find((f) => f.path === p).imports;
  assert.deepEqual(imports("packages/app/src/main.ts"), ["packages/app/src/util.ts"]);
  assert.deepEqual(imports("packages/ui/src/button.ts"), ["packages/ui/src/util.ts"]);
});

test("a referenced config never outranks a nearer or equal config of the repo's own", () => {
  // Two halves of the same rule. At the root, the repo's own `@/*` must beat the one a referenced
  // config declares for the same directory — they are merged, and the nearer claim is tried first.
  // Below it, the package's aliases must still win for the package's files, even though the only
  // config declaring them was reached through a reference.
  const root = mkdtempSync(join(tmpdir(), "cortex-tsrank-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "other"), { recursive: true });
  mkdirSync(join(root, "packages", "app", "src"), { recursive: true });

  writeFileSync(
    join(root, "tsconfig.json"),
    `{
      "compilerOptions": { "paths": { "@/*": ["./src/*"] } },
      "references": [{ "path": "./tsconfig.extra.json" }, { "path": "./packages/app" }]
    }`,
  );
  writeFileSync(join(root, "tsconfig.extra.json"), '{ "compilerOptions": { "paths": { "@/*": ["./other/*"] } } }');
  writeFileSync(join(root, "packages", "app", "tsconfig.json"), '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }');
  writeFileSync(join(root, "packages", "app", "tsconfig.app.json"), '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }');
  writeFileSync(join(root, "src", "thing.ts"), "export const thing = 1;\n");
  writeFileSync(join(root, "other", "thing.ts"), "export const thing = 2;\n");
  writeFileSync(join(root, "packages", "app", "src", "thing.ts"), "export const thing = 3;\n");
  writeFileSync(join(root, "src", "app.ts"), 'import { thing } from "@/thing";\n');
  writeFileSync(join(root, "packages", "app", "src", "main.ts"), 'import { thing } from "@/thing";\n');

  const idx = buildIndex(root);
  const imports = (p) => idx.files.find((f) => f.path === p).imports;
  assert.deepEqual(imports("src/app.ts"), ["src/thing.ts"]);
  assert.deepEqual(imports("packages/app/src/main.ts"), ["packages/app/src/thing.ts"]);
});

test("a reference cycle costs a config, never the run", () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-tscycle-"));
  mkdirSync(join(root, "src"), { recursive: true });

  writeFileSync(
    join(root, "tsconfig.json"),
    '{ "files": [], "references": [{ "path": "./tsconfig.a.json" }] }',
  );
  writeFileSync(
    join(root, "tsconfig.a.json"),
    '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } }, "references": [{ "path": "./tsconfig.b.json" }] }',
  );
  writeFileSync(join(root, "tsconfig.b.json"), '{ "references": [{ "path": "./tsconfig.a.json" }, { "path": "./tsconfig.json" }] }');
  writeFileSync(join(root, "src", "a.ts"), 'import { b } from "@/b";\n');
  writeFileSync(join(root, "src", "b.ts"), "export const b = 1;\n");

  const idx = buildIndex(root);
  assert.deepEqual(idx.files.find((f) => f.path === "src/a.ts").imports, ["src/b.ts"]);
});

test("a malformed referenced config loses its own aliases and nothing else", () => {
  // Same discipline the extends walk already keeps: a config that cannot be parsed costs its
  // aliases, never the index. The sibling reference must still be read.
  const root = mkdtempSync(join(tmpdir(), "cortex-tsbad-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "lib"), { recursive: true });

  writeFileSync(
    join(root, "tsconfig.json"),
    '{ "files": [], "references": [{ "path": "./tsconfig.broken.json" }, { "path": "./tsconfig.ok.json" }] }',
  );
  writeFileSync(join(root, "tsconfig.broken.json"), '{ "compilerOptions": { "paths": { "#lib/*": ["./lib/*"] } }');
  writeFileSync(join(root, "tsconfig.ok.json"), '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }');
  writeFileSync(join(root, "src", "a.ts"), 'import { b } from "@/b";\nimport { c } from "#lib/c";\n');
  writeFileSync(join(root, "src", "b.ts"), "export const b = 1;\n");
  writeFileSync(join(root, "lib", "c.ts"), "export const c = 1;\n");

  const idx = buildIndex(root);
  assert.deepEqual(idx.files.find((f) => f.path === "src/a.ts").imports, ["src/b.ts"]);
});

test("a reference to a config that is not there costs nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-tsmissing-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "tsconfig.json"),
    '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } }, "references": [{ "path": "./packages/gone" }, {}] }',
  );
  writeFileSync(join(root, "src", "a.ts"), 'import { b } from "@/b";\n');
  writeFileSync(join(root, "src", "b.ts"), "export const b = 1;\n");

  const idx = buildIndex(root);
  assert.deepEqual(idx.files.find((f) => f.path === "src/a.ts").imports, ["src/b.ts"]);
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

// --- churn window ------------------------------------------------------------------------------

function gitRepo(build) {
  const root = mkdtempSync(join(tmpdir(), "cortex-churn-"));
  execFileSync("git", ["init", "-q", "."], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: root });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  build(root);
  return root;
}

function commitAt(root, date) {
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "c"], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

test("churn falls back to all history rather than silently scoring every file zero", () => {
  // A real repo with 11 commits, all older than the window, reported commits: 0 for all 120 files.
  // Nothing said so, and /cortex-brief's "ranked by size, churn and absence of tests" quietly
  // became ranked by size. A silent constant is worse than a wider window that names itself.
  const root = gitRepo((r) => writeFileSync(join(r, "a.js"), "export const a = 1;\n"));
  commitAt(root, "2020-01-01T00:00:00");

  const { counts, window } = hotspots(root);
  assert.equal(window, "all history", "the window says it widened");
  assert.equal(counts.get("a.js"), 1, "and the file actually has churn");

  const idx = buildIndex(root);
  assert.equal(idx.stats.churnWindow, "all history", "the index carries it, so reports can say it");
  assert.ok(idx.files.find((f) => f.path === "a.js").commits > 0);
});

test("a repo with recent history keeps the recent window", () => {
  // The window is recent by design — churn matters because it is current. The fallback must not
  // quietly turn every repo into an all-time count.
  const root = gitRepo((r) => writeFileSync(join(r, "a.js"), "export const a = 1;\n"));
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "now"], { cwd: root });

  const { window } = hotspots(root);
  assert.equal(window, "3 months ago");
});

test("no git at all is distinguishable from no churn", () => {
  // The same distinction UNRESOLVED_LANGUAGES keeps for imports: "I looked and found nothing" and
  // "I could not look" must not print the same sentence.
  const root = mkdtempSync(join(tmpdir(), "cortex-nogit-"));
  writeFileSync(join(root, "a.js"), "export const a = 1;\n");
  const { counts, window } = hotspots(root);
  assert.equal(window, null, "null means there was nothing to ask");
  assert.equal(counts.size, 0);
});
