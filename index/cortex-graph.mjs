#!/usr/bin/env node
// cortex-graph.mjs — the graph report: hubs, bridges, cycles and untested clusters.
//
//   node index/cortex-graph.mjs [root]          # the report, for a person
//   node index/cortex-graph.mjs [root] --json   # the same report as JSON
//
// Read-only in the strongest sense: it writes nothing, not even under .cortex/. It reads the stored
// index and refuses without one, because hubs and bridges are read off clusters, and a report
// built from an index nobody looked at is the confident wrong answer `lib/open.mjs` exists to stop.
//
// Every number here is a floor. Import resolution is regex-based, so a dynamic import is missing
// from the graph: a link count can be higher, and an untested cluster may be run by a test the
// index cannot see. The rules are in `lib/graph-report.mjs`.

import { codeCoverage } from "./lib/findings.mjs";
import { graphReport, TOP } from "./lib/graph-report.mjs";
import { openTarget } from "./lib/open.mjs";
import { textSource } from "./lib/repo-text.mjs";

const { root, args, index } = openTarget(process.argv.slice(2), {
  usage: "usage: node index/cortex-graph.mjs [root] [--index FILE] [--json]",
  flags: { "--json": "boolean", "--index": "value" },
  root: "positional",
  index: "require",
  freshness: (a) => !a.json,
});

const coverage = codeCoverage(index, textSource(root, { index }));
const report = graphReport(index, { coverage });

if (args.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m";
const tty = process.stdout.isTTY;
const b = (s) => (tty ? B + s + R : s);
const dim = (s) => (tty ? D + s + R : s);
const out = [];
const say = (s = "") => out.push(s);

say(b(`Graph report — ${root}`));
say(
  dim(
    `${report.clusters} cluster${report.clusters === 1 ? "" : "s"}, ${report.unclustered} code file${report.unclustered === 1 ? "" : "s"} in none. ` +
      "Every count is a floor: a dynamic import is invisible to the index.",
  ),
);
say();

if (!report.clusters) {
  say("No clusters: no two files here import each other, so there are no hubs or bridges to report.");
  say();
}

say(b(`Hubs — most linked, tests and fixtures left out${report.hubs.length ? "" : ": none"}`));
for (const h of report.hubs) {
  say(`  ${h.path}  ${dim(`${h.links} links, imported by ${h.inbound}, ${h.cluster ?? "no cluster"}`)}`);
  if (h.twins.length) say(dim(`      and ${h.twins.length} file${h.twins.length === 1 ? "" : "s"} with the same links: ${h.twins.join(", ")}`));
}
say();

say(b(`Bridges — imports between clusters, most unexpected first${report.bridgeCount ? "" : ": none"}`));
if (report.bridgeCount > report.bridges.length) say(dim(`  ${report.bridges.length} of ${report.bridgeCount}, one row per importing file; --json has the scores.`));
for (const br of report.bridges) {
  say(`  ${br.from} -> ${br.to}  ${dim(`score ${br.score}, ${br.between} import${br.between === 1 ? "" : "s"} between ${br.fromCluster} and ${br.toCluster}`)}`);
  for (const r of br.reasons) say(dim(`      ${r}`));
  if (br.alsoFrom) say(dim(`      ${br.from} has ${br.alsoFrom} more bridge${br.alsoFrom === 1 ? "" : "s"} below this one`));
}
say();

say(b(`Cycles — shortest loop first${report.cycles.length ? "" : ": none"}`));
for (const c of report.cycles.slice(0, TOP)) {
  const extra = c.files.length > c.loop.length ? dim(`  (${c.files.length} files in this group)`) : "";
  say(`  ${[...c.loop, c.loop[0]].join(" -> ")}${extra}`);
}
if (report.cycles.length > TOP) say(dim(`  and ${report.cycles.length - TOP} more; --json lists every one.`));
if (report.testCycles) {
  const n = report.testCycles;
  say(dim(`  Not listed: ${n} cycle${n === 1 ? "" : "s"} among tests, fixtures and test helpers only.`));
}
say();

const u = report.untestedClusters;
say(b(`Clusters with no test found${u.length ? "" : ": none"}`));
for (const c of u) {
  say(`  ${c.id}  ${c.hub}  ${dim(c.testable === 1 ? "1 file needs a test, none found" : `${c.testable} files need a test, none found`)}`);
}
if (u.length) say(dim("  Coverage reads three signals (name, import, quoted mention); a test that reaches a file another way is missed."));

process.stdout.write(out.join("\n") + "\n");
