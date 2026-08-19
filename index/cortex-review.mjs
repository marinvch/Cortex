#!/usr/bin/env node
// cortex-review.mjs — which of this repo's own documents govern a change, and which the change
// just made wrong.
//
//   node index/cortex-review.mjs --staged
//   node index/cortex-review.mjs --since HEAD~3
//   node index/cortex-review.mjs src/lib/db.ts --json
//
// Read-only in the strongest sense: it writes nothing, not even under .cortex/.
//
// It finds and cites. It never judges — deciding whether a change actually violates a documented
// rule needs a model, and that is `/cortex-review`'s job rather than this file's.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { reviewContext } from "./lib/review.mjs";

function parseArgs(argv) {
  const args = { root: null, paths: [], staged: false, since: null, json: false, index: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--staged") args.staged = true;
    else if (a === "--json") args.json = true;
    else if (a === "--since") args.since = argv[++i];
    else if (a === "--index") args.index = argv[++i];
    else if (a === "--root") args.root = argv[++i];
    else if (!a.startsWith("--")) args.paths.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root || process.cwd());
const indexPath = args.index
  ? isAbsolute(args.index)
    ? args.index
    : resolve(args.index)
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
  const wt = out.trim() ? out : (git(["diff", "--name-only"]) ?? "");
  changed = changed.concat(wt.split("\n").filter(Boolean));
}
if (args.since) {
  const out =
    git(["diff", "--name-only", `${args.since}...HEAD`]) ?? git(["diff", "--name-only", args.since]) ?? "";
  changed = changed.concat(out.split("\n").filter(Boolean));
}
changed = [...new Set(changed)];

if (!changed.length) {
  console.error("nothing to review. Pass file paths, or --staged, or --since <ref>.");
  process.exit(2);
}

const index = JSON.parse(readFileSync(indexPath, "utf8"));
const readText = (p) => {
  try {
    return readFileSync(join(root, p), "utf8");
  } catch {
    return null;
  }
};
const r = reviewContext(index, changed, { readText });

if (args.json) {
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

if (!r.hasContextLayer) {
  // The honest answer, and an actionable one: there is nothing to review against yet.
  console.log(`\nThis repo has no context layer — no AGENTS.md, CONTEXT.md or ADRs.`);
  console.log(`There is nothing to review the change against. Run /cortex-install to add one.`);
  process.exit(0);
}

console.log(`\nChanged (${r.changed.length}):`);
for (const c of r.changed.slice(0, 12)) console.log(`  ${c}`);
if (r.changed.length > 12) console.log(`  ... and ${r.changed.length - 12} more`);

if (r.unknown.length) {
  console.log(`\nNot in the index (${r.unknown.length}) — new, ignored, or a typo:`);
  for (const u of r.unknown) console.log(`  ${u}`);
}

console.log(`\nDocuments governing this change, nearest scope first:\n`);
for (const b of r.briefs) {
  console.log(`  ${b.path}`);
  console.log(`      scope: ${b.scope} · covers ${b.covers.length} changed file${b.covers.length === 1 ? "" : "s"}`);
}
if (!r.briefs.length) console.log(`  (none — no AGENTS.md sits at or above these files)`);

if (r.glossary.length) {
  console.log(`\nGlossary terms this change is working in:`);
  console.log(`  ${r.glossary.join(" · ")}`);
}

if (r.stale.length) {
  console.log(`\nDocuments that NAME something this change touched — re-read these:\n`);
  for (const s of r.stale) {
    console.log(`  ${s.path}  (${s.total} mention${s.total === 1 ? "" : "s"})`);
    for (const m of s.mentions.slice(0, 4)) console.log(`      :${m.line}  ${m.text}`);
    if (s.total > s.mentions.slice(0, 4).length) console.log(`      ...`);
  }
  console.log(`\nA mention is not a defect — it is where one would hide. This repo has shipped`);
  console.log(`"Coverage uses two signals" while it used three, and a pointer to mcp/lib/scrub.js`);
  console.log(`months after scrub moved to core/. Neither broke a test; both misled the next reader.`);
} else {
  console.log(`\nNo context document names any of these files.`);
  console.log(`That is not proof the docs are still right — only that none of them says the file's`);
  console.log(`name. A rule described in prose, without naming a path, is invisible here.`);
}
