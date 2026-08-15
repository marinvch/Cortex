#!/usr/bin/env node
// Read and write the repo's committed memory.
//
//   node index/cortex-memory.mjs append "text" [--kind dream] [--root .cortex]
//   node index/cortex-memory.mjs recent [--days 7] [--root .cortex]
//
// A CLI rather than a module skills import: an ESM `import()` of an absolute Windows path throws
// ERR_UNSUPPORTED_ESM_URL_SCHEME, so every caller would have to remember pathToFileURL. A command
// works the same on every platform.
//
// Every append goes through the scrub gate. A refused write exits 2 and prints what kind of secret
// was found — never the secret itself.

import { resolve } from "node:path";
import { append, recent } from "../core/memory.js";

function parse(argv) {
  const args = { cmd: argv[0], text: null, kind: "note", root: ".cortex", days: 7 };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--kind") args.kind = argv[++i];
    else if (a === "--root") args.root = argv[++i];
    else if (a === "--days") args.days = Number(argv[++i]) || 7;
    else if (!a.startsWith("--") && args.text === null) args.text = a;
  }
  return args;
}

const args = parse(process.argv.slice(2));
const root = resolve(args.root);

function usage(code) {
  process.stderr.write(
    'usage: cortex-memory.mjs append "text" [--kind dream] [--root .cortex]\n' +
      "       cortex-memory.mjs recent [--days 7] [--root .cortex]\n",
  );
  process.exit(code);
}

if (args.cmd === "append") {
  if (!args.text) usage(1);
  try {
    const r = append(root, args.text, { kind: args.kind });
    process.stdout.write(`wrote ${r.path}\n`);
  } catch (e) {
    if (e.code === "refused_write") {
      const kinds = [...new Set(e.findings.map((f) => f.kind))].join(", ");
      process.stderr.write(
        `REFUSED — this entry contains ${kinds}.\n` +
          "Memory is committed, so it must not carry secrets. Nothing was written.\n" +
          "Rewrite the note without the credential, or record it somewhere private instead.\n",
      );
      process.exit(2);
    }
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
} else if (args.cmd === "recent") {
  const entries = recent(root, { days: args.days });
  if (!entries.length) {
    process.stdout.write("no memory yet\n");
  } else {
    for (const e of entries) process.stdout.write(`${e.content}\n`);
  }
} else {
  usage(args.cmd ? 1 : 0);
}
