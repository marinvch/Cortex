import { appendFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveInRoot } from "./paths.js";
import { assertWritable } from "./scrub.js";
import { stamp, clock } from "./date.js";
import { authorSlug, resolveAuthor, InvalidAuthorError } from "./author.js";

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

// Who is writing. An `author` option is a name the caller chose, so one that gives no slug is
// refused the way an unusable CORTEX_AUTHOR is. With no option the writer asks for itself, in the
// repository that holds this .cortex: a caller that had to pass the author is a caller that forgets,
// and its entries would land in the day file with nobody noticing (ADR 0016).
function authorOf(root, { author, env, git }) {
  if (author !== undefined && author !== null) {
    const slug = authorSlug(author);
    if (slug === null) throw new InvalidAuthorError("the author option");
    return { slug };
  }
  return resolveAuthor({ env, cwd: dirname(resolve(root)), git });
}

// Said on every write that falls back, never once per repo or once per day. A developer whose name
// gives no slug keeps writing the day file, and the day file is the one that conflicts.
function dayFileNotice(day, why) {
  return (
    `memory: this entry went to the shared day file ${day}.md, because ${why}. ` +
    "Two branches that each write that file on one day conflict when they merge. " +
    "Set CORTEX_AUTHOR to a short handle (for example dev-a) to write one file per author."
  );
}

/**
 * Append one entry to today's memory: `memory/<day>/<author>.md`, one file per author per day.
 * `root` is the .cortex directory. Refuses the write when the text carries a secret.
 *
 * The author is the `author` option when given, otherwise CORTEX_AUTHOR, otherwise git `user.name`
 * (core/author.js). Only its slug is written. With no usable name the entry goes to the day file
 * `memory/<day>.md` and the result says so: `layout: "day"`, with a `notice` to show the person.
 * `env` and `git` are passed to `resolveAuthor`, so a test reads no machine identity.
 *
 * Returns `{ path, day, created, author, layout: "author" | "day" }`, and `notice` on a day write.
 * Throws `empty`, `refused_write`, `not_cortex_root` or `invalid_author`, each before anything
 * touches the disk.
 */
export function append(root, text, { date = new Date(), kind = "note", author, env = process.env, git } = {}) {
  const body = String(text ?? "").trim();
  if (!body) throw Object.assign(new Error("refusing to write an empty memory entry"), { code: "empty" });

  // Throws RefusedWriteError, before anything touches disk. This covers every caller of `append()`
  // and nothing beyond it — a write that publishes without entering memory is gated where it is
  // declared, not here. See CONTEXT.md, "The gate": the pair is the guarantee, and reading this
  // call as the whole of it is what kept the other half missing.
  //
  // It is also before the author is asked for and before any path is computed. A refused write
  // leaves no file and no day directory behind, and core/test/memory.test.js compares the whole
  // tree to say so.
  assertWritable(body);
  assertCortexRoot(root); // throws not_cortex_root — before anything touches disk

  // Resolves the root first, so a .cortex that does not exist throws here and is never created:
  // the consent gate. Nothing is made yet.
  const memoryDir = resolveInRoot(root, MEMORY_DIR);

  const who = authorOf(root, { author, env, git }); // throws invalid_author — nothing is written
  const day = stamp(date);
  const layout = who.slug === null ? "day" : "author";
  const rel = layout === "author" ? join(MEMORY_DIR, day, `${who.slug}.md`) : join(MEMORY_DIR, `${day}.md`);
  const file = resolveInRoot(root, rel);

  // memory/, and the day directory when there is one. Both sit inside a .cortex that exists.
  mkdirSync(layout === "author" ? dirname(file) : memoryDir, { recursive: true });

  const isNew = !existsSync(file);
  const time = clock(date);

  let out = "";
  if (isNew) out += layout === "author" ? `# ${day} · ${who.slug}\n\n` : `# ${day}\n\n`;
  out += `## ${time} · ${kind}\n\n${body}\n\n`;
  appendFileSync(file, out, "utf8");

  const result = { path: file, day, created: isNew, author: who.slug, layout };
  if (layout === "day") result.notice = dayFileNotice(day, who.why);
  return result;
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
