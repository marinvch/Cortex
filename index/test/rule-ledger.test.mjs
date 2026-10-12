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

test("a rule that cites a test file is in state test, with the path", () => {
  const r = ledger(FILES, TESTS, {
    "AGENTS.md": "# Root\n\n- **Every path goes through the guard.** `test/paths.test.js` pins it.\n",
  });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].state, "test");
  assert.deepEqual(r.rows[0].tests, ["test/paths.test.js"]);
  assert.equal(r.rows[0].line, 3);
  assert.equal(r.rows[0].doc, "AGENTS.md");
});

test("a rule that cites only production code is in state other", () => {
  // Naming where a rule is implemented is not naming what would fail if it broke.
  const r = ledger(FILES, TESTS, { "AGENTS.md": "- **The guard lives in one place**, `src/paths.js`.\n" });
  assert.equal(r.rows[0].state, "other");
  assert.deepEqual(r.rows[0].others, ["src/paths.js"]);
  assert.deepEqual(r.rows[0].tests, []);
});

test("a rule that cites nothing is in state none", () => {
  const r = ledger(FILES, TESTS, { "AGENTS.md": "- **Never guess an alias.** Read it from the repo.\n" });
  assert.equal(r.rows[0].state, "none");
  assert.deepEqual(r.counts, { test: 0, other: 0, none: 1 });
});

test("a test and code cited together is state test, and both are kept", () => {
  const r = ledger(FILES, TESTS, {
    "AGENTS.md": "- **Guarded.** See `src/paths.js`; `test/paths.test.js` fails without it.\n",
  });
  assert.equal(r.rows[0].state, "test");
  assert.deepEqual(r.rows[0].others, ["src/paths.js"]);
});

test("a citation on a continuation line belongs to the item that opened", () => {
  // Briefs wrap at 100 columns, so the test a rule names is rarely on its first line.
  const r = ledger(FILES, TESTS, {
    "AGENTS.md": "- **Every path goes through the guard.** It is long enough to\n  wrap, and `test/paths.test.js` pins it.\n",
  });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].state, "test");
  assert.equal(r.rows[0].line, 1);
});

test("a nested sub-item's citation counts for its parent, and is not a row of its own", () => {
  const r = ledger(FILES, TESTS, {
    "AGENTS.md": "- **Guarded.** Two parts:\n  - **the test** is `test/paths.test.js`\n  - the code\n",
  });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].state, "test");
});

test("a blank line ends an item, so a later paragraph's citation is not its evidence", () => {
  const r = ledger(FILES, TESTS, {
    "AGENTS.md": "- **Never guess an alias.**\n\nUnrelated prose naming `test/paths.test.js`.\n",
  });
  assert.equal(r.rows[0].state, "none");
});

test("a list item that does not open with bold text is not a rule", () => {
  // A routing table's bullets and a list of commands are items, and neither states a rule.
  const r = ledger(FILES, TESTS, { "AGENTS.md": "- see `src/paths.js`\n- plain item with **bold** later\n" });
  assert.equal(r.rows.length, 0);
  assert.equal(r.briefs, 1);
});

test("an item inside a code fence is an example, not a rule", () => {
  const r = ledger(FILES, TESTS, { "AGENTS.md": "```markdown\n- **An example rule.**\n```\n- **A real rule.**\n" });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].line, 4);
});

test("a citation resolves against the brief's own directory first", () => {
  const r = ledger(["pkg/AGENTS.md", "pkg/test/a.test.js"], ["pkg/test/a.test.js"], {
    "pkg/AGENTS.md": "- **Pinned** by `test/a.test.js`.\n",
  });
  assert.deepEqual(r.rows[0].tests, ["pkg/test/a.test.js"]);
});

test("a markdown link target is a citation, and its anchor is ignored", () => {
  const r = ledger(FILES, TESTS, { "AGENTS.md": "- **Pinned** by [the test](test/paths.test.js#guard).\n" });
  assert.equal(r.rows[0].state, "test");
});

test("a bare file name counts when exactly one indexed file carries it", () => {
  // Leaf briefs write "`build.test.mjs` asserts two runs agree" with no directory. The index knows
  // whether that name identifies one file.
  const r = ledger(["AGENTS.md", "index/test/build.test.mjs"], ["index/test/build.test.mjs"], {
    "AGENTS.md": "- **Deterministic.** `build.test.mjs` asserts two runs agree.\n",
  });
  assert.deepEqual(r.rows[0].tests, ["index/test/build.test.mjs"]);
});

test("a bare file name shared by two files is not evidence for either", () => {
  const paths = ["AGENTS.md", "a/run.test.mjs", "b/run.test.mjs"];
  const r = ledger(paths, paths.slice(1), { "AGENTS.md": "- **Pinned** by `run.test.mjs`.\n" });
  assert.equal(r.rows[0].state, "none");
});

test("a citation that does not resolve is not evidence", () => {
  // --citations reports it. Here it is simply not a test the index knows.
  const r = ledger(FILES, TESTS, { "AGENTS.md": "- **Pinned** by `test/gone.test.js`.\n" });
  assert.equal(r.rows[0].state, "none");
});

test("a brief naming itself is not evidence", () => {
  // Four lines of text, so it is a brief with rules of its own and not a pointer at the root.
  const r = ledger(["docs/AGENTS.md"], [], {
    "docs/AGENTS.md": "# Docs\n\nRules for this directory.\n\nMore.\n\n- **Read** `docs/AGENTS.md` first.\n",
  });
  assert.equal(r.rows[0].state, "none");
});

test("a file the index flags as a test but that cannot be one is another file", () => {
  // An index built before langs.mjs learned a document is never a test still says so.
  const r = ledger(["AGENTS.md", "tests/NOTES.md"], ["tests/NOTES.md"], {
    "AGENTS.md": "- **Explained** in `tests/NOTES.md`.\n",
  });
  assert.equal(r.rows[0].state, "other");
});

test("the glossary, ADRs and templates yield no rows", () => {
  const docs = {
    "CONTEXT.md": "- **A term.**\n",
    "docs/adr/0001-x.md": "- **A decision.**\n",
    "templates/AGENTS.md": "- **A template rule.**\n",
  };
  const r = ledger(Object.keys(docs), [], docs);
  assert.equal(r.rows.length, 0);
  assert.equal(r.hasBriefs, false);
});

test("a shim is not a brief, and a CLAUDE.md with rules of its own is", () => {
  const r = ledger(["AGENTS.md", "CLAUDE.md", "GEMINI.md"], [], {
    "AGENTS.md": "- **Root rule.**\n",
    "CLAUDE.md": "@AGENTS.md\n",
    "GEMINI.md": "# Gemini\n\n- **A rule only Gemini reads.**\n\nMore text.\n\nAnd more.\n",
  });
  assert.equal(r.briefs, 2);
  assert.deepEqual(r.rows.map((x) => x.doc), ["AGENTS.md", "GEMINI.md"]);
});

test("a brief that could not be read is counted as unread, never as empty", () => {
  const r = ledger(["AGENTS.md", "pkg/AGENTS.md"], [], { "AGENTS.md": "- **Root rule.**\n" });
  assert.equal(r.briefs, 1);
  assert.deepEqual(r.unread, ["pkg/AGENTS.md"]);
});

test("CRLF line endings give the same rows as LF", () => {
  const lf = "# Root\n\n- **Guarded.** Wraps\n  to `test/paths.test.js`.\n- **Second.**\n";
  const a = ledger(FILES, TESTS, { "AGENTS.md": lf });
  const b = ledger(FILES, TESTS, { "AGENTS.md": lf.replace(/\n/g, "\r\n") });
  assert.deepEqual(b, a);
});

test("the row's text is the opening line without the bullet, cut at 120 characters", () => {
  const long = "x".repeat(200);
  const r = ledger(FILES, TESTS, { "AGENTS.md": `- **Rule.** ${long}\n` });
  assert.equal(r.rows[0].text.length, 120);
  assert.ok(r.rows[0].text.startsWith("**Rule.**"));
});

test("rows sort by document, then line, and two runs agree", () => {
  const docs = {
    "b/AGENTS.md": "- **B one.**\n- **B two.**\n",
    "AGENTS.md": "- **Root.**\n",
    "a/AGENTS.md": "- **A.**\n",
  };
  const paths = ["b/AGENTS.md", "AGENTS.md", "a/AGENTS.md"];
  const one = ledger(paths, [], docs);
  const two = ledger([...paths].reverse(), [], docs);
  assert.deepEqual(one.rows.map((x) => `${x.doc}:${x.line}`), ["a/AGENTS.md:1", "AGENTS.md:1", "b/AGENTS.md:1", "b/AGENTS.md:2"]);
  assert.equal(JSON.stringify(one), JSON.stringify(two));
});

test("the counts add up to the rows", () => {
  const r = ledger(FILES, TESTS, {
    "AGENTS.md": "- **One.** `test/paths.test.js`\n- **Two.** `src/paths.js`\n- **Three.**\n- **Four.**\n",
  });
  assert.deepEqual(r.counts, { test: 1, other: 1, none: 2 });
  assert.equal(r.counts.test + r.counts.other + r.counts.none, r.rows.length);
});

test("no row and no field says a rule is enforced or not", () => {
  // The ledger cites. Deciding that a test enforces a sentence needs a model.
  const r = ledger(FILES, TESTS, { "AGENTS.md": "- **One.** `test/paths.test.js`\n- **Two.**\n" });
  assert.doesNotMatch(JSON.stringify(r), /enforc/i);
});
