#!/usr/bin/env node
// cortex-contract.mjs — what this repo serves, calls and emits, as JSON for a team-brain (#621).
//
//   node index/cortex-contract.mjs [root]                          # the contract on stdout
//   node index/cortex-contract.mjs [root] --out .cortex/index/contract.json
//   node index/cortex-contract.mjs [root] --project <slug>         # name it; else the connector's
//
// Deterministic: the same tree gives the same bytes, so republishing an unchanged contract is an
// empty diff. Publishing is `node mcp/ai-os.js contract publish --file <it>`, never this command:
// the index reads, and mcp/ owns the team-brain. Design: lib/contract.mjs's header, and R12 of
// docs/specs/2026-10-24-team-brain-rollout-design.md.
//
// The stored index is used when it carries `routes`; otherwise one is built in memory, as
// `cortex-routes.mjs` does. Nothing is written except `--out`, and under `.cortex/` only to a
// generated directory, which `ensureGeneratedFileDir` keeps gitignored. An empty contract is a
// valid answer: it says why in `reason`, and the exit is 0.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { buildIndex } from "./lib/build.mjs";
import { extractContract, renderContractJson } from "./lib/contract.mjs";
import { ensureGeneratedFileDir } from "./lib/generated.mjs";
import { defaultIndexPath, generatedNotice, openTarget, readIndex } from "./lib/open.mjs";
import { repoText } from "./lib/repo-text.mjs";

const usage = "usage: node index/cortex-contract.mjs [root] [--out FILE] [--project SLUG] [--index FILE]";
const { root, args } = openTarget(process.argv.slice(2), {
  usage,
  flags: { "--out": "value", "--project": "value", "--index": "value" },
  root: "positional",
  // Declared "none": a stored index without `routes` is rebuilt in memory rather than refused,
  // exactly as cortex-routes.mjs decides it.
  index: "none",
});

const indexPath = args.index ? (isAbsolute(args.index) ? args.index : resolve(args.index)) : defaultIndexPath(root);
const read = readIndex(indexPath);
if (args.index && read.problem) {
  process.stderr.write(read.problem);
  process.exit(2);
}
const index = read.index?.routes ? read.index : buildIndex(root);

/** The connector's project, when this repo is joined to a team-brain; null otherwise. */
function connectorProject() {
  const p = join(root, ".cortex", "connector.json");
  if (!existsSync(p)) return null;
  try {
    const v = JSON.parse(readFileSync(p, "utf8"))?.project;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

const text = repoText(root, { index });
const contract = extractContract(index, (rel) => text.read(rel), { project: args.project ?? connectorProject() });
const json = renderContractJson(contract);

if (!args.out) {
  process.stdout.write(json);
  process.exit(0);
}
const out = isAbsolute(args.out) ? args.out : resolve(args.out);
const gen = ensureGeneratedFileDir(root, out);
writeFileSync(out, json);
process.stderr.write(generatedNotice(gen));
const n = (k) => contract[k].length;
process.stdout.write(
  `Wrote ${out} — source ${contract.source}: ${n("serves")} served, ${n("calls")} called, ${n("events")} events` +
    (contract.reason ? `. ${contract.reason}` : "") +
    "\n",
);
