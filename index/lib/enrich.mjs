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

export const ROLES = new Set([
  "entrypoint", "core-logic", "adapter", "config", "test", "docs",
  "infrastructure", "types", "utility", "generated",
]);

const MAX_SUMMARY = 400;

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

  const rows = Array.isArray(result) ? result : Array.isArray(result?.files) ? result.files : null;
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
 * Attach enrichment onto an index, in memory. Unenriched files are simply left as they are — the
 * caller must never assume every file has a summary.
 */
export function applyEnrichment(index, enrichment) {
  if (!enrichment?.files) return index;
  return {
    ...index,
    files: index.files.map((f) => {
      const e = enrichment.files[f.path];
      return e ? { ...f, summary: e.summary, role: e.role, tags: e.tags } : f;
    }),
  };
}

/**
 * True when an enrichment no longer describes the index it is attached to. Reported rather than
 * enforced: a slightly stale enrichment is still useful, a silently stale one is not.
 */
export function isStale(index, enrichment) {
  if (!enrichment) return true;
  if (enrichment.indexCommit && index.commit && enrichment.indexCommit !== index.commit) return true;
  return enrichment.coverage.indexed !== index.files.length;
}
