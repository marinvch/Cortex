// Validate and merge the enrichment an agent produced.
//
// Everything here exists because a model wrote the input. Enrichment is prose about files, and the
// failure mode is not a crash — it is a confident summary of a file that does not exist, or a
// batch quietly dropping half its files. Both are caught here rather than discovered later by
// someone reading a wrong description of their own code.
//
// Enrichment is ADDITIVE. The deterministic index stays the source of truth for structure; this
// only attaches summaries, tags and roles. A missing or stale enrichment degrades Cortex to the
// deterministic behaviour, never breaks it.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROLES = new Set([
  "entrypoint", "core-logic", "adapter", "config", "test", "docs",
  "infrastructure", "types", "utility", "generated",
]);

const MAX_SUMMARY = 400;

/**
 * The file entries in a batch result, or null when the shape is not one Cortex accepts.
 *
 * The skill documents a bare array. A model that also echoes the batch number back — writing
 * `{ "batchIndex": 2, "files": [...] }` — has still answered the question, so `merge` has always
 * taken both. `classifyBatches` took only the array, and `status` therefore reported a complete,
 * correct object-form batch as "answers a different plan — redo or delete" while `merge` on the
 * very same file enriched every one of its files without a single issue.
 *
 * That is the tripwire in reverse: only drop what is actually wrong, and a wrapped array is not
 * wrong — merge already ruled on it. `status` is what an agent reads to decide what work is left,
 * so the disagreement costs a re-run of an expensive model pass, or the deletion of correct output.
 * One reader, so the two can no longer disagree **about the shape of a result**.
 *
 * They can still disagree about its CONTENT, and that part is deliberate rather than left over.
 * A real, indexed path arriving against a renumbered batch is kept by `validateBatch`'s rebatched
 * branch below and counted as `foreign` by `classifyBatches`, so `status` lists the batch as stale
 * while `merge` absorbs the work. The two are answering different questions — "does this file
 * answer the plan I am holding" and "is this summary true of a file that exists" — and index/
 * AGENTS.md records the residue as cosmetic. Do not reconcile it here by teaching one reader the
 * other's rule; that is how status came to condemn work merge accepts.
 */
export function batchRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.files)) return result.files;
  return null;
}

/**
 * Check one batch result against the batch that was requested.
 * Returns { entries, issues } — issues are strings; entries are the survivors.
 */
export function validateBatch(batch, result, indexedPaths = null) {
  const issues = [];
  const entries = [];
  const expected = new Set(batch.files.map((f) => f.path));
  const seen = new Set();
  // Batch indexes are positional: adding or removing a layer renumbers every batch after it, so
  // files written under an earlier layout arrive against a batch that never asked for them. With
  // the index in hand we can tell that apart from a hallucination and keep the work; without it we
  // fall back to the strict positional check.
  const rebatched = indexedPaths !== null;

  const rows = batchRows(result);
  if (!rows) {
    return { entries: [], issues: [`batch ${batch.batchIndex}: expected an array of file entries`] };
  }

  for (const row of rows) {
    const path = typeof row?.path === "string" ? row.path : null;
    if (!path) {
      issues.push(`batch ${batch.batchIndex}: an entry has no path`);
      continue;
    }
    // The single most important check: a summary for a file that does not exist is a hallucinated
    // path and may never reach the index.
    if (!expected.has(path)) {
      if (!rebatched) {
        issues.push(`batch ${batch.batchIndex}: '${path}' was not in this batch — dropped`);
        continue;
      }
      if (!indexedPaths.has(path)) {
        issues.push(`batch ${batch.batchIndex}: '${path}' is not in the index — dropped`);
        continue;
      }
      // Real, indexed, just filed under a number that has since moved. Keep it and say so: a
      // human reading the merge output should see that the layout shifted underneath them.
      issues.push(`batch ${batch.batchIndex}: '${path}' belongs to another batch now — kept`);
    }
    if (seen.has(path)) {
      issues.push(`batch ${batch.batchIndex}: '${path}' appears twice — kept the first`);
      continue;
    }
    const summary = typeof row.summary === "string" ? row.summary.trim() : "";
    if (!summary) {
      issues.push(`batch ${batch.batchIndex}: '${path}' has no summary — dropped`);
      continue;
    }
    let role = typeof row.role === "string" ? row.role.trim().toLowerCase() : "";
    if (role && !ROLES.has(role)) {
      issues.push(`batch ${batch.batchIndex}: '${path}' has unknown role '${role}' — cleared`);
      role = "";
    }
    const tags = Array.isArray(row.tags)
      ? [...new Set(row.tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim().toLowerCase()))].slice(0, 8)
      : [];

    seen.add(path);
    entries.push({
      path,
      summary: summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY - 1)}…` : summary,
      role: role || undefined,
      tags,
    });
  }

  // Coverage is only a per-batch property while the numbering is stable. Once a re-plan can move
  // files between batches, a gap here says nothing — another renumbered file almost certainly
  // carries the path. mergeEnrichment reports real coverage across the whole set.
  if (!rebatched) {
    for (const p of expected) {
      if (!seen.has(p)) issues.push(`batch ${batch.batchIndex}: '${p}' was not covered`);
    }
  }

  return { entries, issues };
}

/**
 * Merge validated batch results into an enrichment document, keyed by path.
 * `results` is a list of { batch, result } pairs.
 */
export function mergeEnrichment(index, results) {
  const files = {};
  const issues = [];
  const indexed = new Set(index.files.map((f) => f.path));

  for (const { batch, result } of results) {
    // Passing the index lets validateBatch distinguish a renumbered batch from a hallucinated
    // path, so a re-plan no longer throws away work that is entirely correct.
    const { entries, issues: batchIssues } = validateBatch(batch, result, indexed);
    issues.push(...batchIssues);
    for (const e of entries) files[e.path] = e;
  }

  // Coverage is checked here, across every batch at once — the only place it means anything once
  // a file can legitimately arrive from a differently-numbered batch.
  const requested = new Set();
  for (const { batch } of results) for (const f of batch.files) requested.add(f.path);
  for (const p of requested) {
    if (!files[p]) issues.push(`'${p}' was not covered by any batch`);
  }
  for (const p of Object.keys(files)) {
    if (!indexed.has(p)) {
      // Belt and braces: a path can be in a stale batch but gone from the current index.
      issues.push(`'${p}' is not in the index — dropped`);
      delete files[p];
    }
  }

  const covered = Object.keys(files).length;
  return {
    version: "1",
    indexCommit: index.commit ?? null,
    coverage: { enriched: covered, indexed: indexed.size },
    files,
    issues,
  };
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
 * True when an enrichment no longer describes the index it is attached to. Reported rather than
 * enforced: a slightly stale enrichment is still useful, a silently stale one is not.
 */
export function isStale(index, enrichment) {
  return stalenessReason(index, enrichment) !== null;
}

/**
 * Sort a plan's batches into done, stale and pending — by reading each result, never by trusting a
 * filename.
 *
 * `batch-<n>.json` records which batch it answered only by its number, and the numbering belongs to
 * the plan. Re-plan after the repo has moved and the same filename is a complete, careful answer to
 * a batch that no longer exists: on this repo, eight days of commits left 33 of 39 result files
 * answering different batches while `status` — which counted filenames — reported all 39 complete.
 *
 * `merge` already validates and reports, but `status` is what an agent reads to decide what work is
 * left, so an agent following the skill would have skipped every one of those batches and merged
 * the stale summaries. A stale answer is worse than a missing one: it is prose about the wrong file,
 * and it reads as authoritative.
 *
 * The test is exact set equality against the batch's own file list. A result that also answers paths
 * this batch does not contain answered a different question, whatever its coverage looks like.
 *
 * `read(batchIndex)` returns the raw file contents, or null when there is none — passed in so this
 * stays a pure function over the plan rather than a second place that knows the directory layout.
 */
export function classifyBatches(batches, read) {
  const done = [];
  const stale = [];
  const pending = [];
  for (const batch of batches) {
    const raw = read(batch.batchIndex);
    if (raw === null || raw === undefined) {
      pending.push(batch);
      continue;
    }
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      stale.push({ batch, why: "invalid JSON" });
      continue;
    }
    // The same shape reader `validateBatch` uses. Two copies of "what does a batch result look
    // like" is how status came to condemn work merge accepted.
    const rows = batchRows(result);
    if (!rows) {
      stale.push({ batch, why: "not an array of entries" });
      continue;
    }
    const want = new Set(batch.files.map((f) => f.path));
    const got = new Set(rows.map((r) => r && r.path).filter(Boolean));
    const unanswered = [...want].filter((p) => !got.has(p)).length;
    const foreign = [...got].filter((p) => !want.has(p)).length;
    if (!unanswered && !foreign) {
      done.push(batch);
      continue;
    }
    const parts = [];
    if (unanswered) parts.push(`${unanswered} of ${want.size} files unanswered`);
    if (foreign) parts.push(`${foreign} path${foreign === 1 ? "" : "s"} this batch does not contain`);
    stale.push({ batch, why: parts.join(", ") });
  }
  return { done, stale, pending };
}

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
 * Read the enrichment layer for a repo, and say what state it is in.
 *
 * **One reader.** `cortex-view.mjs` was the only thing that opened `enriched.json` for its content,
 * and it did it inline: `existsSync` → `JSON.parse` → `catch { enrichment = null }`. Three distinct
 * conditions — never enriched, enriched and damaged, enriched and out of date — arrived at the same
 * silent `null`, and a page rendered from a truncated file was indistinguishable from one rendered
 * for a repo that had never paid for a model pass. That is the same shape `lib/open.mjs` exists to
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
        `To restore them, enrich against the current index: /cortex-enrich (this costs tokens —\n` +
        `re-merging the existing batches would only restamp the old summaries as current).\n`,
    };
  }

  return { ...base, enrichment: doc, state: "ok", note: null };
}
