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

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildIndex } from "./lib/build.mjs";
import { computeBatches, batchStats } from "./lib/batch.mjs";
import { mergeEnrichment, isStale, classifyBatches, ENRICHED_REL } from "./lib/enrich.mjs";
import { ensureGeneratedDir } from "./lib/generated.mjs";

const cmd = process.argv[2];

// Every flag this command accepts, and whether it takes a separate value. ONE declaration, because
// two lists disagree and this one has already cost a bug.
//
// `rootArg` must step over a valued flag's argument or it promotes it to the repo root, and a flag
// added later without being registered here recreates that exactly. So the table is also the
// allowlist: an unrecognised flag is refused rather than reinterpreted. That is what catches the
// shapes nobody enumerated — `-include` (one dash, a typo of the flag this file exists to support)
// used to be read as the ROOT, writing `.cortex/` into `<cwd>/-include`, leaving the named repo
// untouched, and silently getting an empty include scope because `listFlag("--include")` matched
// nothing. Nothing errored: `buildIndex` on a directory that does not exist returns zero files.
const FLAGS = new Map([
  ["--include", true],
  ["--exclude", true],
]);
const flagName = (a) => a.split("=")[0];

// The repo root is the first bare argument after the subcommand, wherever it sits — not
// `process.argv[3]`. That positional read meant a flag written before the root ate it:
// `plan --include src <repo>` left argv[3] as `--include` and fell back to `process.cwd()`.
//
// Anything starting with a single `-` is a flag, not a path. The sibling CLIs test `--` only; here
// that let `-v` through as a repo root and produced a directory literally named `-v`.
function rootArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-")) return a;
    // `--include=src` carries its value inline, so the next argument is not part of it.
    if (!a.includes("=") && FLAGS.get(flagName(a))) i++;
  }
  return null;
}

const argv = process.argv.slice(3);
const unknown = argv.filter((a) => a.startsWith("-") && !FLAGS.has(flagName(a)));
if (unknown.length) {
  process.stderr.write(
    `unknown flag: ${unknown.join(", ")}\n` +
      `usage: cortex-enrich.mjs ${cmd ?? "plan|status|merge"} [repoRoot] [--include a,b] [--exclude c]\n`,
  );
  process.exit(1);
}

const root = resolve(rootArg(argv) ?? process.cwd());

// Assert the property, not the one symptom we found. A root that is not a readable directory can
// arrive by a mangled flag, a typo in the path, or a shape nobody has thought of yet — and the
// damage is the same every time: `buildIndex` returns zero files rather than throwing, so the run
// reports "Planned 0 batches" and exits 0. A confident empty answer is the defect; the argument
// that produced it is only one route to it.
let rootStat = null;
try {
  rootStat = statSync(root);
} catch {
  /* reported below */
}
if (!rootStat?.isDirectory()) {
  process.stderr.write(
    `not a directory: ${root}\n` +
      "Nothing was written. Pass the repository root, or run from inside it with no path argument.\n",
  );
  process.exit(1);
}

// --include / --exclude take comma-separated path prefixes, and repeat. The skill has always said
// to offer a subset on a large repo; with no flag to express it, the only way to obey was to skip
// batchIndex values by hand — which left `status` reporting a large pending set and nothing to say
// the skipping was a decision.
function listFlag(name) {
  const out = [];
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) out.push(...String(argv[++i] ?? "").split(","));
    else if (argv[i].startsWith(`${name}=`)) out.push(...argv[i].slice(name.length + 1).split(","));
  }
  return out.map((s) => s.trim()).filter(Boolean);
}
const scope = { include: listFlag("--include"), exclude: listFlag("--exclude") };
const dir = join(root, ".cortex", "index");
const batchDir = join(dir, "enrich");
const indexPath = join(dir, "index.json");
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
function generatedNotice() {
  const out = [];
  if (created.created) out.push("Created .cortex/ — generated artifacts live here; .cortex/memory/ is committed on purpose.");
  if (created.ignored.length) out.push("Added to .gitignore: " + created.ignored.join(", "));
  return out.length ? out.join("\n") + "\n" : "";
}

function loadIndex() {
  if (existsSync(indexPath)) return JSON.parse(readFileSync(indexPath, "utf8"));
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
      generatedNotice(),
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
  process.stdout.write(`Enriched ${enriched}/${indexed} indexed files\nWrote ${enrichedPath}\n${generatedNotice()}`);
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
