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

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildIndex } from "./lib/build.mjs";
import { computeBatches, batchStats } from "./lib/batch.mjs";
import { mergeEnrichment, isStale } from "./lib/enrich.mjs";

const cmd = process.argv[2];
const root = resolve(process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : process.cwd());
const dir = join(root, ".cortex", "index");
const batchDir = join(dir, "enrich");
const indexPath = join(dir, "index.json");
const batchesPath = join(dir, "batches.json");
const enrichedPath = join(dir, "enriched.json");

function loadIndex() {
  if (existsSync(indexPath)) return JSON.parse(readFileSync(indexPath, "utf8"));
  const idx = buildIndex(root);
  mkdirSync(dir, { recursive: true });
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

function doneBatches() {
  if (!existsSync(batchDir)) return new Set();
  return new Set(
    readdirSync(batchDir)
      .map((n) => n.match(/^batch-(\d+)\.json$/))
      .filter(Boolean)
      .map((m) => Number(m[1])),
  );
}

if (cmd === "plan") {
  const index = loadIndex();
  const batches = computeBatches(index);
  mkdirSync(batchDir, { recursive: true });
  writeFileSync(batchesPath, JSON.stringify({ indexCommit: index.commit ?? null, batches }, null, 2));
  const s = batchStats(batches);
  process.stdout.write(
    `Planned ${s.batches} batches covering ${s.files} files (${s.lines.toLocaleString()} lines)\n` +
      `Wrote ${batchesPath}\n` +
      `Write each result to ${join(batchDir, "batch-<n>.json")}\n`,
  );
} else if (cmd === "status") {
  const { batches } = loadBatches();
  const done = doneBatches();
  const pending = batches.filter((b) => !done.has(b.batchIndex));
  process.stdout.write(`${done.size}/${batches.length} batches complete\n`);
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
  mkdirSync(dir, { recursive: true });
  writeFileSync(enrichedPath, JSON.stringify(enrichment, null, 2));

  const { enriched, indexed } = enrichment.coverage;
  process.stdout.write(`Enriched ${enriched}/${indexed} indexed files\nWrote ${enrichedPath}\n`);
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
