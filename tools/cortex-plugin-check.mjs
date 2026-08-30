#!/usr/bin/env node
// cortex-plugin-check.mjs — is the Cortex you are running the Cortex you are editing?
//
//   node tools/cortex-plugin-check.mjs           # the three stages and where they diverge
//   node tools/cortex-plugin-check.mjs --check   # exit 1 if the running copy is behind the repo
//   node tools/cortex-plugin-check.mjs --json
//
// A plugin reaches a session through three copies, and each one can sit at a different version:
//
//   repo VERSION  →  marketplace clone  →  installed cache  →  this session
//   (what you edit)  (what update pulls)   (what actually runs)
//
// Nothing announces a mismatch. The commands are all present, the skills all load, and the model
// runs last week's instructions against this week's code — so a fix you just wrote appears not to
// work, and the obvious conclusion (the fix is wrong) is the wrong one. Updating the marketplace
// alone does NOT move the installed cache; that is the step people skip, and the reason this reports
// each stage separately instead of printing one version number.
//
// Read-only. It inspects ~/.claude/plugins and this repo, and changes neither.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS = join(homedir(), ".claude", "plugins");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const check = args.includes("--check");

/** The plugin's own name, from its manifest — never hardcoded, so a rename does not silently pass. */
function pluginName() {
  try {
    return JSON.parse(readFileSync(join(REPO_ROOT, ".claude-plugin", "plugin.json"), "utf8")).name;
  } catch {
    return null;
  }
}

function read(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

const name = pluginName();
const repo = read(join(REPO_ROOT, "VERSION"));

// The marketplace clone: what `/plugin update` pulls from, and the stage that moves first.
const clonePath = name ? join(PLUGINS, "marketplaces", name) : null;
const clone = clonePath && existsSync(clonePath) ? read(join(clonePath, "VERSION")) : null;

// The installed cache: what a session actually loads. This is the number that decides behaviour, so
// when the three disagree it is the only one worth acting on.
let installed = null;
let installPath = null;
try {
  const reg = JSON.parse(read(join(PLUGINS, "installed_plugins.json")) || "{}");
  for (const [key, entries] of Object.entries(reg.plugins || {})) {
    if (key.split("@")[0] !== name) continue;
    const e = (entries || []).find((x) => x.scope === "user") || (entries || [])[0];
    if (!e) continue;
    installed = e.version ?? null;
    installPath = e.installPath ?? null;
  }
} catch { /* no registry is a valid state: the plugin is simply not installed */ }

const stages = [
  { stage: "repo", version: repo, path: REPO_ROOT, note: "what you edit" },
  { stage: "marketplace clone", version: clone, path: clonePath, note: "what `/plugin update` pulls" },
  { stage: "installed cache", version: installed, path: installPath, note: "what this session runs" },
];

// Behind, not merely different. A repo mid-release sits ahead of both copies and that is normal; the
// defect is a session running instructions older than the ones being written against it.
const behind = repo && installed && repo !== installed;
const staleClone = repo && clone && repo !== clone;

if (asJson) {
  console.log(JSON.stringify({ plugin: name, stages, behind: Boolean(behind), staleClone: Boolean(staleClone) }, null, 2));
} else {
  console.log(`\nplugin   ${name || "— no .claude-plugin/plugin.json"}\n`);
  for (const s of stages) {
    console.log(`  ${s.stage.padEnd(19)} ${(s.version || "— not present").padEnd(12)} ${s.note}`);
    if (s.path && s.version) console.log(`  ${" ".repeat(19)} ${s.path}`);
  }
  if (!installed) {
    console.log(`\nNot installed. \`claude plugin install ${name}@${name}\` — or you are running from a checkout,`);
    console.log("in which case nothing here applies and the repo is the only copy.");
  } else if (behind) {
    console.log(`\nThis session runs ${installed}; the repo is at ${repo}.`);
    console.log("Two steps, and the first alone is not enough:");
    console.log(`  1. update the marketplace   (it is a git clone — ${staleClone ? `still at ${clone || "?"}` : "already current"})`);
    console.log(`  2. update the INSTALLED plugin, then restart the session`);
    console.log("Then re-run this. A version that did not move means the update did not take.");
  } else {
    console.log(`\nThe running copy matches the repo (${repo}).`);
  }
}

if (check && behind) process.exit(1);
