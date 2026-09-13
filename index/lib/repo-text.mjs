// repo-text.mjs — the one place that reads a target repository's text after the Index exists.
//
// Three scanners used to do this themselves, each with its own unstated policy and its own
// try/catch-and-skip: the secret scan (skip `docs`, cap 400_000), the orphan mention scan
// (four categories, cap 512 * 1024) and the coverage mention scan (every test file, no cap at
// all). Three answers to one question, none of them chosen, and neither cap had a test — grep
// found both numbers only at their definitions. `build.mjs` already stated the convention this
// module applies: reading is INJECTED, so the function above it stays a pure transform of its
// inputs and is testable from literals.
//
// The three policies, decided here rather than left implicit at each call site:
//
// 1. ONE CAP, AND IT IS THE INDEX'S OWN CEILING (`MAX_INDEXED_BYTES`, 2 MB).
//    Not 400_000, not 512 * 1024 — those were two different second caps applied to a set that
//    `walk.mjs` had already bounded, so a scanner silently read LESS than the Index it was
//    scanning and nothing said so. Every file in the Index is already text under 2 MB: walk.mjs
//    drops binary extensions, anything with a NUL byte in its first 8 KB, lockfiles and
//    `.min.js`, and anything larger. One number, owned by the walker, is the whole rule.
//    What changes, and in which direction:
//      · secret scan   — now reads the 400 KB – 2 MB band it skipped. Strictly MORE scanning;
//                        a missed credential is the expensive error, a false one costs a re-read.
//      · orphan scan   — now searches the 512 KB – 2 MB band. Can only ever REMOVE orphans,
//                        which is the direction `orphans.mjs` declares it chose.
//      · coverage scan — gains a cap it never had. For an indexed test file it can never fire;
//                        if it ever does, the file reads as not mentioning anything, which is
//                        the safe direction that module already states.
//    Measured on eight cloned local repos: no indexed file anywhere sits above 400 KB except in
//    three of them, and the only observable difference in output was one repo whose 589 KB
//    `repomix-output.xml` — a generated whole-repo dump — names five orphan candidates, taking
//    that list from 8 to 3. That is a `linguist-generated` question, not a byte-cap one.
//
// 2. `docs` IS READABLE. The orphan scan was right and the secret scan's `continue` was not a
//    readability rule wearing one. A README, an ADR or a runbook naming a script is exactly how
//    repo tooling is wired, so prose must be searched — and since walk.mjs guarantees everything
//    in the Index is text, the readable set is simply "in the Index". The secret scan still skips
//    `docs`, but as a *relevance* rule with a name and a reason (below), not as a silent branch
//    inside a read loop.
//
// 3. AN UNREAD FILE IS RECORDED, NEVER SILENT. A skipped read that reaches a scanner as "no match
//    found" is the confident-wrong-answer failure `index/AGENTS.md` warns about: an unscannable
//    file looks exactly like a clean one. Every source therefore carries `unread` — sorted, with a
//    reason — and the caller that hit a CAP has to be able to say so. `findings.mjs` reports the
//    cap hits; it deliberately does not report `missing`, because an indexed path that is gone is
//    a stale Index, and `lib/open.mjs`'s `indexFreshness` already owns that question.
//
// Zero runtime dependencies (ADR 0004), no clock, no randomness: same tree, same bytes.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { MAX_INDEXED_BYTES } from "./walk.mjs";

/** The single cap. It is the Index's own ceiling — see decision 1 above. */
export const MAX_TEXT_BYTES = MAX_INDEXED_BYTES;

/**
 * Categories the secret scan does not look at.
 *
 * Prose about credentials is not a credential. Measured across five real repos, scanning `docs`
 * produced five hits and every one was an example key or a sample connection string inside a plan
 * or spec document — two repos out of five would have opened their install interview on a false
 * CRITICAL. `core/scrub.js` spends thirty lines on why that specific failure is the expensive one.
 * The cost of the rule is real and stated: a genuine key pasted into a README is invisible here.
 */
export const SECRET_SCAN_SKIPS = new Set(["docs"]);

/** Is this indexed file one the secret scan should read? */
export function scannedForSecrets(file) {
  return !SECRET_SCAN_SKIPS.has(file.category);
}

function makeSource({ available, cap, load }) {
  const unread = new Map(); // path → reason. A Map so a repeated read records one row.
  const note = (path, reason) => {
    if (!unread.has(path)) unread.set(path, reason);
    return null;
  };
  return {
    available,
    cap,
    /** textOf(path) → the file's contents, or null when it could not be read. */
    read(path) {
      return load(path, note);
    },
    /** Why a path produced null: "too-large" · "missing" · "unreadable", or null if it did not. */
    reasonFor(path) {
      return unread.get(path) ?? null;
    },
    /** Everything this source could not deliver, sorted by path so a caller stays deterministic. */
    get unread() {
      return [...unread.entries()]
        .map(([path, reason]) => ({ path, reason }))
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    /** The cap hits alone — the subset a caller is obliged to surface, since this module chose it. */
    get oversized() {
      return this.unread.filter((u) => u.reason === "too-large");
    },
  };
}

/**
 * A source reading `root` from disk.
 *
 * `index` is optional and only saves a `stat`: the Index already knows every tracked file's size.
 * A path it does not know — an untracked `AGENTS.md` the user just wrote — is measured instead.
 */
export function repoText(root, { index = null, cap = MAX_TEXT_BYTES } = {}) {
  const sizes = new Map((index?.files ?? []).map((f) => [f.path, f.bytes]));
  return makeSource({
    available: true,
    cap,
    load(path, note) {
      let bytes = sizes.get(path);
      if (typeof bytes !== "number") {
        try {
          bytes = statSync(join(root, path)).size;
        } catch {
          return note(path, "missing");
        }
      }
      if (bytes > cap) return note(path, "too-large");
      try {
        return readFileSync(join(root, path), "utf8");
      } catch {
        return note(path, "unreadable");
      }
    },
  });
}

/**
 * A source built from literals: `{ "src/a.js": "…" }`.
 *
 * A path the map does not mention reads as EMPTY rather than missing, and is not recorded. A
 * literal source is a complete statement of a repo's text by construction — the absence of a file
 * from it is the author saying "nothing here", not a failed read. That is what lets a test about
 * the Index stop materialising a temp tree just to satisfy three readers.
 */
export function textFrom(files = {}, { cap = MAX_TEXT_BYTES } = {}) {
  return makeSource({
    available: true,
    cap,
    load(path, note) {
      const text = files[path];
      if (text === undefined) return "";
      if (Buffer.byteLength(text, "utf8") > cap) return note(path, "too-large");
      return text;
    },
  });
}

/**
 * A source that has nothing to offer: every read is null and nothing is recorded.
 *
 * `buildCoverage` and `findOrphans` both accept a caller with no root — the signals that need text
 * simply switch off there. `available: false` is how they tell that apart from a source that read
 * the repo and found nothing, which is a different fact about the repo.
 */
export const NO_TEXT = makeSource({ available: false, cap: MAX_TEXT_BYTES, load: () => null });

/**
 * Coerce what a caller passed into a source.
 *
 * The CLIs and `lib/view.mjs` still pass a root string, which is the right thing for them to hold;
 * a test passes a source. This is the seam, and it is one line at each call site rather than a
 * signature change rippling through files other agents own.
 */
export function textSource(rootOrSource, opts = {}) {
  if (!rootOrSource) return NO_TEXT;
  if (typeof rootOrSource === "string") return repoText(rootOrSource, opts);
  return rootOrSource;
}
