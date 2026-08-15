#!/usr/bin/env node
// Produce the findings report for a repository.
//
//   node index/cortex-findings.mjs [repoRoot] [--index <path>] [--out <path>] [--stdout]
//
// Reads (or builds) the index, then writes ONE markdown report to
// <repoRoot>/.cortex/findings/<date>.md. This command has no authority to change anything else —
// that separation is what makes "the user decides" structural rather than a promise.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { buildIndex } from "./lib/build.mjs";
import { analyse, render } from "./lib/findings.mjs";
import { stamp } from "../core/date.js";

function parseArgs(argv) {
  const args = { root: null, index: null, out: null, stdout: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--index") args.index = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--stdout") args.stdout = true;
    else if (!a.startsWith("--") && args.root === null) args.root = a;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root || process.cwd());
const indexPath = args.index
  ? isAbsolute(args.index) ? args.index : resolve(args.index)
  : join(root, ".cortex", "index", "index.json");

let index;
if (existsSync(indexPath)) {
  index = JSON.parse(readFileSync(indexPath, "utf8"));
} else {
  index = buildIndex(root);
}

const day = stamp();
const findings = analyse(index, root);
const report = render(index, findings, { day });

if (args.stdout) {
  process.stdout.write(report);
} else {
  const out = args.out
    ? isAbsolute(args.out) ? args.out : resolve(args.out)
    : join(root, ".cortex", "findings", `${day}.md`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, report);
  const counts = findings.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] || 0) + 1 }), {});
  const summary = ["critical", "high", "medium", "low"]
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(", ");
  process.stdout.write(`${findings.length} findings${summary ? ` (${summary})` : ""}\nWrote ${out}\n`);
}
