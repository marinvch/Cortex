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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { WORK, resolveProfile } from "../../core/profile.js";

export const SETTINGS_REL = ".claude/settings.json";
export const CONNECTOR_REL = ".cortex/connector.json";

/** The marketplace entry, keyed by the name the plugin id uses after its `@`. */
export const CORTEX_MARKETPLACE = { name: "cortex", entry: { source: { source: "github", repo: "marinvch/Cortex" } } };
export const CORTEX_PLUGIN = "cortex@cortex";

// What a merge adds, in order. `keys` lists the spellings Claude Code reads for the same setting:
// `additionalMarketplaces` is the documented alias of `extraKnownMarketplaces`, so a file that uses
// it gets the entry there rather than a second, competing key beside it.
const WANTS = [
  { keys: ["extraKnownMarketplaces", "additionalMarketplaces"], name: CORTEX_MARKETPLACE.name, value: CORTEX_MARKETPLACE.entry },
  { keys: ["enabledPlugins"], name: CORTEX_PLUGIN, value: true },
];

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
    let team = null;
    try {
      const c = JSON.parse(readFileSync(join(root, ...CONNECTOR_REL.split("/")), "utf8"));
      team = typeof c?.team === "string" ? c.team : typeof c?.slug === "string" ? c.slug : null;
    } catch {
      // A connector that does not parse is still someone connecting this repo to a team.
    }
    return { team: true, why: `${CONNECTOR_REL} connects this repo to ${team ? `the ${team} team's` : "a team"} brain` };
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
function plan(doc) {
  return WANTS.map((w) => {
    const key = w.keys.find((k) => own(doc, k)) ?? w.keys[0];
    if (own(doc, key) && !isObject(doc[key])) {
      throw new SettingsUnreadable(`\`${key}\` is not an object in ${SETTINGS_REL}, so Cortex will not write into it`);
    }
    return { ...w, key, present: own(doc, key) && own(doc[key], w.name) };
  });
}

/**
 * `{ settings: "absent" | "ok" | "unreadable", served, problem, missing }` for this repo's
 * `.claude/settings.json`. `served` is both entries present, with any value. `missing` names what a
 * merge would add, as `key.name`.
 */
export function sharedPluginStatus(root) {
  const abs = join(root, ...SETTINGS_REL.split("/"));
  if (!existsSync(abs)) {
    return { settings: "absent", served: false, problem: null, missing: WANTS.map((w) => `${w.keys[0]}.${w.name}`) };
  }
  try {
    const wants = plan(parseSettings(readFileSync(abs, "utf8")));
    const missing = wants.filter((w) => !w.present).map((w) => `${w.key}.${w.name}`);
    return { settings: "ok", served: missing.length === 0, problem: null, missing };
  } catch (e) {
    if (e.code !== "settings_unreadable") throw e;
    return { settings: "unreadable", served: false, problem: e.message, missing: [] };
  }
}

// --- the merge ----------------------------------------------------------------------------------------
//
// A scanner over text already known to be valid JSON (it was parsed first), so it only has to find
// where things are, never to judge them.

const WS = new Set([" ", "\t", "\n", "\r"]);
const skipWs = (t, i) => { while (i < t.length && WS.has(t[i])) i++; return i; };

function skipString(t, i) {
  for (i++; i < t.length && t[i] !== '"'; i++) if (t[i] === "\\") i++;
  return i + 1;
}

function skipValue(t, i) {
  if (t[i] === '"') return skipString(t, i);
  if (t[i] === "{" || t[i] === "[") {
    let depth = 0;
    for (; i < t.length; i++) {
      if (t[i] === '"') { i = skipString(t, i) - 1; continue; }
      if (t[i] === "{" || t[i] === "[") depth++;
      else if ((t[i] === "}" || t[i] === "]") && --depth === 0) return i + 1;
    }
  }
  while (i < t.length && !WS.has(t[i]) && t[i] !== "," && t[i] !== "}" && t[i] !== "]") i++;
  return i;
}

/** The members of the object whose `{` is at `open`, and where its `}` is. */
function objectAt(t, open) {
  const members = [];
  let i = skipWs(t, open + 1);
  if (t[i] === "}") return { members, close: i };
  for (;;) {
    // Unreachable on text that parsed as an object; it stops a broken caller from scanning forever.
    if (t[i] !== '"') throw new Error(`no object member at offset ${i} of ${SETTINGS_REL}`);
    const keyStart = i;
    const keyEnd = skipString(t, i);
    const valueStart = skipWs(t, skipWs(t, keyEnd) + 1);
    const valueEnd = skipValue(t, valueStart);
    members.push({ key: JSON.parse(t.slice(keyStart, keyEnd)), keyStart, valueStart, valueEnd });
    i = skipWs(t, valueEnd);
    if (t[i] === "}") return { members, close: i };
    i = skipWs(t, i + 1);
  }
}

/** The whitespace a line starts with — the indentation of whatever sits at `pos`. */
function lineIndent(t, pos) {
  const start = t.lastIndexOf("\n", pos - 1) + 1;
  let end = start;
  while (t[end] === " " || t[end] === "\t") end++;
  return t.slice(start, end);
}

/** Insert `"name": value` as the last member of the object at `open`, in the file's own style. */
function insertMember(t, open, name, value, style) {
  const { members, close } = objectAt(t, open);
  const key = JSON.stringify(name);
  if (!members.length) {
    const outer = lineIndent(t, open);
    const indent = outer + style.unit;
    const body = JSON.stringify(value, null, style.unit).split("\n").join(style.eol + indent);
    return t.slice(0, open + 1) + style.eol + indent + `${key}: ${body}` + style.eol + outer + t.slice(close);
  }
  const last = members[members.length - 1];
  const between = t.slice(open + 1, members[0].keyStart);
  if (!between.includes("\n")) {
    // A one-line object stays one line.
    return t.slice(0, last.valueEnd) + `, ${key}: ${JSON.stringify(value)}` + t.slice(last.valueEnd);
  }
  const indent = lineIndent(t, members[0].keyStart);
  const body = JSON.stringify(value, null, style.unit).split("\n").join(style.eol + indent);
  return t.slice(0, last.valueEnd) + "," + style.eol + indent + `${key}: ${body}` + t.slice(last.valueEnd);
}

/**
 * Merge Cortex's two entries into a `.claude/settings.json` text (`null` when there is no file).
 * Returns `{ text, added, kept }`, with `added` and `kept` as `key.name`. Throws `SettingsUnreadable`
 * for a file it will not write into. Pure: the caller writes `text`, and only when `added` is not
 * empty.
 */
export function mergeSharedPlugin(text) {
  if (text === null || text === undefined) {
    const doc = {};
    for (const w of WANTS) doc[w.keys[0]] = { [w.name]: w.value };
    return { text: JSON.stringify(doc, null, 2) + "\n", added: WANTS.map((w) => `${w.keys[0]}.${w.name}`), kept: [] };
  }

  const doc = parseSettings(text);
  const wants = plan(doc);
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  let t = text.slice(bom.length);
  const root = skipWs(t, 0);
  const first = objectAt(t, root).members[0];
  const style = {
    eol: t.includes("\r\n") ? "\r\n" : "\n",
    // The file's own indent unit, read off its first top-level member; two spaces for a file with none.
    unit: first && t.slice(root + 1, first.keyStart).includes("\n") ? lineIndent(t, first.keyStart) || "  " : "  ",
  };

  const expected = structuredClone(doc);
  const added = [];
  const kept = [];
  for (const w of wants) {
    const id = `${w.key}.${w.name}`;
    if (w.present) { kept.push(id); continue; }
    added.push(id);
    const top = objectAt(t, root).members.filter((m) => m.key === w.key).pop();
    if (top) {
      expected[w.key][w.name] = w.value;
      t = insertMember(t, top.valueStart, w.name, w.value, style);
    } else {
      expected[w.key] = { [w.name]: w.value };
      t = insertMember(t, root, w.key, { [w.name]: w.value }, style);
    }
  }

  // The text edit is trusted only once the parser agrees it is exactly the intended merge.
  if (!isDeepStrictEqual(JSON.parse(t), expected)) {
    throw new Error(`merging into ${SETTINGS_REL} produced something other than the intended entries — nothing was written`);
  }
  return { text: bom + t, added, kept };
}
