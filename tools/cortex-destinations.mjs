#!/usr/bin/env node
// cortex-destinations.mjs — where this install may send things, and is this one of them.
//
//   node tools/cortex-destinations.mjs status [--json]
//   node tools/cortex-destinations.mjs check <git|https|npm> <url> [--inbound]
//
// The gate is core/destinations.js, the same call every push, pull, clone and tracker request in
// mcp/ makes. A shell script cannot import it, and reimplementing the match in bash would be a
// second copy of a security rule, so this is the door the shell half uses: tools/server/cortex-cron.sh
// checks the API URL and the brain's remotes here before it sends or pushes anything.
//
// The profile comes from core/profile.js (CORTEX_PROFILE); the list from CORTEX_DESTINATIONS, else
// ~/.cortex/allowed-destinations. docs/adr/0030 holds the argument.
//
// Exit codes:
//   0   allowed (check) · the report was printed (status)
//   2   refused — the reason goes to stderr, naming host and path, never a credential
//   1   it could not run: a bad argument, an unknown CORTEX_PROFILE
//
// It writes nothing, and never prints the address as given: only its normalised host and path.

import { resolveProfile } from "../core/profile.js";
import {
  assertDestination, DestinationRefusedError, destinationStatus, destinationNotes, DESTINATION_KINDS,
} from "../core/destinations.js";

const USAGE =
  "usage: cortex-destinations.mjs status [--json]\n" +
  `       cortex-destinations.mjs check <${DESTINATION_KINDS.join("|")}> <url> [--inbound]`;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const words = args.filter((a) => !a.startsWith("--"));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let profile;
try {
  profile = resolveProfile({ env: process.env });
} catch (e) {
  fail(`cortex-destinations: ${e.message}`);
}

const [sub, kind, url] = words;

if (sub === "status") {
  if (words.length !== 1 || [...flags].some((f) => f !== "--json")) fail(USAGE);
  const s = destinationStatus({ policy: profile.policy, env: process.env });
  if (flags.has("--json")) {
    console.log(JSON.stringify({ profile: profile.profile, ...s }, null, 2));
    process.exit(0);
  }
  console.log(`profile       ${profile.profile} (${profile.source}) — destinations: ${s.mode}`);
  if (s.mode === "any") console.log("              every destination is allowed; no list is read");
  else if (s.mode === "none") console.log("              nothing outward leaves this machine; a pull or a clone still may");
  if (s.state === "absent") {
    console.log(`list          none at ${s.path}`);
    if (s.applies) {
      console.log("              every push, pull, clone and tracker call is REFUSED until it exists.");
      console.log("              Write one line per approved destination, or have IT deploy the file:");
      console.log("                git: github.com/your-org");
      console.log("                https: your-tenant.service-now.com");
    }
  } else if (s.state === "missing") {
    console.log(`list          MISSING — CORTEX_DESTINATIONS names ${s.path}, which is not a readable file`);
    if (s.applies) console.log("              every push, pull, clone and tracker call is REFUSED until the path is fixed.");
  } else {
    const by = Object.entries(s.kinds).map(([k, n]) => `${k} ${n}`).join(", ");
    console.log(`list          ${s.entries} entr${s.entries === 1 ? "y" : "ies"}${by ? ` (${by})` : ""} from ${s.path}`);
  }
  for (const n of destinationNotes(s.problems)) console.log(`              ${n}`);
  process.exit(0);
}

if (sub === "check") {
  if (words.length !== 3 || [...flags].some((f) => f !== "--inbound")) fail(USAGE);
  if (!DESTINATION_KINDS.includes(kind)) fail(`cortex-destinations: unknown kind ${JSON.stringify(kind)}\n${USAGE}`);
  try {
    const r = assertDestination(url, { kind, policy: profile.policy, env: process.env, inbound: flags.has("--inbound") });
    console.log(`allowed (${r.why})`);
    process.exit(0);
  } catch (e) {
    if (e instanceof DestinationRefusedError) {
      process.stderr.write(`cortex-destinations: ${e.message}\n`);
      process.exit(2);
    }
    fail(`cortex-destinations: ${e.message}`);
  }
}

fail(USAGE);
