#!/usr/bin/env node
// Build the deterministic index for a repository.
//
//   node index/cortex-index.mjs [repoRoot] [--out <path>] [--json]
//
// Writes <repoRoot>/.cortex/index/index.json unless --out says otherwise. No LLM, no network:
// the same tree always produces the same file, so this is safe to run in CI and on every install.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { buildIndex } from "./lib/build.mjs";

function parseArgs(argv) {
  const args = { root: null, out: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--json") args.json = true;
    else if (!a.startsWith("--") && args.root === null) args.root = a;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root || process.cwd());
const out = args.out ? (isAbsolute(args.out) ? args.out : resolve(args.out)) : join(root, ".cortex", "index", "index.json");

const started = Date.now();
const index = buildIndex(root);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(index, null, 2));

if (args.json) {
  process.stdout.write(`${JSON.stringify(index.stats, null, 2)}\n`);
} else {
  const s = index.stats;
  const top = Object.entries(s.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  process.stdout.write(
    `Indexed ${s.files} files (${s.lines.toLocaleString()} lines), ${s.edges} imports, ${s.tests} tests\n` +
      `Languages: ${top}\n` +
      `Areas: ${index.areas.length}\n` +
      // Areas are directories; layers come from the import graph. Both are printed because a reader
      // shown only one will assume it is the other — which is exactly what the old field name did.
      `Layers: ${index.layers.length} (depth 0 = foundation)` +
      (index.cycles.length ? `, ${index.cycles.length} files in import cycles` : "") +
      `\n` +
      `Wrote ${out} in ${Date.now() - started}ms\n`,
  );
}
