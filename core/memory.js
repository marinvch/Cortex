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

/** Every memory file, newest first. */
export function list(root) {
  let dir;
  try {
    dir = resolveInRoot(root, MEMORY_DIR);
  } catch {
    return [];
  }
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
    .sort()
    .reverse()
    .map((n) => ({ day: n.replace(/\.md$/, ""), path: join(dir, n) }));
}

/** Read back the most recent `days` memory files, newest first. */
export function recent(root, { days = 7 } = {}) {
  return list(root)
    .slice(0, days)
    .map((e) => {
      try {
        return { ...e, content: readFileSync(e.path, "utf8") };
      } catch {
        return { ...e, content: "" };
      }
    });
}
