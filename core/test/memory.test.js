import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { append, list, recent, stamp } from "../memory.js";
import { RefusedWriteError } from "../scrub.js";
import { OutsideRootError } from "../paths.js";
import { tempDir } from "./tmp.js";
import { bothLayouts, newLayoutOnly, ENTRIES, ENTRIES_OF_THE_15TH, NEW_ONLY_ENTRY } from "./memory-fixture.js";

// Assembled at runtime so no secret-shaped literal ships in the repo — see scrub.test.js.
const AWS_KEY = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");

function cortexRoot() {
  const root = tempDir("cortex-mem-");
  mkdirSync(join(root, ".cortex"), { recursive: true });
  return join(root, ".cortex");
}

const DAY = new Date(2026, 7, 15, 9, 5); // 2026-08-15 09:05, fixed so the test is deterministic

test("stamp formats a zero-padded date", () => {
  assert.equal(stamp(new Date(2026, 0, 3)), "2026-01-03");
  assert.equal(stamp(DAY), "2026-08-15");
});

test("first write creates a dated file with a heading", () => {
  const root = cortexRoot();
  const res = append(root, "Split the billing module.", { date: DAY, kind: "decision" });
  assert.equal(res.day, "2026-08-15");
  assert.equal(res.created, true);
  const text = readFileSync(res.path, "utf8");
  assert.match(text, /^# 2026-08-15/);
  assert.match(text, /## 09:05 · decision/);
  assert.match(text, /Split the billing module\./);
});

test("appends rather than overwriting, so concurrent writers never lose an entry", () => {
  const root = cortexRoot();
  append(root, "first note", { date: DAY });
  const second = append(root, "second note", { date: new Date(2026, 7, 15, 14, 30) });
  assert.equal(second.created, false);
  const text = readFileSync(second.path, "utf8");
  assert.match(text, /first note/);
  assert.match(text, /second note/);
  assert.ok(text.indexOf("first note") < text.indexOf("second note"), "order is preserved");
  assert.equal(text.match(/^# 2026-08-15/gm).length, 1, "the day heading is written once");
});

test("a new day gets its own file", () => {
  const root = cortexRoot();
  append(root, "monday", { date: new Date(2026, 7, 17, 9, 0) });
  append(root, "tuesday", { date: new Date(2026, 7, 18, 9, 0) });
  const days = list(root).map((e) => e.day);
  assert.deepEqual(days, ["2026-08-18", "2026-08-17"], "newest first");
});

test("REFUSES a write carrying a secret — the whole point of committed memory", () => {
  const root = cortexRoot();
  assert.throws(
    () => append(root, `deploy key ${AWS_KEY} rotated`, { date: DAY }),
    (e) => e instanceof RefusedWriteError && e.code === "refused_write",
  );
  assert.deepEqual(list(root), [], "nothing may reach disk when the gate refuses");
});

test("refuses an empty entry", () => {
  const root = cortexRoot();
  assert.throws(() => append(root, "   ", { date: DAY }), (e) => e.code === "empty");
});

test("memory writes cannot escape the .cortex root", () => {
  const root = cortexRoot();
  // append() builds its own path, so the guard is exercised via the resolveInRoot it calls.
  // A root that does not exist must fail loudly rather than write somewhere unexpected.
  assert.throws(() => append(join(root, "..", "..", "elsewhere"), "note", { date: DAY }));
});

test("recent() reads back the newest entries", () => {
  const root = cortexRoot();
  append(root, "older", { date: new Date(2026, 7, 10, 9, 0) });
  append(root, "newer", { date: new Date(2026, 7, 12, 9, 0) });
  const got = recent(root, { days: 1 });
  assert.equal(got.length, 1);
  assert.equal(got[0].day, "2026-08-12");
  assert.match(got[0].content, /newer/);
});

test("list() on a vault with no memory yet is empty, not an error", () => {
  const root = cortexRoot();
  assert.deepEqual(list(root), []);
  assert.deepEqual(recent(root), []);
});

export { OutsideRootError };

// --- both layouts (plan step 4.1) -----------------------------------------------------------------
//
// A day is `<date>.md` (old, no author) or a directory `<date>/` holding one `<author>.md` per
// author (new). Nothing writes the new layout yet, so these files are built by hand. Every reader
// in index/ and mcp/ stands on list() and recent(), so the layout rule is tested here once.

const names = (rows) => rows.map((r) => `${r.day} ${r.author}`);

test("list() returns one row per file of either layout, old day file first, then authors by slug", () => {
  const root = bothLayouts(cortexRoot());
  const rows = list(root);
  assert.deepEqual(names(rows), [
    "2026-08-15 null",
    "2026-08-15 dev-a",
    "2026-08-15 dev-b",
    "2026-08-14 null",
  ]);
  const memory = join(root, "memory");
  assert.deepEqual(rows.map((r) => r.path), [
    join(memory, "2026-08-15.md"),
    join(memory, "2026-08-15", "dev-a.md"),
    join(memory, "2026-08-15", "dev-b.md"),
    join(memory, "2026-08-14.md"),
  ]);
  assert.ok(rows.every((r) => Object.keys(r).join() === "day,author,path"), "a row is day, author, path");
});

test("recent({ days }) counts days, not files", () => {
  const root = bothLayouts(cortexRoot());
  const one = recent(root, { days: 1 });
  assert.deepEqual(names(one), ["2026-08-15 null", "2026-08-15 dev-a", "2026-08-15 dev-b"]);
  const two = recent(root, { days: 2 });
  assert.equal(two.length, 4, "the second day brings the 14th");
  assert.equal(two[3].day, "2026-08-14");
  assert.deepEqual(recent(root, { days: 0 }), []);
  assert.equal(recent(root).length, 4, "the default of seven days holds both");
  assert.equal(recent(root, { days: Infinity }).length, 4);
});

test("no entry is lost when one date holds both layouts", () => {
  const root = bothLayouts(cortexRoot());
  const all = recent(root, { days: 7 }).map((r) => r.content).join("\n");
  for (const text of Object.values(ENTRIES)) assert.ok(all.includes(text), `missing: ${text}`);
  const day = recent(root, { days: 1 }).map((r) => r.content).join("\n");
  for (const text of ENTRIES_OF_THE_15TH) assert.ok(day.includes(text), `missing from the 15th: ${text}`);
  assert.ok(!day.includes(ENTRIES.dayBefore), "one day is one day");
  assert.ok(!all.includes("strayreadme"), "a stray README is not memory, in either directory");
});

test("a repo that only ever wrote the new layout has memory", () => {
  const root = newLayoutOnly(cortexRoot());
  const rows = recent(root, { days: 1 });
  assert.deepEqual(names(rows), ["2026-08-16 dev-a"]);
  assert.ok(rows[0].content.includes(NEW_ONLY_ENTRY));
});

test("the author comes from the path, never from the header", () => {
  const root = cortexRoot();
  const day = join(root, "memory", "2026-08-15");
  mkdirSync(day, { recursive: true });
  writeFileSync(join(day, "dev-a.md"), "# 2026-08-15 · someone-else\n\n## 10:15 · dream\n\ntext\n\n");
  writeFileSync(join(root, "memory", "2026-08-14.md"), "# 2026-08-14 · dev-z\n\n## 10:15 · dream\n\ntext\n\n");
  assert.deepEqual(names(list(root)), ["2026-08-15 dev-a", "2026-08-14 null"]);
});

test("authors sort by slug in code-unit order, whatever order the directory returns", () => {
  const root = cortexRoot();
  const day = join(root, "memory", "2026-08-15");
  mkdirSync(day, { recursive: true });
  // Written out of order, and chosen so a locale-aware comparison would order them differently.
  for (const slug of ["dev-b", "b", "dev-10", "a-b", "dev-2", "ab", "0x"]) writeFileSync(join(day, `${slug}.md`), "x");
  assert.deepEqual(list(root).map((r) => r.author), ["0x", "a-b", "ab", "b", "dev-10", "dev-2", "dev-b"]);
});

test("days sort newest first across both layouts", () => {
  const root = cortexRoot();
  const memory = join(root, "memory");
  mkdirSync(join(memory, "2026-08-17"), { recursive: true });
  mkdirSync(join(memory, "2026-08-09"), { recursive: true });
  writeFileSync(join(memory, "2026-08-17", "dev-a.md"), "x");
  writeFileSync(join(memory, "2026-08-09", "dev-a.md"), "x");
  writeFileSync(join(memory, "2026-08-10.md"), "x");
  writeFileSync(join(memory, "2026-08-18.md"), "x");
  assert.deepEqual(list(root).map((r) => r.day), ["2026-08-18", "2026-08-17", "2026-08-10", "2026-08-09"]);
  assert.deepEqual(recent(root, { days: 3 }).map((r) => r.day), ["2026-08-18", "2026-08-17", "2026-08-10"]);
});

test("anything that is neither layout is ignored", () => {
  const root = cortexRoot();
  const memory = join(root, "memory");
  const put = (rel, text = "x") => {
    mkdirSync(join(memory, rel, ".."), { recursive: true });
    writeFileSync(join(memory, rel), text);
  };
  put("2026-08-15/dev-a.md"); // the one real file
  put("2026-08-15/Dev-A2.md"); // upper case is not a slug
  put("2026-08-15/dev.b.md"); // a dot is not in a slug
  put("2026-08-15/-dev.md"); // a slug starts with a letter or a digit
  put("2026-08-15/dev_c.md"); // an underscore is not in a slug
  put("2026-08-15/dev-d.txt"); // not markdown
  put("2026-08-15/dev-e.md.bak");
  put(`2026-08-15/${"x".repeat(41)}.md`); // a slug is at most 40 characters
  put("2026-08-15/nested/dev-f.md"); // a day directory holds files, not directories
  mkdirSync(join(memory, "2026-08-15", "dev-g.md")); // a directory named like an author file
  put("notes/dev-h.md"); // a directory that is not a date
  put("2026-8-15/dev-i.md"); // not zero-padded
  put("2026-08-15x/dev-j.md");
  put("x2026-08-15/dev-l.md");
  put("x2026-08-16.md");
  put("2026-08-16.md.bak");
  put("2026-08-17"); // a FILE named like a day directory
  mkdirSync(join(memory, "2026-08-18.md")); // a DIRECTORY named like an old day file
  put("2026-08-18.md/dev-k.md");
  assert.deepEqual(names(list(root)), ["2026-08-15 dev-a"]);
  assert.deepEqual(recent(root, { days: 9 }).map((r) => r.content), ["x"]);
});

test("a slug of exactly forty characters is an author, and a one-character slug is too", () => {
  const root = cortexRoot();
  const day = join(root, "memory", "2026-08-15");
  mkdirSync(day, { recursive: true });
  const forty = "a" + "9".repeat(39);
  writeFileSync(join(day, `${forty}.md`), "x");
  writeFileSync(join(day, "7.md"), "x");
  assert.deepEqual(list(root).map((r) => r.author), ["7", forty]);
});

test("an empty day directory is not a day", () => {
  const root = cortexRoot();
  mkdirSync(join(root, "memory", "2026-08-19"), { recursive: true });
  writeFileSync(join(root, "memory", "2026-08-12.md"), "older");
  assert.deepEqual(names(list(root)), ["2026-08-12 null"]);
  assert.deepEqual(recent(root, { days: 1 }).map((r) => r.content), ["older"], "it does not use up a day either");
});

test("what the writer writes today is still read back, with no author", () => {
  const root = cortexRoot();
  append(root, "written by the real writer", { date: DAY });
  const rows = recent(root, { days: 1 });
  assert.deepEqual(names(rows), ["2026-08-15 null"]);
  assert.match(rows[0].content, /written by the real writer/);
});

// The contract "`root` is the .cortex directory" lived only in a doc comment, so passing a repo
// root — the reading the word "root" invites — wrote a dated file to <repo>/memory/ and returned
// exit 0. Nothing reads that path: it is not the committed .cortex/memory/, and generated.mjs
// ignores only .cortex/index|findings|view, so it is not even gitignored. A confident wrong
// output, which is the failure index/lib/root.mjs exists to prevent.
test("append refuses a root that is not the .cortex directory", () => {
  const repo = tempDir("cortex-mem-");
  mkdirSync(join(repo, ".cortex"), { recursive: true });

  assert.throws(
    () => append(repo, "a note that must not land", { date: DAY }),
    (e) => e.code === "not_cortex_root",
  );
  assert.equal(existsSync(join(repo, "memory")), false, "nothing may be written on a refused root");
});

test("append names the root it was given when it refuses", () => {
  const repo = tempDir("cortex-mem-");
  assert.throws(() => append(repo, "x", { date: DAY }), (e) => e.message.includes(repo));
});
