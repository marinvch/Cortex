// core/test/memory-fixture.js — the two memory layouts, written by the real writer for every
// reader's test.
//
// Every entry here goes through append() in core/memory.js (plan step 4.2), so a reader is tested
// against the bytes the writer produces, and a change to what the writer writes reaches every
// reader's test. Only the stray README files are written by hand: they are what the writer never
// makes. One module, imported by the tests of core/, index/ and mcp/, so every reader is shown the
// same files and "loses no entry" means the same thing in each: every text in ENTRIES is in the
// output.
//
// The author is passed in, and the day files are written with no CORTEX_AUTHOR and a git that has
// no name, so nothing here asks the machine who it belongs to.
//
// Not named *.test.js, so no test glob runs it. It imports nothing from node:test, so a test in any
// package can call it with a directory of its own.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { append } from "../memory.js";

/** The text of every entry in the first fixture. Unique words, so a search finds exactly one. */
export const ENTRIES = {
  dayBefore: "daybefore: moved the cache behind the gateway.",
  oldMorning: "oldmorning: split the billing module.",
  oldAfternoon: "oldafternoon: kept the retry queue.",
  devA: "authoralpha: chose the queue over the cron job.",
  devB: "authorbravo: the parser drops a trailing comma.",
};

/** The four entries of 2026-08-15, in any order. */
export const ENTRIES_OF_THE_15TH = [ENTRIES.oldMorning, ENTRIES.oldAfternoon, ENTRIES.devA, ENTRIES.devB];

/** The only entry of the second fixture. */
export const NEW_ONLY_ENTRY = "newlayoutonly: the first digest this repo ever wrote.";

/** Local time, as the writer stamps it. Months are 1-based here. */
const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm);

/** A writer with no name: no CORTEX_AUTHOR, and a git that answers nothing. It writes the day file. */
const NOBODY = { env: {}, git: () => null };

function expectLayout(result, layout) {
  if (result.layout !== layout) throw new Error(`memory fixture: expected a ${layout} write, got ${result.layout}`);
}

function writeAs(cortex, author, date, kind, text) {
  expectLayout(append(cortex, text, { date, kind, author }), "author");
}

function writeDayFile(cortex, date, kind, text) {
  expectLayout(append(cortex, text, { date, kind, ...NOBODY }), "day");
}

/**
 * Both layouts, with one date held by both. `cortex` is the `.cortex` directory; it is created.
 *
 *   memory/2026-08-14.md           a day file, one entry
 *   memory/2026-08-15.md           a day file, two entries (09:05 and 14:30)
 *   memory/2026-08-15/dev-a.md     one author's file, one entry at 10:15
 *   memory/2026-08-15/dev-b.md     another author's file, one entry at the same minute
 *   memory/README.md               a stray file, not memory
 *   memory/2026-08-15/README.md    a stray file in a day directory, not memory
 */
export function bothLayouts(cortex) {
  mkdirSync(cortex, { recursive: true });
  const memory = join(cortex, "memory");
  writeDayFile(cortex, at(2026, 8, 14, 9, 0), "note", ENTRIES.dayBefore);
  writeDayFile(cortex, at(2026, 8, 15, 9, 5), "decision", ENTRIES.oldMorning);
  writeDayFile(cortex, at(2026, 8, 15, 14, 30), "note", ENTRIES.oldAfternoon);
  writeAs(cortex, "dev-a", at(2026, 8, 15, 10, 15), "dream", ENTRIES.devA);
  writeAs(cortex, "dev-b", at(2026, 8, 15, 10, 15), "dream", ENTRIES.devB);
  writeFileSync(join(memory, "README.md"), "# About this directory\n\nstrayreadme: not a memory entry.\n");
  writeFileSync(join(memory, "2026-08-15", "README.md"), "# About this day\n\nstrayreadme: not a memory entry.\n");
  return cortex;
}

/** A repo that only ever wrote the new layout: `memory/2026-08-16/dev-a.md` and nothing else. */
export function newLayoutOnly(cortex) {
  mkdirSync(cortex, { recursive: true });
  writeAs(cortex, "dev-a", at(2026, 8, 16, 8, 30), "dream", NEW_ONLY_ENTRY);
  return cortex;
}
