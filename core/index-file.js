// index-file.js — where a repo's index lives, what shape it must be in, and whether it is stale.
//
// Every reader of `.cortex/index/index.json` asks these three questions before it answers anything,
// and two leaves read it: the `index/` CLIs, and the `graph` MCP tool (`mcp/lib/graph.js`). The
// leaves may not import each other, and "stale" in particular must have exactly one definition, so
// the answers live here. `index/lib/format.mjs` and `index/lib/open.mjs` re-export them, so a CLI
// still asks its own front door; `tools/cortex-preflight.mjs` asks `open.mjs`. The same holds for
// `enriched.json`, the layer on top, whose one reader moved here from `index/lib/enrich.mjs`.
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

// --- the enrichment layer on top -------------------------------------------------------------------

/**
 * Where a merged enrichment lives, repo-relative.
 *
 * One constant because the name was written down in four places and two of them were wrong: `merge`
 * wrote `enriched.json` while `cortex-view.mjs` and `next.mjs` both looked for `enrichment.json`.
 * A completed enrichment therefore produced no summaries on the file cards and left the sequence
 * reporting the step as never run — nothing errored, because both readers treat absence as the
 * normal optional case, which is exactly what made it survive.
 *
 * Same argument as ADR 0013 for the version: the fact has one home, and every site reads it from
 * there rather than restating it.
 */
export const ENRICHED_REL = ".cortex/index/enriched.json";

/**
 * The command that writes one, quoted back with the root the user actually typed.
 *
 * Only ever offered for a DAMAGED document, never a stale one, and the difference is not cosmetic.
 * `mergeEnrichment` stamps `indexCommit` and `coverage.indexed` from the index it is handed, so
 * merging yesterday's batch results against today's index produces a document `isStale` calls
 * fresh — carrying prose about the previous commit with every trust signal intact. Pointing a user
 * at `merge` to fix staleness would launder the exact thing `cortex-view` declines, by following
 * our own instruction. Damage is different: the batch results on disk still describe this index,
 * and only the merged artifact is broken, so re-merging is both correct and free.
 */
function remergeHint(rootArg) {
  return `node index/cortex-enrich.mjs merge ${rootArg || "."}`;
}

/**
 * Is this document the shape `mergeEnrichment` writes?
 *
 * Deliberately the two fields a consumer cannot do without — the summaries themselves, and the
 * `coverage.indexed` that staleness is measured against — and no more. The tripwire this package
 * is built around cuts both ways: validate what was produced, but only reject what is actually
 * wrong. A document carrying extra keys, or written by a later Cortex, is not this function's
 * business.
 *
 * `{}` is the case that matters. It parses, so the old inline reader accepted it, attached nothing,
 * and then skipped the "no enrichment" line because the value was truthy — a page with no summaries
 * and no explanation for it. `isStale` would also have read `.coverage.indexed` straight off it.
 */
function isEnrichmentShape(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  if (!doc.files || typeof doc.files !== "object") return false;
  return typeof doc.coverage?.indexed === "number";
}

/**
 * Why an enrichment no longer describes the index it is attached to, or `null` when it still does.
 *
 * This is `isStale` with its answer written out. There is exactly one definition of stale for the
 * enrichment layer and it is here — `isStale` is now a question asked of this function, not a
 * second copy of the same two comparisons. A caller that has to tell a human *why* it declined
 * their paid-for summaries needs the sentence, and a caller deciding whether to use them needs the
 * boolean; deriving the sentence separately would be two rules that agree until one is edited.
 */
export function stalenessReason(index, enrichment) {
  if (!enrichment) return "there is no enrichment";
  if (enrichment.indexCommit && index.commit && enrichment.indexCommit !== index.commit) {
    return `it describes commit ${String(enrichment.indexCommit).slice(0, 8)}, the index is at ${String(index.commit).slice(0, 8)}`;
  }
  const indexed = enrichment.coverage?.indexed;
  if (indexed !== index.files.length) {
    return `it was merged against ${indexed} indexed files, the index now holds ${index.files.length}`;
  }
  return null;
}

/**
 * Read the enrichment layer for a repo, and say what state it is in.
 *
 * **One reader.** `cortex-view.mjs` was the only thing that opened `enriched.json` for its content,
 * and it did it inline: `existsSync` → `JSON.parse` → `catch { enrichment = null }`. Three distinct
 * conditions — never enriched, enriched and damaged, enriched and out of date — arrived at the same
 * silent `null`, and a page rendered from a truncated file was indistinguishable from one rendered
 * for a repo that had never paid for a model pass. That is the same shape `readIndex` above exists to
 * fix for `index.json`, and this is its counterpart for the layer on top; the vocabulary is
 * deliberately `readIndex`'s, because a package with one answer to "this generated artifact is
 * unreadable" should not grow a second.
 *
 * Returns one record, always the same fields:
 * - `state`      — `absent` · `unreadable` · `invalid` · `stale` · `ok`. **`ok` is the only state in
 *                  which the document may be trusted**, which is the single check a caller needs.
 * - `enrichment` — the document, or `null`. Populated for `stale` as well as `ok`, so a caller that
 *                  decides to render stale summaries with a marker can; the policy is the caller's,
 *                  the fact is this function's.
 * - `path`       — the absolute path looked at.
 * - `note`       — one sentence for a human, or `null`. `null` for `ok` and for `absent`: **absence
 *                  is not an error**. Enrichment is optional by definition (`CONTEXT.md`), and a
 *                  reader that turned a missing file into a failure would break the guarantee that
 *                  its absence degrades Cortex to deterministic behaviour rather than stopping it.
 *
 * Pure over (what is on disk, the index): no clock, no network, no randomness, and the note names a
 * repo-relative path so the same tree produces the same sentence on any machine.
 */
export function readEnrichment(root, index, { rootArg = "" } = {}) {
  const path = join(root, ...ENRICHED_REL.split("/"));
  const base = { enrichment: null, path };

  if (!existsSync(path)) return { ...base, state: "absent", note: null };

  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return {
      ...base,
      state: "unreadable",
      // Someone paid tokens for this file and it is sitting right there. Saying "no enrichment"
      // would send them to re-run the model pass; saying it is damaged sends them to `merge`, which
      // rebuilds it from the batch results already on disk for nothing.
      note:
        `${ENRICHED_REL} is present but not readable JSON — ${e.message}\n` +
        `Summaries are left off. It is generated, so the fix is to write it again: ${remergeHint(rootArg)}\n`,
    };
  }

  if (!isEnrichmentShape(doc)) {
    return {
      ...base,
      state: "invalid",
      note:
        `${ENRICHED_REL} is JSON but not an enrichment document — it is missing 'files' or 'coverage.indexed'.\n` +
        `Summaries are left off. Re-run: ${remergeHint(rootArg)}\n`,
    };
  }

  const why = stalenessReason(index, doc);
  if (why) {
    return {
      ...base,
      enrichment: doc,
      state: "stale",
      // NOT `merge`. See remergeHint: merging the existing batch results against the current index
      // restamps them as fresh, so the one command that would make this warning go away is also the
      // one that turns stale prose into trusted prose. The batch results themselves are what went
      // out of date, so closing the gap means planning the changed files again and paying for them.
      // That is a real cost and the note says so rather than offering a cheaper thing that lies.
      note:
        `${ENRICHED_REL} does not describe this index — ${why}.\n` +
        `Its summaries are prose about files that may have moved or gone, so they are left off.\n` +
        `To restore them, enrich against the current index: /summarize-files (this costs tokens —\n` +
        `re-merging the existing batches would only restamp the old summaries as current).\n`,
    };
  }

  return { ...base, enrichment: doc, state: "ok", note: null };
}
