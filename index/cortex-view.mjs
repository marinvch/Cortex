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

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { execFile } from "node:child_process";
import { platform } from "node:process";
import { buildView } from "./lib/view.mjs";
import { renderHtml } from "./lib/view-html.mjs";
import { nextSteps, nextLine } from "./lib/next.mjs";
import { ENRICHED_REL } from "./lib/enrich.mjs";
import { ensureGeneratedFileDir } from "./lib/generated.mjs";
import { generatedNotice, openTarget } from "./lib/open.mjs";

// No index, no data. Inventing an empty page is the failure the vault's viewer actually shipped:
// pointed at a codebase it found nothing and cheerfully drew a graph with zero nodes.
const { root, args, index } = openTarget(process.argv.slice(2), {
  usage: "usage: node index/cortex-view.mjs [root] [--out FILE] [--index FILE] [--no-open] [--json]",
  flags: { "--no-open": "boolean", "--json": "boolean", "--index": "value", "--out": "value" },
  root: "positional",
  index: "require",
  freshness: (a) => !a.json,
});

// --json renders nothing to open, so it implies --no-open.
const wantOpen = !args.noOpen && !args.json;

// Enrichment is optional and additive — its absence changes nothing but the detail on a card.
let enrichment = null;
const enrichPath = join(root, ...ENRICHED_REL.split("/"));
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

if (wantOpen) {
  const [cmd, argv] =
    platform === "win32" ? ["cmd", ["/c", "start", "", out]]
    : platform === "darwin" ? ["open", [out]]
    : ["xdg-open", [out]];
  execFile(cmd, argv, () => {});
}
