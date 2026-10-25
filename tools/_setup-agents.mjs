// _setup-agents.mjs — what `cortex-setup.mjs` writes for each agent, and the merges that write it.
//
// A library, not a tool (the leading `_`): `tools/cortex-setup.mjs` is the CLI over it, and
// `tools/test/cortex-setup.test.sh` drives both. Pure apart from `readText`, which the caller hands
// in: no clock, no network, the same files in give the same plan out.
//
// ## Where each agent reads an MCP server, checked against its own docs on 2026-10-24
//
// - claude — https://code.claude.com/docs/en/mcp (scopes, `.mcp.json`, "Precedence and
//   duplicates"). The Cortex plugin already declares the server in `.claude-plugin/plugin.json`
//   (`${CLAUDE_PLUGIN_ROOT}/mcp/server.js`, `CORTEX_ROOT=${CLAUDE_PROJECT_DIR}/.cortex`). A
//   `.mcp.json` entry would be matched against the plugin's by command, and a different path to
//   server.js makes it a second server with every tool listed twice. So `claude` writes nothing:
//   it reports whether the plugin is installed here, and the team-wide switch is
//   `index/cortex-shared-plugin.mjs --write`.
// - copilot (VS Code) — https://code.visualstudio.com/docs/copilot/reference/mcp-configuration.
//   `.vscode/mcp.json`, a top-level `servers` object, `type: "stdio"`, `command`, `args`, `env`.
//   Values take `${workspaceFolder}` and `${env:NAME}`, so the committed file names no path on any
//   one machine. Project scope.
// - copilot (cloud coding agent) — https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp.
//   Configured in the repository's settings on github.com (Settings > Copilot > MCP servers), not
//   in a file, and its runner has no Cortex checkout unless `copilot-setup-steps.yml` makes one.
//   Nothing is written; the plan says so.
// - gemini — https://geminicli.com/docs/tools/mcp-server/ and
//   https://geminicli.com/docs/reference/configuration/. `.gemini/settings.json`, a top-level
//   `mcpServers` object, `command`, `args`, `env`. "String values within your settings.json ...
//   can reference environment variables" (`$VAR`, `${VAR}`), so the command is
//   `${CORTEX_HOME}/mcp/server.js`. Gemini documents no variable for the workspace in
//   settings.json (`${workspacePath}` is for extension manifests only), so `CORTEX_ROOT` is the
//   relative `.cortex`. That holds because Gemini reads project settings only from
//   `<cwd>/.gemini/settings.json` and starts a server with no `cwd` in its own working directory
//   (gemini-cli source, `Storage` and `mcp-client.ts`, read the same day): whenever this file is
//   in force, the server starts at the repo root. Project scope.
// - codex — https://learn.chatgpt.com/docs/extend/mcp?surface=cli (was developers.openai.com/codex/mcp)
//   and https://learn.chatgpt.com/docs/config-file/config-basic.md. `[mcp_servers.<name>]` in
//   `config.toml`, `command`, `args`, `env`. A project `.codex/config.toml` exists (trusted projects
//   only), but Codex documents no variable expansion in it, so a committed file would carry this
//   machine's path to Cortex. User scope instead: `$CODEX_HOME/config.toml`, `~/.codex` by default
//   (https://learn.chatgpt.com/docs/config-file/environment-variables). `CORTEX_ROOT` is the
//   relative `.cortex`, so it names the repo Codex was started in — start Codex at the repo root.
//
// ## The instruction files each agent reads (same date)
//
// - Copilot — https://docs.github.com/en/copilot/reference/custom-instructions-support. AGENTS.md
//   is read by the cloud agent, Copilot CLI, code review on github.com and VS Code chat, and NOT by
//   JetBrains or Visual Studio chat, or code review inside an IDE; those read only
//   `.github/copilot-instructions.md`. So the copilot plan adds that file as a pointer when it is
//   absent, and never touches one a team wrote.
// - Gemini reads `GEMINI.md`; the one-line `@AGENTS.md` shim is `/write-context-docs`'s, and this adds
//   it only when it is missing.
// - Codex reads `AGENTS.md` natively (https://learn.chatgpt.com/docs/agent-configuration/agents-md).
//
// ## The merge discipline (the same as index/lib/shared-plugin.mjs)
//
// Parse first, and refuse a file that does not parse with a sentence — never repair it. An entry
// named `cortex` already there is left exactly as it is, whatever it says. Everything else stays
// byte-for-byte: JSON entries are inserted as text (`core/json-text.js`) and the result is parsed
// again and compared; the TOML table is appended, and the result must start with the old file.

import { isDeepStrictEqual } from "node:util";
import { insertUnder, skipWs, textStyle } from "../core/json-text.js";

export const AGENTS = ["claude", "copilot", "gemini", "codex"];
export const SERVER = "cortex";

/** The sentence the root brief carries on a team (#623, item 3). */
export const INBOX_LINE = "On a team, call the Cortex `inbox` tool (or run `ai-os inbox`) at the start of a task.";
export const INBOX_HEADING = "## Team-brain";

/** The pointer `.github/copilot-instructions.md` holds, for the Copilot surfaces that skip AGENTS.md. */
export const COPILOT_POINTER =
  "# Copilot instructions\n\n" +
  "This repository's instructions for AI agents are in [`AGENTS.md`](../AGENTS.md) at the root, with\n" +
  "scoped `AGENTS.md` files in some directories. Read the root one first and follow it; this file only\n" +
  "points there, so the two cannot disagree.\n";

export const GEMINI_SHIM = "@AGENTS.md\n";

/** A file Cortex will not write into. `code` lets a caller tell it from a bug. */
export class ConfigUnreadable extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigUnreadable";
    this.code = "config_unreadable";
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const slashes = (p) => p.replace(/\\/g, "/");

// --- the entries ----------------------------------------------------------------------------------

/** The server entry each agent gets. `server` is the absolute server.js, for user scope only. */
export function entryFor(agent, { server } = {}) {
  if (agent === "copilot") {
    return { type: "stdio", command: "node", args: ["${env:CORTEX_HOME}/mcp/server.js"], env: { CORTEX_ROOT: "${workspaceFolder}/.cortex" } };
  }
  if (agent === "gemini") {
    return { command: "node", args: ["${CORTEX_HOME}/mcp/server.js"], env: { CORTEX_ROOT: ".cortex" } };
  }
  if (agent === "codex") {
    return { command: "node", args: [slashes(server)], env: { CORTEX_ROOT: ".cortex" } };
  }
  throw new Error(`no server entry for ${agent}`);
}

// --- JSON: .vscode/mcp.json, .gemini/settings.json ------------------------------------------------

/**
 * Merge `{ [key]: { cortex: entry } }` into a JSON config text (`null` with no file). Returns
 * `{ text, action: "add" | "keep" }`; `text` is null on "keep". Throws `ConfigUnreadable`.
 */
export function mergeJsonServer(text, { label, key, entry }) {
  if (text === null || text === undefined) {
    return { action: "add", text: JSON.stringify({ [key]: { [SERVER]: entry } }, null, 2) + "\n" };
  }
  const bom = text.startsWith("﻿") ? "﻿" : "";
  let t = text.slice(bom.length);
  let doc;
  try {
    doc = JSON.parse(t);
  } catch (e) {
    // VS Code and Gemini both accept comments in these files; JSON.parse does not, and a merge that
    // cannot read every byte back does not write any.
    throw new ConfigUnreadable(`${label} is not plain JSON (${e.message}; comments or trailing commas are not read here), so Cortex will not write into it — add the entry by hand, or remove them and run again`);
  }
  if (!isObject(doc)) throw new ConfigUnreadable(`${label} is not a JSON object at the top, so Cortex will not write into it`);
  if (own(doc, key) && !isObject(doc[key])) throw new ConfigUnreadable(`\`${key}\` is not an object in ${label}, so Cortex will not write into it`);
  if (own(doc, key) && own(doc[key], SERVER)) return { action: "keep", text: null };

  const root = skipWs(t, 0);
  const expected = structuredClone(doc);
  if (own(expected, key)) expected[key][SERVER] = entry;
  else expected[key] = { [SERVER]: entry };
  t = insertUnder(t, root, key, SERVER, entry, textStyle(t, root));
  if (!isDeepStrictEqual(JSON.parse(t), expected)) {
    throw new Error(`merging into ${label} produced something other than the intended entry — nothing was written`);
  }
  return { action: "add", text: bom + t };
}

// --- TOML: config.toml ----------------------------------------------------------------------------
//
// Not a TOML parser. A scanner that accepts the statement shapes a config.toml is made of — blank
// lines, comments, `[table]` and `[[array]]` headers, and `key = value` where the value may run over
// several lines inside brackets or a multi-line string — and refuses anything else. It does not
// check a value's grammar: the only write is an append, so what must be true is that the file ENDS
// outside every string and bracket, and that no `cortex` server is already defined in any spelling.

const BARE = /^[A-Za-z0-9_-]+/;

/** Parse a dotted key at `s[i]`: `{ path, end }`, or null when it is not one. */
function dottedKey(s, i) {
  const path = [];
  for (;;) {
    while (s[i] === " " || s[i] === "\t") i++;
    let m;
    if (s[i] === '"') {
      let j = i + 1;
      let raw = "";
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === "\\") { raw += s[j] + s[j + 1]; j++; } else raw += s[j];
      }
      if (j >= s.length) return null;
      try { path.push(JSON.parse(`"${raw}"`)); } catch { return null; }
      i = j + 1;
    } else if (s[i] === "'") {
      const j = s.indexOf("'", i + 1);
      if (j === -1) return null;
      path.push(s.slice(i + 1, j));
      i = j + 1;
    } else if ((m = BARE.exec(s.slice(i)))) {
      path.push(m[0]);
      i += m[0].length;
    } else return null;
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] !== ".") return { path, end: i };
    i++;
  }
}

/** True when the rest of a line from `i` is blank or a comment. */
const restIsEmpty = (s, i) => /^[ \t]*(#.*)?$/.test(s.slice(i));

/**
 * Scan a value starting at `text[i]` to the end of its statement: across lines inside brackets or a
 * multi-line string, and to the end of the line otherwise. Returns the offset after the line's end,
 * or throws when the text ends inside a string or a bracket.
 */
function scanValue(text, i, label) {
  let depth = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const triple = text.startsWith(c.repeat(3), i);
      if (triple) {
        const close = text.indexOf(c.repeat(3), i + 3);
        if (close === -1) throw new ConfigUnreadable(`${label} ends inside a multi-line string, so Cortex will not write into it`);
        i = close + 2;
        while (text[i + 1] === c) i++; // up to two quotes may sit before the closing delimiter
        continue;
      }
      let j = i + 1;
      for (; j < text.length && text[j] !== c && text[j] !== "\n"; j++) if (c === '"' && text[j] === "\\") j++;
      if (text[j] !== c) throw new ConfigUnreadable(`${label} has a string that does not close on its line, so Cortex will not write into it`);
      i = j;
      continue;
    }
    if (c === "#") {
      const nl = text.indexOf("\n", i);
      if (nl === -1) return text.length;
      i = nl - 1;
      continue;
    }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      if (--depth < 0) throw new ConfigUnreadable(`${label} closes a bracket it never opened, so Cortex will not write into it`);
    } else if (c === "\n" && depth === 0) return i + 1;
  }
  if (depth !== 0) throw new ConfigUnreadable(`${label} ends inside an array or an inline table, so Cortex will not write into it`);
  return text.length;
}

/**
 * `{ present, why }`: is a `cortex` MCP server defined in this config.toml text, in any spelling —
 * `[mcp_servers.cortex]`, a sub-table of it, `cortex = {...}` under `[mcp_servers]`, or a dotted key.
 * Throws `ConfigUnreadable` for a text the scanner cannot read, and for one where appending a
 * `[mcp_servers.cortex]` table would not be valid TOML.
 */
export function scanToml(text, label = "config.toml") {
  const t = text.startsWith("﻿") ? text.slice(1) : text;
  let table = [];
  let present = false;
  let i = 0;
  const at = () => `${label}, line ${t.slice(0, i).split("\n").length}`;
  const starts = (path, prefix) => prefix.every((p, k) => path[k] === p);
  while (i < t.length) {
    const nl = t.indexOf("\n", i);
    const end = nl === -1 ? t.length : nl;
    const raw = t.slice(i, end).replace(/\r$/, "");
    const s = raw.trimStart();
    const off = raw.length - s.length;
    if (s === "" || s.startsWith("#")) {
      i = end + 1;
      continue;
    }
    if (s.startsWith("[[")) {
      const k = dottedKey(s, 2);
      if (!k || !s.slice(k.end).startsWith("]]") || !restIsEmpty(s, k.end + 2)) throw new ConfigUnreadable(`${at()} is not a header Cortex can read, so it will not write into ${label}`);
      if (k.path[0] === "mcp_servers") throw new ConfigUnreadable(`${label} declares \`mcp_servers\` as an array of tables, so a [mcp_servers.cortex] table cannot be added — add the server by hand`);
      table = k.path;
      i = end + 1;
      continue;
    }
    if (s.startsWith("[")) {
      const k = dottedKey(s, 1);
      if (!k || s[k.end] !== "]" || !restIsEmpty(s, k.end + 1)) throw new ConfigUnreadable(`${at()} is not a header Cortex can read, so it will not write into ${label}`);
      table = k.path;
      if (starts(table, ["mcp_servers", SERVER])) present = true;
      i = end + 1;
      continue;
    }
    const k = dottedKey(s, 0);
    if (!k || s[k.end] !== "=") throw new ConfigUnreadable(`${at()} is neither a table header nor \`key = value\`, so Cortex will not write into ${label}`);
    const full = [...table, ...k.path];
    if (starts(full, ["mcp_servers", SERVER])) present = true;
    else if (full[0] === "mcp_servers" && !starts(table, ["mcp_servers"])) {
      // `mcp_servers = { ... }` or `mcp_servers.x.command = ...` outside a [mcp_servers...] header.
      // An inline table cannot be extended by a later header, and a dotted-key table is a case this
      // scanner does not reason about; either way the safe answer is to leave the file alone.
      throw new ConfigUnreadable(`${label} defines \`mcp_servers\` inline or with dotted keys (${at()}), so Cortex will not add a table beside it — add the server by hand`);
    }
    const valueStart = i + off + k.end + 1;
    const next = scanValue(t, valueStart, label);
    i = next;
  }
  return { present };
}

/** One TOML basic string. JSON's escapes are a subset of TOML's for every character it emits. */
const tomlString = (s) => JSON.stringify(s);

/** The `[mcp_servers.cortex]` table, in the file's own line ending. */
export function tomlTable(entry, eol = "\n") {
  const env = Object.entries(entry.env).map(([k, v]) => `${k} = ${tomlString(v)}`).join(", ");
  return [
    `[mcp_servers.${SERVER}]`,
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(", ")}]`,
    `env = { ${env} }`,
  ].join(eol) + eol;
}

/**
 * Append `[mcp_servers.cortex]` to a config.toml text (`null` with no file). Returns
 * `{ text, action: "add" | "keep" }`. Throws `ConfigUnreadable`.
 */
export function mergeTomlServer(text, { label, entry }) {
  if (text === null || text === undefined) return { action: "add", text: tomlTable(entry) };
  if (scanToml(text, label).present) return { action: "keep", text: null };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let sep = "";
  if (text.length && !text.endsWith("\n")) sep = eol + eol;
  else if (text.trim().length && !text.endsWith(eol + eol)) sep = eol;
  const out = text + sep + tomlTable(entry, eol);
  // An append is trusted once the old file is still its exact prefix and the scanner, reading the
  // whole result, finds the server it was meant to add.
  if (!out.startsWith(text) || !scanToml(out, label).present) {
    throw new Error(`appending to ${label} produced something other than the intended table — nothing was written`);
  }
  return { action: "add", text: out };
}

// --- the instruction files ------------------------------------------------------------------------

/** Append the inbox line to a root brief's text, under its own heading unless one is there. */
export function withInboxLine(text) {
  if (text.includes(INBOX_LINE)) return null;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lead = text.endsWith(eol + eol) ? "" : text.endsWith("\n") ? eol : eol + eol;
  const hasHeading = text.split(/\r?\n/).some((l) => l.trim() === INBOX_HEADING);
  return text + lead + (hasHeading ? "" : INBOX_HEADING + eol + eol) + INBOX_LINE + eol;
}
