// core/test/memory-fixture.js — the two memory layouts, built by hand for every reader's test.
//
// Nothing writes `<date>/<author>.md` yet (plan step 4.2), so the readers' tests build it here. One
// module, imported by the tests of core/, index/ and mcp/, so every reader is shown the same files
// and "loses no entry" means the same thing in each: every text in ENTRIES is in the output.
//
// Not named *.test.js, so no test glob runs it. It imports nothing from node:test, so a test in any
// package can call it with a directory of its own.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

function put(file, text) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
}

/**
 * Both layouts, with one date held by both. `cortex` is the `.cortex` directory; it is created.
 *
 *   memory/2026-08-14.md           old layout, one entry
 *   memory/2026-08-15.md           old layout, two entries (09:05 and 14:30)
 *   memory/2026-08-15/dev-a.md     new layout, one entry at 10:15
 *   memory/2026-08-15/dev-b.md     new layout, one entry at the same minute
 *   memory/README.md               a stray file, not memory
 *   memory/2026-08-15/README.md    a stray file in a day directory, not memory
 */
export function bothLayouts(cortex) {
  const memory = join(cortex, "memory");
  put(join(memory, "2026-08-14.md"), `# 2026-08-14\n\n## 09:00 · note\n\n${ENTRIES.dayBefore}\n\n`);
  put(
    join(memory, "2026-08-15.md"),
    `# 2026-08-15\n\n## 09:05 · decision\n\n${ENTRIES.oldMorning}\n\n## 14:30 · note\n\n${ENTRIES.oldAfternoon}\n\n`,
  );
  put(join(memory, "2026-08-15", "dev-a.md"), `# 2026-08-15 · dev-a\n\n## 10:15 · dream\n\n${ENTRIES.devA}\n\n`);
  put(join(memory, "2026-08-15", "dev-b.md"), `# 2026-08-15 · dev-b\n\n## 10:15 · dream\n\n${ENTRIES.devB}\n\n`);
  put(join(memory, "README.md"), "# About this directory\n\nstrayreadme: not a memory entry.\n");
  put(join(memory, "2026-08-15", "README.md"), "# About this day\n\nstrayreadme: not a memory entry.\n");
  return cortex;
}

/** A repo that only ever wrote the new layout: `memory/2026-08-16/dev-a.md` and nothing else. */
export function newLayoutOnly(cortex) {
  put(
    join(cortex, "memory", "2026-08-16", "dev-a.md"),
    `# 2026-08-16 · dev-a\n\n## 08:30 · dream\n\n${NEW_ONLY_ENTRY}\n\n`,
  );
  return cortex;
}
