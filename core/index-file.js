// index-file.js — where a repo's index lives, what shape it must be in, and whether it is stale.
//
// Every reader of `.cortex/index/index.json` asks these three questions before it answers anything,
// and two leaves read it: the `index/` CLIs, and the `graph` MCP tool (`mcp/lib/graph.js`). The
// leaves may not import each other, and "stale" in particular must have exactly one definition, so
// the answers live here. `index/lib/format.mjs` and `index/lib/open.mjs` re-export them, so a CLI
// still asks its own front door; `tools/cortex-preflight.mjs` asks `open.mjs`.
//
// The one place in this module that starts a process is `trackedFiles`: `git ls-files`, as an
// argument array. `indexFreshness` takes it as an option, so a test can hand in its own list.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The format version stamped into every `index.json` as `version`.
 *
 * Bump this when a consumer could misread an older index — a renamed field, a changed unit, a value
 * that used to mean something else. Adding a field consumers may ignore is not a bump; removing or
 * repurposing one is. `readIndex` refuses a mismatch rather than guessing, because the failure it
 * prevents is not a crash but a plausible answer computed from a shape that no longer holds.
 *
 * "2" added `clusters` and each file's `cluster`. That alone would be ignorable, but a version-1
 * index read by the viewer shows a repo with no clusters, which reads as an answer about the code
 * rather than about the index's age. Refusing it costs one deterministic rebuild.
 */
export const INDEX_VERSION = "2";

/**
 * Where an index lives inside a repository, as path segments.
 *
 * Nine files carried `join(root, ".cortex", "index", "index.json")` as a literal. They agreed, which
 * is the only state nine copies are ever in until one of them does not.
 */
export const INDEX_REL = [".cortex", "index", "index.json"];

/** The default index path for a repository root. */
export function defaultIndexPath(root) {
  return join(root, ...INDEX_REL);
}

/** The command that produces one, quoted back to the user with the root they actually typed. */
export function rebuildHint(rootArg) {
  return `node index/cortex-index.mjs ${rootArg || "."}`;
}

/**
 * Read an index file, or say exactly what is wrong with it.
 *
 * Returns `{ index }` on success and `{ problem, kind }` on failure — text, not an exception, so the
 * caller keeps ownership of its exit code and the tests can drive this from literals.
 *
 * Three failures, one shape:
 * - **absent** — there is no file there.
 * - **unreadable** — it is not JSON. Four CLIs used to hand the user a raw `SyntaxError` stack for
 *   this, which names the parser and not the file.
 * - **version** — `version` is not the one this build reads. Nothing checked that at all, so a
 *   v1 index read by a v2 consumer produced a plausible answer from a shape that no longer held.
 *   A missing `version` counts as a mismatch: it means an index older than the field itself.
 */
export function readIndex(indexPath, { rootArg = "" } = {}) {
  if (!existsSync(indexPath)) {
    return { problem: `no index at ${indexPath}\nRun: ${rebuildHint(rootArg)}\n`, kind: "absent" };
  }
  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch (e) {
    return {
      problem:
        `index at ${indexPath} is not readable JSON — ${e.message}\n` +
        `It is generated, so the fix is to write it again: ${rebuildHint(rootArg)}\n`,
      kind: "unreadable",
    };
  }
  const found = index?.version ?? null;
  if (found !== INDEX_VERSION) {
    return {
      problem:
        `index at ${indexPath} is format ${found ?? "(none)"}; this Cortex reads ${INDEX_VERSION}.\n` +
        `Reading it would produce a confident answer from a shape that no longer holds. ` +
        `Re-run: ${rebuildHint(rootArg)}\n`,
      kind: "version",
    };
  }
  return { index };
}

/** The repo's tracked files as git lists them, or null when `root` is not a git work tree. */
export function trackedFiles(root) {
  try {
    const out = execFileSync("git", ["ls-files"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Is this index older than the code it describes?
 *
 * "Re-run the index first if it is stale" is advice six rituals give and none could act on, because
 * none of them defined stale. This is the one definition. It accepts a directory as well as a file.
 *
 * mtime, not git history, because an uncommitted edit is exactly the case a pre-read check must
 * catch. The known cost: a `git checkout` or a fresh clone rewrites mtimes and reads as stale when
 * nothing changed. That error points at re-running a deterministic index — cheap and correct — while
 * the opposite error hands someone a confident map of code that moved. Prefer the cheap one.
 *
 * Only tracked files count. A `node_modules` refresh is not a reason to re-index, and treating it as
 * one trains the reader to ignore the warning.
 *
 * Returns `{ present, ageDays, stale, changedSince, reason? }`. `stale` is `null` when it cannot be
 * told (no index, or not a git repo); `changedSince` holds at most five paths.
 */
export function indexFreshness(root, target, { tracked = trackedFiles } = {}) {
  let newest = 0;
  let stat = null;
  try {
    stat = statSync(target);
  } catch {
    stat = null;
  }
  if (stat?.isDirectory()) {
    for (const name of readdirSync(target)) {
      try {
        newest = Math.max(newest, statSync(join(target, name)).mtimeMs);
      } catch { /* a file that vanished mid-walk is not a freshness signal */ }
    }
  } else if (stat) {
    newest = stat.mtimeMs;
  }
  if (!newest) return { present: false, stale: null, changedSince: [] };

  const ageDays = Math.floor((Date.now() - newest) / 86_400_000);

  const list = tracked(root);
  if (list === null) {
    return { present: true, ageDays, stale: null, changedSince: [], reason: "not a git repo — cannot tell" };
  }

  const changed = [];
  for (const rel of list) {
    if (!rel || rel.startsWith(".cortex/")) continue;
    try {
      if (statSync(join(root, rel)).mtimeMs > newest) changed.push(rel);
    } catch { /* deleted-but-tracked; a file that is gone cannot make the index stale */ }
    if (changed.length >= 5) break;
  }
  return { present: true, ageDays, stale: changed.length > 0, changedSince: changed };
}
