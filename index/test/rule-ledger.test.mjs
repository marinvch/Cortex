import { test } from "node:test";
import assert from "node:assert/strict";
import { ruleLedger } from "../lib/rule-ledger.mjs";

/** An index carrying paths and the one flag the ledger reads off a file. */
function ix(paths, tests = []) {
  return {
    files: paths.map((path) => ({ path, category: "code", lang: "javascript", isTest: tests.includes(path) })),
  };
}
const reader = (docs) => (p) => (p in docs ? docs[p] : null);
const ledger = (paths, tests, docs) => ruleLedger(ix(paths, tests), { readText: reader(docs) });

const FILES = ["AGENTS.md", "src/paths.js", "test/paths.test.js"];
const TESTS = ["test/paths.test.js"];

/** A brief whose rules section holds `items`. The first item is on line 3. */
const inv = (items) => `## Invariants\n\n${items}`;
/** The ledger of a root brief holding these items under `## Invariants`. */
const root = (items) => ledger(FILES, TESTS, { "AGENTS.md": inv(items) });

test("a rule that cites a test file is in state test, with the path", () => {
  const r = root("- Every path goes through the guard. `test/paths.test.js` pins it.\n");
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].state, "test");
  assert.deepEqual(r.rows[0].tests, ["test/paths.test.js"]);
  assert.equal(r.rows[0].line, 3);
  assert.equal(r.rows[0].doc, "AGENTS.md");
  assert.equal(r.rows[0].section, "Invariants");
});

test("a rule that cites only production code is in state other", () => {
  // Naming where a rule is implemented is not naming what would fail if it broke.
  const r = root("- The guard lives in one place, `src/paths.js`.\n");
  assert.equal(r.rows[0].state, "other");
  assert.deepEqual(r.rows[0].others, ["src/paths.js"]);
  assert.deepEqual(r.rows[0].tests, []);
});

test("a rule that cites nothing is in state none", () => {
  const r = root("- Never guess an alias. Read it from the repo.\n");
  assert.equal(r.rows[0].state, "none");
  assert.deepEqual(r.counts, { test: 0, other: 0, none: 1 });
});

test("a test and code cited together is state test, and both are kept", () => {
  const r = root("- Guarded. See `src/paths.js`; `test/paths.test.js` fails without it.\n");
  assert.equal(r.rows[0].state, "test");
  assert.deepEqual(r.rows[0].others, ["src/paths.js"]);
});

test("an item is a rule whether or not it opens with bold", () => {
  // Cortex's own template stamps invariants as plain items, and this repo writes them bold.
  const r = root("- **Bold rule.**\n- plain rule\n");
  assert.equal(r.rows.length, 2);
});

test("a section named Gotchas or Rules is read too, in any case", () => {
  for (const h of ["## Gotchas", "## The rules", "## GOTCHAS", "### Invariant", "## Rule"]) {
    const r = ledger(FILES, TESTS, { "AGENTS.md": `${h}\n\n- one\n` });
    assert.equal(r.rows.length, 1, h);
  }
});

test("an item under any other heading is not a rule", () => {
  // A routing list, a list of commands and a definition list are items, and none states a rule.
  // On vercel/ai every bold-led item in the brief was a definition: "**Node.js**: v22.13+".
  const r = ledger(FILES, TESTS, {
    "AGENTS.md": "- before any heading\n\n## Stack\n\n- **Node.js**: v22\n\n## Rulebook\n\n- not the word\n",
  });
  assert.equal(r.rows.length, 0);
  assert.equal(r.briefs, 1);
});

test("a subsection of a rules section is still that section", () => {
  // index/AGENTS.md keeps "### The loop reader" under "## Gotchas".
  const r = ledger(FILES, TESTS, {
    "AGENTS.md": "## Gotchas\n\n- one\n\n### The loop reader\n\n- two\n\n## Tests\n\n- three\n",
  });
  assert.deepEqual(r.rows.map((x) => x.section), ["Gotchas", "The loop reader"]);
});

test("a heading at the same level closes the rules section", () => {
  const r = ledger(FILES, TESTS, { "AGENTS.md": "### Invariants\n\n- one\n\n### Layout\n\n- two\n\n## Other\n\n- three\n" });
  assert.equal(r.rows.length, 1);
});

test("a placeholder a template left behind is not a rule", () => {
  const r = root("- {{an invariant, and why it holds}}\n- a real one\n");
  assert.deepEqual(r.rows.map((x) => x.text), ["a real one"]);
});

test("a citation on a continuation line belongs to the item that opened", () => {
  // Briefs wrap at 100 columns, so the test a rule names is rarely on its first line.
  const r = root("- Every path goes through the guard. It is long enough to\n  wrap, and `test/paths.test.js` pins it.\n");
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].state, "test");
  assert.equal(r.rows[0].line, 3);
});

test("a nested sub-item's citation counts for its parent, and is not a row of its own", () => {
  const r = root("- Guarded. Two parts:\n  - the test is `test/paths.test.js`\n  - the code\n");
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].state, "test");
});

test("text at column 0 ends an item, so nothing after it is that item's evidence", () => {
  const r = root("- Never guess an alias.\n\nUnrelated prose.\n\n    indented `test/paths.test.js`\n");
  assert.equal(r.rows[0].state, "none");
});

test("an indented paragraph after a blank line is still the item", () => {
  // Markdown reads it as the item's second paragraph, and that is where a long rule names its test.
  const r = root("- Every path goes through the guard.\n\n  `test/paths.test.js` pins it.\n");
  assert.equal(r.rows[0].state, "test");
});

test("an item inside a code fence is an example, not a rule", () => {
  const r = root("```markdown\n- An example rule.\n```\n- A real rule.\n");
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].line, 6);
});

test("a heading inside a code fence opens no section", () => {
  const r = ledger(FILES, TESTS, { "AGENTS.md": "## Layout\n\n```\n## Invariants\n```\n\n- not a rule\n" });
  assert.equal(r.rows.length, 0);
});

test("a citation resolves against the brief's own directory first", () => {
  const r = ledger(["pkg/AGENTS.md", "pkg/test/a.test.js"], ["pkg/test/a.test.js"], {
    "pkg/AGENTS.md": inv("- Pinned by `test/a.test.js`.\n"),
  });
  assert.deepEqual(r.rows[0].tests, ["pkg/test/a.test.js"]);
});

test("a markdown link target is a citation, and its anchor is ignored", () => {
  const r = root("- Pinned by [the test](test/paths.test.js#guard).\n");
  assert.equal(r.rows[0].state, "test");
});

test("a bare file name counts when exactly one indexed file carries it", () => {
  // Leaf briefs write "`build.test.mjs` asserts two runs agree" with no directory. The index knows
  // whether that name identifies one file.
  const r = ledger(["AGENTS.md", "index/test/build.test.mjs"], ["index/test/build.test.mjs"], {
    "AGENTS.md": inv("- Deterministic. `build.test.mjs` asserts two runs agree.\n"),
  });
  assert.deepEqual(r.rows[0].tests, ["index/test/build.test.mjs"]);
});

test("a bare file name shared by two files is not evidence for either", () => {
  const paths = ["AGENTS.md", "a/run.test.mjs", "b/run.test.mjs"];
  const r = ledger(paths, paths.slice(1), { "AGENTS.md": inv("- Pinned by `run.test.mjs`.\n") });
  assert.equal(r.rows[0].state, "none");
});

// A Java, Kotlin, C# or Swift brief names a type, not a path. On the first scaffolded repo the
// ledger was run on, seven rules named a real test as `ShipmentServiceTest.someMethod` and the
// ledger counted none of them.
const JAVA = ["AGENTS.md", "src/main/Shipment.java", "src/test/ShipmentServiceTest.java"];
const JAVA_TESTS = ["src/test/ShipmentServiceTest.java"];

test("a type name counts when exactly one indexed file is named for it", () => {
  const r = ledger(JAVA, JAVA_TESTS, { "AGENTS.md": inv("- Status moves forward. Covered by `ShipmentServiceTest`.\n") });
  assert.deepEqual(r.rows[0].tests, ["src/test/ShipmentServiceTest.java"]);
});

test("a type name followed by a member names the type's file", () => {
  const r = ledger(JAVA, JAVA_TESTS, {
    "AGENTS.md": inv("- `Shipment.status` is read off the last event. Covered by `ShipmentServiceTest.trackingOnlyMovesForward`.\n"),
  });
  assert.equal(r.rows[0].state, "test");
  assert.deepEqual(r.rows[0].others, ["src/main/Shipment.java"]);
});

test("a type name two files are named for is not evidence for either", () => {
  const paths = ["AGENTS.md", "a/Config.java", "b/Config.kt"];
  const r = ledger(paths, [], { "AGENTS.md": inv("- Read `Config` first.\n") });
  assert.equal(r.rows[0].state, "none");
});

test("a lower-case word is never read as a type name", () => {
  // `build`, `index` and `test` are ordinary words in a brief, and each is also a file's stem.
  const r = ledger(["AGENTS.md", "src/build.mjs"], [], { "AGENTS.md": inv("- Run `build` before `build.first`.\n") });
  assert.equal(r.rows[0].state, "none");
});

test("a type name is matched on the whole stem, in its own case", () => {
  const r = ledger(["AGENTS.md", "src/ShipmentView.java"], [], { "AGENTS.md": inv("- `Shipment` and `SHIPMENTVIEW` are not that file.\n") });
  assert.equal(r.rows[0].state, "none");
});

test("a file with a compound extension is named for the stem before its first dot", () => {
  const r = ledger(["AGENTS.md", "src/Cart.test.tsx"], ["src/Cart.test.tsx"], { "AGENTS.md": inv("- Totals are rounded once. See `Cart`.\n") });
  assert.equal(r.rows[0].state, "none");
});

test("a citation that does not resolve is not evidence", () => {
  // --citations reports it. Here it is simply not a test the index knows.
  const r = root("- Pinned by `test/gone.test.js`.\n");
  assert.equal(r.rows[0].state, "none");
});

test("a brief naming itself is not evidence", () => {
  const r = ledger(["docs/AGENTS.md"], [], { "docs/AGENTS.md": inv("- Read `docs/AGENTS.md` first.\n- two\n- three\n") });
  assert.equal(r.rows[0].state, "none");
});

test("a file the index flags as a test but that cannot be one is another file", () => {
  // An index built before langs.mjs learned a document is never a test still says so.
  const r = ledger(["AGENTS.md", "tests/NOTES.md"], ["tests/NOTES.md"], {
    "AGENTS.md": inv("- Explained in `tests/NOTES.md`.\n"),
  });
  assert.equal(r.rows[0].state, "other");
});

test("the glossary, ADRs and templates yield no rows", () => {
  const docs = {
    "CONTEXT.md": inv("- A term.\n"),
    "docs/adr/0001-x.md": inv("- A decision.\n"),
    "templates/AGENTS.md": inv("- A template rule.\n"),
  };
  const r = ledger(Object.keys(docs), [], docs);
  assert.equal(r.rows.length, 0);
  assert.equal(r.hasBriefs, false);
});

test("a shim is not a brief, and a CLAUDE.md with rules of its own is", () => {
  const r = ledger(["AGENTS.md", "CLAUDE.md", "GEMINI.md"], [], {
    "AGENTS.md": inv("- Root rule.\n"),
    "CLAUDE.md": "@AGENTS.md\n",
    "GEMINI.md": inv("- A rule only Gemini reads.\n"),
  });
  assert.equal(r.briefs, 2);
  assert.deepEqual(r.rows.map((x) => x.doc), ["AGENTS.md", "GEMINI.md"]);
});

test("a pointer written in prose is a shim too", () => {
  // Not every shim is an `@` import: another tool's file may only say where the brief is.
  const r = ledger(["AGENTS.md", "GEMINI.md"], [], {
    "AGENTS.md": inv("- Root rule.\n"),
    "GEMINI.md": "Read AGENTS.md for this repo's rules.\n",
  });
  assert.equal(r.briefs, 1);
});

test("a shim that Cortex appended sections to is still the root brief, not a second one", () => {
  // `/cortex` appends the verification block to `CLAUDE.md` under its `@AGENTS.md` line. Counting
  // that file told every installed repo that one of its briefs had no rules section.
  const appended = "@AGENTS.md\n\n## Verifying your work\n\n| Check | Command |\n|---|---|\n| Test | `npm test` |\n\nDone means these ran.\n";
  const r = ledger(["AGENTS.md", "CLAUDE.md"], [], { "AGENTS.md": inv("- Root rule.\n"), "CLAUDE.md": appended });
  assert.equal(r.briefs, 1);
  assert.equal(r.withSections, 1);
});

test("a file that imports the root brief and states rules of its own is read", () => {
  const own = "@AGENTS.md\n\n## Rules\n\n- Only Claude reads this one.\n\nMore text here.\n\nAnd more.\n";
  const r = ledger(["AGENTS.md", "CLAUDE.md"], [], { "AGENTS.md": inv("- Root rule.\n"), "CLAUDE.md": own });
  assert.equal(r.briefs, 2);
  assert.deepEqual(r.rows.map((x) => x.doc), ["AGENTS.md", "CLAUDE.md"]);
});

test("a brief that could not be read is counted as unread, never as empty", () => {
  const r = ledger(["AGENTS.md", "pkg/AGENTS.md"], [], { "AGENTS.md": inv("- Root rule.\n") });
  assert.equal(r.briefs, 1);
  assert.deepEqual(r.unread, ["pkg/AGENTS.md"]);
});

test("a brief with no rules section is counted, so an empty ledger is not read as a clean one", () => {
  const r = ledger(["AGENTS.md", "pkg/AGENTS.md"], [], {
    "AGENTS.md": inv("- Root rule.\n"),
    "pkg/AGENTS.md": "# pkg\n\nAll prose.\n\n## Layout\n\n- a list\n",
  });
  assert.equal(r.briefs, 2);
  assert.equal(r.withSections, 1);
});

test("CRLF line endings give the same rows as LF", () => {
  const lf = inv("- Guarded. Wraps\n  to `test/paths.test.js`.\n- Second.\n\n## Layout\n\n- not a rule\n");
  const a = ledger(FILES, TESTS, { "AGENTS.md": lf });
  const b = ledger(FILES, TESTS, { "AGENTS.md": lf.replace(/\n/g, "\r\n") });
  assert.equal(a.rows.length, 2);
  assert.deepEqual(b, a);
});

test("the row's text is the opening line without the bullet, cut at 120 characters", () => {
  const r = root(`- Rule. ${"x".repeat(200)}\n`);
  assert.equal(r.rows[0].text.length, 120);
  assert.ok(r.rows[0].text.startsWith("Rule."));
});

test("a heading's markup is dropped from the section name", () => {
  const r = ledger(FILES, TESTS, { "AGENTS.md": "## The **rules** of `core/`\n\n- one\n" });
  assert.equal(r.rows[0].section, "The rules of core/");
});

test("rows sort by document, then line, and two runs agree", () => {
  const docs = {
    "b/AGENTS.md": inv("- B one.\n- B two.\n"),
    "AGENTS.md": inv("- Root.\n"),
    "a/AGENTS.md": inv("- A.\n"),
  };
  const paths = ["b/AGENTS.md", "AGENTS.md", "a/AGENTS.md"];
  const one = ledger(paths, [], docs);
  const two = ledger([...paths].reverse(), [], docs);
  assert.deepEqual(one.rows.map((x) => `${x.doc}:${x.line}`), ["a/AGENTS.md:3", "AGENTS.md:3", "b/AGENTS.md:3", "b/AGENTS.md:4"]);
  assert.equal(JSON.stringify(one), JSON.stringify(two));
});

test("the counts add up to the rows", () => {
  const r = root("- One. `test/paths.test.js`\n- Two. `src/paths.js`\n- Three.\n- Four.\n");
  assert.deepEqual(r.counts, { test: 1, other: 1, none: 2 });
  assert.equal(r.counts.test + r.counts.other + r.counts.none, r.rows.length);
});

test("no row and no field says a rule is enforced or not", () => {
  // The ledger cites. Deciding that a test enforces a sentence needs a model.
  const r = root("- One. `test/paths.test.js`\n- Two.\n");
  assert.doesNotMatch(JSON.stringify(r), /enforc/i);
});
