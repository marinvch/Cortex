#!/usr/bin/env node
// cortex-plugin-check.mjs — is the Cortex you are running the Cortex you are editing?
//
//   node tools/cortex-plugin-check.mjs           # the three stages and where they diverge
//   node tools/cortex-plugin-check.mjs --check   # exit 1 if the running copy is behind the repo
//   node tools/cortex-plugin-check.mjs --json
//   node tools/cortex-plugin-check.mjs --remote [url]   # also read VERSION upstream: is a newer one published?
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
// Run from an installed copy, the "repo" row is the cache itself, so the three always agree and say
// nothing about upstream. --remote answers that: it fetches the default branch of the plugin's
// repository (the manifest's `repository`, or the url given) into a temp directory and reads its
// VERSION. It is opt-in because it is the only thing here that touches the network. With --check,
// exit 1 means the running copy is behind upstream and exit 2 means upstream could not be read,
// which is not a pass.
//
// Read-only. It inspects ~/.claude/plugins and this repo, and changes neither.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginsDir, readRegistry } from "../core/plugin-registry.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Where the registry lives, and its shape, are core's: `ai-os setup-plugins --status` reads it too.
const PLUGINS = pluginsDir();

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const check = args.includes("--check");
const remote = args.includes("--remote");
const remoteArg = remote ? args[args.indexOf("--remote") + 1] : null;

function manifest() {
  try {
    return JSON.parse(readFileSync(join(REPO_ROOT, ".claude-plugin", "plugin.json"), "utf8"));
  } catch {
    return {};
  }
}

/** The plugin's own name, from its manifest — never hardcoded, so a rename does not silently pass. */
function pluginName() {
  return manifest().name ?? null;
}

const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** -1, 0 or 1. Parts compare as numbers: 2.9.0 is older than 2.10.0. */
function compareVersions(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/**
 * VERSION on the default branch of `url`, read through a shallow fetch into a temp directory that
 * is removed afterwards. Returns { version } or { error }; it never throws and never prompts.
 */
function upstreamVersion(url) {
  const dir = mkdtempSync(join(tmpdir(), "cortex-upstream-"));
  const git = (...a) =>
    execFileSync("git", a, {
      cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  try {
    git("init", "-q");
    git("fetch", "-q", "--depth", "1", url, "HEAD");
    const version = git("show", "FETCH_HEAD:VERSION").trim();
    return VERSION_RE.test(version) ? { version } : { error: "its VERSION is not a version" };
  } catch (e) {
    const said = String(e.stderr || e.message).trim().split(/\r?\n/).pop();
    return { error: said || "git failed" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
// No registry is a valid state here: the plugin is simply not installed, and `plugins` is empty.
for (const [key, entries] of Object.entries(readRegistry(PLUGINS).plugins)) {
  if (key.split("@")[0] !== name) continue;
  const e = entries.find((x) => x.scope === "user") || entries[0];
  if (!e) continue;
  installed = e.version ?? null;
  installPath = e.installPath ?? null;
}

const stages = [
  { stage: "repo", version: repo, path: REPO_ROOT, note: "what you edit" },
  { stage: "marketplace clone", version: clone, path: clonePath, note: "what `/plugin update` pulls" },
  { stage: "installed cache", version: installed, path: installPath, note: "what this session runs" },
];

// Behind, not merely different. A repo mid-release sits ahead of both copies and that is normal; the
// defect is a session running instructions older than the ones being written against it.
const behind = repo && installed && repo !== installed;
const staleClone = repo && clone && repo !== clone;

// What runs is the installed copy, or the checkout when nothing is installed.
const running = installed || repo;
const upstreamUrl = remote ? (remoteArg && !remoteArg.startsWith("--") ? remoteArg : manifest().repository) : null;
const upstream = !remote ? null : upstreamUrl ? upstreamVersion(upstreamUrl) : { error: "the manifest names no repository" };
const comparable = upstream?.version && running && VERSION_RE.test(running);
const behindUpstream = Boolean(comparable && compareVersions(running, upstream.version) < 0);
const unread = Boolean(remote && !comparable);
if (remote) stages.push({ stage: "upstream", version: upstream.version ?? null, path: upstreamUrl ?? null, note: "what is published" });

if (asJson) {
  const result = { plugin: name, stages, behind: Boolean(behind), staleClone: Boolean(staleClone) };
  if (remote) Object.assign(result, { behindUpstream, upstreamError: upstream.error ?? null });
  console.log(JSON.stringify(result, null, 2));
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
  if (remote && upstream.error) {
    console.log(`\ncould not read upstream (${upstream.error}), so whether a newer Cortex is published is unknown.`);
  } else if (remote && !comparable) {
    console.log(`\ncould not read upstream: there is no running version to compare ${upstream.version} with.`);
  } else if (behindUpstream) {
    console.log(`\nA newer Cortex is published: ${upstream.version}. This one is ${running}.`);
    console.log("Update the marketplace, then the installed plugin, then restart the session.");
  } else if (remote) {
    console.log(
      compareVersions(running, upstream.version) === 0
        ? `\nThis is the latest published version (${upstream.version}).`
        : `\nThis copy (${running}) is ahead of what is published (${upstream.version}).`,
    );
  }
}

if (check && (behind || behindUpstream)) process.exit(1);
if (check && unread) process.exit(2);

