import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  STAMPS_REL, STAMPS_FORMAT, hashText, readStamps, recordStamp, stampStatus, writeStamps,
} from "../lib/stamps.mjs";
import { tempDir } from "./tmp.mjs";

// A target repo and a templates directory, both on disk, each file stated by the test. Every state
// below is reached by editing one side after a record was taken, which is how it happens for real:
// /cortex writes and records, then the team edits the file or a release edits the template.
function world({ files = {}, templates = {} } = {}) {
  const repoRoot = tempDir("cortex-stamps-repo-");
  const templatesDir = tempDir("cortex-stamps-tpl-");
  const put = (root, rel, body) => {
    const abs = join(root, ...rel.split("/"));
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  };
  for (const [rel, body] of Object.entries(files)) put(repoRoot, rel, body);
  for (const [rel, body] of Object.entries(templates)) put(templatesDir, rel, body);
  return { repoRoot, templatesDir, put: (rel, body) => put(repoRoot, rel, body), putTemplate: (rel, body) => put(templatesDir, rel, body) };
}

const TPL = "# Review\n\nAt most {{NIT_CAP}} suggestions.\n";
const OUT = "# Review\n\nAt most 3 suggestions.\n";

// One stamped file, recorded from what is on disk, as the CLI in step 2 will do.
function stamped(extra = {}) {
  const w = world({ files: { "REVIEW.md": OUT }, templates: { "loop/REVIEW.md": TPL }, ...extra });
  const record = recordStamp(null, {
    path: "REVIEW.md", template: "loop/REVIEW.md", version: "2.40.0",
    templateText: TPL, fileText: OUT, values: { NIT_CAP: "3" },
  });
  return { ...w, record };
}

const stateOf = (w, record = w.record) => stampStatus({ repoRoot: w.repoRoot, record, templatesDir: w.templatesDir });

// --- the five states, and the sixth -------------------------------------------------------------

test("a file nobody touched, from a template nobody changed, is current", () => {
  const w = stamped();
  assert.deepEqual(stateOf(w), [{ path: "REVIEW.md", template: "loop/REVIEW.md", version: "2.40.0", state: "current" }]);
});

test("a template that changed under an untouched file is an update", () => {
  const w = stamped();
  w.putTemplate("loop/REVIEW.md", TPL + "\nNew rule.\n");
  assert.equal(stateOf(w)[0].state, "update");
});

test("a file the team edited, from an unchanged template, is edited", () => {
  const w = stamped();
  w.put("REVIEW.md", OUT + "\nOur own rule.\n");
  assert.equal(stateOf(w)[0].state, "edited");
});

test("both sides changed is a conflict", () => {
  const w = stamped();
  w.put("REVIEW.md", OUT + "\nOur own rule.\n");
  w.putTemplate("loop/REVIEW.md", TPL + "\nNew rule.\n");
  assert.equal(stateOf(w)[0].state, "conflict");
});

test("a recorded file that is gone is missing, whatever the template did", () => {
  const w = world({ templates: { "loop/REVIEW.md": TPL + "changed\n" } });
  const record = recordStamp(null, {
    path: "REVIEW.md", template: "loop/REVIEW.md", version: "2.40.0", templateText: TPL, fileText: OUT,
  });
  assert.equal(stateOf(w, record)[0].state, "missing");
});

test("a directory where the file was is missing, not read", () => {
  const w = stamped();
  const w2 = world({ files: { "REVIEW.md/inner.txt": "x" }, templates: { "loop/REVIEW.md": TPL } });
  assert.equal(stateOf(w2, w.record)[0].state, "missing");
});

test("a template this Cortex no longer ships is retired, never an update", () => {
  const w = world({ files: { "REVIEW.md": OUT }, templates: { "loop/other.md": "x" } });
  const record = recordStamp(null, {
    path: "REVIEW.md", template: "loop/REVIEW.md", version: "2.40.0", templateText: TPL, fileText: OUT,
  });
  assert.equal(stateOf(w, record)[0].state, "retired");
  // Edited or not, there is nothing to render — the state does not depend on the file.
  w.put("REVIEW.md", "ours\n");
  assert.equal(stateOf(w, record)[0].state, "retired");
});

test("a missing file whose template is also gone is missing — the file fact comes first", () => {
  const w = world({ templates: {} });
  const record = recordStamp(null, {
    path: "REVIEW.md", template: "loop/REVIEW.md", version: "2.40.0", templateText: TPL, fileText: OUT,
  });
  assert.equal(stateOf(w, record)[0].state, "missing");
});

test("a templates directory that is not there is an error naming it, not every file retired", () => {
  const w = stamped();
  assert.throws(
    () => stampStatus({ repoRoot: w.repoRoot, record: w.record, templatesDir: join(w.templatesDir, "nope") }),
    (e) => e.message.includes(join(w.templatesDir, "nope")),
  );
});

test("an unknown recorded hash never reads as unchanged", () => {
  const w = stamped();
  const record = structuredClone(w.record);
  record.files["REVIEW.md"].fileSha256 = null;
  record.files["REVIEW.md"].templateSha256 = null;
  assert.equal(stateOf(w, record)[0].state, "conflict");
});

// --- line endings -------------------------------------------------------------------------------

test("a CRLF checkout of the file reads as untouched", () => {
  const w = stamped();
  w.put("REVIEW.md", OUT.replace(/\n/g, "\r\n"));
  assert.equal(stateOf(w)[0].state, "current");
});

test("a CRLF copy of the template reads as unchanged", () => {
  const w = stamped();
  w.putTemplate("loop/REVIEW.md", TPL.replace(/\n/g, "\r\n"));
  assert.equal(stateOf(w)[0].state, "current");
});

test("a trailing newline added or dropped is not an edit", () => {
  const w = stamped();
  w.put("REVIEW.md", OUT + "\n\n");
  assert.equal(stateOf(w)[0].state, "current");
  w.put("REVIEW.md", OUT.replace(/\n$/, ""));
  assert.equal(stateOf(w)[0].state, "current");
});

test("normalising endings does not hide a real edit", () => {
  const w = stamped();
  w.put("REVIEW.md", OUT.replace("3", "5").replace(/\n/g, "\r\n"));
  assert.equal(stateOf(w)[0].state, "edited");
  // A blank line added in the middle is content, not an ending.
  w.put("REVIEW.md", OUT.replace("# Review\n", "# Review\n\n"));
  assert.equal(stateOf(w)[0].state, "edited");
  // Trailing spaces are not normalised either.
  w.put("REVIEW.md", OUT.replace("# Review", "# Review  "));
  assert.equal(stateOf(w)[0].state, "edited");
});

test("hashText is sha256 of the LF text with trailing newlines removed", () => {
  const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
  assert.equal(hashText("a\r\nb\r\n"), sha("a\nb"));
  assert.equal(hashText("a\nb\n\n"), sha("a\nb"));
  assert.equal(hashText("héllo"), sha("héllo"));
  assert.notEqual(hashText("a\nb"), hashText("a\rb"));
});

test("status is sorted by path and the same on every run", () => {
  const w = world({
    files: { "b.md": "b\n", "a.md": "a\n", ".claude/agents/verifier.md": "v\n" },
    templates: { "t.md": "t\n" },
  });
  let record = null;
  for (const p of ["b.md", "a.md", ".claude/agents/verifier.md"]) {
    const text = readFileSync(join(w.repoRoot, ...p.split("/")), "utf8");
    record = recordStamp(record, { path: p, template: "t.md", version: "2.40.0", templateText: "t\n", fileText: text });
  }
  const first = stateOf(w, record);
  assert.deepEqual(first.map((e) => e.path), [".claude/agents/verifier.md", "a.md", "b.md"]);
  assert.deepEqual(stateOf(w, record), first);
});

test("status refuses a hand-built record naming a path outside the repo", () => {
  const w = stamped();
  const record = structuredClone(w.record);
  record.files["../../etc/passwd"] = record.files["REVIEW.md"];
  assert.throws(() => stateOf(w, record), /\.\.\/\.\.\/etc\/passwd/);
});

test("no record means no answer, not a clean one", () => {
  const w = world();
  assert.equal(stampStatus({ repoRoot: w.repoRoot, record: null, templatesDir: w.templatesDir }), null);
});

// --- reading ------------------------------------------------------------------------------------

test("an absent record reads as null", () => {
  const w = world();
  assert.equal(readStamps(w.repoRoot), null);
});

test("malformed JSON is an error that names the file", () => {
  const w = world({ files: { [STAMPS_REL]: "{ not json" } });
  assert.throws(() => readStamps(w.repoRoot), (e) => e.message.includes(join(w.repoRoot, ".cortex", "stamps.json")));
});

test("a record of the wrong shape is an error that names the file and the problem", () => {
  const good = recordStamp(null, { path: "a.md", template: "t.md", version: "2.40.0", templateText: "t", fileText: "a" });
  const cases = [
    [[], "not an object"],
    [{ ...good, format: 2 }, "format"],
    [{ ...good, files: [] }, "files"],
    [{ ...good, cortex: "latest" }, "cortex"],
    [{ ...good, files: { "../outside.md": good.files["a.md"] } }, "../outside.md"],
    [{ ...good, files: { "/abs.md": good.files["a.md"] } }, "/abs.md"],
    [{ ...good, files: { "a\\b.md": good.files["a.md"] } }, "a\\b.md"],
    [{ ...good, files: { "a.md": { ...good.files["a.md"], template: "../x" } } }, "template"],
    [{ ...good, files: { "a.md": { ...good.files["a.md"], fileSha256: "abc" } } }, "fileSha256"],
    [{ ...good, files: { "a.md": { ...good.files["a.md"], values: { K: 3 } } } }, "values"],
    [{ ...good, files: { "a.md": { ...good.files["a.md"], extra: 1 } } }, "extra"],
    [{ ...good, extra: 1 }, "extra"],
  ];
  for (const [doc, needle] of cases) {
    const w = world({ files: { [STAMPS_REL]: JSON.stringify(doc) } });
    assert.throws(() => readStamps(w.repoRoot), (e) => {
      assert.ok(e.message.includes(join(w.repoRoot, ".cortex", "stamps.json")), e.message);
      assert.ok(e.message.includes(needle), `expected "${needle}" in: ${e.message}`);
      return true;
    });
  }
});

test("a newer format says so, rather than being misread", () => {
  const w = world({ files: { [STAMPS_REL]: JSON.stringify({ format: STAMPS_FORMAT + 1, cortex: "9.0.0", files: {} }) } });
  assert.throws(() => readStamps(w.repoRoot), /newer Cortex/);
});

test("what writeStamps writes, readStamps reads back unchanged", () => {
  const w = stamped();
  writeStamps(w.repoRoot, w.record);
  assert.deepEqual(readStamps(w.repoRoot), w.record);
});

// --- recording ----------------------------------------------------------------------------------

test("recordStamp is pure: the record it was given is untouched", () => {
  const { record } = stamped();
  const before = JSON.stringify(record);
  const next = recordStamp(record, { path: "b.md", template: "t.md", version: "2.41.0", templateText: "t", fileText: "b" });
  assert.equal(JSON.stringify(record), before);
  assert.notEqual(next, record);
  assert.notEqual(next.files, record.files);
  assert.deepEqual(Object.keys(next.files), ["REVIEW.md", "b.md"]);
});

test("recording the same path again replaces its entry", () => {
  const { record } = stamped();
  const next = recordStamp(record, {
    path: "REVIEW.md", template: "loop/REVIEW.md", version: "2.41.0",
    templateText: TPL + "x\n", fileText: OUT + "x\n", values: { NIT_CAP: "5" },
  });
  assert.deepEqual(Object.keys(next.files), ["REVIEW.md"]);
  assert.deepEqual(next.files["REVIEW.md"], {
    template: "loop/REVIEW.md", version: "2.41.0",
    templateSha256: hashText(TPL + "x\n"), fileSha256: hashText(OUT + "x\n"), values: { NIT_CAP: "5" },
  });
  assert.equal(next.cortex, "2.41.0");
});

test("the record's cortex version is never lowered", () => {
  const { record } = stamped(); // 2.40.0
  const older = recordStamp(record, { path: "b.md", template: "t.md", version: "2.39.1", templateText: "t", fileText: "b" });
  assert.equal(older.cortex, "2.40.0");
  assert.equal(older.files["b.md"].version, "2.39.1");
  // Numeric, not lexical: 2.10.0 is newer than 2.9.0.
  const a = recordStamp(null, { path: "a.md", template: "t.md", version: "2.10.0", templateText: "t", fileText: "a" });
  const b = recordStamp(a, { path: "b.md", template: "t.md", version: "2.9.0", templateText: "t", fileText: "b" });
  assert.equal(b.cortex, "2.10.0");
  const c = recordStamp(b, { path: "c.md", template: "t.md", version: "10.0.0", templateText: "t", fileText: "c" });
  assert.equal(c.cortex, "10.0.0");
});

test("recordStamp refuses what the record could not hold", () => {
  const ok = { path: "a.md", template: "t.md", version: "2.40.0", templateText: "t", fileText: "a" };
  for (const bad of [
    { path: "/abs.md" }, { path: "C:/x.md" }, { path: "a\\b.md" }, { path: "../a.md" }, { path: "a/./b.md" }, { path: "" },
    { template: "../t.md" }, { template: "" },
    { version: "2.40" }, { version: "v2.40.0" }, { version: "latest" },
    { templateText: undefined }, { fileText: 3 },
    { values: { K: 3 } }, { values: { K: null } }, { values: [] },
  ]) {
    // The refusal names the field — a crash further in would also throw, and say nothing useful.
    const field = Object.keys(bad)[0];
    assert.throws(() => recordStamp(null, { ...ok, ...bad }), (e) => e instanceof TypeError && e.message.includes(field), JSON.stringify(bad));
  }
});

test("a first record carries the format and the version that wrote it", () => {
  const r = recordStamp(null, { path: "a.md", template: "t.md", version: "2.40.0", templateText: "t", fileText: "a" });
  assert.equal(r.format, STAMPS_FORMAT);
  assert.equal(r.cortex, "2.40.0");
  assert.deepEqual(r.files["a.md"].values, {});
});

// --- writing ------------------------------------------------------------------------------------

test("writeStamps is byte-stable, sorted and LF whatever order the record was built in", () => {
  const entries = [
    { path: "z.md", template: "t.md", version: "2.40.0", templateText: "t", fileText: "z", values: { B: "2", A: "1" } },
    { path: ".claude/hooks/p.sh", template: "loop/p.sh", version: "2.40.0", templateText: "p", fileText: "p" },
    { path: "a.md", template: "t.md", version: "2.40.0", templateText: "t", fileText: "a", values: { Z: "multi\nline" } },
  ];
  const one = world();
  const two = world();
  writeStamps(one.repoRoot, entries.reduce((r, e) => recordStamp(r, e), null));
  writeStamps(two.repoRoot, [...entries].reverse().reduce((r, e) => recordStamp(r, e), null));
  const file = (w) => readFileSync(join(w.repoRoot, ".cortex", "stamps.json"), "utf8");
  const text = file(one);
  assert.equal(text, file(two));
  assert.ok(!text.includes("\r"), "LF only");
  assert.ok(text.endsWith("}\n"), "one trailing newline");

  const doc = JSON.parse(text);
  assert.deepEqual(Object.keys(doc), ["format", "cortex", "files"]);
  assert.deepEqual(Object.keys(doc.files), [".claude/hooks/p.sh", "a.md", "z.md"]);
  assert.deepEqual(Object.keys(doc.files["z.md"]), ["template", "version", "templateSha256", "fileSha256", "values"]);
  assert.deepEqual(Object.keys(doc.files["z.md"].values), ["A", "B"]);

  // Writing the same record again changes nothing.
  writeStamps(one.repoRoot, readStamps(one.repoRoot));
  assert.equal(file(one), text);
});

test("writeStamps refuses a record readStamps would refuse", () => {
  const w = world();
  const good = recordStamp(null, { path: "a.md", template: "t.md", version: "2.40.0", templateText: "t", fileText: "a" });
  const bad = { ...good, files: { "../x.md": good.files["a.md"] } };
  assert.throws(() => writeStamps(w.repoRoot, bad), /refusing.*\.\.\/x\.md/);
  assert.ok(!existsSync(join(w.repoRoot, ".cortex", "stamps.json")), "nothing was written");
});
