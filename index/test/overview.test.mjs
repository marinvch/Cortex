import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildOverview, memoryEntries, CHURN_DAYS } from "../lib/overview.mjs";
import { bothLayouts, newLayoutOnly, ENTRIES, NEW_ONLY_ENTRY } from "../../core/test/memory-fixture.js";

const DAY = 86_400;

function index(over = {}) {
  return {
    version: "1",
    commit: "0123456789abcdef",
    files: [{ path: "src/a.js", lang: "javascript", category: "code", lines: 1, commits: 1, imports: [], inbound: 0 }],
    edges: [],
    areas: [],
    ...over,
  };
}

function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), "cortex-overview-"));
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

// A git that answers from a table, so a window can be asserted without a real history. Anything
// not in the table fails the way git does.
function fakeGit(answers) {
  const calls = [];
  const git = (argv) => {
    calls.push(argv.join(" "));
    for (const [prefix, out] of answers) if (argv.join(" ").startsWith(prefix)) return { out };
    return { error: "fatal: not in the table" };
  };
  git.calls = calls;
  return git;
}

test("a memory file becomes one entry per heading, with the first line of its body", () => {
  const text = "# 2026-09-20\n\n## 09:15 · digest\n\n**Chose** the `index` path.\nmore\n\n## 17:40 · decision\n\nKeep it.\n";
  assert.deepEqual(memoryEntries("2026-09-20", text), [
    { date: "2026-09-20", time: "09:15", kind: "memory", tag: "digest", author: null, title: "Chose the index path." },
    { date: "2026-09-20", time: "17:40", kind: "memory", tag: "decision", author: null, title: "Keep it." },
  ]);
  // The author is the caller's to give — it comes from the file's path, which this parser never sees.
  assert.deepEqual(memoryEntries("2026-09-20", "# 2026-09-20 · someone-else\n\n## 09:15 · digest\n\nx\n", "dev-a").map((e) => e.author), ["dev-a"]);
  assert.equal(memoryEntries("2026-09-20", "no headings here").length, 0);
});

test("no git is named as no git — never drawn as a quiet month", () => {
  const { root, done } = tempRepo();
  try {
    const git = () => ({ error: "fatal: not a git repository" });
    const o = buildOverview(index(), root, { git });
    assert.deepEqual(o.churn, { unavailable: "not a git repository" });
    assert.equal(o.commitDate, null);
    assert.match(o.timelineNote, /not a git repository/);
    assert.deepEqual(o.timeline, []);
    assert.equal(o.index, "unknown", "freshness nobody measured is unknown, not fresh");
  } finally {
    done();
  }
});

test("the churn window ends at the indexed commit, not at whenever the page is opened", () => {
  const { root, done } = tempRepo();
  try {
    const end = Date.UTC(2026, 8, 26, 12) / 1000;
    const inside = [end, end - DAY, end - 29 * DAY];
    const git = fakeGit([
      ["rev-parse --is-inside-work-tree", "true\n"],
      ["rev-parse --is-shallow-repository", "false\n"],
      ["show -s --format=%ct", `${end}\n`],
      ["log 0123456789abcdef --since", inside.join("\n") + "\n"],
      ["log -n 8", `${end}\x1fabc1234\x1fA Person\x1fa subject\n`],
    ]);
    const o = buildOverview(index(), root, { git, stale: false });
    assert.ok(git.calls.includes(`log 0123456789abcdef --since=@${end - CHURN_DAYS * DAY} --format=%ct`), "an absolute instant");
    assert.equal(o.churn.commits, 3);
    assert.equal(o.churn.days.length, CHURN_DAYS);
    assert.equal(o.churn.to, "2026-09-26");
    assert.equal(o.churn.from, "2026-08-27");
    assert.equal(o.commitDate, "2026-09-26");
    assert.equal(o.index, "fresh");
    assert.equal(o.commit, "0123456");
    assert.deepEqual(o.timeline.map((e) => e.tag), ["abc1234"]);
  } finally {
    done();
  }
});

test("memory sits before commits on the same day, and its lag is measured against the code", () => {
  const { root, done } = tempRepo();
  try {
    mkdirSync(join(root, ".cortex", "memory"), { recursive: true });
    writeFileSync(join(root, ".cortex", "memory", "2026-09-20.md"), "## 10:00 · digest\n\nwhy we did it\n");
    const end = Date.UTC(2026, 8, 26, 12) / 1000;
    const git = fakeGit([
      ["rev-parse --is-inside-work-tree", "true\n"],
      ["rev-parse --is-shallow-repository", "false\n"],
      ["show -s --format=%ct", `${end}\n`],
      ["log 0123456789abcdef --since", ""],
      ["log -n 8", `${end}\x1fbbb\x1fA\x1fnewer\n${end - 6 * DAY}\x1faaa\x1fA\x1fsame day\n`],
    ]);
    const o = buildOverview(index(), root, { git });
    assert.deepEqual(o.timeline.map((e) => e.tag), ["bbb", "digest", "aaa"]);
    assert.equal(o.memory.newest, "2026-09-20");
    assert.equal(o.memory.lagDays, 6);
    assert.equal(o.churn.commits, 0, "an empty window is a real zero when git answered");
  } finally {
    done();
  }
});

// --- both memory layouts (plan step 4.1) ----------------------------------------------------------
//
// A day is `<date>.md` (no author) or `<date>/<author>.md`. core/memory.js owns that rule; what is
// tested here is what the timeline does with the rows: every entry is there, each says whose it is,
// and the order depends on nothing but the files.

const NO_GIT = () => ({ error: "fatal: not a git repository" });

test("the timeline holds every entry of a date written in both layouts, in a stable order", () => {
  const { root, done } = tempRepo();
  try {
    bothLayouts(join(root, ".cortex"));
    const o = buildOverview(index(), root, { git: NO_GIT });
    // The 15th: by time, newest first; at 10:15 the two authors by slug. Then the 14th.
    assert.deepEqual(o.timeline.map((e) => [e.date, e.time, e.tag, e.author]), [
      ["2026-08-15", "14:30", "note", null],
      ["2026-08-15", "10:15", "dream", "dev-a"],
      ["2026-08-15", "10:15", "dream", "dev-b"],
      ["2026-08-15", "09:05", "decision", null],
      ["2026-08-14", "09:00", "note", null],
    ]);
    const titles = o.timeline.map((e) => e.title);
    for (const text of Object.values(ENTRIES)) assert.ok(titles.includes(text), `missing: ${text}`);
    assert.ok(!titles.some((t) => /strayreadme/.test(t)), "a stray README is not memory");
    assert.equal(o.memory.newest, "2026-08-15");
    assert.equal(o.memory.days, 2, "two days, though four files hold them");
  } finally {
    done();
  }
});

test("a repo that only ever wrote the new layout has a timeline and a newest day", () => {
  const { root, done } = tempRepo();
  try {
    newLayoutOnly(join(root, ".cortex"));
    const o = buildOverview(index(), root, { git: NO_GIT });
    assert.deepEqual(o.timeline.map((e) => [e.date, e.time, e.tag, e.author, e.title]), [
      ["2026-08-16", "08:30", "dream", "dev-a", NEW_ONLY_ENTRY],
    ]);
    assert.equal(o.memory.newest, "2026-08-16");
    assert.equal(o.memory.days, 1);
  } finally {
    done();
  }
});

test("at one minute an entry with no author comes first, and a later entry in a file before an earlier one", () => {
  const { root, done } = tempRepo();
  try {
    const memory = join(root, ".cortex", "memory");
    mkdirSync(join(memory, "2026-08-15"), { recursive: true });
    writeFileSync(join(memory, "2026-08-15.md"), "# 2026-08-15\n\n## 10:15 · note\n\nold first\n\n## 10:15 · note\n\nold second\n\n");
    writeFileSync(join(memory, "2026-08-15", "dev-b.md"), "## 10:15 · note\n\nb early\n\n## 10:16 · note\n\nb late\n\n");
    writeFileSync(join(memory, "2026-08-15", "dev-a.md"), "## 10:15 · note\n\na first\n\n## 10:15 · note\n\na second\n\n");
    const o = buildOverview(index(), root, { git: NO_GIT });
    assert.deepEqual(o.timeline.map((e) => e.title), [
      "b late",
      "old second",
      "old first",
      "a second",
      "a first",
      "b early",
    ]);
  } finally {
    done();
  }
});

test("the timeline reads the newest three days, however many files hold them", () => {
  const { root, done } = tempRepo();
  try {
    const memory = join(root, ".cortex", "memory");
    const put = (rel, title) => {
      mkdirSync(join(memory, rel, ".."), { recursive: true });
      writeFileSync(join(memory, rel), `## 09:00 · note\n\n${title}\n\n`);
    };
    put("2026-08-18/dev-a.md", "18 a");
    put("2026-08-18/dev-b.md", "18 b");
    put("2026-08-17.md", "17 old");
    put("2026-08-17/dev-a.md", "17 a");
    put("2026-08-16/dev-a.md", "16 a");
    put("2026-08-15.md", "15 old");
    const o = buildOverview(index(), root, { git: NO_GIT });
    assert.deepEqual(o.timeline.map((e) => e.title), ["18 a", "18 b", "17 old", "17 a", "16 a"]);
    assert.equal(o.memory.days, 4, "the count is of every day, not only the ones read");
  } finally {
    done();
  }
});

test("memory still sits before the commits of its day when the day has several authors", () => {
  const { root, done } = tempRepo();
  try {
    bothLayouts(join(root, ".cortex"));
    const noon = Date.UTC(2026, 7, 15, 12) / 1000;
    const git = fakeGit([
      ["rev-parse --is-inside-work-tree", "true\n"],
      ["rev-parse --is-shallow-repository", "false\n"],
      ["show -s --format=%ct", `${noon}\n`],
      ["log 0123456789abcdef --since", ""],
      ["log -n 8", `${noon}\x1fccc\x1fA Person\x1fthe same day\n`],
    ]);
    const o = buildOverview(index(), root, { git });
    assert.deepEqual(o.timeline.map((e) => e.tag), ["note", "dream", "dream", "decision", "ccc", "note"]);
    assert.equal(o.timeline[4].author, "A Person", "a commit keeps the author git gave it");
  } finally {
    done();
  }
});

test("a commit's timeline date and the status bar's date are the same UTC day", () => {
  // 00:30 UTC on the 25th is 09:30 on the 25th in +09:00 but 20:30 on the 24th in -04:00. The
  // timeline read git's `%cs` — the committer's local date — while the status bar used UTC, so one
  // commit showed two dates on one page. Both come from the timestamp now.
  const { root, done } = tempRepo();
  try {
    const ts = Date.UTC(2026, 7, 25, 0, 30) / 1000;
    const git = fakeGit([
      ["rev-parse --is-inside-work-tree", "true\n"],
      ["rev-parse --is-shallow-repository", "false\n"],
      ["show -s --format=%ct", `${ts}\n`],
      ["log 0123456789abcdef --since", `${ts}\n`],
      ["log -n 8", `${ts}\x1fabc1234\x1fA\x1fsubject\n`],
    ]);
    const o = buildOverview(index(), root, { git });
    assert.ok(git.calls.some((c) => c.startsWith("log -n 8") && c.includes("%ct")), "the timeline asks git for a timestamp");
    assert.equal(o.commitDate, "2026-08-25");
    assert.equal(o.timeline[0].date, o.commitDate);
  } finally {
    done();
  }
});

test("a shallow clone says churn is unavailable instead of drawing one commit as a quiet month", () => {
  // `git clone --depth 1` is how people try a tool on somebody else's repo, and it holds one commit:
  // every file "changed once", every window "1 commit". That is not a measurement of anything.
  const { root, done } = tempRepo();
  try {
    const end = Date.UTC(2026, 8, 26, 12) / 1000;
    const git = fakeGit([
      ["rev-parse --is-inside-work-tree", "true\n"],
      ["rev-parse --is-shallow-repository", "true\n"],
      ["show -s --format=%ct", `${end}\n`],
      ["log 0123456789abcdef --since", `${end}\n`],
      ["log -n 8", `${end}\x1fabc1234\x1fA\x1fsubject\n`],
    ]);
    const o = buildOverview(index(), root, { git });
    assert.equal(o.shallow, true);
    assert.match(o.churn.unavailable, /shallow clone/);
    assert.equal(o.churn.commits, undefined, "no count is drawn at all");
  } finally {
    done();
  }
});

test("the same repo state gives the same overview", () => {
  const { root, done } = tempRepo();
  try {
    const git = () => ({ error: "no" });
    assert.deepEqual(buildOverview(index(), root, { git }), buildOverview(index(), root, { git }));
  } finally {
    done();
  }
});
