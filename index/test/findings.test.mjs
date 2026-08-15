import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyse, render, testStem } from "../lib/findings.mjs";

// These tests were written because Cortex reported both of these bugs about ITSELF: it flagged its
// own scanner test corpus as a critical secret leak, and it called `mcp/lib` untested when the
// tests live in `mcp/test`. Dogfooding found them; these keep them found.

function repo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "cortex-find-"));
  for (const [p, content] of Object.entries(files)) {
    const abs = join(root, p);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function index(files, edges = []) {
  return {
    commit: "abc1234",
    stats: {
      files: files.length,
      lines: files.reduce((a, f) => a + (f.lines || 0), 0),
      edges: edges.length,
      tests: files.filter((f) => f.isTest).length,
      languages: { javascript: files.length },
      categories: { code: files.length },
    },
    files: files.map((f) => ({
      lang: "javascript", category: "code", lines: 50, bytes: 500,
      isTest: false, isEntry: false, commits: 0, imports: [], inbound: 0, ...f,
    })),
    edges,
    layers: [{ id: "layer:src", name: "src", paths: files.map((f) => f.path) }],
  };
}

const findingsOfKind = (out, kind) => out.filter((f) => f.kind === kind);

test("a module is covered when a test is NAMED after it, even in another directory", () => {
  const idx = index([
    { path: "lib/paths.js" },
    { path: "lib/scrub.js" },
    { path: "lib/memory.js" },
    { path: "test/paths.test.js", isTest: true },
    { path: "test/scrub.test.js", isTest: true },
    { path: "test/memory.test.js", isTest: true },
  ]);
  const tests = findingsOfKind(analyse(idx, repo()), "tests");
  assert.deepEqual(tests, [], "src/ + test/ is the ordinary layout, not an untested repo");
});

test("a module is covered when a test IMPORTS it, whatever the test is called", () => {
  const idx = index(
    [
      { path: "lib/a.js" },
      { path: "lib/b.js" },
      { path: "lib/c.js" },
      { path: "test/integration.test.js", isTest: true, imports: ["lib/a.js", "lib/b.js", "lib/c.js"] },
    ],
    [
      { from: "test/integration.test.js", to: "lib/a.js", type: "imports" },
      { from: "test/integration.test.js", to: "lib/b.js", type: "imports" },
      { from: "test/integration.test.js", to: "lib/c.js", type: "imports" },
    ],
  );
  assert.deepEqual(findingsOfKind(analyse(idx, repo()), "tests"), []);
});

test("a CLI spawned by a test counts as covered, when named in a string literal", () => {
  // The blind spot this closes: a subprocess test neither imports the module nor is named after
  // it, so both other signals miss it and a tested CLI reads as untested.
  const root = repo({
    "test/cli.test.js": 'run("cortex-index.mjs"); run("cortex-findings.mjs"); run("cortex-memory.mjs");',
  });
  const idx = index([
    { path: "cortex-index.mjs" },
    { path: "cortex-findings.mjs" },
    { path: "cortex-memory.mjs" },
    { path: "test/cli.test.js", isTest: true },
  ]);
  assert.deepEqual(findingsOfKind(analyse(idx, root), "tests"), []);
});

test("an unquoted mention in a comment does NOT count as coverage", () => {
  const root = repo({
    "test/other.test.js": "// see cortex-index.mjs and cortex-findings.mjs and cortex-memory.mjs\n",
  });
  const idx = index([
    { path: "cortex-index.mjs" },
    { path: "cortex-findings.mjs" },
    { path: "cortex-memory.mjs" },
    { path: "test/other.test.js", isTest: true },
  ]);
  const [f] = findingsOfKind(analyse(idx, root), "tests");
  assert.ok(f, "a passing mention in prose is not a test");
  assert.match(f.title, /3 modules appear untested/);
});

test("genuinely untested modules are still reported", () => {
  const idx = index([
    { path: "lib/a.js", commits: 9 },
    { path: "lib/b.js" },
    { path: "lib/c.js" },
    { path: "test/other.test.js", isTest: true },
  ]);
  const [f] = findingsOfKind(analyse(idx, repo()), "tests");
  assert.ok(f, "three uncovered modules should be reported");
  assert.match(f.title, /3 modules appear untested/);
  assert.equal(f.severity, "high", "recent commits on untested code raises severity");
});

test("a secret in a source file is critical", () => {
  const root = repo({ "src/config.js": `const key = "${["AKIA", "IOSFODNN7", "EXAMPLE"].join("")}";` });
  const sec = findingsOfKind(analyse(index([{ path: "src/config.js" }]), root), "security");
  assert.equal(sec.length, 1);
  assert.equal(sec[0].severity, "critical");
  assert.match(sec[0].title, /Possible secrets/);
});

test("cortex:allow-secrets exempts a fixture file, and says so", () => {
  const root = repo({
    "test/scanner.test.js": `// cortex:allow-secrets\nconst fake = "${["AKIA", "IOSFODNN7", "EXAMPLE"].join("")}";`,
  });
  const sec = findingsOfKind(analyse(index([{ path: "test/scanner.test.js", isTest: true }]), root), "security");
  assert.equal(sec.length, 1);
  assert.equal(sec[0].severity, "low", "an exemption is a note, not an alarm");
  assert.match(sec[0].title, /exempted from the secret scan/);
  assert.ok(!/Possible secrets/.test(sec[0].title), "an exempted file must not also be reported as a leak");
});

test("the exemption is never silent", () => {
  const root = repo({ "a.js": `// cortex:allow-secrets\n${["sk_", "live_", "abcdefghijklmnop1234"].join("")}` });
  const out = analyse(index([{ path: "a.js" }]), root);
  assert.ok(out.some((f) => /exempted/.test(f.title)), "an exemption must appear in the report");
});

test("missing context files are reported, and present ones are not", () => {
  const bare = analyse(index([{ path: "a.js" }]), repo());
  assert.ok(bare.some((f) => /No agent context file/.test(f.title)));
  assert.ok(bare.some((f) => /No CONTEXT\.md/.test(f.title)));

  const furnished = repo({
    "AGENTS.md": "# brief\n",
    "CONTEXT.md": "# glossary\n",
    "docs/adr/TEMPLATE.md": "# adr\n",
  });
  const out = analyse(index([{ path: "a.js" }]), furnished);
  assert.ok(!out.some((f) => /No agent context file|No CONTEXT\.md|No architecture decision/.test(f.title)));
});

test("an oversized AGENTS.md is reported as a splitting candidate", () => {
  const root = repo({ "AGENTS.md": `${"line\n".repeat(300)}`, "CONTEXT.md": "x" });
  const out = analyse(index([{ path: "a.js" }]), root);
  assert.ok(out.some((f) => /AGENTS\.md is \d+ lines/.test(f.title)));
});

test("a directory that already has a brief is not proposed again", () => {
  const files = Array.from({ length: 8 }, (_, i) => ({ path: `billing/f${i}.js`, commits: 3 }));

  const without = analyse(index(files), repo());
  assert.ok(
    without.some((f) => /deserve their own AGENTS\.md/.test(f.title)),
    "an area with no brief should be proposed",
  );

  // Re-proposing finished work is how a report teaches people to stop reading it.
  const withBrief = analyse(index(files), repo({ "billing/AGENTS.md": "# billing\n" }));
  assert.ok(!withBrief.some((f) => /deserve their own AGENTS\.md/.test(f.title)));
});

test("testStem strips the conventions it claims to", () => {
  assert.equal(testStem("mcp/test/paths.test.js"), "paths");
  assert.equal(testStem("tests/test_thing.py"), "thing");
  assert.equal(testStem("pkg/thing_test.go"), "thing");
  assert.equal(testStem("src/FooTest.java"), "foo");
});

test("render always states that nothing was changed", () => {
  const idx = index([{ path: "a.js" }]);
  const out = render(idx, analyse(idx, repo()), { day: "2026-08-15" });
  assert.match(out, /Nothing in this repository has been changed/);
  assert.match(out, /# Cortex findings — 2026-08-15/);
});
