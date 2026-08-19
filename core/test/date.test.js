import { test } from "node:test";
import assert from "node:assert/strict";
import { stamp, clock } from "../date.js";

// These assertions are about LOCAL time, so they only mean the same thing on every machine if the
// timezone is fixed. Node reads TZ at startup, so the suite sets it for itself rather than relying
// on the developer's machine being east of Greenwich.
process.env.TZ = "Europe/Sofia"; // UTC+2/+3

test("stamp reads the local day, not the UTC one", () => {
  // 01:00 on 19 August in UTC+3 is still 22:00 on the 18th in UTC. This is the bug that put a
  // capture into yesterday's daily note: `new Date().toISOString().slice(0,10)` answers 2026-08-18
  // for this instant, and the person filing the thought is living on the 19th.
  const afterLocalMidnight = new Date("2026-08-19T01:00:00+03:00");
  assert.equal(afterLocalMidnight.toISOString().slice(0, 10), "2026-08-18"); // what UTC would say
  assert.equal(stamp(afterLocalMidnight), "2026-08-19"); // what the person means
});

test("stamp reads the local day at the other end of the day too", () => {
  // The mirror case, which is what a negative-offset timezone hits: 23:00 UTC is already tomorrow
  // in UTC+3, and the stamp must move with the person rather than with Greenwich.
  const beforeUtcMidnight = new Date("2026-08-19T23:30:00Z");
  assert.equal(beforeUtcMidnight.toISOString().slice(0, 10), "2026-08-19");
  assert.equal(stamp(beforeUtcMidnight), "2026-08-20");
});

test("stamp zero-pads month and day", () => {
  // Sorting and globbing both depend on this: `2026-1-5` sorts after `2026-12-05` as a string, and
  // `daily/2026-01-*.md` misses it entirely.
  assert.equal(stamp(new Date(2026, 0, 5, 12, 0)), "2026-01-05");
  assert.equal(stamp(new Date(2026, 11, 31, 12, 0)), "2026-12-31");
});

test("clock is local HH:MM, zero-padded", () => {
  assert.equal(clock(new Date(2026, 7, 19, 9, 5)), "09:05");
  assert.equal(clock(new Date(2026, 7, 19, 23, 59)), "23:59");
  assert.equal(clock(new Date(2026, 7, 19, 0, 0)), "00:00");
});

test("both default to now, so a caller needing today's stamp passes nothing", () => {
  const now = new Date();
  assert.equal(stamp(), stamp(now));
  assert.equal(clock(), clock(now));
});

test("both accept an explicit Date, which is what keeps callers testable", () => {
  // The reason core/memory.js takes a `date` option: every caller can be pinned to a fixed instant
  // without stubbing the global clock.
  const fixed = new Date(2026, 6, 1, 14, 30);
  assert.equal(stamp(fixed), "2026-07-01");
  assert.equal(clock(fixed), "14:30");
});
