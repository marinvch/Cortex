#!/usr/bin/env node
// cortex-review.mjs — which of this repo's own documents govern a change, and which the change
// just made wrong.
//
//   node index/cortex-review.mjs --staged
//   node index/cortex-review.mjs --since HEAD~3
//   node index/cortex-review.mjs src/lib/db.ts --json
//   node index/cortex-review.mjs --citations
//   node index/cortex-review.mjs --citations --since HEAD~20
//
// Read-only in the strongest sense: it writes nothing, not even under .cortex/.
//
// It finds and cites. It never judges — deciding whether a change actually violates a documented
// rule needs a model, and that is `/cortex-review`'s job rather than this file's.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { reviewContext, citationDrift } from "./lib/review.mjs";
import { changedFiles, failureLines, gitReader } from "./lib/changed.mjs";
import { rootProblem } from "./lib/root.mjs";

function parseArgs(argv) {
  const args = { root: null, paths: [], staged: false, since: null, json: false, index: null, citations: false, fix: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--staged") args.staged = true;
    else if (a === "--citations") args.citations = true;
    else if (a === "--fix") args.fix = true;
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

// A root that is not a directory produces a confident empty answer, not an error: buildIndex
// returns zero files rather than throwing. Refuse instead — the route in (a mangled flag, a typo,
// a stale path in a script) does not matter, the output does.
const rootIssue = rootProblem(root);
if (rootIssue) {
  process.stderr.write(rootIssue);
  process.exit(1);
}
const indexPath = args.index
  ? isAbsolute(args.index)
    ? args.index
    : resolve(args.index)
  : join(root, ".cortex", "index", "index.json");

if (!existsSync(indexPath)) {
  console.error(`no index at ${indexPath}\nRun: node index/cortex-index.mjs ${args.root || "."}`);
  process.exit(2);
}

// The rename log below and the change set share one runner, so they share one buffer size. The
// maxBuffer fix lived here and not in cortex-impact.mjs for exactly as long as there were two
// copies of this code — see lib/changed.mjs.
const run = gitReader(root);
const git = (a) => run(a).out ?? null;

const { files: changed, failures } = changedFiles(root, {
  paths: args.paths,
  staged: args.staged,
  since: args.since,
  git: run,
});

for (const line of failureLines(failures)) console.error(line);

if (!changed.length && !args.citations) {
  console.error(
    failures.length
      // Deliberately not "there is nothing to review": that is the sentence for a clean branch, and
      // a reader scanning output must not have to parse a clause to tell the two apart.
      ? "The change set could not be read, so nothing was reviewed. This is git failing, not a branch with no changes."
      : "nothing to review. Pass file paths, or --staged, or --since <ref>.",
  );
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
if (args.citations) {
  // Where a deleted path went, from git's own rename record. Deterministic: history is append-only.
  //
  // Read once, without a pathspec. Limiting `git log` by the OLD path returns nothing — history
  // simplification prunes the commit before --diff-filter sees it, and --follow only works forwards
  // from a path that still exists. Neither is available here: the whole premise is that the cited
  // path is gone. So take every rename git recorded and look the citation up.
  let renames = null;
  const renameMap = () => {
    if (renames) return renames;
    renames = new Map();
    const out = git(["log", "-M", "--diff-filter=R", "--name-status", "--format="]) ?? "";
    // Newest first, so the first record for a source is its latest destination.
    for (const line of out.split("\n")) {
      const m = line.match(/^R\d*\t(.+)\t(.+)$/);
      if (m && !renames.has(m[1])) renames.set(m[1], m[2]);
    }
    return renames;
  };
  const findRename = (cited) => {
    // A file moved twice (a → b → c) leaves two records. Follow the chain, or the answer is a
    // path that is also gone — which proves nothing and correctly stays `suspected`.
    const map = renameMap();
    const seen = new Set();
    let cur = cited;
    while (map.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = map.get(cur);
    }
    return cur === cited ? null : cur;
  };
  const c = citationDrift(index, { readText, findRename });

  // --since narrows to citations this range could have broken: only docs or paths it touched. This
  // was a THIRD copy of the same fallback chain, in the same file as one of the other two.
  if (args.since) {
    const touched = new Set(changedFiles(root, { since: args.since, git: run }).files);
    c.findings = c.findings.filter((f) => touched.has(f.doc) || touched.has(f.cited) || touched.has(f.suggestion));
    c.counts = { provable: 0, suspected: 0, historical: 0 };
    for (const f of c.findings) c.counts[f.class]++;
  }

  if (args.fix) {
    // A patch, not a write. index/ may not modify a target repo outside .cortex/, and this file
    // promises in its header that it writes nothing at all — so the heal is proposed in the one
    // form a human can read, reject, and apply in a single command.
    const provable = c.findings.filter((f) => f.class === "provable");
    if (!provable.length) {
      console.log(`\nNothing to fix — no citation has a destination git can prove.`);
      process.exit(0);
    }
    const byDoc = new Map();
    for (const f of provable) {
      if (!byDoc.has(f.doc)) byDoc.set(f.doc, []);
      byDoc.get(f.doc).push(f);
    }
    let patch = "";
    for (const [doc, group] of [...byDoc].sort((a, b) => a[0].localeCompare(b[0]))) {
      const lines = (readText(doc) ?? "").split("\n");
      patch += `--- a/${doc}\n+++ b/${doc}\n`;
      for (const f of group.sort((a, b) => a.line - b.line)) {
        const old = lines[f.line - 1];
        // Replace only the cited token, never the surrounding prose.
        const next = old.split(f.cited).join(f.suggestion);
        patch += `@@ -${f.line},1 +${f.line},1 @@\n-${old}\n+${next}\n`;
      }
    }
    process.stdout.write(patch);
    process.exit(0);
  }

  if (args.json) {
    console.log(JSON.stringify(c, null, 2));
    process.exit(c.counts.provable ? 1 : 0);
  }
  if (!c.hasContextLayer) {
    console.log(`\nThis repo has no context layer — no AGENTS.md, CONTEXT.md or ADRs.`);
    console.log(`There is nothing whose citations could be checked. Run /cortex-install to add one.`);
    process.exit(0);
  }
  if (!c.findings.length) {
    console.log(`\nNo unresolved citations. Every path these documents name still exists.`);
    console.log(`That is not proof they are RIGHT — a claim made in prose, naming no path, is`);
    console.log(`invisible here. This checks pointers, not sentences.`);
    process.exit(0);
  }
  for (const cls of ["provable", "suspected", "historical"]) {
    const group = c.findings.filter((f) => f.class === cls);
    if (!group.length) continue;
    console.log(`\n${cls} (${group.length}):\n`);
    for (const f of group) {
      console.log(`  ${f.doc}:${f.line}  cites ${f.cited}`);
      console.log(`      ${f.text}`);
      if (f.suggestion) console.log(`      git says it moved to: ${f.suggestion}`);
    }
  }
  console.log(`\nOnly "provable" fails this check — git recorded where those files went.`);
  console.log(`"suspected" needs a human; "historical" is an ADR or a stated absence and is correct.`);
  process.exit(c.counts.provable ? 1 : 0);
}

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
