#!/usr/bin/env node
// cortex-view.mjs — render the index as one self-contained page you can open in a browser.
//
//   node index/cortex-view.mjs .            # writes .cortex/view/repo.html and opens it
//   node index/cortex-view.mjs . --no-open  # write only
//   node index/cortex-view.mjs . --json     # the view data, for something else to render
//
// Five tabs: Next steps (where this repo is in the sequence), Map (force graph of files and
// imports), Files (every file with who imports it), Areas, Gaps (orphans, cycles, untested hot
// spots). No server, no CDN, no runtime — the data is inlined, so the file works offline and
// copies anywhere.
//
// Writes ONLY under .cortex/, like everything else in index/. It never touches source.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute, dirname } from "node:path";
import { execFile } from "node:child_process";
import { platform } from "node:process";
import { buildView } from "./lib/view.mjs";
import { renderHtml } from "./lib/view-html.mjs";
import { nextSteps, nextLine } from "./lib/next.mjs";
import { ensureGeneratedFileDir } from "./lib/generated.mjs";

function parseArgs(argv) {
  const args = { root: null, index: null, out: null, open: true, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-open") args.open = false;
    else if (a === "--json") { args.json = true; args.open = false; }
    else if (a === "--index") args.index = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--help" || a === "-h") { args.help = true; }
    else if (!a.startsWith("--")) args.root = a;
  }
  return args;
}

// A directory appearing in someone's project on a run they did not explicitly ask for should be
// visible. ADR 0005 puts the consent gate in the skill; this is the other half — saying what
// landed, so "generated and gitignored" never quietly means "invisible".
function generatedNotice(gen) {
  const out = [];
  if (gen.created) out.push("Created .cortex/ — generated artifacts live here; .cortex/memory/ is committed on purpose.");
  if (gen.ignored.length) out.push("Added to .gitignore: " + gen.ignored.join(", "));
  return out.length ? out.join("\n") + "\n" : "";
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log("usage: node index/cortex-view.mjs [root] [--out FILE] [--index FILE] [--no-open] [--json]");
  process.exit(0);
}

const root = resolve(args.root || process.cwd());
const indexPath = args.index
  ? (isAbsolute(args.index) ? args.index : resolve(args.index))
  : join(root, ".cortex", "index", "index.json");

if (!existsSync(indexPath)) {
  console.error(`no index at ${indexPath}`);
  console.error(`Run first: node index/cortex-index.mjs ${args.root || "."}`);
  process.exit(2);
}

const index = JSON.parse(readFileSync(indexPath, "utf8"));

// Enrichment is optional and additive — its absence changes nothing but the detail on a card.
let enrichment = null;
const enrichPath = join(root, ".cortex", "index", "enrichment.json");
if (existsSync(enrichPath)) {
  try {
    enrichment = JSON.parse(readFileSync(enrichPath, "utf8"));
  } catch {
    enrichment = null;
  }
}

// The page carries the sequence, and one of its steps is "see the repo as a graph" — the page
// itself. Reading that off disk made the output depend on whether a previous run had left a file
// behind: the same index rendered different bytes twice, and the first run always showed a stale
// answer about itself. It is being written right now, so say so.
// `--json` renders nothing, so it gets the state as it actually is on disk.
const seq = nextSteps(root, index, args.json ? {} : { view: true });
const view = buildView(index, root, { enrichment, next: seq });

if (args.json) {
  console.log(JSON.stringify(view, null, 2));
  process.exit(0);
}

const out = args.out
  ? (isAbsolute(args.out) ? args.out : resolve(args.out))
  : join(root, ".cortex", "view", "repo.html");
const gen = ensureGeneratedFileDir(root, out);
writeFileSync(out, renderHtml(view), "utf8");

const g = view.gaps;
console.log(`✓ ${out}`);
process.stdout.write(generatedNotice(gen));
console.log(
  `  ${view.stats.files} files · ${view.stats.edges} import edges · ${view.areas.length} areas · ` +
    // "in cycles" and not "cycles": the index reports the FILES that sit in a strongly connected
    // component, which is what cortex-index prints too. Calling three files three cycles inflates
    // the number and makes the two tools disagree about the same repo.
    `${g.orphans.length} orphans · ${g.cyclicFiles.length} in cycles · ${g.untested.length} busiest untested`
);
if (!enrichment) console.log("  (no enrichment — run /cortex-enrich to put summaries on the file cards)");
console.log("");
console.log(nextLine(root, index));

if (args.open) {
  const [cmd, argv] =
    platform === "win32" ? ["cmd", ["/c", "start", "", out]]
    : platform === "darwin" ? ["open", [out]]
    : ["xdg-open", [out]];
  execFile(cmd, argv, () => {});
}
