#!/usr/bin/env node
// cortex-shared-plugin.mjs — put Cortex in a team repo's committed .claude/settings.json.
//
//   node index/cortex-shared-plugin.mjs <repo> [--json]   # what a merge would add; writes nothing
//   node index/cortex-shared-plugin.mjs <repo> --write    # merge the two entries in
//   node index/cortex-shared-plugin.mjs <repo> --write --auto-update
//                                                          # ...with "autoUpdate": true on a new cortex entry
//
// `/cortex` offers this on a team's repo (the `team-plugin` row in lib/loop.mjs: the `work` profile or
// a team-brain connector) and runs `--write` only when the user picked it. The entries are the
// documented ones — `extraKnownMarketplaces.cortex` (GitHub marinvch/Cortex) and
// `enabledPlugins["cortex@cortex"]` — and lib/shared-plugin.mjs merges them: every other key stays
// byte-for-byte, an entry already there is left alone whatever it says, and a file that does not
// parse is refused, never rewritten.
//
// `--auto-update` is its own choice and off without the flag: it writes the documented optional
// `autoUpdate` Boolean (settings-reference, `extraKnownMarketplaces`) as `true` on a cortex entry this
// run adds, so every teammate's Claude Code pulls new Cortex releases in the background. A cortex
// entry already in the file keeps its `autoUpdate` — true, false or unset — and the output says so.
//
// This is one of three scripts in index/ that write outside `.cortex/` (the others are
// `cortex-stamps.mjs update` and `cortex-section.mjs --replace`), and it writes one file: `.claude/settings.json`, through a temp file
// renamed into place, so an interrupted run leaves the old file whole. Committing it does not install
// anything for anyone — each teammate still installs once — and the output says so.
//
// Exit codes: 1 for a bad argument, 2 for a settings file it will not write into.

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openTarget } from "./lib/open.mjs";
import { SETTINGS_REL, mergeSharedPlugin, sharedPluginStatus, teamServed } from "./lib/shared-plugin.mjs";

const USAGE = "usage: node index/cortex-shared-plugin.mjs <repo> [--json] [--write [--auto-update]]";

const refuse = (text, code) => {
  process.stderr.write(text.endsWith("\n") ? text : text + "\n");
  process.exit(code);
};

// What committing the entries does and does not do, from the plugin docs (plugins/install, "Choose
// an install scope"; settings-reference, `extraKnownMarketplaces`). Said wherever the merge is.
const WHAT_IT_DOES =
  "Commit it. Once a teammate trusts this folder, Claude Code registers the cortex marketplace for them; " +
  "it does not install the plugin, so each teammate still runs, once: claude plugin install cortex@cortex --scope project";

// What `"autoUpdate": true` means for the team (settings-reference, `extraKnownMarketplaces`).
const AUTO_UPDATE_MEANS = "every teammate's Claude Code pulls new Cortex releases in the background after startup";

/** One line on the cortex entry's autoUpdate as the file holds it, or null with no entry. */
function autoUpdateLine(outcome) {
  if (!outcome.startsWith("kept ")) return null;
  const v = outcome.slice(5);
  return `The cortex entry's autoUpdate is ${v === "unset" ? "not set (off for a third-party marketplace)" : v}; ` +
    "Cortex never changes it on an entry that is already there, --auto-update included.";
}

const { root, args } = openTarget(process.argv.slice(2), {
  usage: USAGE,
  flags: { "--json": "boolean", "--write": "boolean", "--auto-update": "boolean" },
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
  const hasEntry = status.settings === "ok" && !status.missing.some((m) => m.endsWith(".cortex"));
  if (hasEntry) {
    console.log(autoUpdateLine(`kept ${status.autoUpdate === null ? "unset" : status.autoUpdate}`));
  } else {
    console.log(`Auto-update is a separate choice, off unless you add --auto-update: it sets "autoUpdate": true, so ${AUTO_UPDATE_MEANS}.`);
  }
  console.log("\nNothing was changed.");
  process.exit(0);
}

const before = readSettings();
let merged;
try {
  merged = mergeSharedPlugin(before, { autoUpdate: args.autoUpdate === true });
} catch (e) {
  if (e.code !== "settings_unreadable") throw e;
  refuse(`${e.message}\nNothing was written.`, 2);
}

if (!merged.added.length) {
  console.log(`Nothing to add: ${SETTINGS_REL} already has ${merged.kept.join(" and ")}, left as they are.`);
  console.log(autoUpdateLine(merged.autoUpdate));
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
if (merged.autoUpdate === "set") console.log(`Set "autoUpdate": true on the cortex entry: ${AUTO_UPDATE_MEANS}.`);
else if (merged.autoUpdate === "not asked") console.log('No "autoUpdate" written: teammates update Cortex themselves (off by default for a third-party marketplace).');
else console.log(autoUpdateLine(merged.autoUpdate));
console.log(WHAT_IT_DOES);
