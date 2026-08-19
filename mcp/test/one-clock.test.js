// The structural rule behind core/date.js: it is the ONLY place that reads the wall clock.
//
// This exists because `mcp/server.js` carried its own for months —
// `const today = () => new Date().toISOString().slice(0, 10)` — sitting eleven lines below an
// import of `core/memory.js`, which stamps through `core/date.js`. The two disagree for the first
// hours of every day east of Greenwich and the last hours west of it, so `capture` filed a 01:00
// thought into yesterday's daily note.
//
// Same instinct as vault-is-the-only-door.test.js: a rule a test enforces is cheaper than a rule
// everyone has to remember. That one exists because the guard was already bypassed once; this one
// exists because the helper was already re-derived once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stamp } from "../../core/date.js";

const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

// Files allowed to construct a Date. Each needs a reason, because an allowlist without reasons
// becomes a place to hide a bug. Empty today — and an empty allowlist is the strongest form of the
// rule, so add to it only for a genuine non-clock use of Date (parsing a caller's string, say),
// never for a second source of "what day is it".
const ALLOWED = new Map([
  // Date.now() as a uniqueness token, not as "what day is it". genNoteId builds
  // `<epoch36>-<pid36>-<seq36>` so two team captures in the same millisecond cannot overwrite each
  // other in an append-only store. The value is never formatted as a date and never decides a
  // filename's day — capture supplies that separately, through stamp(). A millisecond epoch is
  // also timezone-independent, so it has no local-vs-UTC question to get wrong.
  ["lib/noteid.js", "epoch as a collision-resistant id component, never as a calendar day"],
]);

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "test" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

// Reading the wall clock, or formatting a date by hand. Deliberately syntactic rather than clever:
// this must be obvious to a reader, and a false positive is a prompt to import core/date.js.
const CLOCK = /\bnew Date\s*\(\s*\)|\.toISOString\s*\(|\bDate\.now\s*\(/;

test("core/date.js is the only clock — mcp/ does not read the wall clock itself", () => {
  const offenders = [];
  for (const file of sourceFiles(MCP_DIR)) {
    const rel = relative(MCP_DIR, file).split(/[\\/]/).join("/");
    if (ALLOWED.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    src.split("\n").forEach((line, i) => {
      // Comments are prose, not calls. Without this the check flags the very comment explaining why
      // the check exists — the lesson vault-is-the-only-door.test.js already paid for.
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      if (CLOCK.test(line)) offenders.push(`${rel}:${i + 1}  ${trimmed}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `these read the wall clock outside core/date.js — import stamp()/clock() instead:\n${offenders.join("\n")}`,
  );
});

// The scan proves nobody wrote a second clock. This proves the one they must use answers the
// question `capture` actually asks — the day the person filing the note is living in.
test("the day capture files under is the local day", () => {
  process.env.TZ = "Europe/Sofia"; // UTC+3 in August
  const afterLocalMidnight = new Date("2026-08-19T01:00:00+03:00");
  assert.equal(stamp(afterLocalMidnight), "2026-08-19");
  assert.notEqual(stamp(afterLocalMidnight), afterLocalMidnight.toISOString().slice(0, 10));
});
