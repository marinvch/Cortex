import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyse, render, testStem, offerOf, offers } from "../lib/findings.mjs";

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
    areas: [{ id: "area:src", name: "src", paths: files.map((f) => f.path) }],
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

// The marker is written by concatenation in the two tests below, because they assert what happens
// when a file MENTIONS it — spelled out, the fixture would be making the claim it is meant to be
// merely discussing, which is the self-matching trap in miniature.
const MARK = ["cortex:", "allow-secrets"].join("");

test("a marker with nothing left to exempt is reported, not swallowed", () => {
  // The defect: the loop bailed on an empty scan BEFORE testing for the marker, so a file whose
  // fixture was deleted or stopped matching the scanner kept a blanket opt-out that could never
  // appear in any report. tools/test/cortex-cron.test.sh sat that way for real — its fake key began
  // with "test", core/scrub.js added "test" to PLACEHOLDER, the hits went to zero, and the marker
  // stayed. Invisible in both directions, because the marker also suppresses the secrets finding.
  const root = repo({ "test/cron.test.js": `// ${MARK}\nconst key = "nothing secret here";\n` });
  const sec = findingsOfKind(analyse(index([{ path: "test/cron.test.js", isTest: true }]), root), "security");

  assert.equal(sec.length, 1, "a dormant marker is the whole security story for this repo");
  assert.match(sec[0].title, /no longer exempts anything/);
  assert.equal(sec[0].severity, "low", "no secret is leaking — this is hygiene, not an alarm");
  assert.match(sec[0].evidence[0], /^test\/cron\.test\.js:1 /, "the line to delete is named");

  // Its own finding, with its own action. Rendered as a row in the exemptions list it would read
  // "0 secret-shaped strings", which looks like a bug in the report; and the action is the
  // opposite one — an active exemption is re-read, a dormant one is deleted.
  assert.doesNotMatch(sec[0].title, /exempted from the secret scan/);
  assert.match(sec[0].detail, /deleted/, "the detail names the action, and it is not 're-read'");
  assert.ok(!sec[0].evidence.some((e) => /\b0 secret-shaped/.test(e)), "and never counts zero of anything");
});

test("a file that only DISCUSSES the marker is not exempt, and is not dormant either", () => {
  // The trap the ordering fix walks into on its own. `text.includes(...)` matches anywhere, so
  // every file explaining the mechanism claims the exemption — on this repo, findings.mjs itself
  // and this very test file. That was invisible only because the empty-scan bail ran first, so the
  // two bugs hid each other: fix the order without narrowing the claim and five discussion files
  // immediately surface as dormant exemptions, which is a worse report than the one we started
  // with. A claim is positional, a mention is not — the same rule citationDrift holds itself to.
  const prose = `${"\n".repeat(30)}// The scanner honours a ${MARK} comment.\n`;
  const root = repo({ "src/doc.js": prose });
  assert.equal(
    findingsOfKind(analyse(index([{ path: "src/doc.js" }]), root), "security").length,
    0,
    "a mention below the header is prose about the mechanism, not an exemption",
  );

  // And the narrowing must not blind the scanner: a real secret beside a late mention is still a
  // leak. This is the direction of error that matters — a marker out of place costs a finding the
  // report tells you to verify by hand; a marker honoured anywhere costs the finding entirely.
  const leaky = repo({
    "src/conf.js": `${"\n".repeat(30)}// see ${MARK}\nconst k = "${["AKIA", "IOSFODNN7", "EXAMPLE"].join("")}";`,
  });
  const sec = findingsOfKind(analyse(index([{ path: "src/conf.js" }]), leaky), "security");
  assert.equal(sec.length, 1);
  assert.equal(sec[0].severity, "critical", "a mention does not exempt a real credential");
});

test("a marker in the header still exempts, so the narrowing costs nothing real", () => {
  // The rule is positional, not first-line-only: a shebang, a licence line or a file docstring
  // routinely sits above the marker. Line 5 of 10 must still be a claim.
  const key = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");
  const root = repo({ "test/corpus.test.js": `#!/usr/bin/env node\n//\n// Scanner corpus.\n//\n// ${MARK}\nconst fake = "${key}";\n` });
  const sec = findingsOfKind(analyse(index([{ path: "test/corpus.test.js", isTest: true }]), root), "security");
  assert.equal(sec.length, 1);
  assert.match(sec[0].title, /exempted from the secret scan/, "a header marker below line 1 still exempts");
  assert.match(sec[0].evidence[0], /1 secret-shaped string$/, "and the active list still counts what it hides");
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
    areas: [],
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

// Five code files in a directory is what briefCandidates asks for, so a repo that genuinely has
// somewhere to cut needs one. The earlier version of the test below used a single root-level file,
// which is why it passed while the offer it asserted carried no candidates at all.
const anAreaWorthABrief = () =>
  ["src/a.js", "src/b.js", "src/c.js", "src/d.js", "src/e.js"].map((path) => ({ path }));

test("an oversized AGENTS.md offers splitting, not re-scaffolding", () => {
  const root = repo({ "AGENTS.md": `${"line\n".repeat(300)}`, "CONTEXT.md": "x" });
  const [f] = analyse(index(anAreaWorthABrief()), root).filter((x) => /AGENTS\.md is \d+ lines/.test(x.title));
  assert.equal(offerOf(f)?.action, "brief", "a large root brief is split into leaves, not overwritten");
  assert.deepEqual(offerOf(f).targets, ["src"], "and the offer names where to cut");
});

test("an oversized root with nowhere left to cut offers nothing, and says what to do instead", () => {
  // The defect: `offer("brief")` fired on size alone, so a repo whose areas all already have leaves
  // emitted {"action":"brief","targets":[]} — the detector reporting, in its own output, that its
  // remedy has no candidate. offers() is the wizard's script (ADR 0006), so an empty-target entry
  // walks the interview into a question with nothing to choose between.
  const root = repo({
    "AGENTS.md": `${"line\n".repeat(300)}`,
    "CONTEXT.md": "x",
    "src/AGENTS.md": "# the leaf that already exists\n",
  });
  const all = analyse(index(anAreaWorthABrief()), root);
  const [f] = all.filter((x) => /AGENTS\.md is \d+ lines/.test(x.title));

  assert.ok(f, "the measurement still stands — the root really is too long");
  assert.equal(offerOf(f), null, "but a remedy with no candidate is not offered");
  assert.match(f.detail, /optimize-context/, "the reader is still told what to run");
  assert.match(f.detail, /nothing left to split out/, "and why cutting a leaf is not it");

  // The whole point: the wizard's script must not contain a step with nothing to choose between.
  // `scaffold`, `enrich` and `memory` legitimately carry no targets — the question is whole-repo.
  // `brief` is the one whose entire question is "which of these", so an empty list there is a
  // dead end rather than a shape.
  assert.ok(
    !offers(all).some((o) => o.action === "brief"),
    "no brief entry reaches the wizard with nothing to name",
  );
});

test("the two producers of a brief offer collapse onto one set of real targets", () => {
  // Both the root-size finding and the scoped-brief proposal emit `brief`, and offers() merges by
  // action. They must name the same candidates, or the merged entry's targets depend on which
  // finding happened to be seen first.
  const root = repo({ "AGENTS.md": `${"line\n".repeat(300)}`, "CONTEXT.md": "x" });
  const all = analyse(index([...anAreaWorthABrief(), ...["lib/a.js", "lib/b.js", "lib/c.js", "lib/d.js", "lib/e.js"].map((path) => ({ path }))]), root);
  const brief = offers(all).filter((o) => o.action === "brief");

  assert.equal(brief.length, 1, "two findings, one question");
  assert.deepEqual([...brief[0].targets].sort(), ["lib", "src"], "carrying every candidate, listed once each");
  assert.ok(brief[0].findings.length >= 2, "and remembering both findings that asked for it");
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

// --- The worklist -----------------------------------------------------------------------------
//
// A repo with thirty findings must not become a thirty-question interview. Offers collapse by
// action, so five areas needing briefs are one conversation naming five candidates — the wizard
// asks per *decision*, not per finding.

test("same-action findings collapse into one entry carrying every target", () => {
  const root = repo({ "AGENTS.md": `${"line\n".repeat(300)}`, "CONTEXT.md": "x" });
  const files = [
    ...Array.from({ length: 8 }, (_, i) => ({ path: `billing/f${i}.js`, commits: 3 })),
    ...Array.from({ length: 8 }, (_, i) => ({ path: `auth/f${i}.js`, commits: 2 })),
  ];
  const work = offers(analyse(index(files), root));

  const brief = work.filter((o) => o.action === "brief");
  assert.equal(brief.length, 1, "two findings both proposing briefs are one decision, not two");
  assert.deepEqual([...brief[0].targets].sort(), ["auth", "billing"], "no target is lost in the merge");
});

test("a merged entry takes its rank from its highest member", () => {
  const root = repo({ "src/config.js": `const key = "${["AKIA", "IOSFODNN7", "EXAMPLE"].join("")}";` });
  const work = offers(analyse(index([{ path: "src/config.js" }]), root));
  assert.equal(work[0].action, "triage-secrets", "critical leads the worklist, as the report requires");
  assert.equal(work[0].severity, "critical");
});

test("the worklist is ranked, so the wizard asks the most severe question first", () => {
  const work = offers(analyse(index([{ path: "a.js" }]), repo()));
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  const ranks = work.map((o) => rank[o.severity]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "severity order survives collapsing");
  assert.equal(work[0].action, "scaffold", "a repo with no context layer is asked that first");
});

test("a worklist entry remembers which findings produced it", () => {
  const work = offers(analyse(index([{ path: "a.js" }]), repo()));
  const scaffold = work.find((o) => o.action === "scaffold");
  assert.ok(scaffold.findings.length >= 2, "missing AGENTS.md and missing CONTEXT.md both fed it");
  assert.ok(
    scaffold.findings.every((t) => typeof t === "string"),
    "titles, so the wizard can say why it is asking",
  );
});

test("findings with no offer never reach the worklist", () => {
  const idx = index([{ path: "a.js" }]);
  idx.stats.tests = 0;
  const work = offers(analyse(idx, repo()));
  assert.ok(
    !work.some((o) => /test/i.test(o.action)),
    "an unactionable finding is reported, never asked about",
  );
});

test("a greenfield repo produces an empty worklist", () => {
  assert.deepEqual(offers(analyse(emptyIndex(), repo())), []);
});

// --- The three offers no finding produced ------------------------------------------------------
//
// enrich, memory and bundle are repo-scale proposals rather than defects, so nothing in the report
// spoke for them and the wizard had nothing to ask. They are all low: none of them is a problem,
// and ranking an optional token spend as a defect is how a report loses its calibration.

const BIG = Array.from({ length: 60 }, (_, i) => ({ path: `src/f${i}.js` }));

test("a large repo offers enrichment, and says what it costs", () => {
  const [f] = analyse(index(BIG), repo()).filter((x) => offerOf(x)?.action === "enrich");
  assert.ok(f, "a big unfamiliar repo is exactly where enrichment pays");
  assert.equal(f.severity, "low", "an optional token spend is not a defect");
  assert.match(f.detail, /token/i, "the cost is stated before the question, never after");
});

test("a small repo is not asked to pay for enrichment", () => {
  const work = offers(analyse(index([{ path: "a.js" }]), repo()));
  assert.ok(!work.some((o) => o.action === "enrich"));
});

test("an already-enriched repo is not offered it again", () => {
  const root = repo({ ".cortex/index/enriched.json": "{}" });
  assert.ok(!offers(analyse(index(BIG), root)).some((o) => o.action === "enrich"));
});

test("a repo with no committed memory is offered one", () => {
  const [f] = analyse(index([{ path: "a.js" }]), repo()).filter((x) => offerOf(x)?.action === "memory");
  assert.ok(f, "shared memory is the point of the committed half of .cortex/");
  assert.match(f.detail, /commit/i, "the committed/gitignored asymmetry is explained once");
});

test("an existing memory store is not offered again", () => {
  const root = repo({ ".cortex/memory/2026-08-17.md": "# day\n" });
  assert.ok(!offers(analyse(index([{ path: "a.js" }]), root)).some((o) => o.action === "memory"));
});

test("a frontend proposes the browser-qa tier, and only that", () => {
  const idx = index([{ path: "src/App.tsx" }, { path: "src/app.css", category: "code" }]);
  const [f] = analyse(idx, repo()).filter((x) => offerOf(x)?.action === "bundle");
  assert.ok(f, "the index gave a reason, so the tier is offered");
  assert.deepEqual(offerOf(f).targets, ["browser-qa"], "never recite the whole list");
});

test("an API surface proposes the api tier", () => {
  const idx = index([{ path: "openapi.yaml", category: "config" }, { path: "src/server.js" }]);
  const [f] = analyse(idx, repo()).filter((x) => offerOf(x)?.action === "bundle");
  assert.deepEqual(offerOf(f).targets, ["api"]);
});

test("a repo that is neither is offered no tier at all", () => {
  const work = offers(analyse(index([{ path: "lib/thing.js" }]), repo()));
  assert.ok(!work.some((o) => o.action === "bundle"), "no reason from the index means no question");
});

test("greenfield still proposes nothing, including the three new offers", () => {
  assert.deepEqual(offers(analyse(emptyIndex(), repo())), []);
});

// --- Re-run ------------------------------------------------------------------------------------
//
// ADR 0005 lets an established repo re-index freely, which means the wizard runs again over a repo
// it already served. Work already done must not be offered a second time: re-proposing finished
// work is how a report teaches people to stop reading it, and the second run is where that lands.

test("a furnished repo offers no scaffolding", () => {
  const furnished = repo({
    "AGENTS.md": "# brief\nreal content\n",
    "CONTEXT.md": "# glossary\n",
    "docs/adr/TEMPLATE.md": "# adr\n",
  });
  const work = offers(analyse(index([{ path: "a.js" }]), furnished));
  assert.ok(!work.some((o) => o.action === "scaffold"), "nothing to scaffold on a second run");
});

test("an area that already has a brief drops out of the targets, not just the report", () => {
  const files = [
    ...Array.from({ length: 8 }, (_, i) => ({ path: `billing/f${i}.js`, commits: 3 })),
    ...Array.from({ length: 8 }, (_, i) => ({ path: `auth/f${i}.js`, commits: 2 })),
  ];
  const work = offers(analyse(index(files), repo({ "billing/AGENTS.md": "# billing\n" })));
  const brief = work.find((o) => o.action === "brief");
  assert.deepEqual(brief.targets, ["auth"], "a finished area is not offered again");
});

test("a repo Cortex has fully served asks nothing at all", () => {
  const furnished = repo({
    "AGENTS.md": "# brief\nreal content\n",
    "CONTEXT.md": "# glossary\n",
    "docs/adr/TEMPLATE.md": "# adr\n",
    ".cortex/memory/2026-08-17.md": "# day\n",
  });
  const idx = index([{ path: "a.js" }, { path: "a.test.js", isTest: true }]);
  assert.deepEqual(offers(analyse(idx, furnished)), [], "an empty worklist is a successful re-run");
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

test("a test certificate does not open the interview", () => {
  // Run against six respected open-source repositories, four came back CRITICAL and every match
  // was a fixture or a placeholder. Severity is control flow (ADR 0006), so the wizard led with a
  // false alarm — and a tool that cries wolf teaches people to skip the section entirely.
  const key = ["-----BEGIN", " RSA PRIVATE KEY-----"].join("");
  const root = repo({ "tests/certs/server.key": key });
  const sec = findingsOfKind(analyse(index([{ path: "tests/certs/server.key" }]), root), "security");
  assert.equal(sec.length, 1, "a fixture key is still reported");
  assert.equal(sec[0].severity, "medium", "but not as the thing to deal with first");
  assert.match(sec[0].title, /test file/, "and the title says where it came from");
});

test("a key outside a test path stays critical", () => {
  // The rule must not become a way to hide a real leak by filing it under tests/.
  const key = ["-----BEGIN", " RSA PRIVATE KEY-----"].join("");
  const root = repo({ "src/config/server.key": key });
  const sec = findingsOfKind(analyse(index([{ path: "src/config/server.key" }]), root), "security");
  assert.equal(sec.length, 1);
  assert.equal(sec[0].severity, "critical");
});
