// shared-plugin.mjs — the two `.claude/settings.json` entries that put Cortex in front of a whole team.
//
// On a team repo, each developer finding and installing the plugin alone is how half a team ends up
// on a different Cortex from the other half (spec S6). Claude Code reads two keys from a repo's
// committed `.claude/settings.json` for exactly this (code.claude.com/docs/en/settings-reference):
//
//   "extraKnownMarketplaces": { "cortex": { "source": { "source": "github", "repo": "marinvch/Cortex" } } }
//   "enabledPlugins":         { "cortex@cortex": true }
//
// The first registers the marketplace for anyone who opens the repo and trusts the folder; the
// second turns the plugin on. The docs are plain that this does not install it for them: "Committing
// that entry turns the plugin on for your collaborators but doesn't download it to their machines, so
// each collaborator also runs `claude plugin install <name>@<marketplace> --scope project` once"
// (plugins/install, "Choose an install scope"). Every sentence that offers this says so.
//
// Which repos are a team's is `teamServed`: the `work` profile (core/profile.js, ADR 0015), or a
// team-brain connector at `.cortex/connector.json` (`/team-add`). A `home` or `lab` repo with no
// connector is one person's, and is never offered this.
//
// `mergeSharedPlugin` is the only writer, and it merges — it never replaces. `.claude/settings.json`
// holds hooks and permissions other people depend on, so:
//   - the file is parsed first, and a file that is not a JSON object is refused with a sentence —
//     never "repaired", never overwritten;
//   - an entry already there is left exactly as it is, whatever it says: `"cortex@cortex": false` is
//     a team's decision, and a `cortex` marketplace from another source is someone's fork;
//   - everything else is byte-for-byte what it was. The entries are inserted as text at the end of
//     their object, in the file's own indentation and line endings, rather than by re-serialising
//     the whole file — `JSON.stringify` would reflow every inline array the team wrote, and a merge
//     whose diff touches forty lines is not a merge anyone can review;
//   - the result is parsed again and must equal the original plus the added entries exactly, or
//     nothing is returned. A text edit is only trusted once the parser agrees with it.
// Deterministic: no clock, no network, the same text in gives the same text out.
//
// The two entries are a block inside a shared file, like the hooks merged into the same file, so
// they are not in the stamp record (`stamps.mjs` tracks whole files only).
//
// Where the marketplace entry points is not this file's to decide (#622). An organisation that runs
// Cortex from its own fork sets the source, and `core/source.js` resolves it — `--source`, then
// `CORTEX_SOURCE`, then the `source` in `.cortex/connector.json`, then `marinvch/Cortex` — into one
// of the documented source shapes (github, git, directory). `mergeSharedPlugin` takes the resolved
// object and writes it into a NEW cortex entry only; an entry already there, from whatever source,
// is still left exactly as it is. With nothing set the entry is byte-for-byte the default's.
//
// Auto-update is a separate choice, off unless asked (`{ autoUpdate: true }`). The settings reference
// documents it as "an optional `autoUpdate` Boolean" on the marketplace entry: `true` makes every
// teammate's Claude Code refresh the marketplace and update Cortex in the background after startup,
// and in the committed file it outranks each teammate's own /plugin toggle (plugins/loading, "Which
// marketplaces and plugins auto-update"). So it is written only on a NEW cortex entry. An entry
// already there keeps its `autoUpdate` — true, false or absent — because that was someone's call.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { WORK, resolveProfile } from "../../core/profile.js";
import { CONNECTOR_REL, DEFAULT_MARKETPLACE_SOURCE, cloneUrl, connectorSource, resolveSource } from "../../core/source.js";
import { insertUnder, skipWs, textStyle } from "../../core/json-text.js";

export const SETTINGS_REL = ".claude/settings.json";
export { CONNECTOR_REL };

/** The default marketplace entry, keyed by the name the plugin id uses after its `@`. */
export const CORTEX_MARKETPLACE = { name: "cortex", entry: { source: { ...DEFAULT_MARKETPLACE_SOURCE } } };
export const CORTEX_PLUGIN = "cortex@cortex";

// What a merge adds, in order. `keys` lists the spellings Claude Code reads for the same setting:
// `additionalMarketplaces` is the documented alias of `extraKnownMarketplaces`, so a file that uses
// it gets the entry there rather than a second, competing key beside it. `source` is a resolved
// marketplace source object (`core/source.js`); the default when none is given.
const wantsFor = (source = DEFAULT_MARKETPLACE_SOURCE) => [
  { keys: ["extraKnownMarketplaces", "additionalMarketplaces"], name: CORTEX_MARKETPLACE.name, value: { source: { ...source } }, marketplace: true },
  { keys: ["enabledPlugins"], name: CORTEX_PLUGIN, value: true },
];
const WANTS = wantsFor();

/** A settings file Cortex will not write into. `code` lets a caller tell it from a bug. */
export class SettingsUnreadable extends Error {
  constructor(message) {
    super(message);
    this.name = "SettingsUnreadable";
    this.code = "settings_unreadable";
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// --- which repos are a team's -----------------------------------------------------------------------

/**
 * `{ team, why }`: whether this repo is served for a team, and the evidence. The `work` profile or a
 * team-brain connector; anything else is `{ team: false, why: null }`. A profile value that is not
 * one of the three is not read as `work` — `/cortex-profile` reports that error, this does not throw.
 */
export function teamServed(root, env = process.env) {
  if (existsSync(join(root, ...CONNECTOR_REL.split("/")))) {
    // Only the two-field shape names its team. The old `{ slug, teamBrainRepo }` connector holds the
    // PROJECT's slug (`/team-add` wrote it from --slug), and only the MCP resolver, with the vault's
    // clones in hand, can tell what it meant — so here it is a team brain, unnamed. Reading the slug
    // as the team said every repo of a real workspace belonged to a team named after itself.
    let team = null;
    try {
      const c = JSON.parse(readFileSync(join(root, ...CONNECTOR_REL.split("/")), "utf8"));
      team = typeof c?.team === "string" && c.team.trim() ? c.team : null;
    } catch {
      // A connector that does not parse is still someone connecting this repo to a team.
    }
    return { team: true, why: `${CONNECTOR_REL} connects this repo to ${team ? `the ${team} team's brain` : "a team brain"}` };
  }
  let profile = null;
  try {
    profile = resolveProfile({ env }).profile;
  } catch {
    profile = null;
  }
  if (profile === WORK) return { team: true, why: "this machine's profile is CORTEX_PROFILE=work" };
  return { team: false, why: null };
}

// --- where Cortex comes from ----------------------------------------------------------------------------

/**
 * The source a new cortex entry would point at, for this repo: `resolveSource` (`core/source.js`)
 * fed the repo's connector, plus the URL CI would clone it from (`null` for a directory source).
 * Throws `SourceRefused` for a source that is set and unusable; nothing here falls back past it.
 */
export function sharedPluginSource(root, { argument = null, env = process.env } = {}) {
  const r = resolveSource({ argument, env, connector: connectorSource(root) });
  return { ...r, cloneUrl: cloneUrl(r.source) };
}

// --- what is on disk ----------------------------------------------------------------------------------

function parseSettings(text) {
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  let doc;
  try {
    doc = JSON.parse(body);
  } catch (e) {
    throw new SettingsUnreadable(`${SETTINGS_REL} is not valid JSON (${e.message}), so Cortex will not write into it — fix it and run again`);
  }
  if (!isObject(doc)) throw new SettingsUnreadable(`${SETTINGS_REL} is not a JSON object at the top, so Cortex will not write into it`);
  return doc;
}

/** For each wanted entry: the key it lives or would live under, and whether it is there already. */
function plan(doc, wanted = WANTS) {
  return wanted.map((w) => {
    const key = w.keys.find((k) => own(doc, k)) ?? w.keys[0];
    if (own(doc, key) && !isObject(doc[key])) {
      throw new SettingsUnreadable(`\`${key}\` is not an object in ${SETTINGS_REL}, so Cortex will not write into it`);
    }
    const present = own(doc, key) && own(doc[key], w.name);
    return { ...w, key, present, existing: present ? doc[key][w.name] : undefined };
  });
}

/** The value a merge writes for a wanted entry: the marketplace entry gains autoUpdate only if asked. */
const valueFor = (w, autoUpdate) => (w.marketplace && autoUpdate === true ? { ...w.value, autoUpdate: true } : w.value);

/**
 * What became of the auto-update choice: "set" on a new entry, "not asked", or "kept <value>" for a
 * cortex entry already there, whose autoUpdate is never changed — "kept true", "kept false", "kept unset".
 */
function autoUpdateOutcome(wants, autoUpdate) {
  const m = wants.find((w) => w.marketplace);
  if (m.present) {
    const v = isObject(m.existing) && own(m.existing, "autoUpdate") ? m.existing.autoUpdate : undefined;
    return `kept ${v === undefined ? "unset" : JSON.stringify(v)}`;
  }
  return autoUpdate === true ? "set" : "not asked";
}

/**
 * `{ settings: "absent" | "ok" | "unreadable", served, problem, missing, autoUpdate }` for this
 * repo's `.claude/settings.json`. `served` is both entries present, with any value. `missing` names
 * what a merge would add, as `key.name`. `autoUpdate` is the cortex entry's own Boolean, or null
 * when there is no entry or it sets none.
 */
export function sharedPluginStatus(root) {
  const abs = join(root, ...SETTINGS_REL.split("/"));
  if (!existsSync(abs)) {
    return { settings: "absent", served: false, problem: null, missing: WANTS.map((w) => `${w.keys[0]}.${w.name}`), autoUpdate: null };
  }
  try {
    const wants = plan(parseSettings(readFileSync(abs, "utf8")));
    const missing = wants.filter((w) => !w.present).map((w) => `${w.key}.${w.name}`);
    const m = wants.find((w) => w.marketplace).existing;
    const autoUpdate = isObject(m) && typeof m.autoUpdate === "boolean" ? m.autoUpdate : null;
    return { settings: "ok", served: missing.length === 0, problem: null, missing, autoUpdate };
  } catch (e) {
    if (e.code !== "settings_unreadable") throw e;
    return { settings: "unreadable", served: false, problem: e.message, missing: [], autoUpdate: null };
  }
}

// --- the merge ----------------------------------------------------------------------------------------
//
// The scanner and the text insertion are `core/json-text.js`, shared with `tools/cortex-setup.mjs`.
// What is added, and that an entry already there is kept, is decided here.

/**
 * Merge Cortex's two entries into a `.claude/settings.json` text (`null` when there is no file).
 * Returns `{ text, added, kept, autoUpdate }`, with `added` and `kept` as `key.name` and
 * `autoUpdate` as `autoUpdateOutcome` says. `{ autoUpdate: true }` asks for it on a new cortex entry.
 * `{ source }` is the marketplace source object a NEW cortex entry points at — `resolveSource(...)
 * .source` from `core/source.js` — and the default's when omitted. An existing entry keeps its own.
 * Throws `SettingsUnreadable` for a file it will not write into. Pure: the caller writes `text`, and
 * only when `added` is not empty.
 */
export function mergeSharedPlugin(text, { autoUpdate = false, source = DEFAULT_MARKETPLACE_SOURCE } = {}) {
  const wanted = wantsFor(source);
  if (text === null || text === undefined) {
    const doc = {};
    for (const w of wanted) doc[w.keys[0]] = { [w.name]: valueFor(w, autoUpdate) };
    return {
      text: JSON.stringify(doc, null, 2) + "\n",
      added: wanted.map((w) => `${w.keys[0]}.${w.name}`),
      kept: [],
      autoUpdate: autoUpdate === true ? "set" : "not asked",
    };
  }

  const doc = parseSettings(text);
  const wants = plan(doc, wanted);
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  let t = text.slice(bom.length);
  const root = skipWs(t, 0);
  // The file's own line ending and indent unit; two spaces for a file with none.
  const style = textStyle(t, root);

  const expected = structuredClone(doc);
  const added = [];
  const kept = [];
  for (const w of wants) {
    const id = `${w.key}.${w.name}`;
    if (w.present) { kept.push(id); continue; }
    added.push(id);
    const value = valueFor(w, autoUpdate);
    if (own(expected, w.key)) expected[w.key][w.name] = value;
    else expected[w.key] = { [w.name]: value };
    t = insertUnder(t, root, w.key, w.name, value, style);
  }

  // The text edit is trusted only once the parser agrees it is exactly the intended merge.
  if (!isDeepStrictEqual(JSON.parse(t), expected)) {
    throw new Error(`merging into ${SETTINGS_REL} produced something other than the intended entries — nothing was written`);
  }
  return { text: bom + t, added, kept, autoUpdate: autoUpdateOutcome(wants, autoUpdate) };
}
