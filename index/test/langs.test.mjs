import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, categoryOf, isTestPath, isEntryPath } from "../lib/langs.mjs";

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
