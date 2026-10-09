import { appendFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveInRoot } from "./paths.js";
import { assertWritable } from "./scrub.js";
import { stamp, clock } from "./date.js";

// Cortex's memory lives in <repo>/.cortex/memory/ and is COMMITTED, so every developer and every
// agent working in the repo shares one context that travels with the code. Git is the sync
// mechanism — no server, no second repo, no protocol.
//
// Every file is dated and append-only. Two developers writing on the same day append to the same
// file and git resolves it as an ordinary text merge; nobody mutates a shared document in place,
// so there is no lost-update case to reason about.

export const MEMORY_DIR = "memory";

// Re-exported so existing callers keep working, but core/date.js owns the definition — one
// spelling of a date format across memory files, findings reports and digests.
export { stamp } from "./date.js";

function ensureDir(root) {
  const dir = resolveInRoot(root, MEMORY_DIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// The layout is this module's to own, and it used to be owned by a doc comment. `root` means the
// .cortex directory; pass a repo root — the reading the word invites — and the write landed in
// <repo>/memory/, reported the path it had written, and exited 0. Nothing reads there, and
// generated.mjs ignores only .cortex/index|findings|view, so it was not even gitignored: a
// confident wrong output rather than a failure. Refuse and name what was passed, the way the
// shell clock in ADR 0012 chose a named failure over a plausible wrong value.
// Split on both separators so it stays correct on Windows, as mcp/lib/mode.js learned to.
function assertCortexRoot(root) {
  const last = String(root ?? "").split(/[\\/]/).filter(Boolean).pop();
  if (last === ".cortex") return;
  throw Object.assign(
    new Error(`refusing to write memory: root must be the .cortex directory, got ${root}`),
    { code: "not_cortex_root", root },
  );
}

/**
 * Append one entry to today's memory file.
 * `root` is the .cortex directory. Refuses the write when the text carries a secret.
 */
export function append(root, text, { date = new Date(), kind = "note" } = {}) {
  const body = String(text ?? "").trim();
  if (!body) throw Object.assign(new Error("refusing to write an empty memory entry"), { code: "empty" });

  // Throws RefusedWriteError, before anything touches disk. This covers every caller of `append()`
  // and nothing beyond it — a write that publishes without entering memory is gated where it is
  // declared, not here. See CONTEXT.md, "The gate": the pair is the guarantee, and reading this
  // call as the whole of it is what kept the other half missing.
  assertWritable(body);
  assertCortexRoot(root); // throws not_cortex_root — before anything touches disk

  ensureDir(root);
  const day = stamp(date);
  const file = resolveInRoot(root, join(MEMORY_DIR, `${day}.md`));
  const isNew = !existsSync(file);
  const time = clock(date);

  let out = "";
  if (isNew) out += `# ${day}\n\n`;
  out += `## ${time} · ${kind}\n\n${body}\n\n`;
  appendFileSync(file, out, "utf8");

  return { path: file, day, created: isNew };
}

// --- reading -------------------------------------------------------------------------------------
//
// Readers accept two layouts, and this is the only place that knows either:
//
//   memory/<date>.md             a day file — every author's entries in one file, no author named
//   memory/<date>/<author>.md    one file per author per day
//
// Both can hold the same date, and then both are read: each file is its own row, and no row replaces
// another. Anything else in the directory is not memory and is skipped, as a stray README always was.
// The three patterns cannot overlap. A day file ends in `.md` and a day directory does not; an author
// slug holds no `.`, `/` or `\`, so a file in a day directory can neither read as a date nor leave it.
// docs/specs/2026-10-09-team-memory-design.md, "Layout".
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const DAY_DIR = /^\d{4}-\d{2}-\d{2}$/;
const AUTHOR_FILE = /^([a-z0-9][a-z0-9-]{0,39})\.md$/;

function entriesOf(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Newest day first. Within a day the day file, then authors by slug. Compared by code unit and never
// by locale, so the order depends on the names alone: the same on every machine, whatever order the
// file system returned them in and whatever order the branches that added them were merged in.
function byDayThenAuthor(a, b) {
  if (a.day !== b.day) return a.day < b.day ? 1 : -1;
  if (a.author === b.author) return 0;
  if (a.author === null) return -1;
  if (b.author === null) return 1;
  return a.author < b.author ? -1 : 1;
}

/**
 * Every memory file, one row each: `{ day, author, path }`. Newest day first; within a day the day
 * file, then one file per author by slug.
 *
 * `author` is the slug in the file's path, or `null` for a day file. It is never read from the
 * file's heading: the path is what git merges on, and a heading is text anyone can edit.
 */
export function list(root) {
  let dir;
  try {
    dir = resolveInRoot(root, MEMORY_DIR);
  } catch {
    return [];
  }
  const rows = [];
  for (const e of entriesOf(dir)) {
    if (e.isDirectory()) {
      if (!DAY_DIR.test(e.name)) continue;
      const dayDir = join(dir, e.name);
      for (const f of entriesOf(dayDir)) {
        const m = f.isDirectory() ? null : AUTHOR_FILE.exec(f.name);
        if (m) rows.push({ day: e.name, author: m[1], path: join(dayDir, f.name) });
      }
      continue;
    }
    const m = DAY_FILE.exec(e.name);
    if (m) rows.push({ day: m[1], author: null, path: join(dir, e.name) });
  }
  return rows.sort(byDayThenAuthor);
}

/**
 * Read back the most recent `days` days, newest first: every file of each, with its `content`.
 * `days` counts days, not files — a day with five authors is one day.
 */
export function recent(root, { days = 7 } = {}) {
  const kept = new Set();
  const rows = [];
  for (const e of list(root)) {
    if (!kept.has(e.day)) {
      if (!(kept.size < days)) break;
      kept.add(e.day);
    }
    rows.push(e);
  }
  return rows.map((e) => {
    try {
      return { ...e, content: readFileSync(e.path, "utf8") };
    } catch {
      return { ...e, content: "" };
    }
  });
}
