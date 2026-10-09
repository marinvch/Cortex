import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { append, list, recent, stamp } from "../memory.js";
import { RefusedWriteError } from "../scrub.js";
import { OutsideRootError } from "../paths.js";
import { tempDir } from "./tmp.js";
import { bothLayouts, newLayoutOnly, ENTRIES, ENTRIES_OF_THE_15TH, NEW_ONLY_ENTRY } from "./memory-fixture.js";

// Assembled at runtime so no secret-shaped literal ships in the repo — see scrub.test.js.
const AWS_KEY = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");

// The real path, because append() reports the path it resolved: a temp dir reached through a link
// would otherwise differ from the path the test built.
function cortexRoot() {
  const root = realpathSync(tempDir("cortex-mem-"));
  mkdirSync(join(root, ".cortex"), { recursive: true });
  return join(root, ".cortex");
}

const DAY = new Date(2026, 7, 15, 9, 5); // 2026-08-15 09:05, fixed so the test is deterministic
const LATER = new Date(2026, 7, 15, 14, 30);

// Every write below names its author, or names a writer with no name. A write that did neither
// would ask the machine's git who it is: green on a laptop, red in CI, and a real name in a path.
const DEV_A = { author: "dev-a" };
const DEV_B = { author: "dev-b" };
/** No CORTEX_AUTHOR, and a git that has no user.name. */
const NOBODY = { env: {}, git: () => null };

/** Every file and directory under `dir`, as sorted relative paths with `/`. */
function tree(dir, prefix = "") {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}${e.name}`;
    if (e.isDirectory()) out.push(`${rel}/`, ...tree(join(dir, e.name), `${rel}/`));
    else out.push(rel);
  }
  return out.sort();
}

test("stamp formats a zero-padded date", () => {
  assert.equal(stamp(new Date(2026, 0, 3)), "2026-01-03");
  assert.equal(stamp(DAY), "2026-08-15");
});

// --- the writer (plan step 4.2) -------------------------------------------------------------------
//
// One file per author per day: memory/<day>/<author>.md. Two developers then never write the same
// path, so two branches that each wrote memory on one day merge with no conflict.
// docs/specs/2026-10-09-team-memory-design.md.

test("the first write by an author creates <day>/<author>.md, headed with the day and the author", () => {
  const root = cortexRoot();
  const res = append(root, "Split the billing module.", { date: DAY, kind: "decision", ...DEV_A });
  assert.deepEqual(res, {
    path: join(root, "memory", "2026-08-15", "dev-a.md"),
    day: "2026-08-15",
    created: true,
    author: "dev-a",
    layout: "author",
  });
  assert.equal(
    readFileSync(res.path, "utf8"),
    "# 2026-08-15 · dev-a\n\n## 09:05 · decision\n\nSplit the billing module.\n\n",
  );
  assert.deepEqual(tree(root), ["memory/", "memory/2026-08-15/", "memory/2026-08-15/dev-a.md"]);
});

test("a second write by the same author appends, and the header is there once", () => {
  const root = cortexRoot();
  const first = append(root, "first note", { date: DAY, ...DEV_A });
  const second = append(root, "second note", { date: LATER, ...DEV_A });
  assert.equal(second.created, false);
  assert.equal(second.path, first.path);
  const text = readFileSync(second.path, "utf8");
  assert.equal(
    text,
    "# 2026-08-15 · dev-a\n\n## 09:05 · note\n\nfirst note\n\n## 14:30 · note\n\nsecond note\n\n",
    "the first entry is still there, byte for byte, before the second",
  );
  assert.equal(text.match(/^# /gm).length, 1, "the header is written once");
  assert.deepEqual(tree(root), ["memory/", "memory/2026-08-15/", "memory/2026-08-15/dev-a.md"]);
});

test("a second author gets a second file on the same day, and neither touches the other's", () => {
  const root = cortexRoot();
  const a = append(root, "from the first author", { date: DAY, ...DEV_A });
  const before = readFileSync(a.path, "utf8");
  const b = append(root, "from the second author", { date: DAY, ...DEV_B });
  assert.equal(b.created, true);
  assert.equal(b.author, "dev-b");
  assert.equal(b.path, join(root, "memory", "2026-08-15", "dev-b.md"));
  assert.equal(readFileSync(a.path, "utf8"), before, "the first author's file is unchanged");
  assert.equal(readFileSync(b.path, "utf8"), "# 2026-08-15 · dev-b\n\n## 09:05 · note\n\nfrom the second author\n\n");
  assert.deepEqual(list(root).map((r) => r.author), ["dev-a", "dev-b"]);
});

test("a new day gets its own directory", () => {
  const root = cortexRoot();
  append(root, "monday", { date: new Date(2026, 7, 17, 9, 0), ...DEV_A });
  append(root, "tuesday", { date: new Date(2026, 7, 18, 9, 0), ...DEV_A });
  const days = list(root).map((e) => e.day);
  assert.deepEqual(days, ["2026-08-18", "2026-08-17"], "newest first");
  assert.deepEqual(tree(root), [
    "memory/",
    "memory/2026-08-17/",
    "memory/2026-08-17/dev-a.md",
    "memory/2026-08-18/",
    "memory/2026-08-18/dev-a.md",
  ]);
});

test("an author given as a name is written as its slug, in the path and in the header", () => {
  const root = cortexRoot();
  const res = append(root, "note", { date: DAY, author: "  Dev   A. " });
  assert.equal(res.author, "dev-a");
  assert.equal(res.path, join(root, "memory", "2026-08-15", "dev-a.md"));
  assert.match(readFileSync(res.path, "utf8"), /^# 2026-08-15 · dev-a\n/);
});

test("with no author given, CORTEX_AUTHOR names it, and beats git", () => {
  const root = cortexRoot();
  const res = append(root, "note", { date: DAY, env: { CORTEX_AUTHOR: "dev-a" }, git: () => "Dev B" });
  assert.equal(res.author, "dev-a");
  assert.equal(res.layout, "author");
  assert.deepEqual(tree(root), ["memory/", "memory/2026-08-15/", "memory/2026-08-15/dev-a.md"]);
});

test("with no author given and no CORTEX_AUTHOR, git user.name names it, asked in the repository", () => {
  const root = cortexRoot();
  const asked = [];
  const git = (cwd) => {
    asked.push(cwd);
    return "Dev B\n";
  };
  const res = append(root, "note", { date: DAY, env: {}, git });
  assert.equal(res.author, "dev-b");
  assert.equal(res.path, join(root, "memory", "2026-08-15", "dev-b.md"));
  assert.deepEqual(asked, [dirname(root)], "git is asked once, in the parent of .cortex");
});

// --- no author: the day file, and the writer says so (T8) -----------------------------------------

test("with no usable author the entry goes to <day>.md, and the result says layout: day", () => {
  const root = cortexRoot();
  const res = append(root, "Split the billing module.", { date: DAY, kind: "decision", ...NOBODY });
  assert.equal(res.path, join(root, "memory", "2026-08-15.md"));
  assert.equal(res.day, "2026-08-15");
  assert.equal(res.created, true);
  assert.equal(res.author, null);
  assert.equal(res.layout, "day");
  assert.equal(
    readFileSync(res.path, "utf8"),
    "# 2026-08-15\n\n## 09:05 · decision\n\nSplit the billing module.\n\n",
    "the day file is written exactly as it was before there were authors",
  );
  assert.deepEqual(tree(root), ["memory/", "memory/2026-08-15.md"], "and no day directory is made");
});

test("the writer says so on EVERY write that falls back, not only the first", () => {
  const root = cortexRoot();
  const first = append(root, "one", { date: DAY, ...NOBODY });
  const second = append(root, "two", { date: LATER, ...NOBODY });
  for (const res of [first, second]) {
    assert.equal(res.layout, "day");
    assert.equal(typeof res.notice, "string", "a fallback nobody notices is the risk");
    assert.match(res.notice, /Set CORTEX_AUTHOR to /, "the notice names the fix, as something to do");
    assert.match(res.notice, /2026-08-15\.md/, "and the file the entry went to");
    assert.match(res.notice, /conflict/, "and what the day file costs");
    assert.ok(!res.notice.includes("\n"), "one line");
  }
  assert.equal(second.created, false);
  assert.equal(readFileSync(second.path, "utf8").match(/^# 2026-08-15$/gm).length, 1);
});

test("a write that names its author carries no fallback notice", () => {
  const root = cortexRoot();
  assert.equal("notice" in append(root, "note", { date: DAY, ...DEV_A }), false);
});

test("a git name with no ASCII letter falls back too, and the notice repeats no name", () => {
  const root = cortexRoot();
  const name = "Разработчик А"; // "developer A" in Cyrillic: nobody's name
  const res = append(root, "note", { date: DAY, env: {}, git: () => name });
  assert.equal(res.layout, "day");
  assert.equal(res.author, null);
  assert.match(res.notice, /Set CORTEX_AUTHOR to /);
  assert.match(res.notice, /no ASCII letter/, "and says why this name gave no file name");
  assert.ok(!res.notice.includes("Разработчик"), "only a slug is ever written, and there is none");
  assert.ok(!readFileSync(res.path, "utf8").includes("Разработчик"));
});

test("a day file that is already there is never touched by an author's write", () => {
  const root = cortexRoot();
  const old = append(root, "written before the team moved over", { date: DAY, ...NOBODY });
  const before = readFileSync(old.path, "utf8");
  const res = append(root, "written after", { date: LATER, ...DEV_A });
  assert.equal(res.created, true);
  assert.equal(readFileSync(old.path, "utf8"), before, "no migration: the old file stays byte for byte");
  assert.deepEqual(tree(root), ["memory/", "memory/2026-08-15.md", "memory/2026-08-15/", "memory/2026-08-15/dev-a.md"]);
  assert.deepEqual(list(root).map((r) => r.author), [null, "dev-a"], "one date holds both, and both are read");
});

// --- refusals leave nothing behind ----------------------------------------------------------------

test("REFUSES a write carrying a secret, and leaves neither a file nor a day directory", () => {
  const root = cortexRoot();
  let gitAsked = 0;
  const git = () => {
    gitAsked += 1;
    return "Dev A";
  };
  for (const who of [DEV_A, NOBODY, { env: { CORTEX_AUTHOR: "dev-a" } }, { env: {}, git }]) {
    assert.throws(
      () => append(root, `deploy key ${AWS_KEY} rotated`, { date: DAY, ...who }),
      (e) => e instanceof RefusedWriteError && e.code === "refused_write",
    );
    assert.deepEqual(tree(root), [], "nothing may reach disk when the gate refuses: no memory/, no day directory");
  }
  assert.equal(gitAsked, 0, "the gate is first: a refused write does not even ask who is writing");
  assert.deepEqual(list(root), []);
});

test("a refused write leaves a day that already has entries exactly as it was", () => {
  const root = cortexRoot();
  append(root, "a note", { date: DAY, ...DEV_A });
  const before = tree(root);
  assert.throws(
    () => append(root, `deploy key ${AWS_KEY} rotated`, { date: DAY, ...DEV_B }),
    (e) => e.code === "refused_write",
  );
  assert.deepEqual(tree(root), before, "no file for the second author");
});

test("an author option that gives no slug is refused as invalid_author, and nothing is written", () => {
  const root = cortexRoot();
  for (const bad of ["..", "CON", "***", "", "   ", 7, {}]) {
    assert.throws(
      () => append(root, "note", { date: DAY, author: bad }),
      (e) => e.code === "invalid_author",
      JSON.stringify(bad),
    );
  }
  assert.deepEqual(tree(root), []);
});

test("a CORTEX_AUTHOR that is set and unusable refuses the write, and git is not used instead", () => {
  const root = cortexRoot();
  assert.throws(
    () => append(root, "note", { date: DAY, env: { CORTEX_AUTHOR: ".." }, git: () => "Dev B" }),
    (e) => e.code === "invalid_author" && /CORTEX_AUTHOR/.test(e.message),
  );
  assert.deepEqual(tree(root), [], "nothing is written, to either layout");
});

test("refuses an empty entry", () => {
  const root = cortexRoot();
  assert.throws(() => append(root, "   ", { date: DAY, ...DEV_A }), (e) => e.code === "empty");
  assert.deepEqual(tree(root), []);
});

test("memory writes cannot escape the .cortex root", () => {
  const root = cortexRoot();
  // append() builds its own path, so the guard is exercised via the resolveInRoot it calls.
  // A root that does not exist must fail loudly rather than write somewhere unexpected.
  assert.throws(() => append(join(root, "..", "..", "elsewhere"), "note", { date: DAY, ...DEV_A }));
});

test("append never creates .cortex, in either layout", () => {
  for (const who of [DEV_A, NOBODY]) {
    const repo = tempDir("cortex-mem-");
    const root = join(repo, ".cortex");
    assert.throws(() => append(root, "note", { date: DAY, ...who }));
    assert.deepEqual(readdirSync(repo), [], "the consent gate: the writer makes memory/, never .cortex/");
  }
});

test("nothing in core/memory.js opens a file for writing other than by append", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "memory.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(code.match(/\bappendFileSync\(/g)?.length, 1, "one append, in one place");
  assert.doesNotMatch(
    code,
    /\b(writeFileSync|writeFile|openSync|createWriteStream|renameSync|rename|copyFileSync|truncateSync|rmSync|unlinkSync|rmdirSync)\b/,
    "memory is append-only: no rewrite, no move, no delete",
  );
  assert.doesNotMatch(code, /node:fs\/promises/, "and no second way in");
});

test("recent() reads back the newest entries", () => {
  const root = cortexRoot();
  append(root, "older", { date: new Date(2026, 7, 10, 9, 0), ...DEV_A });
  append(root, "newer", { date: new Date(2026, 7, 12, 9, 0), ...DEV_A });
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
// author (new). The shared fixture is written by the real writer (memory-fixture.js); the files
// built by hand below are the ones the writer never makes. Every reader in index/ and mcp/ stands
// on list() and recent(), so the layout rule is tested here once.

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

test("what the writer writes is read back, with its author or with none", () => {
  const root = cortexRoot();
  append(root, "written with no name", { date: DAY, ...NOBODY });
  append(root, "written by the second author", { date: DAY, ...DEV_B });
  append(root, "written by the first author", { date: LATER, ...DEV_A });
  const rows = recent(root, { days: 1 });
  assert.deepEqual(names(rows), ["2026-08-15 null", "2026-08-15 dev-a", "2026-08-15 dev-b"]);
  assert.match(rows[0].content, /written with no name/);
  assert.match(rows[1].content, /written by the first author/);
  assert.match(rows[2].content, /written by the second author/);
});

test("the shared fixture is what the real writer wrote, in both layouts", () => {
  const root = bothLayouts(cortexRoot());
  const read = (...rel) => readFileSync(join(root, "memory", ...rel), "utf8");
  assert.equal(read("2026-08-14.md"), `# 2026-08-14\n\n## 09:00 · note\n\n${ENTRIES.dayBefore}\n\n`);
  assert.equal(
    read("2026-08-15.md"),
    `# 2026-08-15\n\n## 09:05 · decision\n\n${ENTRIES.oldMorning}\n\n## 14:30 · note\n\n${ENTRIES.oldAfternoon}\n\n`,
  );
  assert.equal(read("2026-08-15", "dev-a.md"), `# 2026-08-15 · dev-a\n\n## 10:15 · dream\n\n${ENTRIES.devA}\n\n`);
  assert.equal(read("2026-08-15", "dev-b.md"), `# 2026-08-15 · dev-b\n\n## 10:15 · dream\n\n${ENTRIES.devB}\n\n`);
  assert.deepEqual(tree(root), [
    "memory/",
    "memory/2026-08-14.md",
    "memory/2026-08-15.md",
    "memory/2026-08-15/",
    "memory/2026-08-15/README.md",
    "memory/2026-08-15/dev-a.md",
    "memory/2026-08-15/dev-b.md",
    "memory/README.md",
  ]);
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
    () => append(repo, "a note that must not land", { date: DAY, ...DEV_A }),
    (e) => e.code === "not_cortex_root",
  );
  assert.equal(existsSync(join(repo, "memory")), false, "nothing may be written on a refused root");
});

test("append names the root it was given when it refuses", () => {
  const repo = tempDir("cortex-mem-");
  assert.throws(() => append(repo, "x", { date: DAY, ...DEV_A }), (e) => e.message.includes(repo));
});
