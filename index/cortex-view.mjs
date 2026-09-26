#!/usr/bin/env node
// cortex-view.mjs — render the index as one self-contained page you can open in a browser.
//
//   node index/cortex-view.mjs .            # writes .cortex/view/repo.html and opens it
//   node index/cortex-view.mjs . --no-open  # write only
//   node index/cortex-view.mjs . --json     # the view data, for something else to render
//
// Seven tabs: Overview (vitals, the import graph as a particle cloud, next steps, timeline), Map
// (files laid out by import depth), Structure (the context layer as a tree), Files (every file with
// who imports it), Areas, Gaps (orphans, cycles, untested hot spots), Next steps (the sequence).
// No server, no CDN, no runtime — the data is inlined, so the file works offline and
// copies anywhere.
//
// Writes ONLY under .cortex/, like everything else in index/. It never touches source.

import { writeFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { execFile } from "node:child_process";
import { platform } from "node:process";
import { buildView } from "./lib/view.mjs";
import { renderHtml } from "./lib/view-html.mjs";
import { nextSteps, nextLine } from "./lib/next.mjs";
import { readEnrichment } from "./lib/enrich.mjs";
import { ensureGeneratedFileDir } from "./lib/generated.mjs";
import { generatedNotice, openTarget, indexFreshness } from "./lib/open.mjs";
import { buildOverview } from "./lib/overview.mjs";

// No index, no data. Inventing an empty page is the failure the vault's viewer actually shipped:
// pointed at a codebase it found nothing and cheerfully drew a graph with zero nodes.
const { root, rootArg, args, index, indexPath } = openTarget(process.argv.slice(2), {
  usage: "usage: node index/cortex-view.mjs [root] [--out FILE] [--index FILE] [--no-open] [--json]",
  flags: { "--no-open": "boolean", "--json": "boolean", "--index": "value", "--out": "value" },
  root: "positional",
  index: "require",
  freshness: (a) => !a.json,
});

// --json renders nothing to open, so it implies --no-open.
const wantOpen = !args.noOpen && !args.json;

// Enrichment is optional and additive — its absence changes nothing but the detail on a card. What
// it must never do is put prose on a card about a file that has moved.
//
// THE POLICY: stale enrichment is DECLINED, not marked. The page is the one Cortex artifact whose
// whole argument is that a picture beats prose, and /cortex-view's own skill says a stale picture is
// worse than no picture *because the reader trusts it*. Three things make a marker the weaker
// answer here. The page is self-contained and copies anywhere, so the reader who acts on a summary
// is often not the person who saw the warning in the terminal. And staleness is a property of the
// document while the damage is per-card — a summary still attaches wherever the path survives, and
// describes a version of that file that may not — so no legend swatch could say which cards are
// wrong.
//
// This is NOT free, and the note is honest about that: the batch results are what went out of
// date, so recovering the summaries means enriching against the current index and paying for it.
// The trade is taken anyway. Declining degrades the page to the deterministic layer, which is the
// guarantee CONTEXT.md already makes about enrichment and the direction this package always
// chooses; rendering keeps a prettier page by making it unfalsifiable.
//
// A flag to override this would be the decision not taken, so there is none.
const enrich = readEnrichment(root, index, { rootArg });
const enrichment = enrich.state === "ok" ? enrich.enrichment : null;

// The page carries the sequence, and one of its steps is "see the repo as a graph" — the page
// itself. Reading that off disk made the output depend on whether a previous run had left a file
// behind: the same index rendered different bytes twice, and the first run always showed a stale
// answer about itself. It is being written right now, so say so.
// `--json` renders nothing, so it gets the state as it actually is on disk.
const seq = nextSteps(root, index, args.json ? {} : { view: true });
// The Overview's facts: freshness, profile, memory, churn, findings, timeline. Freshness is asked
// directly rather than taken from the front door, which only computes it when it is going to print
// the stale note — and `--json` must carry the same answer the page does.
let stale = null;
try {
  stale = indexFreshness(root, indexPath).stale;
} catch {
  stale = null;
}
const overview = buildOverview(index, root, { stale, env: process.env });
const view = buildView(index, root, { enrichment, next: seq, overview });

if (args.json) {
  // A machine-readable mode gets no prose on either stream — the same rule the front door applies
  // to the stale-index note, and for the same reason: callers pipe this with `2>&1` into a parser.
  // The honest machine-readable answer to a declined enrichment is `stats.enriched: 0`, which is
  // what a null enrichment produces. Do not add a field for the distinction until a caller needs it.
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
// Absent is the ordinary case and gets the invitation it always got. Anything else is a file that
// exists and was not used, and the user is told which and why — the silent `null` this replaced
// made "never enriched" and "enriched, then damaged" the same page.
if (enrich.state === "absent") {
  console.log("  (no enrichment — run /cortex-enrich to put summaries on the file cards)");
} else if (enrich.note) {
  process.stderr.write(enrich.note);
}
console.log("");
console.log(nextLine(root, index));

if (wantOpen) {
  const [cmd, argv] =
    platform === "win32" ? ["cmd", ["/c", "start", "", out]]
    : platform === "darwin" ? ["open", [out]]
    : ["xdg-open", [out]];
  execFile(cmd, argv, () => {});
}
