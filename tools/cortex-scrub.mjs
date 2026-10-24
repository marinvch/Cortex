#!/usr/bin/env node
// cortex-scrub.mjs — run the publish gate over text a shell script is about to send or push.
//
//   node tools/cortex-scrub.mjs --check < file      # stdin
//   node tools/cortex-scrub.mjs --check file
//
// The gate is core/gate.js, the same call `remember` and every publishing MCP tool make: a credential,
// the employer denylist when the profile refuses employer material (home), and personal data under
// CORTEX_PII. A shell script cannot import it, and reimplementing it in bash would be a fourth copy
// of the firewall, so this is the door the shell half uses. tools/server/cortex-cron.sh is the first
// caller: it scrubs the diff before it goes to the API and the digest before it is pushed.
//
// Exit codes:
//   0   clean, or personal data in `warn` mode (the warning goes to stderr)
//   2   refused — stderr names each KIND and its line, never the text
//   1   it could not run: a bad argument, an unreadable file, an unknown CORTEX_PROFILE or CORTEX_PII
//
// It writes nothing, and it never prints what it found. A scrubber that echoed the secret to a cron
// log would be the leak with an extra step.

import { readFileSync } from "node:fs";
import { assertPublished } from "../core/gate.js";
import { resolveProfile } from "../core/profile.js";
import { RefusedWriteError } from "../core/scrub.js";

const USAGE = "usage: cortex-scrub.mjs --check [file]   (reads stdin when no file is named)";

const args = process.argv.slice(2);
if (args[0] !== "--check" || args.length > 2) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(1);
}

let text;
try {
  text = args[1] ? readFileSync(args[1], "utf8") : readFileSync(0, "utf8");
} catch (e) {
  process.stderr.write(`cortex-scrub: cannot read ${args[1] ?? "stdin"} (${e.code ?? e.message})\n`);
  process.exit(1);
}

try {
  const { policy } = resolveProfile({ env: process.env });
  const { warnings } = assertPublished(text, { policy, env: process.env });
  for (const w of warnings) process.stderr.write(`cortex-scrub: ${w}\n`);
  process.exit(0);
} catch (e) {
  if (e instanceof RefusedWriteError) {
    // A credential's findings carry kind and line (and a redacted match, which is not printed). The
    // denylist and personal-data errors word their own message, already free of the text.
    const what = e.code === "refused_write"
      ? [...new Set(e.findings.map((f) => `${f.kind} (line ${f.line})`))].join(", ")
      : e.message;
    process.stderr.write(`cortex-scrub: refused — ${what}\n`);
    process.exit(2);
  }
  process.stderr.write(`cortex-scrub: ${e.message}\n`);
  process.exit(1);
}
