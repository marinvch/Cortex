import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { append, list, recent, stamp } from "../memory.js";
import { RefusedWriteError } from "../scrub.js";
import { OutsideRootError } from "../paths.js";

// Assembled at runtime so no secret-shaped literal ships in the repo — see scrub.test.js.
const AWS_KEY = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");

function cortexRoot() {
  const root = mkdtempSync(join(tmpdir(), "cortex-mem-"));
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
