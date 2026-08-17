import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyse, render, testStem, offerOf } from "../lib/findings.mjs";

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

// A greenfield repo is the OTHER install flow the design specifies, and the report had no idea it
// existed: an empty repo produced three ranked findings — one of them "high" — about missing
// documentation for code that does not exist, then pointed at /cortex-brief for "the areas listed
// above" when there were none. Absurd output on the first run teaches people the report is noise.

function emptyIndex() {
  return {
    commit: "abc1234",
    stats: { files: 0, lines: 0, edges: 0, tests: 0, languages: {}, categories: {} },
    files: [],
    edges: [],
    layers: [],
  };
}

test("an empty repo is reported as greenfield, not as a repo with problems", () => {
  const idx = emptyIndex();
  const out = analyse(idx, repo());

  // Nothing may be ranked as a defect: there is no code to be missing context for.
  assert.equal(
    out.filter((f) => f.severity === "high" || f.severity === "medium").length,
    0,
    "a repo with no files has no high or medium findings",
  );
  assert.ok(
    !out.some((f) => /highest-leverage file/.test(f.detail || "")),
    "does not claim AGENTS.md is high-leverage for a repo with no code",
  );
  assert.ok(
    !out.some((f) => /Domain terms are undefined/.test(f.detail || "")),
    "does not claim domain terms drift when there is no domain",
  );
});

test("the greenfield report says scaffolding is the whole job, and names no areas", () => {
  const idx = emptyIndex();
  const out = render(idx, analyse(idx, repo()), { day: "2026-08-15" });

  assert.match(out, /greenfield/i, "names the flow the reader is actually in");
  assert.doesNotMatch(
    out,
    /areas listed above/,
    "never points at areas when the index found none",
  );
  // The stray bullet from an empty language list.
  assert.doesNotMatch(out, /\n- \n/, "no empty bullet when there are no languages");
});

test("a repo with code is still reported the old way", () => {
  const idx = index([{ path: "a.js" }]);
  const out = analyse(idx, repo());
  assert.ok(
    out.some((f) => f.severity === "high" && /No agent context file/.test(f.title)),
    "the legacy flow is untouched — missing AGENTS.md over real code is still high",
  );
});

// --- Offers -----------------------------------------------------------------------------------
//
// A finding says what is wrong; an offer says what Cortex can do about it. The wizard walks the
// ranked report and asks about each offer in turn, so this mapping is what turns the report from a
// document read beside the conversation into the script for it. It lives here, next to the finding
// that earns it, because deriving it from prose in the skill would put it in two places.

const offersIn = (out) => out.map(offerOf).filter(Boolean);

test("a missing context layer offers to scaffold it", () => {
  const out = analyse(index([{ path: "a.js" }]), repo());
  const scaffold = out.filter((f) => offerOf(f)?.action === "scaffold");
  assert.ok(
    scaffold.some((f) => /No agent context file/.test(f.title)),
    "the highest-leverage finding must carry the action that fixes it",
  );
  assert.ok(scaffold.some((f) => /No CONTEXT\.md/.test(f.title)));
});

test("an area that deserves a brief offers one, and names it as the target", () => {
  const files = Array.from({ length: 8 }, (_, i) => ({ path: `billing/f${i}.js`, commits: 3 }));
  const [f] = analyse(index(files), repo()).filter((x) => offerOf(x)?.action === "brief");
  assert.ok(f, "a proposed area must carry a brief offer");
  assert.deepEqual(offerOf(f).targets, ["billing"], "the offer names the directory, not just the action");
});

test("an oversized AGENTS.md offers splitting, not re-scaffolding", () => {
  const root = repo({ "AGENTS.md": `${"line\n".repeat(300)}`, "CONTEXT.md": "x" });
  const [f] = analyse(index([{ path: "a.js" }]), root).filter((x) => /AGENTS\.md is \d+ lines/.test(x.title));
  assert.equal(offerOf(f)?.action, "brief", "a large root brief is split into leaves, not overwritten");
});

test("a possible secret offers triage and never remediation", () => {
  const root = repo({ "src/config.js": `const key = "${["AKIA", "IOSFODNN7", "EXAMPLE"].join("")}";` });
  const [f] = analyse(index([{ path: "src/config.js" }]), root).filter((x) => x.severity === "critical");
  assert.equal(offerOf(f)?.action, "triage-secrets");
  // Some hits are fixtures. An offer that edited the file would act on a guess, and one false
  // positive acted on destroys trust in every other finding in the report.
  assert.ok(
    !offersIn(analyse(index([{ path: "src/config.js" }]), root)).some((o) => /fix|remove|redact/.test(o.action)),
    "no offer may propose editing a source file",
  );
});

test("findings Cortex cannot act on carry no offer", () => {
  // "No test files found" is high severity and there is no Cortex action that writes tests.
  // Inventing an offer to fill the column would be a question the index did not earn.
  const idx = index([{ path: "a.js" }]);
  idx.stats.tests = 0;
  const [f] = analyse(idx, repo()).filter((x) => /No test files found/.test(x.title));
  assert.ok(f, "the finding is still reported");
  assert.equal(offerOf(f), null, "reported, but nothing is proposed");
});

test("the greenfield finding proposes nothing here — scaffolding is already the whole job", () => {
  const out = analyse(emptyIndex(), repo());
  assert.deepEqual(offersIn(out), [], "greenfield has its own flow and does not walk offers");
});

test("offers are deterministic — same tree, same offers", () => {
  const files = Array.from({ length: 8 }, (_, i) => ({ path: `billing/f${i}.js`, commits: 3 }));
  const root = repo();
  assert.deepEqual(
    offersIn(analyse(index(files), root)),
    offersIn(analyse(index(files), root)),
    "no LLM, no clock, no randomness — offers inherit the index's determinism",
  );
});
