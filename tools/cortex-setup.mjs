#!/usr/bin/env node
// cortex-setup.mjs — register the Cortex MCP server in each agent a team uses (#623).
//
//   node tools/cortex-setup.mjs --agents claude,copilot,gemini,codex [--repo <dir>] [--json]
//                                                    # the plan: what --write would do; writes nothing
//   node tools/cortex-setup.mjs --agents copilot,gemini --write
//                                                    # ...and do it
//
// A team rarely uses one agent, and an ask sent to a role reaches nobody if that role's developer
// runs an agent with no Cortex in it. MCP plus the `ai-os` CLI is the contract every agent shares
// (design R15–R16, docs/specs/2026-10-24-team-brain-rollout-design.md); this puts the server in
// each agent's own config:
//
//   claude   nothing written — the Cortex plugin declares the server; the plan says whether the
//            plugin is installed here, and how to switch it on for the whole team
//   copilot  .vscode/mcp.json        project scope, committed once for the team
//            (the cloud coding agent is configured on github.com, not in a file: the plan says how)
//   gemini   .gemini/settings.json   project scope, committed once for the team
//   codex    $CODEX_HOME/config.toml user scope: Codex expands no variables, so a committed file
//            would carry this machine's path
//
// Where each agent reads its config, and the doc URLs and date each was checked, are in the header
// of `_setup-agents.mjs`, beside the code that writes them.
//
// The committed files name no path on any machine. They start `${CORTEX_HOME}/mcp/server.js`, so
// each developer sets CORTEX_HOME once to wherever their Cortex checkout lives; the plan says
// whether it is set here. Codex, at user scope, gets this machine's absolute path instead.
//
// Next to each agent's config, the files it reads instructions from: `.github/copilot-instructions.md`
// (a pointer to AGENTS.md, for the Copilot surfaces that do not read AGENTS.md) and `GEMINI.md`
// (`@AGENTS.md`), each added only when absent. On a team's repo (a `.cortex/connector.json`), the
// root AGENTS.md gains one line telling any agent to read its inbox at the start of a task.
//
// Prints before it writes (ADR 0009): without `--write` nothing is written, and `--dry-run` says
// the same thing explicitly. Every file is merged, never replaced — an entry named `cortex` already
// there is left exactly as it is, and a file that does not parse is refused with a sentence. If any
// file is refused, `--write` writes none of them.
//
// Exit codes: 1 for a bad argument, 2 for a file Cortex will not write into.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installedHere, readRegistry } from "../core/plugin-registry.js";
import {
  AGENTS, COPILOT_POINTER, ConfigUnreadable, GEMINI_SHIM, INBOX_LINE,
  entryFor, mergeJsonServer, mergeTomlServer, withInboxLine,
} from "./_setup-agents.mjs";

const CORTEX_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "usage: node tools/cortex-setup.mjs --agents claude,copilot,gemini,codex [--repo <dir>] [--write | --dry-run] [--json]";

const fail = (text, code) => {
  process.stderr.write(text.endsWith("\n") ? text : text + "\n");
  process.exit(code);
};

// --- arguments ---------------------------------------------------------------------------------------

const args = { agents: null, repo: process.cwd(), write: false, dryRun: false, json: false };
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) fail(`${a} needs a value\n${USAGE}`, 1);
      return v;
    };
    if (a === "--agents") args.agents = value();
    else if (a.startsWith("--agents=")) args.agents = a.slice(9);
    else if (a === "--repo") args.repo = value();
    else if (a === "--write") args.write = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--json") args.json = true;
    else if (a === "-h" || a === "--help") { console.log(USAGE); process.exit(0); }
    else fail(`unknown argument: ${a}\n${USAGE}`, 1);
  }
}
if (!args.agents) fail(`--agents is required\n${USAGE}`, 1);
if (args.write && args.dryRun) fail(`--write and --dry-run contradict each other\n${USAGE}`, 1);
const agents = [...new Set(args.agents.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
const unknown = agents.filter((a) => !AGENTS.includes(a));
if (!agents.length || unknown.length) fail(`unknown agent${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ") || "(none given)"} — one or more of ${AGENTS.join(", ")}\n${USAGE}`, 1);
const repo = resolve(args.repo);
try {
  if (!statSync(repo).isDirectory()) fail(`--repo is not a directory: ${repo}`, 1);
} catch {
  fail(`--repo does not exist: ${repo}`, 1);
}

// --- what is on this machine --------------------------------------------------------------------------

const env = process.env;
const hasServer = (dir) => existsSync(join(dir, "mcp", "server.js"));
const cortexHome = (() => {
  const v = env.CORTEX_HOME?.trim();
  if (!v) return { state: "unset", value: null };
  return { state: hasServer(v) ? "ok" : "wrong", value: v };
})();
// The server a user-scope config starts: CORTEX_HOME when it names a Cortex, else this checkout.
const serverPath = join(cortexHome.state === "ok" ? cortexHome.value : CORTEX_DIR, "mcp", "server.js");

const codexHome = env.CODEX_HOME?.trim() || join(homedir(), ".codex");

/** A file's text, or null when there is none. A path that is there and is not a file is refused. */
function readText(abs, label) {
  let st;
  try {
    st = statSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile()) throw new ConfigUnreadable(`${label} is not a file, so Cortex will not write into it`);
  return readFileSync(abs, "utf8");
}

// --- the plan -----------------------------------------------------------------------------------------
//
// One row per file: { agent, label, abs, scope, action: add|keep|none|refused, text?, note }.
// `none` is a row that writes nothing by design (claude, the coding agent).

const rows = [];
const plan = (row) => {
  try {
    const before = readText(row.abs, row.label);
    const merged = row.merge(before);
    rows.push({ ...row, action: merged.action, text: merged.text, created: before === null });
  } catch (e) {
    if (e.code !== "config_unreadable") throw e;
    rows.push({ ...row, action: "refused", note: e.message });
  }
};

const COMMIT = "project scope — commit it once for the team";

for (const agent of agents) {
  if (agent === "claude") {
    const reg = readRegistry();
    const here = reg.state === "read" && installedHere(reg.plugins, "cortex", repo);
    rows.push({
      agent, label: "(the Cortex plugin)", scope: "plugin", action: "none",
      note: (here
        ? "The Cortex plugin is installed here and already starts the server; nothing to write."
        : "The Cortex plugin starts the server; install it with: claude plugin install cortex@cortex.") +
        " A .mcp.json entry would be a second copy of the same server. To switch the plugin on for the whole team: node index/cortex-shared-plugin.mjs . --write",
    });
  }
  if (agent === "copilot") {
    const label = ".vscode/mcp.json";
    plan({ agent, label, abs: join(repo, ".vscode", "mcp.json"), scope: COMMIT, merge: (t) => mergeJsonServer(t, { label, key: "servers", entry: entryFor("copilot") }) });
    rows.push({
      agent, label: "(Copilot coding agent)", scope: "github.com", action: "none",
      note: "The cloud coding agent reads MCP servers from the repository's Settings > Copilot > MCP servers on github.com, not from a file, and its runner has no Cortex unless copilot-setup-steps.yml checks one out. Nothing is written for it.",
    });
  }
  if (agent === "gemini") {
    const label = ".gemini/settings.json";
    plan({ agent, label, abs: join(repo, ".gemini", "settings.json"), scope: COMMIT, merge: (t) => mergeJsonServer(t, { label, key: "mcpServers", entry: entryFor("gemini") }) });
  }
  if (agent === "codex") {
    const abs = join(codexHome, "config.toml");
    const label = env.CODEX_HOME?.trim() ? "$CODEX_HOME/config.toml" : "~/.codex/config.toml";
    if (env.CODEX_HOME?.trim() && !existsSync(codexHome)) {
      // Codex requires the directory to exist before CODEX_HOME points at it; creating it here would
      // hide a misspelt variable.
      rows.push({ agent, label, abs, scope: "user scope", action: "refused", note: `CODEX_HOME is set to ${codexHome}, which does not exist; Codex requires it to, so Cortex will not create it` });
    } else {
      plan({
        agent, label, abs, scope: "user scope — Codex expands no variables, so a committed file would carry this machine's path",
        merge: (t) => mergeTomlServer(t, { label, entry: entryFor("codex", { server: serverPath }) }),
        note: "CORTEX_ROOT is .cortex, relative: start Codex at the repo root.",
      });
    }
  }
}

// The instruction files. Each is added only when absent, and only beside a root AGENTS.md to point at.
const brief = join(repo, "AGENTS.md");
const hasBrief = existsSync(brief);
const shim = (agent, rel, text) => {
  const abs = join(repo, ...rel.split("/"));
  if (existsSync(abs)) rows.push({ agent, label: rel, abs, scope: "instructions", action: "keep", note: "already there; left as it is" });
  else if (!hasBrief) rows.push({ agent, label: rel, abs, scope: "instructions", action: "none", note: "no root AGENTS.md to point at — /write-context-docs writes it, then run this again" });
  else rows.push({ agent, label: rel, abs, scope: "instructions", action: "add", text, created: true });
};
if (agents.includes("copilot")) shim("copilot", ".github/copilot-instructions.md", COPILOT_POINTER);
if (agents.includes("gemini")) shim("gemini", "GEMINI.md", GEMINI_SHIM);

// On a team, the root brief tells any agent to read its inbox — the MCP `instructions` say the same
// to a connected session; this is for the session whose server is not running.
const connected = existsSync(join(repo, ".cortex", "connector.json"));
if (connected && hasBrief) {
  try {
    const next = withInboxLine(readText(brief, "AGENTS.md"));
    rows.push({ agent: "team", label: "AGENTS.md", abs: brief, scope: "the inbox line", action: next === null ? "keep" : "add", verb: "add the inbox line", text: next, note: next === null ? "already says to read the inbox" : `adds: ${INBOX_LINE}` });
  } catch (e) {
    if (e.code !== "config_unreadable") throw e;
    rows.push({ agent: "team", label: "AGENTS.md", abs: brief, scope: "the inbox line", action: "refused", note: e.message });
  }
}

const refused = rows.filter((r) => r.action === "refused");
const writes = rows.filter((r) => r.action === "add");
const projectScope = rows.some((r) => r.scope === COMMIT && r.action !== "refused");

// --- writing ------------------------------------------------------------------------------------------

let wrote = [];
if (args.write && !refused.length) {
  for (const r of writes) {
    mkdirSync(dirname(r.abs), { recursive: true });
    const tmp = `${r.abs}.cortex-tmp`;
    try {
      writeFileSync(tmp, r.text);
      renameSync(tmp, r.abs);
      wrote.push(r.label);
    } catch (e) {
      rmSync(tmp, { force: true });
      fail(`could not write ${r.label}: ${e.message}${wrote.length ? `\nAlready written: ${wrote.join(", ")}.` : "\nNothing was written."}`, 2);
    }
  }
}

// --- the report ---------------------------------------------------------------------------------------

const homeLine = () => {
  if (!projectScope) return null;
  if (cortexHome.state === "ok") return `CORTEX_HOME is ${cortexHome.value} on this machine; the committed configs start Cortex from there.`;
  const how = process.platform === "win32" ? `setx CORTEX_HOME "${CORTEX_DIR}"` : `export CORTEX_HOME="${CORTEX_DIR}" in your shell profile`;
  const fix = `set it to a Cortex checkout — this one is ${CORTEX_DIR}: ${how}, then restart the editor`;
  if (cortexHome.state === "wrong") return `CORTEX_HOME is ${cortexHome.value}, which holds no mcp/server.js: ${fix}.`;
  return `CORTEX_HOME is not set. The committed configs start \${CORTEX_HOME}/mcp/server.js, so each teammate sets it once: ${fix}.`;
};

if (args.json) {
  console.log(JSON.stringify({
    repo,
    write: args.write && !refused.length,
    cortexHome: { ...cortexHome, cortex: CORTEX_DIR },
    files: rows.map(({ agent, label, scope, action, note, created }) => ({ agent, path: label, scope, action, ...(created !== undefined && action === "add" ? { created } : {}), ...(note ? { note } : {}) })),
    wrote,
  }, null, 2));
  process.exit(refused.length ? 2 : 0);
}

const VERB = { add: "add", keep: "keep", none: "—", refused: "REFUSED" };
console.log(`Cortex for ${agents.join(", ")} in ${repo}`);
console.log("");
for (const r of rows) {
  const what = r.action === "add" ? (r.verb ?? (r.created ? "create" : "add the cortex entry")) : VERB[r.action];
  console.log(`${r.agent.padEnd(8)} ${r.label}  [${r.scope}]  ${what}`);
  if (r.action === "keep" && r.scope !== "instructions" && r.agent !== "team") console.log(`${" ".repeat(9)}a cortex entry is already there; left exactly as it is`);
  if (r.note) console.log(`${" ".repeat(9)}${r.note}`);
}
const h = homeLine();
if (h) console.log(`\n${h}`);
console.log("");
if (refused.length) {
  console.log(`Nothing was written: ${refused.length === 1 ? "a file was" : `${refused.length} files were`} refused above. Fix ${refused.length === 1 ? "it" : "them"} or leave that agent out, and run again.`);
  process.exit(2);
}
if (!args.write) {
  console.log(writes.length ? `A dry run: nothing was written. Run again with --write to write ${writes.length === 1 ? "it" : `these ${writes.length} files`}.` : "Nothing to write.");
  process.exit(0);
}
if (!wrote.length) {
  console.log("Nothing to write: every entry is already there.");
  process.exit(0);
}
console.log(`Wrote ${wrote.join(", ")}.`);
const commit = rows.filter((r) => wrote.includes(r.label) && r.scope !== "user scope" && !r.scope.startsWith("user scope")).map((r) => r.label);
if (commit.length) console.log(`Commit them so the whole team gets them: git add ${commit.join(" ")}`);
