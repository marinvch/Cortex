import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, categoryOf, isTestPath, isEntryPath, isEntrySource } from "../lib/langs.mjs";

test("detects language by extension and by filename", () => {
  assert.equal(detectLanguage("src/a.ts"), "typescript");
  assert.equal(detectLanguage("src/a.tsx"), "typescript");
  assert.equal(detectLanguage("run.sh"), "shell");
  assert.equal(detectLanguage("Dockerfile"), "dockerfile");
  assert.equal(detectLanguage("deploy/Dockerfile.prod"), "dockerfile");
  assert.equal(detectLanguage("Makefile"), "make");
  assert.equal(detectLanguage("VERSION"), "config");
});

test("an unknown extension is still indexed, as 'other'", () => {
  assert.equal(detectLanguage("weird.xyz"), "other");
  assert.equal(categoryOf("other"), "other");
});

test("maps languages onto categories", () => {
  assert.equal(categoryOf("typescript"), "code");
  assert.equal(categoryOf("markdown"), "docs");
  assert.equal(categoryOf("yaml"), "config");
  assert.equal(categoryOf("dockerfile"), "infra");
  assert.equal(categoryOf("shell"), "script");
  assert.equal(categoryOf("sql"), "schema");
});

test("recognises test paths across ecosystems", () => {
  for (const p of [
    "src/a.test.ts",
    "src/a.spec.js",
    "mcp/test/paths.test.js",
    "tests/test_thing.py",
    "pkg/thing_test.go",
    "src/__tests__/a.ts",
    "src/main/java/FooTest.java",
  ]) {
    assert.ok(isTestPath(p), `${p} should be a test`);
  }
});

test("recognises the hyphenated shell and python test conventions", () => {
  for (const p of [
    "tools/test-homelab-drift.sh",
    "test-parser.bash",
    "scripts/test-migrate.py",
    "render.bats",
  ]) {
    assert.ok(isTestPath(p), `${p} should be a test`);
  }
});

test("does not mistake production code for a test", () => {
  for (const p of [
    "src/latest.ts",
    "src/contest.js",
    "lib/protest.py",
    "src/test-utils.ts",
  ]) {
    assert.equal(isTestPath(p), false, `${p} should not be a test`);
  }
});

test("a document or config file under tests/ is never a test", () => {
  // `/cortex-brief tests` writes tests/AGENTS.md. On pmndrs/zustand that made the index report 16
  // tests instead of 15, and — because the brief names vitest.config.mts — coverage's mention signal
  // called the config tested. Cortex's own output changed Cortex's findings.
  for (const p of [
    "tests/AGENTS.md",
    "test/README.md",
    "src/__tests__/notes.mdx",
    "tests/fixtures/data.json",
    "spec/config.yml",
    "tests/fixtures/page.html",
    "tests/schema.sql",
    "a.test.md",
  ]) {
    assert.equal(isTestPath(p), false, `${p} should not be a test`);
  }
});

test("code and script tests keep their status under the same directories", () => {
  for (const p of ["tests/basic.test.tsx", "tests/helpers.ts", "test/run.sh", "tests/cli.bats", "spec/a_spec.rb"]) {
    assert.ok(isTestPath(p), `${p} should be a test`);
  }
});

test("recognises conventional entry points", () => {
  for (const p of ["src/index.ts", "main.go", "cmd/api/main.go", "manage.py", "src/main.rs"]) {
    assert.ok(isEntryPath(p), `${p} should be an entry point`);
  }
  assert.equal(isEntryPath("src/utils/helper.ts"), false);
});

// #459: a Spring Boot service starts at a class nothing imports, in a package directory a path rule
// cannot tell from any other. The declaration is in the code, so the code is what is read.
test("a JVM entry point is recognised by what the source declares", () => {
  const entries = {
    java: [
      "@SpringBootApplication\npublic class App {}\n",
      "@org.springframework.boot.autoconfigure.SpringBootApplication\nclass App {}\n",
      "class Tool {\n  public static void main(String[] args) {}\n}\n",
      "class Tool {\n  static public void main(final String... argv) {}\n}\n",
      "class Tool {\n  public static void main(String args[]) {}\n}\n",
    ],
    kotlin: [
      "@SpringBootApplication\nclass App\n\nfun main(args: Array<String>) { runApplication<App>(*args) }\n",
      "fun main() {\n  println(1)\n}\n",
      "class Tool {\n  companion object {\n    @JvmStatic fun main(args: Array<String>) {}\n  }\n}\n",
    ],
  };
  for (const [lang, bodies] of Object.entries(entries)) {
    for (const body of bodies) assert.equal(isEntrySource(body, lang), true, `${lang}: ${body}`);
  }
});

test("a JVM class that merely mentions main or Spring Boot is not an entry point", () => {
  const ordinary = {
    java: [
      // Framework-discovered, but an ordinary class's annotation: a dead one is worth reporting.
      "@Configuration\npublic class WebConfiguration {}\n",
      "@RestController\nclass OwnerController { void main() {} }\n",
      "class Tool { public void main(String[] args) {} }\n", // not static: the JVM cannot call it
      "/** Started like {@code public static void main(String[] args)}. @SpringBootApplication */\nclass Doc {}\n",
      'class S { String s = "public static void main(String[] args) @SpringBootApplication"; }\n',
      "// @SpringBootApplication\nclass Commented {}\n",
    ],
    kotlin: [
      "class Runner {\n  fun main() {}\n}\n", // an indented method, not the program's main
      "// fun main() {}\nclass Commented\n",
    ],
    javascript: ["@SpringBootApplication\nfunction main() {}\n"],
  };
  for (const [lang, bodies] of Object.entries(ordinary)) {
    for (const body of bodies) assert.equal(isEntrySource(body, lang), false, `${lang}: ${body}`);
  }
});

// --- a file about tests is not a test (#548, item 8) -----------------------------------------------

test("a runner's setup file in a test directory is not a test", () => {
  // src/test/setup.ts registers matchers; the runner's config loads it and it holds no test. It made
  // the test count the drift check quotes back at skills one too high.
  for (const p of [
    "src/test/setup.ts",
    "test/setup.js",
    "tests/setupTests.tsx",
    "tests/vitest.setup.ts",
    "test/jest.setup.cjs",
    "tests/global-setup.ts",
    "e2e/tests/globalTeardown.mjs",
    "__tests__/teardown.js",
  ]) {
    assert.equal(isTestPath(p), false, `${p} should not be a test`);
  }
});

test("a setup file named as a test is one, and neighbours of a setup file keep their status", () => {
  // The last two: a name that only contains the word, and a shell test outside a test directory,
  // which was a test before this rule and is not this rule's business.
  for (const p of ["test/setup.test.js", "tests/setup_test.go", "tests/setup.spec.ts", "tests/helpers.ts", "tests/setup/db.ts", "tests/conftest.py", "tests/db-setup-helpers.ts", "scripts/test-setup.sh"]) {
    assert.ok(isTestPath(p), `${p} should be a test`);
  }
});

test("under .claude/ only a file named as a test is one — a hook called test-paths.sh guards tests", () => {
  // /cortex stamps .claude/hooks/test-paths.sh for the Tester. Named like a shell test, it took a
  // repo from 38 tests to 39 the moment the team was installed: Cortex's output changed its count.
  for (const p of [".claude/hooks/test-paths.sh", ".claude/hooks/test-guard.py", ".claude/skills/add-test/scripts/test-run.sh", ".claude/tests/notes.sh", "packages/web/.claude/hooks/test-paths.sh"]) {
    assert.equal(isTestPath(p), false, `${p} should not be a test`);
  }
  for (const p of [".claude/hooks/optimize-prompt.test.mjs", ".claude/hooks/guard_test.py", "tools/test-homelab-drift.sh"]) {
    assert.ok(isTestPath(p), `${p} should be a test`);
  }
});
