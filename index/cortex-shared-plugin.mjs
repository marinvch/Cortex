#!/usr/bin/env node
// cortex-shared-plugin.mjs — put Cortex in a team repo's committed .claude/settings.json.
//
//   node index/cortex-shared-plugin.mjs <repo> [--json]   # what a merge would add; writes nothing
//   node index/cortex-shared-plugin.mjs <repo> --write    # merge the two entries in
//
// `/cortex` offers this on a team's repo (the `team-plugin` row in lib/loop.mjs: the `work` profile or
// a team-brain connector) and runs `--write` only when the user picked it. The entries are the
// documented ones — `extraKnownMarketplaces.cortex` (GitHub marinvch/Cortex) and
// `enabledPlugins["cortex@cortex"]` — and lib/shared-plugin.mjs merges them: every other key stays
// byte-for-byte, an entry already there is left alone whatever it says, and a file that does not
// parse is refused, never rewritten.
//
// This is the second of two scripts in index/ that write outside `.cortex/` (the other is
// `cortex-stamps.mjs update`), and it writes one file: `.claude/settings.json`, through a temp file
// renamed into place, so an interrupted run leaves the old file whole. Committing it does not install
// anything for anyone — each teammate still installs once — and the output says so.
//
// Exit codes: 1 for a bad argument, 2 for a settings file it will not write into.

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openTarget } from "./lib/open.mjs";
import { SETTINGS_REL, mergeSharedPlugin, sharedPluginStatus, teamServed } from "./lib/shared-plugin.mjs";

const USAGE = "usage: node index/cortex-shared-plugin.mjs <repo> [--json] [--write]";

const refuse = (text, code) => {
  process.stderr.write(text.endsWith("\n") ? text : text + "\n");
  process.exit(code);
};

// What committing the entries does and does not do, from the plugin docs (plugins/install, "Choose
// an install scope"; settings-reference, `extraKnownMarketplaces`). Said wherever the merge is.
const WHAT_IT_DOES =
  "Commit it. Once a teammate trusts this folder, Claude Code registers the cortex marketplace for them; " +
  "it does not install the plugin, so each teammate still runs, once: claude plugin install cortex@cortex --scope project";

const { root, args } = openTarget(process.argv.slice(2), {
  usage: USAGE,
  flags: { "--json": "boolean", "--write": "boolean" },
  root: "positional",
  index: "none",
});

const abs = join(root, ...SETTINGS_REL.split("/"));

/** The settings text, or null with no file. A path that is there but cannot be read is refused. */
function readSettings() {
  let st;
  try {
    st = statSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile()) refuse(`${SETTINGS_REL} is not a file, so Cortex will not write into it`, 2);
  return readFileSync(abs, "utf8");
}

if (!args.write) {
  const status = sharedPluginStatus(root);
  const team = teamServed(root);
  if (args.json) {
    console.log(JSON.stringify({ settings: SETTINGS_REL, ...status, team }, null, 2));
    process.exit(0);
  }
  if (status.settings === "unreadable") refuse(status.problem, 2);
  console.log(team.team ? `A team's repo: ${team.why}.` : "Not a team's repo (no work profile, no team-brain connector); /cortex does not offer this here.");
  if (status.served) {
    console.log(`${SETTINGS_REL} already registers the cortex marketplace and names cortex@cortex.`);
  } else {
    console.log(`--write would add ${status.missing.join(" and ")} to ${SETTINGS_REL}, and change nothing else.`);
    console.log(WHAT_IT_DOES);
  }
  console.log("\nNothing was changed.");
  process.exit(0);
}

const before = readSettings();
let merged;
try {
  merged = mergeSharedPlugin(before);
} catch (e) {
  if (e.code !== "settings_unreadable") throw e;
  refuse(`${e.message}\nNothing was written.`, 2);
}

if (!merged.added.length) {
  console.log(`Nothing to add: ${SETTINGS_REL} already has ${merged.kept.join(" and ")}, left as they are.`);
  process.exit(0);
}

mkdirSync(dirname(abs), { recursive: true });
const tmp = `${abs}.cortex-tmp`;
try {
  writeFileSync(tmp, merged.text);
  renameSync(tmp, abs);
} catch (e) {
  rmSync(tmp, { force: true });
  refuse(`could not write ${SETTINGS_REL}: ${e.message}\nNothing was written.`, 2);
}

console.log(`Added ${merged.added.join(" and ")} to ${SETTINGS_REL}; every other key is as it was.`);
if (merged.kept.length) console.log(`Left as they were: ${merged.kept.join(", ")}.`);
console.log(WHAT_IT_DOES);
