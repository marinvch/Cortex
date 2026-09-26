import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildOverview, memoryEntries, CHURN_DAYS } from "../lib/overview.mjs";

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
    { date: "2026-09-20", time: "09:15", kind: "memory", tag: "digest", title: "Chose the index path." },
    { date: "2026-09-20", time: "17:40", kind: "memory", tag: "decision", title: "Keep it." },
  ]);
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
      ["rev-parse", "true\n"],
      ["show -s --format=%ct", `${end}\n`],
      ["log 0123456789abcdef --since", inside.join("\n") + "\n"],
      ["log -n 8", "2026-09-26\x1fabc1234\x1fA Person\x1fa subject\n"],
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
      ["rev-parse", "true\n"],
      ["show -s --format=%ct", `${end}\n`],
      ["log 0123456789abcdef --since", ""],
      ["log -n 8", "2026-09-26\x1fbbb\x1fA\x1fnewer\n2026-09-20\x1faaa\x1fA\x1fsame day\n"],
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

test("the same repo state gives the same overview", () => {
  const { root, done } = tempRepo();
  try {
    const git = () => ({ error: "no" });
    assert.deepEqual(buildOverview(index(), root, { git }), buildOverview(index(), root, { git }));
  } finally {
    done();
  }
});
