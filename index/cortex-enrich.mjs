#!/usr/bin/env node
// Drive the enrichment pass.
//
//   node index/cortex-enrich.mjs plan   [repoRoot]   → write .cortex/index/batches.json, list work
//   node index/cortex-enrich.mjs status [repoRoot]   → which batches are done, which remain
//   node index/cortex-enrich.mjs merge  [repoRoot]   → validate + merge into enriched.json
//
// The agent's job sits between `plan` and `merge`: for each pending batch it writes
// .cortex/index/enrich/batch-<n>.json. Everything deterministic — what to summarise, in what
// grouping, and whether the result is acceptable — lives in code, so an interrupted run resumes
// by simply re-running `plan` and doing what `status` still lists as pending.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildIndex } from "./lib/build.mjs";
import { computeBatches, batchStats } from "./lib/batch.mjs";
import { mergeEnrichment, isStale, classifyBatches, ENRICHED_REL } from "./lib/enrich.mjs";
import { ensureGeneratedDir } from "./lib/generated.mjs";
import { defaultIndexPath, generatedNotice, openTarget, readIndex, staleNote } from "./lib/open.mjs";

const cmd = process.argv[2];

// The flag allowlist that was invented here is now lib/open.mjs's, and every sibling inherits it.
// What stays local is the SUBCOMMAND: `plan`, `status` and `merge` want different things, and only
// two of them read an index at all — `status` answers entirely from batches.json, so loading one
// eagerly would invent a requirement that was never there. Hence `index: "none"` and the explicit
// `loadIndex()` below, which routes through the shared reader for the one error mode.
const { root, rootArg, args } = openTarget(process.argv.slice(3), {
  usage: `usage: cortex-enrich.mjs ${cmd ?? "plan|status|merge"} [repoRoot] [--include a,b] [--exclude c]`,
  flags: { "--include": "list", "--exclude": "list" },
  root: "positional",
  index: "none",
});

// --include / --exclude take comma-separated path prefixes, and repeat. The skill has always said
// to offer a subset on a large repo; with no flag to express it, the only way to obey was to skip
// batchIndex values by hand — which left `status` reporting a large pending set and nothing to say
// the skipping was a decision.
const scope = { include: args.include, exclude: args.exclude };
const dir = join(root, ".cortex", "index");
const batchDir = join(dir, "enrich");
const indexPath = defaultIndexPath(root);
const batchesPath = join(dir, "batches.json");
const enrichedPath = join(root, ...ENRICHED_REL.split("/"));

// ADR 0016: a guarantee attaches to the ACT, not to the skill that performs it. `/cortex-enrich
// plan` is listed there among the entry points that create `.cortex/`, and it was the only one of
// the four that never ignored or announced what it wrote — `cortex-index`, `cortex-findings` and
// `cortex-view` all route through `generated.mjs`. So every directory this file creates goes
// through the same call, and what it did is reported rather than left to be found in `git status`.
const created = { created: false, ignored: [] };
function generated(subdir) {
  const g = ensureGeneratedDir(root, subdir);
  created.created = created.created || g.created;
  for (const i of g.ignored) if (!created.ignored.includes(i)) created.ignored.push(i);
}

// A model is about to summarise whatever this returns, so what it reads has to be the repo as it is
// now. An index that exists but cannot be read — bad JSON, or a format this build does not speak —
// is refused rather than rebuilt over: silently replacing a file the user still has would answer
// from something they never inspected. A stale one is a note, not a refusal, because the work is
// resumable and telling them is what lets them decide.
function loadIndex() {
  if (existsSync(indexPath)) {
    const read = readIndex(indexPath, { rootArg });
    if (read.problem) {
      process.stderr.write(read.problem);
      process.exit(2);
    }
    const note = staleNote(root, indexPath, { rootArg });
    if (note) process.stderr.write(note);
    return read.index;
  }
  const idx = buildIndex(root);
  generated(dir);
  writeFileSync(indexPath, JSON.stringify(idx, null, 2));
  return idx;
}

function loadBatches() {
  if (!existsSync(batchesPath)) {
    process.stderr.write("no batches.json — run `cortex-enrich.mjs plan` first\n");
    process.exit(1);
  }
  return JSON.parse(readFileSync(batchesPath, "utf8"));
}

function readBatchResult(n) {
  const p = join(batchDir, `batch-${n}.json`);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

if (cmd === "plan") {
  const index = loadIndex();
  const batches = computeBatches(index, scope);
  generated(batchDir);
  // The scope is recorded, not just applied. `status` reads it back, so a deliberately partial run
  // is distinguishable from an interrupted one — otherwise the next agent sees pending batches and
  // has no way to know that skipping them was a decision someone already made.
  writeFileSync(
    batchesPath,
    JSON.stringify({ indexCommit: index.commit ?? null, scope, batches }, null, 2),
  );
  const s = batchStats(batches);
  const vendored = index.stats?.vendored;
  process.stdout.write(
    `Planned ${s.batches} batches covering ${s.files} files (${s.lines.toLocaleString()} lines)\n` +
      (scope.include.length ? `Included: ${scope.include.join(", ")}\n` : "") +
      (scope.exclude.length ? `Excluded: ${scope.exclude.join(", ")}\n` : "") +
      // Naming what was left out is the point. A cost estimate that silently omits half a repo
      // reads exactly like one that covers it.
      (vendored?.files
        ? `Skipped ${vendored.files} vendored files (${vendored.lines.toLocaleString()} lines) declared in .gitattributes\n`
        : "") +
      `Wrote ${batchesPath}\n` +
      `Write each result to ${join(batchDir, "batch-<n>.json")}\n` +
      generatedNotice(created),
  );
} else if (cmd === "status") {
  const { batches, scope: planned } = loadBatches();
  const { done, stale, pending } = classifyBatches(batches, readBatchResult);
  process.stdout.write(`${done.length}/${batches.length} batches complete\n`);
  // Stale is its own state, listed before pending and named batch by batch. Folding it into either
  // of the others is the bug: counted as done it is skipped, counted as pending it looks like fresh
  // work when there is a wrong answer already on disk waiting to be merged.
  if (stale.length) {
    process.stdout.write(
      `\n${stale.length} batch result${stale.length === 1 ? "" : "s"} answer a different plan — redo or delete:\n`,
    );
    for (const s of stale.slice(0, 40)) {
      process.stdout.write(`  batch ${s.batch.batchIndex} — ${s.batch.layer}: ${s.why}\n`);
    }
    if (stale.length > 40) process.stdout.write(`  … and ${stale.length - 40} more\n`);
    process.stdout.write("\n");
  }
  // Say what the plan was scoped to. Pending batches under a narrowed plan mean "still to do";
  // material outside it was never planned, and a reader must be able to tell those apart.
  if (planned?.include?.length) process.stdout.write(`planned only for: ${planned.include.join(", ")}\n`);
  if (planned?.exclude?.length) process.stdout.write(`deliberately excluded: ${planned.exclude.join(", ")}\n`);
  if (pending.length) {
    process.stdout.write("pending:\n");
    for (const b of pending.slice(0, 40)) {
      process.stdout.write(`  batch ${b.batchIndex} — ${b.layer} (${b.files.length} files)\n`);
    }
    if (pending.length > 40) process.stdout.write(`  … and ${pending.length - 40} more\n`);
  }
} else if (cmd === "merge") {
  const index = loadIndex();
  const { batches } = loadBatches();
  const results = [];
  const missing = [];
  for (const batch of batches) {
    const p = join(batchDir, `batch-${batch.batchIndex}.json`);
    if (!existsSync(p)) {
      missing.push(batch.batchIndex);
      continue;
    }
    let result;
    try {
      result = JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {
      process.stderr.write(`batch ${batch.batchIndex}: invalid JSON — ${e.message}\n`);
      continue;
    }
    results.push({ batch, result });
  }

  const enrichment = mergeEnrichment(index, results);
  generated(dir);
  writeFileSync(enrichedPath, JSON.stringify(enrichment, null, 2));

  const { enriched, indexed } = enrichment.coverage;
  process.stdout.write(`Enriched ${enriched}/${indexed} indexed files\nWrote ${enrichedPath}\n${generatedNotice(created)}`);
  if (missing.length) {
    process.stdout.write(`${missing.length} batches had no result: ${missing.slice(0, 20).join(", ")}\n`);
  }
  if (enrichment.issues.length) {
    // Never silent: a dropped summary is a thing the user should know about.
    process.stdout.write(`\n${enrichment.issues.length} issues:\n`);
    for (const i of enrichment.issues.slice(0, 30)) process.stdout.write(`  - ${i}\n`);
    if (enrichment.issues.length > 30) process.stdout.write(`  … and ${enrichment.issues.length - 30} more\n`);
  }
  if (isStale(index, enrichment)) {
    process.stdout.write("\nNote: enrichment does not fully cover the current index — re-plan to close the gap.\n");
  }
} else {
  process.stderr.write("usage: cortex-enrich.mjs plan|status|merge [repoRoot]\n");
  process.exit(cmd ? 1 : 0);
}
