import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { unimported, namedElsewhere, findOrphans } from "../lib/orphans.mjs";
import { textFrom } from "../lib/repo-text.mjs";
import { buildIndex } from "../lib/build.mjs";
import { analyse } from "../lib/findings.mjs";

function repo(files) {
  const root = tempDir("cortex-orph-");
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

const file = (path, over = {}) => ({
  path,
  lang: "javascript",
  category: "code",
  lines: 10,
  bytes: 200,
  isTest: false,
  isEntry: false,
  inbound: 0,
  imports: [],
  ...over,
});

test("a file nothing imports and nothing names is an orphan", () => {
  const root = repo({ "src/dead.js": "export const x = 1;\n", "src/live.js": "export const y = 1;\n" });
  const index = { files: [file("src/dead.js"), file("src/live.js", { inbound: 1 })] };
  assert.deepEqual(
    findOrphans(index, root).map((f) => f.path),
    ["src/dead.js"],
  );
});

test("a CLI invoked from a shell test is not unreferenced", () => {
  // The false positive that prompted this: tools/cortex-version.mjs is what releases this repo and
  // tools/cortex-capability.mjs is what proves its capability table, and both were listed because
  // nothing `import`s them. Cortex reported it about itself.
  const root = repo({
    "tools/release.mjs": "// a CLI\n",
    "tools/test/release.test.sh": 'VER="$REPO_ROOT/tools/release.mjs"\n',
  });
  const index = {
    files: [file("tools/release.mjs"), file("tools/test/release.test.sh", { category: "script", isTest: true })],
  };
  assert.deepEqual(unimported(index).map((f) => f.path), ["tools/release.mjs"], "the import graph alone still flags it");
  assert.deepEqual(findOrphans(index, root), [], "naming it settles the question");
});

test("a doc or an ADR naming the path counts", () => {
  // How repo tooling is normally wired. Excluding docs would have left the original false positives
  // in place, since these two are named by an ADR and by the contributor invariants.
  const root = repo({
    "tools/stamp.mjs": "// a CLI\n",
    "docs/adr/0001-x.md": "Run `node tools/stamp.mjs --set 1.0.0` to propagate.\n",
  });
  const index = { files: [file("tools/stamp.mjs"), file("docs/adr/0001-x.md", { category: "docs" })] };
  assert.deepEqual(findOrphans(index, root), []);
});

test("a file naming itself does not rescue itself", () => {
  // Otherwise every file with a header comment quoting its own path becomes unreportable.
  const root = repo({ "src/dead.js": "// src/dead.js — does nothing\nexport const x = 1;\n" });
  const index = { files: [file("src/dead.js")] };
  assert.deepEqual(
    findOrphans(index, root).map((f) => f.path),
    ["src/dead.js"],
  );
});

test("without a root, only the import graph is consulted", () => {
  // The old, noisier behaviour. A caller that has the root should pass it; one that cannot must get
  // a defined answer rather than a crash.
  const index = { files: [file("tools/release.mjs")] };
  assert.deepEqual(
    findOrphans(index).map((f) => f.path),
    ["tools/release.mjs"],
  );
});

test("entry points and tests are never orphans", () => {
  const root = repo({ "src/main.js": "x", "src/a.test.js": "x" });
  const index = { files: [file("src/main.js", { isEntry: true }), file("src/a.test.js", { isTest: true })] };
  assert.deepEqual(findOrphans(index, root), []);
});

test("an unreadable file costs its mentions, never the finding", () => {
  // The searched file does not exist on disk here; the walk must skip it and still return an answer.
  const root = repo({ "src/dead.js": "export const x = 1;\n" });
  const index = { files: [file("src/dead.js"), file("ghost/missing.js")] };
  assert.equal(findOrphans(index, root).length, 2);
});

test("namedElsewhere reports only what it was asked about", () => {
  const root = repo({
    "a.js": "// mentions tools/b.mjs\n",
    "tools/b.mjs": "// b\n",
    "tools/c.mjs": "// c\n",
  });
  const index = { files: [file("a.js"), file("tools/b.mjs"), file("tools/c.mjs")] };
  const named = namedElsewhere(index, root, ["tools/b.mjs", "tools/c.mjs"]);
  assert.deepEqual([...named], ["tools/b.mjs"]);
});

test("every indexed category is searched, because every indexed file is text", () => {
  // The old list was code/script/config/docs, a fourth guess under a walker that had already
  // dropped binaries: `infra`, `markup`, `schema` and `other` hold paths too, and each of the four
  // below is how a real repo wires one up. On a cloned Next.js app the widening removed six of
  // fourteen "unreferenced" entries. Widening can only ever REMOVE orphans, which is the direction
  // of error this module states it chose.
  const root = repo({
    "Dockerfile": "COPY scripts/entrypoint.sh /app/\n",
    "public/index.html": '<script src="src/boot.js"></script>\n',
    "db/schema.sql": "-- generated from db/seed.js\n",
    ".npmrc": "# see tools/publish.mjs\n",
    "scripts/entrypoint.sh": "",
    "src/boot.js": "",
    "db/seed.js": "",
    "tools/publish.mjs": "",
  });
  const index = {
    files: [
      file("Dockerfile", { category: "infra", lang: "dockerfile" }),
      file("public/index.html", { category: "markup", lang: "html" }),
      file("db/schema.sql", { category: "schema", lang: "sql" }),
      file(".npmrc", { category: "other", lang: "other" }),
      file("scripts/entrypoint.sh"),
      file("src/boot.js"),
      file("db/seed.js"),
      file("tools/publish.mjs"),
    ],
  };
  assert.deepEqual(findOrphans(index, root), [], "a path named by a Dockerfile is wired up, not dead");
});

test("a file too large to read cannot settle an orphan question, and says so", () => {
  // The cap used to be 512 * 1024 here and nothing tested it, so nobody could see this happen.
  // Injecting the source makes it an assertion instead of a half-megabyte fixture.
  const text = textFrom({ "docs/map.md": "names src/dead.js", "src/dead.js": "" }, { cap: 8 });
  const index = { files: [file("docs/map.md", { category: "docs" }), file("src/dead.js")] };

  assert.deepEqual(
    findOrphans(index, text).map((f) => f.path),
    ["src/dead.js"],
    "the only file that named it was never opened, so the question is unsettled, not answered",
  );
  assert.deepEqual(text.oversized, [{ path: "docs/map.md", reason: "too-large" }]);
});

test("findOrphans is a pure transform of the index plus injected text", () => {
  // No root, no temp tree: the same inputs, twice, byte for byte.
  const index = { files: [file("a.js"), file("src/dead.js")] };
  const run = () => findOrphans(index, textFrom({ "a.js": "// nothing here\n" })).map((f) => f.path);
  assert.deepEqual(run(), ["a.js", "src/dead.js"]);
  assert.deepEqual(run(), run());
});

// #459. A Spring Boot service's application class is started by the JVM, not imported by another
// class, so "nothing points at it" is true and "unreferenced" is not. Found on two real services;
// spring-guides/gs-rest-service reproduces it with its one application class.
const APP = "src/main/java/com/example/App.java";
const DEAD = "src/main/java/com/example/Leftover.java";
const javaFile = (path, over = {}) => file(path, { lang: "java", ...over });

test("a Spring Boot application class is an entry point, and the class beside it is still an orphan", () => {
  const text = textFrom({
    [APP]: "package com.example;\n\n@SpringBootApplication\npublic class App {\n  public static void main(String[] args) { SpringApplication.run(App.class, args); }\n}\n",
    [DEAD]: "package com.example;\n\npublic class Leftover {}\n",
  });
  // `isEntry: false` on purpose: an index built before 2.39.1 carries exactly this, and is read
  // without complaint, so the finding has to be right when handed one.
  const index = { files: [javaFile(APP), javaFile(DEAD)] };
  assert.deepEqual(
    findOrphans(index, text).map((f) => f.path),
    [DEAD],
    "the entry point is not listed; a class with no reference and no main still is",
  );
});

test("a class with a main is an entry point even without Spring, in Java and Kotlin", () => {
  const TOOL = "src/main/java/com/example/Tool.java";
  const KT = "src/main/kotlin/com/example/Main.kt";
  const text = textFrom({
    [TOOL]: "class Tool {\n  public static void main(String... args) {}\n}\n",
    [KT]: "package com.example\n\nfun main() {\n  println(1)\n}\n",
  });
  const index = { files: [javaFile(TOOL), file(KT, { lang: "kotlin" })] };
  assert.deepEqual(findOrphans(index, text), []);
});

test("a main that only a comment mentions does not rescue a dead class", () => {
  const text = textFrom({ [DEAD]: "/** Unlike App, has no public static void main(String[] args). */\nclass Leftover {}\n" });
  assert.deepEqual(findOrphans({ files: [javaFile(DEAD)] }, text).map((f) => f.path), [DEAD]);
});

test("a Kotlin-only repo claims no orphans, because Cortex cannot read Kotlin imports (#465)", () => {
  // Built for real, so the edges are whatever the builder actually extracts — which for Kotlin is
  // none. Before, every class here was "unreferenced"; the model imports nothing, the controller
  // imports it, and neither claim would have been true.
  const root = repo({
    "src/main/kotlin/com/example/App.kt": "package com.example\n\n@SpringBootApplication\nclass App\n\nfun main(args: Array<String>) { runApplication<App>(*args) }\n",
    "src/main/kotlin/com/example/owner/Owner.kt": "package com.example.owner\n\nclass Owner(val name: String)\n",
    "src/main/kotlin/com/example/owner/OwnerController.kt": "package com.example.owner\n\nimport com.example.owner.Owner\n\nclass OwnerController { fun get() = Owner(\"a\") }\n",
  });
  const index = buildIndex(root);
  assert.equal(index.edges.length, 0, "the premise: no Kotlin edge is extracted");
  assert.deepEqual(findOrphans(index, root), [], "blindness is not reported as absence");
  const blind = analyse(index, root).find((f) => /Import graph does not cover/.test(f.title));
  assert.match(blind?.title ?? "", /kotlin/, "and the report says which language it cannot see");
});

test("package-info.java and module-info.java are never orphan candidates", () => {
  // Both are read by the compiler by name and declare no class, so nothing can reference them —
  // they were five of spring-petclinic's six "unreferenced" files.
  const index = {
    files: [
      javaFile("src/main/java/com/example/package-info.java"),
      javaFile("src/main/java/module-info.java"),
      javaFile(DEAD),
    ],
  };
  assert.deepEqual(unimported(index).map((f) => f.path), [DEAD]);
});
