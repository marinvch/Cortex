import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  MAX_TEXT_BYTES,
  NO_TEXT,
  repoText,
  scannedForSecrets,
  textFrom,
  textSource,
} from "../lib/repo-text.mjs";
import { MAX_INDEXED_BYTES } from "../lib/walk.mjs";

// This module exists because three scanners each read the repo their own way: two different byte
// caps and one absent one, three try/catch-and-skip blocks, and NEITHER cap under test — grep
// found both numbers only at the line that defined them. A cap nothing exercises is a policy
// nobody chose, so the first thing these tests do is make the cap assertable from literals rather
// than by writing half a megabyte to disk.

function repo(files = {}) {
  const root = tempDir("cortex-text-");
  for (const [p, content] of Object.entries(files)) {
    const abs = join(root, p);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

test("there is one cap, and it is the Index's own ceiling", () => {
  // Not 400_000 and not 512 * 1024 — both were second caps under a limit walk.mjs had already
  // applied, so a scanner could read less than the file list it was scanning and say nothing.
  assert.equal(MAX_TEXT_BYTES, MAX_INDEXED_BYTES);
  assert.equal(textFrom({}).cap, MAX_INDEXED_BYTES);
});

test("the cap is assertable without writing a 400KB file", () => {
  const text = textFrom({ "big.js": "x".repeat(64), "small.js": "ok" }, { cap: 32 });
  assert.equal(text.read("small.js"), "ok");
  assert.equal(text.read("big.js"), null, "over the cap reads as null, never as empty");
  assert.equal(text.reasonFor("big.js"), "too-large");
});

test("a skipped read is visible to the caller, not silently empty", () => {
  // The failure this forecloses: a file the scanner never opened reaches it as "no match found",
  // which is indistinguishable from a clean file. Null plus a record is distinguishable.
  const root = repo({ "there.js": "hello" });
  const text = repoText(root);
  assert.equal(text.read("there.js"), "hello");
  assert.equal(text.read("gone.js"), null);
  assert.deepEqual(text.unread, [{ path: "gone.js", reason: "missing" }]);
});

test("what could not be read is sorted, so every caller stays deterministic", () => {
  const text = textFrom({ b: "xxxx", a: "xxxx", c: "xxxx" }, { cap: 2 });
  for (const p of ["c", "a", "b"]) text.read(p);
  assert.deepEqual(
    text.unread.map((u) => u.path),
    ["a", "b", "c"],
  );
  // Read twice, recorded once: a repeated read must not inflate what the caller reports.
  text.read("a");
  assert.equal(text.unread.length, 3);
});

test("the cap hits are separable, because they are the only ones this module chose", () => {
  const root = repo({ "big.js": "x".repeat(64) });
  const text = repoText(root, { cap: 32 });
  text.read("big.js");
  text.read("absent.js");
  assert.deepEqual(text.unread.map((u) => u.reason).sort(), ["missing", "too-large"]);
  assert.deepEqual(
    text.oversized.map((u) => u.path),
    ["big.js"],
    "a stale index entry is lib/open.mjs's freshness question; a cap hit is this module's own",
  );
});

test("the Index's byte count is used when it has one, so nothing is stat'ed twice", () => {
  // The file on disk is small; the Index claims it is huge. The Index wins, because it is what
  // every other consumer ranked and costed by — a reader disagreeing with it silently is the
  // split-brain this module exists to close.
  const root = repo({ "a.js": "tiny" });
  const text = repoText(root, { index: { files: [{ path: "a.js", bytes: 9_000_000 }] } });
  assert.equal(text.read("a.js"), null);
  assert.equal(text.reasonFor("a.js"), "too-large");
});

test("a path the Index does not know is measured instead of assumed", () => {
  // An AGENTS.md the user has just written is not tracked and not indexed, and `analyse` still
  // has to read it to say how long it is.
  const root = repo({ "AGENTS.md": "# brief\n" });
  const text = repoText(root, { index: { files: [] } });
  assert.equal(text.read("AGENTS.md"), "# brief\n");
});

test("a literal source is complete by construction: an absent path is empty, not a failure", () => {
  // This is what lets a test about the Index stop building a temp tree. An index naming forty
  // files and a literal source naming one means the other thirty-nine are empty — the author
  // said so — rather than thirty-nine failed reads the caller then has to report.
  const text = textFrom({ "a.js": "hello" });
  assert.equal(text.read("b.js"), "");
  assert.deepEqual(text.unread, []);
});

test("no source at all is a different fact from a source that found nothing", () => {
  assert.equal(NO_TEXT.available, false);
  assert.equal(NO_TEXT.read("anything"), null);
  assert.deepEqual(NO_TEXT.unread, [], "a caller with no root is not a caller with unread files");
  assert.equal(textFrom({}).available, true);
});

test("textSource coerces a root, passes a source through, and refuses nothing else silently", () => {
  const root = repo({ "a.js": "x" });
  assert.equal(textSource(root).read("a.js"), "x");
  const given = textFrom({ "a.js": "y" });
  assert.equal(textSource(given), given, "a source is returned as itself, not wrapped twice");
  assert.equal(textSource(null), NO_TEXT);
  assert.equal(textSource(undefined), NO_TEXT);
});

test("docs are readable; the secret scan skipping them is a relevance rule with a name", () => {
  // The two scanners disagreed and only one of them was talking about readability. Reading prose
  // is how a README or an ADR naming a script settles an orphan question. NOT scanning it for
  // credentials is a separate decision, measured: across five real repos every hit in `docs` was
  // an example key inside a plan document, and severity is control flow (ADR 0006).
  const text = textFrom({ "README.md": "see tools/release.sh" });
  assert.equal(text.read("README.md"), "see tools/release.sh", "docs are text like anything else");

  assert.equal(scannedForSecrets({ category: "docs" }), false);
  for (const category of ["code", "script", "config", "infra", "schema", "markup", "other"]) {
    assert.equal(scannedForSecrets({ category }), true, `${category} may hold a credential`);
  }
});
