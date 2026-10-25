// symbol-cache.mjs — the per-file cache of symbol extractions, and the line the index prints.
//
// `.cortex/index/symbols/<sha256>.json` beside the index, one file per extraction. The key is
// `cacheKey` (lib/symbols.mjs): the file's text, its grammar, the parser lock's digest and the
// extractor's version. A file whose text is unchanged is not parsed again, and a new lock or a new
// extractor misses every entry rather than reusing one made by other code.
//
// The rules this module keeps:
//
//   - **A cache entry can only save time, never change the answer.** An entry that does not parse,
//     or does not have the shape `extractFile` returns, is ignored and the file is parsed again, so
//     a cold build and a warm one write the same bytes.
//   - **It lives in the generated directory and nowhere else.** The caller hands in the directory;
//     `cortex-index.mjs` puts it beside the index it writes. The directory is created on the first
//     write, so a repo indexed without the add-on gains nothing.
//   - **`prune` deletes the entries this run did not use**, and only `<64 hex>.json` names inside the
//     directory, so the cache cannot outgrow the repo it describes and cannot delete anything else.

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ENTRY = /^[0-9a-f]{64}\.json$/;

const looksExtracted = (v) =>
  v && Array.isArray(v.defs) && Array.isArray(v.exports) && Array.isArray(v.imports) && Array.isArray(v.reexports) && Array.isArray(v.bound) && Array.isArray(v.calls);

/** A disk cache in `dir`: `{ get(key), set(key, value), prune(), stats }`. */
export function symbolCache(dir) {
  const used = new Set();
  const stats = { hits: 0, misses: 0 };
  let made = false;
  return {
    stats,
    get(key) {
      used.add(key);
      try {
        const v = JSON.parse(readFileSync(join(dir, `${key}.json`), "utf8"));
        if (looksExtracted(v)) {
          stats.hits += 1;
          return v;
        }
      } catch {
        // absent or unreadable: parse the file again
      }
      stats.misses += 1;
      return null;
    },
    set(key, value) {
      used.add(key);
      try {
        if (!made) mkdirSync(dir, { recursive: true });
        made = true;
        const tmp = join(dir, `${key}.${process.pid}.tmp`);
        writeFileSync(tmp, JSON.stringify(value));
        renameSync(tmp, join(dir, `${key}.json`));
      } catch {
        // A cache that cannot be written costs time on the next run, nothing else.
      }
    },
    prune() {
      let names = [];
      try {
        names = readdirSync(dir);
      } catch {
        return 0;
      }
      let removed = 0;
      for (const name of names) {
        if (!ENTRY.test(name) || used.has(name.slice(0, -5))) continue;
        try {
          rmSync(join(dir, name), { force: true });
          removed += 1;
        } catch {
          // left for the next run
        }
      }
      return removed;
    },
  };
}

/** One line for the index's summary: how much the add-on read and how sure its calls are. */
export function symbolsLine(symbols) {
  const by = { extracted: 0, inferred: 0, ambiguous: 0 };
  for (const c of symbols.calls) by[c.confidence] += 1;
  return (
    `Symbols: ${symbols.definitions.length} definitions in ${symbols.files} files, ${symbols.calls.length} calls ` +
    `(${by.extracted} extracted, ${by.inferred} inferred, ${by.ambiguous} ambiguous), ` +
    `${symbols.unresolved.total} not resolved — ${symbols.parser}`
  );
}
