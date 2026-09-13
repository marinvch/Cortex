#!/usr/bin/env node
// Produce the findings report for a repository.
//
//   node index/cortex-findings.mjs [repoRoot] [--index <path>] [--out <path>] [--stdout] [--offers]
//
// Reads (or builds) the index, then writes ONE markdown report to
// <repoRoot>/.cortex/findings/<date>.md. This command has no authority to change anything else —
// that separation is what makes "the user decides" structural rather than a promise.
//
// --offers prints the ranked worklist as JSON and writes nothing at all. The report is prose for a
// human; the worklist is the script the install wizard walks. Keeping them two surfaces of one
// analysis is deliberate — a wizard forced to parse its questions back out of rendered markdown
// would drift from the findings the moment either was reworded.

import { writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { buildIndex } from "./lib/build.mjs";
import { analyse, offers, render } from "./lib/findings.mjs";
import { stamp } from "../core/date.js";
import { nextLine } from "./lib/next.mjs";
import { ensureGeneratedFileDir } from "./lib/generated.mjs";
import { generatedNotice, openTarget } from "./lib/open.mjs";

// `index: "build"` is this command's declared error mode: a repo with no stored index still gets a
// report, built in memory and never written. An index that EXISTS but cannot be read is a different
// answer — rebuilding over it would hide a file the user still has and report on something they
// never inspected — so that refuses.
const { root, args, index } = openTarget(process.argv.slice(2), {
  usage: "usage: node index/cortex-findings.mjs [root] [--index FILE] [--out FILE] [--stdout] [--offers]",
  flags: { "--index": "value", "--out": "value", "--stdout": "boolean", "--offers": "boolean" },
  root: "positional",
  index: "build",
  buildIndex,
  // --offers is JSON a wizard parses; everything else is prose for a person.
  freshness: (a) => !a.offers,
});

const day = stamp();
const findings = analyse(index, root);

if (args.offers) {
  // Writes nothing, not even the report. A wizard asking what to do must not have already done it.
  process.stdout.write(`${JSON.stringify(offers(findings), null, 2)}\n`);
  process.exit(0);
}

const report = render(index, findings, { day });

if (args.stdout) {
  process.stdout.write(report);
} else {
  const out = args.out
    ? isAbsolute(args.out) ? args.out : resolve(args.out)
    : join(root, ".cortex", "findings", `${day}.md`);
  const gen = ensureGeneratedFileDir(root, out);
  writeFileSync(out, report);
  const counts = findings.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] || 0) + 1 }), {});
  const summary = ["critical", "high", "medium", "low"]
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(", ");
  process.stdout.write(
    `${findings.length} findings${summary ? ` (${summary})` : ""}\nWrote ${out}\n${generatedNotice(gen)}`,
  );
  // The report is the wizard's script, so the reader needs to know which step it feeds next.
  process.stdout.write(`\n${nextLine(root, index)}\n`);
}
