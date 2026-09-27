#!/usr/bin/env node
// Produce the findings report for a repository.
//
//   node index/cortex-findings.mjs [repoRoot] [--index <path>] [--out <path>] [--stdout] [--offers] [--json]
//
// Reads (or builds) the index, then writes ONE markdown report to
// <repoRoot>/.cortex/findings/<date>.md. This command has no authority to change anything else —
// that separation is what makes "the user decides" structural rather than a promise.
//
// --offers prints the ranked worklist as JSON and writes nothing at all. The report is prose for a
// human; the worklist is the script the install wizard walks. Keeping them two surfaces of one
// analysis is deliberate — a wizard forced to parse its questions back out of rendered markdown
// would drift from the findings the moment either was reworded.
//
// --json prints every finding — kind, severity, title, detail, evidence — and also writes nothing.
// The worklist drops what has no offer (every `claude-setup/*` finding among them) and the report
// drops `kind`, so a program asking "which findings, of which kind" had no surface to read short of
// importing index/lib, which is what tools/ must not do.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  usage: "usage: node index/cortex-findings.mjs [root] [--index FILE] [--out FILE] [--stdout] [--offers] [--json]",
  flags: { "--index": "value", "--out": "value", "--stdout": "boolean", "--offers": "boolean", "--json": "boolean" },
  root: "positional",
  index: "build",
  buildIndex,
  // --offers and --json are JSON a program parses; everything else is prose for a person.
  freshness: (a) => !a.offers && !a.json,
});

const day = stamp();
const findings = analyse(index, root);

if (args.offers) {
  // Writes nothing, not even the report. A wizard asking what to do must not have already done it.
  process.stdout.write(`${JSON.stringify(offers(findings), null, 2)}\n`);
  process.exit(0);
}

if (args.json) {
  process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
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
  // One report per date is the naming rule, so a second run the same day overwrites the first. That
  // used to happen in silence, and running findings before an install and again after it is the
  // natural way to see what the install changed — the "before" vanished without a word. Keep the
  // rule; say when it cost something. An identical report replaced nothing worth mentioning.
  const earlier = existsSync(out) ? readFileSync(out, "utf8") : null;
  const replaced = earlier !== null && earlier !== report;
  writeFileSync(out, report);
  const counts = findings.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] || 0) + 1 }), {});
  const summary = ["critical", "high", "medium", "low"]
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(", ");
  process.stdout.write(
    `${findings.length} findings${summary ? ` (${summary})` : ""}\nWrote ${out}\n${generatedNotice(gen)}`,
  );
  if (replaced) {
    process.stdout.write(
      `Replaced today's earlier report at that path, which differed from this one and is not kept. ` +
        `To keep both next time, write one elsewhere with --out <file>.\n`,
    );
  }
  // The report is the wizard's script, so the reader needs to know which step it feeds next.
  process.stdout.write(`\n${nextLine(root, index)}\n`);
}
