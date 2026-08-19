#!/usr/bin/env node
// cortex-skills.mjs — which skills this repo would benefit from, from what the index detected.
//
//   node index/cortex-skills.mjs .            # human-readable proposal
//   node index/cortex-skills.mjs . --offers   # JSON worklist, for a ritual to walk
//
// Read-only in the strongest sense: it writes nothing at all, not even under .cortex/. The bodies
// are written by /cortex-skills after the user picks, because a useful body quotes this repo's real
// commands and real paths — and inventing those is precisely the failure a deterministic module
// cannot detect in itself.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { proposeSkills, partitionExisting } from "./lib/skills.mjs";
import { labelsFor } from "./lib/stack.mjs";

function parseArgs(argv) {
  const args = { root: null, offers: false, index: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--offers") args.offers = true;
    else if (a === "--index") args.index = argv[++i];
    else if (!a.startsWith("--") && args.root === null) args.root = a;
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

const index = JSON.parse(readFileSync(indexPath, "utf8"));

/** Skills the repo already has, so present ones are reported rather than silently dropped. */
function existingSkills(r) {
  const out = [];
  for (const dir of [join(r, ".claude", "skills"), join(r, ".agents", "skills")]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      try {
        if (statSync(join(dir, name)).isDirectory()) out.push(name);
      } catch { /* unreadable entry is not an existing skill */ }
    }
  }
  return [...new Set(out)];
}

const proposed = proposeSkills(index);
const { missing, present } = partitionExisting(proposed, existingSkills(root));

if (args.offers) {
  console.log(JSON.stringify({ stack: index.stack ?? null, propose: missing, alreadyPresent: present }, null, 2));
  process.exit(0);
}

const st = index.stack;
if (!st || !st.manifests?.length) {
  console.log("No dependency manifest found, so the stack is unknown and nothing stack-specific can");
  console.log("be proposed honestly. Add a package.json / pyproject.toml / go.mod, or write skills by hand.");
}

if (st) {
  const line = (label, ids) => (ids?.length ? `  ${label.padEnd(11)} ${labelsFor(ids).join(" · ")}` : null);
  const lines = [
    line("language", st.languages), line("framework", st.frameworks), line("data", st.data),
    line("services", st.services), line("tests", st.test), line("delivery", st.delivery),
  ].filter(Boolean);
  if (lines.length) {
    console.log(`\nDetected stack (${index.stats.files} files, ${index.stats.tests} test files)`);
    console.log(lines.join("\n"));
  }
}

if (!missing.length) {
  console.log(`\nNothing to propose — every skill this stack suggests is already here.`);
} else {
  console.log(`\n${missing.length} skill${missing.length === 1 ? "" : "s"} worth adding, most useful first:\n`);
  for (const p of missing) {
    console.log(`  /${p.id}  — ${p.title}`);
    console.log(`      why: ${p.why}\n`);
  }
  console.log("These are proposals. Nothing has been written. Run /cortex-skills to pick and write them.");
}

if (present.length) {
  console.log(`\nAlready present: ${present.map((p) => p.id).join(", ")}`);
}
