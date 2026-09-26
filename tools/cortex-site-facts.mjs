#!/usr/bin/env node
// cortex-site-facts.mjs — the facts a public page states about Cortex, read from the source.
//
//   node tools/cortex-site-facts.mjs                    # print site-facts.json to stdout
//   node tools/cortex-site-facts.mjs --out <file>       # write it
//   node tools/cortex-site-facts.mjs --check <file>     # exit 1 and name each fact that changed since <file>
//   node tools/cortex-site-facts.mjs --check <file> --json
//   node tools/cortex-site-facts.mjs --root <dir>       # read a checkout other than this one
//
// The public site drifted from v0.15 to v2.38 without anything noticing (#415), because it was a
// hand-kept copy of facts that live here. This extracts those facts — version, Node floor, install
// commands, the rituals, the MCP tools — so the site can render them instead of restating them, and
// `--check` can say exactly which ones moved since the site last synced (#416).
//
// Deterministic by construction: keys sorted, rituals and tools sorted by name, no timestamps, so
// two runs over the same tree are byte-identical and a diff of the file is a diff of the facts.
// No network: every fact comes from a file in the checkout or from the checkout's own MCP server,
// spawned locally over stdio.
//
// Exit codes: 0 facts written / nothing drifted · 1 --check found changes · 2 a fact could not be
// extracted (a ritual table row with no skill, a missing README heading, a server that would not
// answer). A 2 is never a pass: a page rendered from half the facts is the failure this exists for.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./cortex-frontmatter.mjs";

const SCHEMA = 1;
const INSTALL_HEADING = "Install as a Claude plugin";

class FactError extends Error {}

const read = (root, rel) => readFileSync(join(root, rel), "utf8").replace(/\r/g, "");

// --- the facts ------------------------------------------------------------------------------------

function version(root) {
  return read(root, "VERSION").trim();
}

function nodeFloor(root) {
  const pkg = JSON.parse(read(root, "mcp/package.json"));
  const floor = pkg.engines?.node;
  if (!floor) throw new FactError("mcp/package.json declares no engines.node — the Node floor has no source");
  return floor;
}

/**
 * Every line of every fenced block between the install heading and the next heading of any level.
 * Keyed off the heading's words, not its position or its emoji, so rewording the paragraph around
 * the commands does not move the fact — removing the heading does, and says so.
 */
function installCommands(root) {
  const lines = read(root, "README.md").split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.includes(INSTALL_HEADING));
  if (start === -1) {
    throw new FactError(`README.md has no heading containing "${INSTALL_HEADING}" — the install commands have no source`);
  }
  const commands = [];
  let inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) { if (line.trim()) commands.push(line.trim()); continue; }
    if (/^#{1,6}\s/.test(line)) break;
  }
  if (commands.length === 0) throw new FactError(`README.md's "${INSTALL_HEADING}" section has no fenced commands`);
  return commands;
}

/** `| `/name` | when | does |` rows of AGENTS.md's ritual table. */
function ritualRows(root) {
  const rows = new Map();
  for (const line of read(root, "AGENTS.md").split("\n")) {
    const m = line.match(/^\|\s*`\/([a-z0-9-]+)`\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const cells = m[2].split("|").map((c) => c.trim());
    if (cells.length !== 2) throw new FactError(`AGENTS.md row for /${m[1]} has ${cells.length + 1} cells, not 3 (ritual | when | does)`);
    if (rows.has(m[1])) throw new FactError(`AGENTS.md lists /${m[1]} twice`);
    rows.set(m[1], { when: cells[0], does: cells[1] });
  }
  return rows;
}

/**
 * The ritual table joined with the skill folders. Disagreement fails rather than picking a side:
 * a row with no skill advertises a command that does not exist, and a skill with no row is the
 * partial-table failure ritual-table.test.sh was written about.
 */
function rituals(root) {
  const rows = ritualRows(root);
  const dirs = readdirSync(join(root, "skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, "skills", d.name, "SKILL.md")))
    .map((d) => d.name);

  const noRow = dirs.filter((d) => !rows.has(d));
  const noSkill = [...rows.keys()].filter((r) => !dirs.includes(r));
  const problems = [
    ...noRow.map((d) => `skills/${d}/ has no row in AGENTS.md's ritual table`),
    ...noSkill.map((r) => `AGENTS.md lists /${r} but there is no skills/${r}/SKILL.md`),
  ];
  if (problems.length) throw new FactError(`the ritual table and the skill folders disagree:\n  ${problems.join("\n  ")}`);

  return dirs.map((name) => {
    const { data } = parseFrontmatter(read(root, `skills/${name}/SKILL.md`));
    const invocation = data["disable-model-invocation"]?.trim() === "true" ? "user" : "model";
    return { name, when: rows.get(name).when, does: rows.get(name).does, invocation };
  });
}

/** Ask the checkout's own server what it advertises, pointed at a throwaway root of the given mode. */
function listTools(root, mode) {
  const base = mkdtempSync(join(tmpdir(), "cortex-facts-"));
  const brain = mode === "repo" ? join(base, "repo", ".cortex") : join(base, "vault");
  // A clean environment for the answer: a CORTEX_* variable from the caller's shell (profile,
  // audience, a connector override) is a fact about that shell, not about the product.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CORTEX_") && k !== "AI_OS_ROOT"));
  env.AI_OS_ROOT = brain;

  const child = spawn(process.execPath, [join(root, "mcp", "server.js")], { cwd: base, env, stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise((res) => child.once("exit", res));
  let out = "";
  let err = "";
  child.stderr.on("data", (d) => { err += d; });

  const answered = new Promise((res, rej) => {
    child.stdout.on("data", (d) => {
      out += d;
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) return res(msg);
      }
    });
    child.once("error", rej);
    child.once("exit", (code) => rej(new FactError(`mcp/server.js (${mode} mode) exited ${code} before answering tools/list\n${err.trim()}`)));
    setTimeout(() => rej(new FactError(`mcp/server.js (${mode} mode) did not answer tools/list within 10s\n${err.trim()}`)), 10_000).unref();
  });

  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cortex-site-facts", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

  const finish = async () => {
    child.stdin.end();
    child.kill();
    await exited; // Windows pins a live process's cwd; the rmSync below would find it locked
    rmSync(base, { recursive: true, force: true, maxRetries: 3 });
  };
  return answered.then(
    async (msg) => { await finish(); return msg.result.tools; },
    async (e) => { await finish(); throw e; },
  );
}

const lastSentence = (s) => s.trim().split(/(?<=[.!?])\s+/).pop();

/**
 * Tools from both modes, merged by name. The trust-boundary warning the server appends to every
 * tool that returns other people's text is for the model, not for a reader of the site: a closing
 * sentence shared verbatim by two or more tools is that boilerplate, and is dropped.
 */
async function mcpTools(root) {
  const byName = new Map();
  for (const mode of ["repo", "vault"]) {
    for (const t of await listTools(root, mode)) {
      const entry = byName.get(t.name) ?? { name: t.name, modes: [], description: t.description ?? "" };
      entry.modes.push(mode);
      byName.set(t.name, entry);
    }
  }
  const tools = [...byName.values()];
  const tally = new Map();
  for (const t of tools) tally.set(lastSentence(t.description), (tally.get(lastSentence(t.description)) ?? 0) + 1);
  for (const t of tools) {
    const last = lastSentence(t.description);
    if (tally.get(last) >= 2 && last !== t.description.trim()) {
      t.description = t.description.trim().slice(0, -last.length).trim();
    }
  }
  return tools;
}

// --- output ---------------------------------------------------------------------------------------

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export async function extractFacts(root) {
  const facts = {
    schema: SCHEMA,
    version: version(root),
    node: nodeFloor(root),
    install: { commands: installCommands(root) },
    rituals: rituals(root).sort(byName),
    mcpTools: (await mcpTools(root)).map((t) => ({ ...t, modes: t.modes.sort() })).sort(byName),
  };
  return sortKeys(facts);
}

export const serialize = (facts) => `${JSON.stringify(facts, null, 2)}\n`;

/** One plain line per fact that moved between `was` (the synced copy) and `now`. */
export function diffFacts(was, now) {
  const out = [];
  if (was.schema !== now.schema) out.push(`schema ${was.schema} → ${now.schema}`);
  if (was.version !== now.version) out.push(`version ${was.version} → ${now.version}`);
  if (was.node !== now.node) out.push(`Node floor ${was.node} → ${now.node}`);

  const wasCmds = was.install?.commands ?? [];
  const nowCmds = now.install?.commands ?? [];
  if (JSON.stringify(wasCmds) !== JSON.stringify(nowCmds)) {
    const added = nowCmds.filter((c) => !wasCmds.includes(c));
    const removed = wasCmds.filter((c) => !nowCmds.includes(c));
    const detail = [...added.map((c) => `added "${c}"`), ...removed.map((c) => `removed "${c}"`)];
    out.push(`install command changed${detail.length ? ` (${detail.join(", ")})` : " (reordered)"}`);
  }

  const compare = (label, prefix, before = [], after = [], fields) => {
    const b = new Map(before.map((x) => [x.name, x]));
    const a = new Map(after.map((x) => [x.name, x]));
    for (const name of [...new Set([...b.keys(), ...a.keys()])].sort()) {
      const id = `${label} ${prefix}${name}`;
      if (!b.has(name)) { out.push(`${id} added`); continue; }
      if (!a.has(name)) { out.push(`${id} removed`); continue; }
      for (const f of fields) {
        const x = JSON.stringify(b.get(name)[f]);
        const y = JSON.stringify(a.get(name)[f]);
        if (x === y) continue;
        out.push(f === "description" || f === "when" || f === "does"
          ? `${id} ${f} changed`
          : `${id} ${f} ${[b.get(name)[f]].flat().join(", ")} → ${[a.get(name)[f]].flat().join(", ")}`);
      }
    }
  };
  compare("ritual", "/", was.rituals, now.rituals, ["when", "does", "invocation"]);
  compare("MCP tool", "", was.mcpTools, now.mcpTools, ["description", "modes"]);
  return out;
}

// --- cli ------------------------------------------------------------------------------------------

async function main(argv) {
  const opt = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const root = resolve(opt("--root") ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  const outFile = opt("--out");
  const checkFile = opt("--check");
  const asJson = argv.includes("--json");

  let facts;
  try {
    facts = await extractFacts(root);
  } catch (e) {
    if (!(e instanceof FactError) && e.code !== "ENOENT") throw e;
    console.error(`cortex-site-facts: ${e.message}`);
    return 2;
  }

  if (checkFile) {
    let was;
    try {
      was = JSON.parse(readFileSync(checkFile, "utf8"));
    } catch (e) {
      console.error(`cortex-site-facts: cannot read ${checkFile} as site facts — ${e.message}`);
      return 2;
    }
    const changes = diffFacts(was, facts);
    if (asJson) process.stdout.write(`${JSON.stringify({ changes }, null, 2)}\n`);
    else if (changes.length) for (const c of changes) console.log(c);
    else console.log(`site facts match ${checkFile}`);
    return changes.length ? 1 : 0;
  }

  if (outFile) writeFileSync(outFile, serialize(facts));
  else process.stdout.write(serialize(facts));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
