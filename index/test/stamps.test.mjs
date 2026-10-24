import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PLUGIN_UPDATE_COMMANDS, STAMPS_REL, STAMPS_FORMAT, adoptStamp, adoptionCandidates, forgetStamp, hashText, ignoreAdvice, olderPlugin, planUpdates, readStamps, recordStamp, runningCortex, stampDiff, stampStatus, stampsIgnoreRule, writeStamps, VALUE_DEFAULTS, StampRefused, applyUpdates, stampFile, stampReport, STATES, TEMPLATES_DIR,
} from "../lib/stamps.mjs";
import { LOOP_STAMPS } from "../lib/loop.mjs";
import { lineDiff } from "../lib/linediff.mjs";
import { PLUGIN_ROOT, cortexDigest } from "../lib/cortex-digest.mjs";
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

// The Cortex running an update — the release `stamped()` records with, so no test below is an older plugin by accident.
const RUNNING = "2.40.0";
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
  assert.deepEqual(stateOf(w), [{ path: "REVIEW.md", template: "loop/REVIEW.md", version: "2.40.0", renderable: true, state: "current" }]);
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
    [{ ...good, files: { "a.md": { ...good.files["a.md"], renderable: "yes" } } }, "renderable"],
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
    templateSha256: hashText(TPL + "x\n"), fileSha256: hashText(OUT + "x\n"), renderable: false, values: { NIT_CAP: "5" },
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
  assert.deepEqual(Object.keys(doc.files["z.md"]), ["template", "version", "templateSha256", "fileSha256", "renderable", "values"]);
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

// --- is the record hidden from git? --------------------------------------------------------------

// A git stand-in: `check-ignore -v <path>` answers from `rule`, `check-ignore -q .cortex` from `dir`.
function fakeGit({ rule = null, dir = false, status = null } = {}) {
  return (args) => {
    if (status !== null) return { status, stdout: "" };
    if (args.includes("-v")) return rule ? { status: 0, stdout: `${rule}\t.cortex/stamps.json\n` } : { status: 1, stdout: "" };
    return { status: dir ? 0 : 1, stdout: "" };
  };
}

test("a record no rule ignores is not reported", () => {
  assert.equal(stampsIgnoreRule("/r", { git: fakeGit() }), null);
});

test("outside git, or when git fails, nothing is claimed", () => {
  assert.equal(stampsIgnoreRule("/r", { git: fakeGit({ status: 128 }) }), null);
});

test("a negation that re-includes the record is not an ignore", () => {
  // `check-ignore -v` exits 0 and prints the `!` pattern for a negated match — the state a user is
  // in right after taking the advice. Reading exit 0 as "ignored" would warn about the fix itself.
  assert.equal(stampsIgnoreRule("/r", { git: fakeGit({ rule: ".gitignore:2:!.cortex/stamps.json" }) }), null);
});

test("the rule that hides the record is named with its source and line", () => {
  const r = stampsIgnoreRule("/r", { git: fakeGit({ rule: ".gitignore:7:.cortex/", dir: true }) });
  assert.deepEqual(r, { source: ".gitignore", line: 7, pattern: ".cortex/", dirIgnored: true });
  // A global excludes file on Windows carries a drive colon in its path.
  const g = stampsIgnoreRule("/r", { git: fakeGit({ rule: "C:/Users/x/.gitignore_global:3:*.json" }) });
  assert.deepEqual(g, { source: "C:/Users/x/.gitignore_global", line: 3, pattern: "*.json", dirIgnored: false });
});

test("before .cortex exists, a directory-only rule is still read as excluding it", () => {
  // Real git, asked about a .cortex that is not there yet, says a `.cortex/` rule does not match it —
  // it cannot know the path is a directory. The first install asks exactly then.
  const root = tempDir("cortex-stamps-noexist-");
  const r = stampsIgnoreRule(root, { git: fakeGit({ rule: ".gitignore:1:.cortex/", dir: false }) });
  assert.equal(r.dirIgnored, true);
  for (const p of ["/.cortex/", "**/.cortex/", ".c*/"]) {
    assert.equal(stampsIgnoreRule(root, { git: fakeGit({ rule: `.gitignore:1:${p}`, dir: false }) }).dirIgnored, true, p);
  }
  for (const p of [".cortex/*", "*.json", "build/", "src/.cortex/"]) {
    assert.equal(stampsIgnoreRule(root, { git: fakeGit({ rule: `.gitignore:1:${p}`, dir: false }) }).dirIgnored, false, p);
  }
});

test("a directory rule is told to become .cortex/* — a negation under it cannot work", () => {
  const text = ignoreAdvice({ source: ".gitignore", line: 7, pattern: ".cortex/", dirIgnored: true });
  assert.match(text, /\.gitignore:7/);
  assert.match(text, /will not be committed/);
  assert.match(text, /`\.cortex\/\*`/);
  assert.match(text, /`!\.cortex\/stamps\.json`/);
});

test("a file rule is told to add the negation, and nothing else", () => {
  const text = ignoreAdvice({ source: ".gitignore", line: 2, pattern: "*.json", dirIgnored: false });
  assert.match(text, /`!\.cortex\/stamps\.json`/);
  assert.doesNotMatch(text, /\.cortex\/\*/);
});

test("a rule in a nested .gitignore gets a negation relative to that file", () => {
  const text = ignoreAdvice({ source: ".cortex/.gitignore", line: 1, pattern: "*", dirIgnored: false });
  assert.match(text, /`!stamps\.json`/);
  assert.doesNotMatch(text, /!\.cortex\/stamps\.json/);
});

// --- can the file be re-rendered from what was recorded? ------------------------------------------

test("a file its template and values reproduce is recorded as renderable", () => {
  const { record } = stamped();
  assert.equal(record.files["REVIEW.md"].renderable, true);
  // The same LF and trailing-newline rule as the hash: a CRLF file with no final newline still is.
  const r = recordStamp(null, {
    path: "a.md", template: "t.md", version: "2.40.0", templateText: TPL, fileText: OUT.replace(/\n/g, "\r\n").trimEnd(), values: { NIT_CAP: "3" },
  });
  assert.equal(r.files["a.md"].renderable, true);
});

test("a file the values do not reproduce is recorded, and marked not renderable", () => {
  // The model filled NIT_CAP with 3 and said 5; or wrote a line no placeholder accounts for.
  for (const [fileText, values] of [[OUT, { NIT_CAP: "5" }], [OUT, {}], [OUT + "An extra line.\n", { NIT_CAP: "3" }]]) {
    const r = recordStamp(null, { path: "a.md", template: "t.md", version: "2.40.0", templateText: TPL, fileText, values });
    assert.equal(r.files["a.md"].renderable, false, JSON.stringify(values));
    assert.equal(r.files["a.md"].fileSha256, hashText(fileText), "its edits are still tracked");
  }
});

test("a template change under an untouched file it cannot re-render is review, never update", () => {
  const w = world({ files: { "a.md": OUT + "Model prose.\n" }, templates: { "t.md": TPL } });
  const record = recordStamp(null, {
    path: "a.md", template: "t.md", version: "2.40.0", templateText: TPL, fileText: OUT + "Model prose.\n", values: { NIT_CAP: "3" },
  });
  assert.equal(stateOf(w, record)[0].state, "current", "unchanged on both sides is still current");
  w.putTemplate("t.md", TPL + "New rule.\n");
  assert.equal(stateOf(w, record)[0].state, "review");
  w.put("a.md", "ours\n");
  assert.equal(stateOf(w, record)[0].state, "conflict", "an edit on top is still a conflict");
});

// --- the update plan ----------------------------------------------------------------------------

test("an update re-renders the new template with the recorded values", () => {
  const w = stamped();
  w.putTemplate("loop/REVIEW.md", TPL + "\nNew rule, cap {{NIT_CAP}}.\n");
  const plan = planUpdates({ running: RUNNING, repoRoot: w.repoRoot, record: w.record, templatesDir: w.templatesDir });
  assert.deepEqual(plan.refused, []);
  assert.deepEqual(plan.updates.map((u) => u.path), ["REVIEW.md"]);
  assert.equal(plan.updates[0].text, OUT + "\nNew rule, cap 3.\n");
  assert.equal(plan.updates[0].templateText, TPL + "\nNew rule, cap {{NIT_CAP}}.\n");
});

test("an update plans nothing for a file in any other state", () => {
  const w = world({
    files: { "cur.md": OUT, "ed.md": OUT + "ours\n", "con.md": OUT + "ours\n", "rev.md": OUT + "prose\n", "ret.md": OUT },
    templates: { "cur.md": TPL, "ed.md": TPL, "con.md": TPL, "rev.md": TPL, "ret.md": TPL },
  });
  let record = null;
  for (const p of ["cur.md", "ed.md", "con.md", "rev.md", "ret.md", "mis.md"]) {
    const fileText = p === "rev.md" ? OUT + "prose\n" : OUT;
    record = recordStamp(record, { path: p, template: p === "mis.md" ? "cur.md" : p, version: "2.40.0", templateText: TPL, fileText, values: { NIT_CAP: "3" } });
  }
  w.putTemplate("con.md", TPL + "x\n");
  w.putTemplate("rev.md", TPL + "x\n");
  record.files["ret.md"].template = "gone.md"; // a template this Cortex does not ship
  const states = Object.fromEntries(stateOf(w, record).map((e) => [e.path, e.state]));
  assert.deepEqual(states, { "cur.md": "current", "ed.md": "edited", "con.md": "conflict", "rev.md": "review", "ret.md": "retired", "mis.md": "missing" });
  const plan = planUpdates({ running: RUNNING, repoRoot: w.repoRoot, record, templatesDir: w.templatesDir });
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.refused, [], "states that are not update are not refusals either — they are simply not planned");
});

test("a new template placeholder with no recorded value is refused, not left in the file", () => {
  const w = stamped();
  w.putTemplate("loop/REVIEW.md", TPL + "Owner: {{OWNER}}\n");
  const plan = planUpdates({ running: RUNNING, repoRoot: w.repoRoot, record: w.record, templatesDir: w.templatesDir });
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.refused.length, 1);
  assert.match(plan.refused[0].why, /\{\{OWNER\}\}/);
});

test("a placeholder the file kept on purpose is kept through an update", () => {
  const tpl = "# {{TITLE}}\n\nRaised by: {{AUTHOR}}\n";
  const w = world({ files: { "intent/TEMPLATE.md": tpl }, templates: { "loop/intent.md": tpl } });
  const record = recordStamp(null, { path: "intent/TEMPLATE.md", template: "loop/intent.md", version: "2.40.0", templateText: tpl, fileText: tpl });
  w.putTemplate("loop/intent.md", tpl + "Status: draft\n");
  const plan = planUpdates({ running: RUNNING, repoRoot: w.repoRoot, record, templatesDir: w.templatesDir });
  assert.deepEqual(plan.refused, []);
  assert.equal(plan.updates[0].text, tpl + "Status: draft\n");
});

test("an update limited to named paths plans only those", () => {
  const w = world({ files: { "a.md": OUT, "b.md": OUT }, templates: { "t.md": TPL } });
  let record = recordStamp(null, { path: "a.md", template: "t.md", version: "2.40.0", templateText: TPL, fileText: OUT, values: { NIT_CAP: "3" } });
  record = recordStamp(record, { path: "b.md", template: "t.md", version: "2.40.0", templateText: TPL, fileText: OUT, values: { NIT_CAP: "3" } });
  w.putTemplate("t.md", TPL + "x\n");
  const plan = planUpdates({ running: RUNNING, repoRoot: w.repoRoot, record, templatesDir: w.templatesDir, paths: ["b.md"] });
  assert.deepEqual(plan.updates.map((u) => u.path), ["b.md"]);
  // A path named on purpose that is not safe to update is a refusal the caller must hear.
  w.put("a.md", OUT + "ours\n");
  const named = planUpdates({ running: RUNNING, repoRoot: w.repoRoot, record, templatesDir: w.templatesDir, paths: ["a.md", "zzz.md"] });
  assert.deepEqual(named.updates, []);
  assert.deepEqual(named.refused.map((r) => r.path), ["a.md", "zzz.md"]);
  assert.match(named.refused[0].why, /conflict/);
  assert.match(named.refused[1].why, /not in the record/);
});

// --- an older plugin (spec S5) --------------------------------------------------------------------

const UPDATE_STEPS = /`claude plugin marketplace update cortex`, then `claude plugin update cortex@cortex`, then `\/reload-plugins` or a new session/;

test("a record a newer Cortex wrote names the older plugin and the two commands that update it", () => {
  const w = stamped(); // written by 2.40.0
  const o = olderPlugin(w.record, "2.39.1");
  assert.deepEqual(o.commands, ["claude plugin marketplace update cortex", "claude plugin update cortex@cortex"]);
  assert.deepEqual(PLUGIN_UPDATE_COMMANDS, o.commands);
  assert.equal(o.stamped, "2.40.0");
  assert.equal(o.running, "2.39.1");
  assert.match(o.advice, /stamped by Cortex 2\.40\.0/);
  assert.match(o.advice, /this is Cortex 2\.39\.1/);
  assert.match(o.advice, UPDATE_STEPS);
});

test("versions compare as numbers in every place, never as text", () => {
  const rec = (cortex) => ({ ...stamped().record, cortex });
  assert.ok(olderPlugin(rec("2.10.0"), "2.9.9"), "minor 10 is newer than 9");
  assert.ok(olderPlugin(rec("3.0.0"), "2.99.99"), "major first");
  assert.ok(olderPlugin(rec("2.40.10"), "2.40.9"), "patch 10 is newer than 9");
  assert.equal(olderPlugin(rec("2.9.9"), "2.10.0"), null, "text order would call 2.9.9 newer");
  assert.equal(olderPlugin(rec("2.40.0"), "2.41.0"), null, "a newer plugin is not older");
});

test("equal versions, an adopted record's unknown version, no record, and an unknown running version never warn", () => {
  const w = stamped();
  assert.equal(olderPlugin(w.record, "2.40.0"), null);
  assert.equal(olderPlugin(adoptStamp(null, { path: "REVIEW.md", template: "loop/REVIEW.md" }), "0.0.1"), null);
  assert.equal(olderPlugin(null, "2.40.0"), null);
  assert.equal(olderPlugin(w.record, null), null, "nothing is claimed about a version this Cortex could not read");
});

test("an older plugin plans no update at all, even of a file that would be safe, and says why once", () => {
  const w = world({ files: { "a.md": OUT, "b.md": OUT }, templates: { "t.md": TPL } });
  let record = recordStamp(null, { path: "a.md", template: "t.md", version: "2.40.0", templateText: TPL, fileText: OUT, values: { NIT_CAP: "3" } });
  record = recordStamp(record, { path: "b.md", template: "t.md", version: "2.40.0", templateText: TPL, fileText: OUT, values: { NIT_CAP: "3" } });
  // What an older release looks like from here: its templates differ from the ones recorded, so every
  // untouched file reads as `update` — and applying it would put the older template back.
  w.putTemplate("t.md", "# Review\n");
  assert.deepEqual(stateOf(w, record).map((e) => e.state), ["update", "update"]);
  for (const paths of [null, ["a.md"]]) {
    const plan = planUpdates({ running: "2.39.1", repoRoot: w.repoRoot, record, templatesDir: w.templatesDir, paths });
    assert.deepEqual(plan.updates, [], "all-or-nothing: nothing is planned");
    assert.deepEqual(plan.refused, [{ path: STAMPS_REL, why: olderPlugin(record, "2.39.1").advice }]);
  }
  // The same repo, the same release: the plan is back.
  const same = planUpdates({ running: "2.40.0", repoRoot: w.repoRoot, record, templatesDir: w.templatesDir });
  assert.deepEqual(same.updates.map((u) => u.path), ["a.md", "b.md"]);
});

test("the running Cortex is the release in the VERSION file this code ships beside", () => {
  const v = readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();
  assert.match(v, /^\d+\.\d+\.\d+$/);
  assert.equal(runningCortex(), v);
});

test("planUpdates will not run without knowing which Cortex is asking", () => {
  const w = stamped();
  for (const running of [undefined, null, "2.40", "v2.40.0"]) {
    assert.throws(
      () => planUpdates({ running, repoRoot: w.repoRoot, record: w.record, templatesDir: w.templatesDir }),
      /running must be an x\.y\.z version/,
      String(running),
    );
  }
});

// --- the diff a per-file question shows ---------------------------------------------------------

test("stampDiff shows the file now against the new template rendered with the recorded values", () => {
  const w = stamped();
  w.put("REVIEW.md", OUT + "Our own rule.\n");
  w.putTemplate("loop/REVIEW.md", TPL + "New rule.\n");
  const d = stampDiff({ repoRoot: w.repoRoot, record: w.record, templatesDir: w.templatesDir, path: "REVIEW.md" });
  assert.equal(d.state, "conflict");
  assert.match(d.diff, /^-Our own rule\.$/m);
  assert.match(d.diff, /^\+New rule\.$/m);
  assert.equal(stampDiff({ repoRoot: w.repoRoot, record: w.record, templatesDir: w.templatesDir, path: "nope.md" }), null);
});

test("lineDiff is empty for equal text and marks each changed line with context", () => {
  assert.equal(lineDiff("a\nb\n", "a\r\nb"), "");
  const d = lineDiff("1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n", "1\n2\nTWO-AND-HALF\n3\n4\n5\n6\n7\n8\n9\nTEN\n");
  assert.match(d, /^\+TWO-AND-HALF$/m);
  assert.match(d, /^-10$/m);
  assert.match(d, /^\+TEN$/m);
  assert.match(d, /^ 2$/m, "context around a change");
  assert.equal((d.match(/^@@/gm) ?? []).length, 2, "two changes far apart are two hunks");
});

// --- adoption: a repo stamped before the record existed ---------------------------------------------

const REAL_TEMPLATES = fileURLToPath(new URL("../../templates/", import.meta.url));

test("loop files at /cortex's locations with no record are adoption candidates", () => {
  const w = world({ files: { "REVIEW.md": "# ours\n", ".claude/hooks/protected-paths.sh": "x\n", "src/app.ts": "x\n" } });
  assert.deepEqual(adoptionCandidates(w.repoRoot, null, LOOP_STAMPS), [
    { path: ".claude/hooks/protected-paths.sh", template: "loop/protected-paths.sh" },
    { path: "REVIEW.md", template: "loop/REVIEW.md" },
  ]);
});

test("a repo with a record, or with no loop files, has nothing to adopt", () => {
  const empty = world({ files: { "src/app.ts": "x\n" } });
  assert.deepEqual(adoptionCandidates(empty.repoRoot, null, LOOP_STAMPS), []);
  const w = stamped();
  w.put(".claude/hooks/protected-paths.sh", "x\n");
  // Adoption is the first contact with the record. Once one exists, a file outside it is the team's.
  assert.deepEqual(adoptionCandidates(w.repoRoot, w.record, LOOP_STAMPS), []);
});

test("the agent team's files are never adopted — a hand-written architect.md is the team's", () => {
  // The team shipped after the record, so no Cortex ever stamped one unrecorded. octez-manager, one
  // of the repos the mapper was validated on, commits its own `.claude/agents/architect.md`.
  const w = world({ files: { ".claude/agents/architect.md": "---\nname: architect\n---\n", "REVIEW.md": "# ours\n" } });
  assert.deepEqual(adoptionCandidates(w.repoRoot, null, LOOP_STAMPS).map((c) => c.path), ["REVIEW.md"]);
  assert.ok(LOOP_STAMPS.some((s) => s.path === ".claude/agents/architect.md"), "while the location is still a stamp site");
  assert.throws(() => adoptionCandidates(w.repoRoot, null), /sites must be/, "the list is passed, never assumed");
});

test("every adoption location is a real loop template", () => {
  assert.ok(LOOP_STAMPS.length >= 9, "the nine whole-file loop templates");
  for (const s of LOOP_STAMPS) {
    assert.ok(existsSync(join(REAL_TEMPLATES, ...s.template.split("/"))), `${s.template} exists`);
  }
  assert.equal(new Set(LOOP_STAMPS.map((s) => s.path)).size, LOOP_STAMPS.length, "one template per location");
});

test("an adopted file is recorded with nothing known, and reads as conflict — never update", () => {
  const w = world({ files: { "REVIEW.md": OUT }, templates: { "loop/REVIEW.md": TPL } });
  const record = adoptStamp(null, { path: "REVIEW.md", template: "loop/REVIEW.md" });
  assert.deepEqual(record, {
    format: STAMPS_FORMAT, cortex: null,
    files: { "REVIEW.md": { template: "loop/REVIEW.md", version: null, templateSha256: null, fileSha256: null, renderable: false, values: {} } },
  });
  // Even a file identical to the template: which release wrote it is unknown, so it is asked about.
  assert.equal(stateOf(w, record)[0].state, "conflict");
  assert.deepEqual(planUpdates({ running: RUNNING, repoRoot: w.repoRoot, record, templatesDir: w.templatesDir }).updates, []);
  // It survives the round trip through the committed file.
  writeStamps(w.repoRoot, record);
  assert.deepEqual(readStamps(w.repoRoot), record);
});

test("adopting never overwrites what the record already knows", () => {
  const { record } = stamped();
  assert.throws(() => adoptStamp(record, { path: "REVIEW.md", template: "loop/REVIEW.md" }), /already in the record/);
});

test("recording over an adopted entry fills it in, and sets the record's version", () => {
  const adopted = adoptStamp(null, { path: "REVIEW.md", template: "loop/REVIEW.md" });
  const r = recordStamp(adopted, { path: "REVIEW.md", template: "loop/REVIEW.md", version: "2.40.0", templateText: TPL, fileText: OUT, values: { NIT_CAP: "3" } });
  assert.equal(r.cortex, "2.40.0");
  assert.equal(r.files["REVIEW.md"].renderable, true);
});

test("forgetStamp drops one entry and nothing else, purely", () => {
  let r = recordStamp(null, { path: "a.md", template: "t.md", version: "2.40.0", templateText: "t", fileText: "a" });
  r = recordStamp(r, { path: "b.md", template: "t.md", version: "2.40.0", templateText: "t", fileText: "b" });
  const before = JSON.stringify(r);
  const next = forgetStamp(r, "a.md");
  assert.deepEqual(Object.keys(next.files), ["b.md"]);
  assert.equal(next.cortex, "2.40.0");
  assert.equal(JSON.stringify(r), before);
  assert.throws(() => forgetStamp(r, "zzz.md"), /not in the record/);
});

// --- settings: a placeholder with a default (the debate's round limit) --------------------------------

test("a template that gains a setting updates a file stamped before it, at the default, and records it", () => {
  assert.equal(VALUE_DEFAULTS.DEBATE_ROUNDS, "2");
  const w = stamped();
  w.putTemplate("loop/REVIEW.md", TPL + "Limit: {{DEBATE_ROUNDS}}\n");
  const plan = planUpdates({ running: RUNNING, repoRoot: w.repoRoot, record: w.record, templatesDir: w.templatesDir });
  assert.deepEqual(plan.refused, []);
  assert.equal(plan.updates[0].text, OUT + "Limit: 2\n");
  assert.equal(plan.updates[0].values.DEBATE_ROUNDS, "2", "the value is recorded, so the next update renders the same file");
  assert.equal(plan.updates[0].values.NIT_CAP, "3");
  assert.equal(w.record.files["REVIEW.md"].values.DEBATE_ROUNDS, undefined, "planning changes no record");
  const d = stampDiff({ repoRoot: w.repoRoot, record: w.record, templatesDir: w.templatesDir, path: "REVIEW.md" });
  assert.match(d.diff, /^\+Limit: 2$/m, "the diff shows the file the update would write");

  // A template that does not use the setting records none: the record holds what rendered the file.
  const other = stamped();
  other.putTemplate("loop/REVIEW.md", TPL + "\nNew rule.\n");
  const plain = planUpdates({ running: RUNNING, repoRoot: other.repoRoot, record: other.record, templatesDir: other.templatesDir });
  assert.deepEqual(plain.updates[0].values, { NIT_CAP: "3" });
});

test("a recorded setting outranks its default, and a setting does not excuse another unfilled placeholder", () => {
  const w = stamped();
  const record = recordStamp(w.record, { path: "REVIEW.md", template: "loop/REVIEW.md", version: "2.40.0", templateText: TPL, fileText: OUT, values: { NIT_CAP: "3", DEBATE_ROUNDS: "4" } });
  w.putTemplate("loop/REVIEW.md", TPL + "Limit: {{DEBATE_ROUNDS}}\n");
  const kept = planUpdates({ running: RUNNING, repoRoot: w.repoRoot, record, templatesDir: w.templatesDir });
  assert.equal(kept.updates[0].text, OUT + "Limit: 4\n");

  w.putTemplate("loop/REVIEW.md", TPL + "Limit: {{DEBATE_ROUNDS}}\nOwner: {{OWNER}}\n");
  const plan = planUpdates({ running: RUNNING, repoRoot: w.repoRoot, record: w.record, templatesDir: w.templatesDir });
  assert.deepEqual(plan.updates, []);
  assert.match(plan.refused[0].why, /adds \{\{OWNER\}\}, which/);
  assert.doesNotMatch(plan.refused[0].why, /DEBATE_ROUNDS/);
});

// The template as it shipped before the digest pin (docs/adr/0028): no CORTEX_SHA256 line and no
// verify step. Built from today's template so the test follows it rather than a frozen copy.
function withoutPin(template) {
  const out = template
    .replace('      CORTEX_SHA256: "{{CORTEX_SHA256}}"\n', "")
    .replace(/ {6}# Nothing from the clone runs before this[\s\S]*?' "\$RUNNER_TEMP\/cortex"\n/, "");
  assert.ok(!out.includes("{{CORTEX_SHA256}}") && !out.includes("Verify Cortex"), "the pin was stripped");
  return out;
}
const PINNED_REF = `v${runningCortex()}`;

test("cortex-review.yml stamped before {{CORTEX_REPO}} existed keeps its upstream URL on update, and records it (#622)", () => {
  const UPSTREAM = "https://github.com/marinvch/Cortex.git";
  assert.equal(VALUE_DEFAULTS.CORTEX_REPO, UPSTREAM);
  const now = readFileSync(join(TEMPLATES_DIR, "loop", "cortex-review.yml"), "utf8");
  // The template as it shipped before #622: the URL written in, CORTEX_REF the only placeholder.
  const before = withoutPin(now).replace("{{CORTEX_REPO}}", UPSTREAM);
  assert.notEqual(before, now);
  const file = before.replace("{{CORTEX_REF}}", "v2.44.1");
  const w = world({ files: { ".github/workflows/cortex-review.yml": file }, templates: { "loop/cortex-review.yml": before } });
  const record = recordStamp(null, {
    path: ".github/workflows/cortex-review.yml", template: "loop/cortex-review.yml", version: RUNNING,
    templateText: before, fileText: file, values: { CORTEX_REF: "v2.44.1" },
  });
  // Today's template minus the pin: the #622 property alone, the URL default giving the old bytes.
  w.putTemplate("loop/cortex-review.yml", withoutPin(now));
  const plan = planUpdates({ running: RUNNING, repoRoot: w.repoRoot, record, templatesDir: w.templatesDir });
  assert.deepEqual(plan.refused, []);
  assert.equal(plan.updates[0].text, file, "the old workflow, byte for byte");
  assert.deepEqual(plan.updates[0].values, { CORTEX_REF: "v2.44.1", CORTEX_REPO: UPSTREAM });

  // A fork's URL, given at stamp time, is what the record holds and what an update keeps.
  const fork = world({ templates: { "loop/cortex-review.yml": now } });
  const done = stampFile({
    repoRoot: fork.repoRoot, templatesDir: fork.templatesDir, path: ".github/workflows/cortex-review.yml", template: "loop/cortex-review.yml",
    values: { CORTEX_REF: PINNED_REF, CORTEX_REPO: "https://github.com/acme/cortex.git" }, version: RUNNING,
  });
  assert.deepEqual(done.unfilled, []);
  assert.equal(readStamps(fork.repoRoot).files[".github/workflows/cortex-review.yml"].values.CORTEX_REPO, "https://github.com/acme/cortex.git");
  assert.match(readFileSync(join(fork.repoRoot, ".github", "workflows", "cortex-review.yml"), "utf8"), /CORTEX_REPO: https:\/\/github\.com\/acme\/cortex\.git\n/);
});

// The act fills {{CORTEX_REPO}} from the resolved source, so /cortex never has to (#622).
test("stampFile fills CORTEX_REPO from the connector's source, upstream by default, and refuses a directory", () => {
  const now = readFileSync(join(TEMPLATES_DIR, "loop", "cortex-review.yml"), "utf8");
  const stampReview = (w) => stampFile({
    repoRoot: w.repoRoot, templatesDir: w.templatesDir, path: ".github/workflows/cortex-review.yml",
    template: "loop/cortex-review.yml", values: { CORTEX_REF: PINNED_REF }, version: RUNNING,
  });
  const saved = process.env.CORTEX_SOURCE;
  delete process.env.CORTEX_SOURCE;
  try {
    const plain = world({ templates: { "loop/cortex-review.yml": now } });
    stampReview(plain);
    assert.equal(readStamps(plain.repoRoot).files[".github/workflows/cortex-review.yml"].values.CORTEX_REPO, "https://github.com/marinvch/Cortex.git");

    const fork = world({ files: { ".cortex/connector.json": JSON.stringify({ team: "t", project: "p", source: "acme/cortex" }) }, templates: { "loop/cortex-review.yml": now } });
    stampReview(fork);
    assert.match(readFileSync(join(fork.repoRoot, ".github", "workflows", "cortex-review.yml"), "utf8"), /CORTEX_REPO: https:\/\/github\.com\/acme\/cortex\.git\n/);

    process.env.CORTEX_SOURCE = process.platform === "win32" ? "C:\\cortex" : "/srv/cortex";
    const local = world({ templates: { "loop/cortex-review.yml": now } });
    assert.throws(() => stampReview(local), (e) => e.code === "directory_source" && /cannot clone a path/.test(e.message));
    assert.equal(existsSync(join(local.repoRoot, ".github", "workflows", "cortex-review.yml")), false, "nothing written");
  } finally {
    if (saved === undefined) delete process.env.CORTEX_SOURCE;
    else process.env.CORTEX_SOURCE = saved;
  }
});

// --- the digest pin: CORTEX_SHA256 and CORTEX_REF, filled by the act (docs/adr/0028) -----------------

test("stampFile pins cortex-review.yml to the running release and its code digest, and records both", () => {
  const now = readFileSync(join(TEMPLATES_DIR, "loop", "cortex-review.yml"), "utf8");
  const w = world({ templates: { "loop/cortex-review.yml": now } });
  const done = stampFile({ repoRoot: w.repoRoot, templatesDir: w.templatesDir, path: ".github/workflows/cortex-review.yml", template: "loop/cortex-review.yml", values: {}, version: RUNNING });
  assert.deepEqual(done.unfilled, []);
  const values = readStamps(w.repoRoot).files[".github/workflows/cortex-review.yml"].values;
  assert.equal(values.CORTEX_REF, PINNED_REF, "the ref is the release doing the stamping");
  assert.equal(values.CORTEX_SHA256, cortexDigest(PLUGIN_ROOT), "the digest is this plugin's own code");
  assert.match(values.CORTEX_SHA256, /^[0-9a-f]{64}$/);
  const text = readFileSync(join(w.repoRoot, ".github", "workflows", "cortex-review.yml"), "utf8");
  assert.match(text, new RegExp(`CORTEX_SHA256: "${values.CORTEX_SHA256}"\\n`));
  assert.equal(readStamps(w.repoRoot).files[".github/workflows/cortex-review.yml"].renderable, true, "the pin is a value, so the file re-renders");
});

test("a CORTEX_REF for another release is refused: its code is not here to hash", () => {
  const now = readFileSync(join(TEMPLATES_DIR, "loop", "cortex-review.yml"), "utf8");
  const w = world({ templates: { "loop/cortex-review.yml": now } });
  assert.throws(
    () => stampFile({ repoRoot: w.repoRoot, templatesDir: w.templatesDir, path: ".github/workflows/cortex-review.yml", template: "loop/cortex-review.yml", values: { CORTEX_REF: "v0.0.1" }, version: RUNNING }),
    (e) => e instanceof StampRefused && e.code === "ref_not_running" && e.message.includes(PINNED_REF),
  );
  assert.equal(existsSync(join(w.repoRoot, ".github", "workflows", "cortex-review.yml")), false, "nothing written");
});

test("a cortex-review.yml stamped before the pin is offered as an update that pins the running release", () => {
  const UPSTREAM = "https://github.com/marinvch/Cortex.git";
  const now = readFileSync(join(TEMPLATES_DIR, "loop", "cortex-review.yml"), "utf8");
  const before = withoutPin(now);
  const values = { CORTEX_REF: "v2.44.1", CORTEX_REPO: UPSTREAM };
  const file = before.replace("{{CORTEX_REF}}", values.CORTEX_REF).replace("{{CORTEX_REPO}}", UPSTREAM);
  const w = world({ files: { ".github/workflows/cortex-review.yml": file }, templates: { "loop/cortex-review.yml": before } });
  const record = recordStamp(null, { path: ".github/workflows/cortex-review.yml", template: "loop/cortex-review.yml", version: RUNNING, templateText: before, fileText: file, values });
  w.putTemplate("loop/cortex-review.yml", now);

  assert.equal(stampStatus({ repoRoot: w.repoRoot, record, templatesDir: w.templatesDir })[0].state, "update", "untouched, template moved: an update");
  const plan = planUpdates({ running: RUNNING, repoRoot: w.repoRoot, record, templatesDir: w.templatesDir });
  assert.deepEqual(plan.refused, [], "not refused for a placeholder no recorded value fills");
  const u = plan.updates[0];
  assert.deepEqual(u.values, { CORTEX_REF: PINNED_REF, CORTEX_REPO: UPSTREAM, CORTEX_SHA256: cortexDigest(PLUGIN_ROOT) });
  assert.doesNotMatch(u.text, /\{\{CORTEX_/, "every Cortex placeholder is filled");
  assert.match(u.text, /Verify Cortex is the code that was stamped/);
  // What the per-file question shows is what the update writes.
  const d = stampDiff({ repoRoot: w.repoRoot, record, templatesDir: w.templatesDir, path: ".github/workflows/cortex-review.yml" });
  assert.ok(d.diff.includes(`CORTEX_SHA256: "${u.values.CORTEX_SHA256}"`), "the diff shows the pin the update writes");

  // Once recorded, the pair is kept as written, like every other value: a later template change
  // re-renders with the same ref and digest.
  const next = recordStamp(record, { path: u.path, template: u.template, version: RUNNING, templateText: u.templateText, fileText: u.text, values: u.values });
  writeFileSync(join(w.repoRoot, ".github", "workflows", "cortex-review.yml"), u.text);
  w.putTemplate("loop/cortex-review.yml", now + "# a later comment\n");
  const later = planUpdates({ running: RUNNING, repoRoot: w.repoRoot, record: next, templatesDir: w.templatesDir });
  assert.deepEqual(later.updates[0].values, u.values);
});

// --- the stamp act: render, write and record as one call ----------------------------------------------

const act = (w, extra = {}) => stampFile({ repoRoot: w.repoRoot, templatesDir: w.templatesDir, path: "REVIEW.md", template: "loop/REVIEW.md", values: { NIT_CAP: "3" }, version: RUNNING, ...extra });
const onDisk = (w, rel = "REVIEW.md") => readFileSync(join(w.repoRoot, ...rel.split("/")), "utf8");

test("stampFile writes the render and records it, so the file is current from the first read", () => {
  const w = world({ templates: { "loop/REVIEW.md": TPL } });
  const done = act(w);
  assert.equal(done.action, "created");
  assert.equal(onDisk(w), OUT);
  assert.deepEqual(done.unfilled, []);
  const record = readStamps(w.repoRoot);
  assert.deepEqual(record, done.record, "what it returns is what it wrote");
  assert.deepEqual(record.files["REVIEW.md"].values, { NIT_CAP: "3" });
  assert.equal(record.files["REVIEW.md"].renderable, true);
  assert.deepEqual(stateOf(w, record).map((e) => [e.path, e.state]), [["REVIEW.md", "current"]]);
});

test("stampFile writes LF whatever the template was checked out as, and makes the folders", () => {
  const w = world({ templates: { "loop/REVIEW.md": TPL.replace(/\n/g, "\r\n") } });
  act(w, { path: ".claude/agents/deep/REVIEW.md" });
  assert.equal(onDisk(w, ".claude/agents/deep/REVIEW.md"), OUT);
});

test("stampFile names the placeholders it left as written", () => {
  const w = world({ templates: { "loop/REVIEW.md": TPL + "Owner: {{OWNER}}\n" } });
  assert.deepEqual(act(w).unfilled, ["OWNER"]);
  assert.match(onDisk(w), /Owner: \{\{OWNER\}\}/);
});

test("stampFile never writes over a file Cortex did not record", () => {
  const w = world({ files: { "REVIEW.md": "# Ours\n" }, templates: { "loop/REVIEW.md": TPL } });
  assert.throws(() => act(w), (e) => e instanceof StampRefused && e.code === "not_ours" && /Cortex did not write it/.test(e.message));
  assert.equal(onDisk(w), "# Ours\n");
  assert.equal(readStamps(w.repoRoot), null, "and a refusal records nothing");
  assert.equal(act(w, { force: true }).action, "replaced");
  assert.equal(onDisk(w), OUT);
  // What is recorded is the file it wrote, not the one it replaced.
  assert.deepEqual(stateOf(w, readStamps(w.repoRoot)).map((e) => e.state), ["current"]);
});

test("stampFile never writes over a stamped file the team edited since", () => {
  const w = world({ templates: { "loop/REVIEW.md": TPL } });
  act(w);
  const before = readStamps(w.repoRoot);
  w.put("REVIEW.md", OUT + "Our own rule.\n");
  assert.throws(() => act(w, { values: { NIT_CAP: "5" } }), (e) => e instanceof StampRefused && e.code === "edited");
  assert.equal(onDisk(w), OUT + "Our own rule.\n");
  assert.deepEqual(readStamps(w.repoRoot), before, "the record still holds the values the file was rendered with");
});

test("stampFile replaces its own untouched file with new values, and leaves an identical one alone", () => {
  const w = world({ templates: { "loop/REVIEW.md": TPL } });
  act(w);
  assert.equal(act(w).action, "unchanged");
  const again = act(w, { values: { NIT_CAP: "5" } });
  assert.equal(again.action, "replaced");
  assert.equal(onDisk(w), "# Review\n\nAt most 5 suggestions.\n");
  assert.deepEqual(readStamps(w.repoRoot).files["REVIEW.md"].values, { NIT_CAP: "5" });
  // A file that is already what the render gives, written by anyone, is recorded and not refused.
  const same = world({ files: { "REVIEW.md": OUT }, templates: { "loop/REVIEW.md": TPL } });
  assert.equal(act(same).action, "unchanged");
  assert.equal(readStamps(same.repoRoot).files["REVIEW.md"].renderable, true);
});

test("stampFile refuses a missing template and a path outside the repo before any write", () => {
  const w = world({ templates: { "loop/REVIEW.md": TPL } });
  assert.throws(() => act(w, { template: "loop/gone.md" }), (e) => e instanceof StampRefused && e.code === "no_template");
  assert.throws(() => act(w, { path: "../REVIEW.md" }), TypeError);
  assert.throws(() => act(w, { values: { NIT_CAP: 3 } }), TypeError, "a value that is not a string");
  assert.equal(existsSync(join(w.repoRoot, "REVIEW.md")), false);
  assert.equal(readStamps(w.repoRoot), null);
});

test("applyUpdates writes each planned file, records it, and reads current afterwards", () => {
  const w = stamped();
  writeStamps(w.repoRoot, w.record);
  w.putTemplate("loop/REVIEW.md", TPL + "\nNew rule, cap {{NIT_CAP}}.\n");
  const plan = planUpdates({ running: RUNNING, repoRoot: w.repoRoot, record: w.record, templatesDir: w.templatesDir });
  assert.deepEqual(applyUpdates({ repoRoot: w.repoRoot, record: w.record, plan, version: RUNNING }), ["REVIEW.md"]);
  assert.equal(onDisk(w), OUT + "\nNew rule, cap 3.\n");
  assert.deepEqual(stateOf(w, readStamps(w.repoRoot)).map((e) => e.state), ["current"]);
  // An empty plan writes nothing, not even the record.
  const idle = stamped();
  assert.deepEqual(applyUpdates({ repoRoot: idle.repoRoot, record: idle.record, plan: { updates: [], refused: [] }, version: RUNNING }), []);
  assert.equal(readStamps(idle.repoRoot), null);
});

// --- the stamp report: what the status command prints and what cortex-next ranks from ----------------

const SITES = [{ path: "REVIEW.md", template: "loop/REVIEW.md" }, { path: "intent/README.md", template: "loop/intent-README.md" }];
// A git that counts how often it is asked, and answers with one ignore rule or none.
const countingGit = (rule = null) => {
  const g = () => { g.calls++; return rule ? { status: 0, stdout: `${rule}\t.cortex/stamps.json\n` } : { status: 1, stdout: "" }; };
  g.calls = 0;
  return g;
};
const report = (w, extra = {}) => stampReport(w.repoRoot, { sites: SITES, templatesDir: w.templatesDir, running: RUNNING, git: countingGit(), ...extra });

test("stampReport on a repo Cortex never touched is empty, and does not ask git", () => {
  const w = world({ templates: { "loop/REVIEW.md": TPL } });
  const git = countingGit(".gitignore:1:.cortex/");
  const r = report(w, { git });
  assert.deepEqual(r, { recorded: false, cortex: null, running: RUNNING, olderPlugin: null, files: null, counts: null, adopt: [], ignored: null, empty: true });
  assert.equal(git.calls, 0, "an untouched repo costs no git process");
  // A first install asks anyway, to offer the fix before the record is written.
  const first = report(w, { git, whenEmpty: true });
  assert.ok(git.calls > 0, "and then git is asked");
  assert.deepEqual({ source: first.ignored.source, line: first.ignored.line }, { source: ".gitignore", line: 1 });
  assert.equal(first.empty, true);
});

test("stampReport with no record names what an older /cortex left, and files stay null", () => {
  const w = world({ files: { "REVIEW.md": "# old\n" }, templates: { "loop/REVIEW.md": TPL } });
  const git = countingGit();
  const r = report(w, { git });
  assert.deepEqual(r.adopt, [{ path: "REVIEW.md", template: "loop/REVIEW.md" }]);
  assert.equal(r.files, null, "null is no record; an empty list would read as all current");
  assert.equal(r.counts, null);
  assert.equal(r.empty, false);
  assert.ok(git.calls > 0, "something to adopt is something to ask about");
});

test("stampReport with a record gives each file's state and the count per state", () => {
  const w = stamped();
  writeStamps(w.repoRoot, w.record);
  const r = report(w);
  assert.equal(r.recorded, true);
  assert.equal(r.cortex, "2.40.0");
  assert.deepEqual(r.files, stateOf(w), "the same per-file status stampStatus gives");
  assert.deepEqual(Object.keys(r.counts), STATES, "every state is counted, the zeros too");
  assert.equal(r.counts.current, 1);
  assert.equal(Object.values(r.counts).reduce((a, b) => a + b, 0), r.files.length);
  assert.deepEqual(r.adopt, [], "nothing is adopted once a record exists");
  w.put("REVIEW.md", OUT + "ours\n");
  assert.equal(report(w).counts.edited, 1);
  assert.equal(report(w).counts.current, 0);
});

test("stampReport says when the record was written by a newer Cortex, and when it is ignored", () => {
  const w = stamped();
  writeStamps(w.repoRoot, w.record);
  assert.equal(report(w).olderPlugin, null);
  const behind = report(w, { running: "2.39.0" });
  assert.deepEqual(behind.olderPlugin, olderPlugin(w.record, "2.39.0"));
  assert.equal(behind.olderPlugin.stamped, "2.40.0");
  assert.equal(behind.running, "2.39.0");
  assert.equal(report(w, { git: countingGit(".gitignore:4:.cortex/") }).ignored.line, 4);
});

test("stampReport refuses a damaged record and a missing list of sites", () => {
  const w = world({ files: { ".cortex/stamps.json": "{ not json" } });
  assert.throws(() => report(w), /not readable as JSON/);
  const ok = world();
  assert.throws(() => stampReport(ok.repoRoot, { running: RUNNING }), TypeError);
});

test("the templates this plugin ships are found from the library, in one place", () => {
  assert.ok(existsSync(join(TEMPLATES_DIR, "loop", "REVIEW.md")));
  for (const file of ["../lib/next.mjs", "../lib/team.mjs", "../lib/sections.mjs", "../cortex-stamps.mjs"]) {
    const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    assert.doesNotMatch(src, /new URL\("[./]*templates\/"/, `${file} resolves the templates folder itself`);
  }
});
