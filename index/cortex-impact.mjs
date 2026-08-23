#!/usr/bin/env node
// cortex-impact.mjs — what breaks if this changes, and which of it nothing tests.
//
//   node index/cortex-impact.mjs src/lib/db.ts        # named files
//   node index/cortex-impact.mjs --staged             # what you are about to commit
//   node index/cortex-impact.mjs --since HEAD~3       # what changed over a range
//   node index/cortex-impact.mjs --staged --json      # for a ritual to walk
//
// Read-only in the strongest sense: it writes nothing, not even under .cortex/.
//
// Every count is a FLOOR. Import resolution is regex-based, so dynamic and computed imports are
// missed — the files named will be affected, and others may be. The output says "at least" for that
// reason, and no flag turns it into a total.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { impactOf, groupUnknown } from "./lib/impact.mjs";
import { UNRESOLVED_LANGUAGES } from "./lib/imports.mjs";

function parseArgs(argv) {
  const args = { root: null, paths: [], staged: false, since: null, json: false, depth: Infinity, index: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--staged") args.staged = true;
    else if (a === "--json") args.json = true;
    else if (a === "--since") args.since = argv[++i];
    else if (a === "--depth") args.depth = Number(argv[++i]);
    else if (a === "--index") args.index = argv[++i];
    else if (a === "--root") args.root = argv[++i];
    else if (!a.startsWith("--")) args.paths.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root || process.cwd());
const indexPath = args.index
  ? (isAbsolute(args.index) ? args.index : resolve(args.index))
  : join(root, ".cortex", "index", "index.json");

if (!existsSync(indexPath)) {
  console.error(`no index at ${indexPath}\nRun: node index/cortex-index.mjs ${args.root || "."}`);
  process.exit(2);
}

function git(a) {
  try {
    return execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

let changed = args.paths;
if (args.staged) {
  const out = git(["diff", "--cached", "--name-only"]) ?? "";
  // Fall back to unstaged when nothing is staged: someone mid-edit asking "what does this touch"
  // means their working tree, and an empty answer would look like "nothing depends on this".
  const wt = out.trim() ? out : (git(["diff", "--name-only"]) ?? "");
  changed = changed.concat(wt.split("\n").filter(Boolean));
}
if (args.since) {
  const out = git(["diff", "--name-only", `${args.since}...HEAD`]) ?? git(["diff", "--name-only", args.since]) ?? "";
  changed = changed.concat(out.split("\n").filter(Boolean));
}
changed = [...new Set(changed)];

if (!changed.length) {
  console.error("nothing to analyse. Pass file paths, or --staged, or --since <ref>.");
  process.exit(2);
}

const index = JSON.parse(readFileSync(indexPath, "utf8"));
const r = impactOf(index, changed, { root, maxDepth: args.depth });

if (args.json) {
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

console.log(`\nChanged (${r.changed.length}):`);
// A wide `--since` range can name hundreds of files. The blast radius is the answer; the change set
// is context, and letting it push the answer off the top of the terminal loses the point of running.
for (const c of r.changed.slice(0, 12)) console.log(`  ${c}`);
if (r.changed.length > 12) console.log(`  ... and ${r.changed.length - 12} more`);

if (r.unknown.length) {
  // Reported, never dropped. A path the index does not know contributes nothing to the walk, and
  // silently ignoring it reads as "nothing depends on this" — the most dangerous wrong answer here.
  //
  // But "never dropped" is not the same as "printed one per line". On a repo with a DeepZoom tile
  // set this section returned 2,483 entries, 2,478 of them tile PNGs, and the two staged source
  // deletions a reader genuinely had to resolve were buried under it — the terminal never even
  // reached the affected / unverified / suggested-tests sections. A section nobody can read has the
  // same effect as one that was dropped, while looking like diligence.
  //
  // So: assets are counted by directory and extension, source is still listed one per line. The
  // total is unchanged and every path stays reachable with --json.
  const groups = groupUnknown(r.unknown);
  console.log(`\nNot in the index (${r.unknown.length}) — new, ignored, or a typo:`);
  for (const u of groups.source.slice(0, 40)) console.log(`  ${u}`);
  if (groups.source.length > 40) console.log(`  ... and ${groups.source.length - 40} more source paths (--json for all)`);
  for (const a of groups.assets) {
    console.log(`  ${a.count} ${a.ext} under ${a.dir}/ — assets, never indexed`);
  }
  if (!groups.source.length && groups.assets.length) {
    console.log(`  (nothing here is source; assets are expected to be absent from the index)`);
  }
}

if (!r.affected.length) {
  // "Nothing imports this" and "I cannot read this language" are different answers, and only one
  // of them is about the repo. Pointed at a Go repo before its resolver existed, this printed the
  // first for a file the whole framework depends on.
  const byPath = new Map(index.files.map((f) => [f.path, f]));
  const blind = [...new Set(r.changed.map((c) => byPath.get(c)?.lang).filter((l) => UNRESOLVED_LANGUAGES.has(l)))];
  if (blind.length) {
    console.log(`\nCortex cannot resolve ${blind.join(", ")} imports, so it has no graph for these files.`);
    console.log(`This is not "nothing depends on them" — it is "Cortex did not look". Find the`);
    console.log(`dependents another way before treating this as a safe change.`);
    process.exit(0);
  }
  console.log(`\nNothing in the index imports these.`);
  console.log(`That is a floor, not a proof: imports are resolved by convention, so a dynamically`);
  console.log(`loaded or framework-discovered dependent would not appear here.`);
  process.exit(0);
}

console.log(`\nAt least ${r.atLeast} file${r.atLeast === 1 ? "" : "s"} affected, nearest first:\n`);
for (const a of r.affected) {
  const mark = a.isTest ? "test" : a.covered ? "  ok" : "  ??";
  console.log(`  ${mark}  d${a.depth}  ${a.path}${a.commits ? `   (${a.commits} commits)` : ""}`);
}

if (r.unverified.length) {
  console.log(`\n${r.unverified.length} of those ${r.unverified.length === 1 ? "is" : "are"} exercised by no test Cortex can see:`);
  for (const u of r.unverified) console.log(`  ${u.path}`);
  console.log(`\nThis is where a regression lands. A large blast radius that is covered is an ordinary`);
  console.log(`change; a small one that is not is the one to look at.`);
}

if (r.suggestedTests.length) {
  console.log(`\nTests worth running (${r.suggestedTests.length}):`);
  for (const t of r.suggestedTests) console.log(`  ${t}`);
}

if (r.truncated) {
  // Said out loud: a bounded walk and an exhausted one print the same shape, so a reader who forgot
  // the flag would take the smaller number for the whole radius.
  console.log(`\nStopped at depth ${args.depth}. Anything further out was not walked.`);
}

console.log(`\nA floor, not a total — imports are resolved by convention, so treat this as the`);
console.log(`smallest honest answer rather than the complete one.`);
