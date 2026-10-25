// _pack.mjs — what a role pack holds, and the test a skill must pass to be in one.
//
// A library, not a tool (the leading `_`): `tools/cortex-pack.mjs` is the CLI over it, and
// `tools/test/cortex-pack.test.sh` drives both. Pure apart from reading `skills/`, the plugin
// manifest and `VERSION`: no clock, no network, no environment. The same tree gives the same bytes.
//
// R2 of docs/specs/2026-10-25-role-packs-design.md. A person who works in Claude Code installs the
// plugin. Everyone else, in Claude Desktop, claude.ai or another assistant, installs a pack: the
// skills their job is offered (`JOB_SKILLS`, core/job.js) in the Agent Skills format, plus the MCP
// configuration that reaches the Cortex server. A pack is generated from `skills/` and never
// committed, so there is one copy of every skill.
//
// ## Portable, defined narrowly
//
// A skill goes in a pack only when it works with nothing Claude Code provides. Checked on every
// file the skill ships, after the adaptation below:
//
//   1. It names no variable only Claude Code sets: `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PROJECT_DIR`.
//   2. It runs no Cortex script: no `node` (or `bash`, `sh`) command naming a path under `tools/`,
//      `index/` or `mcp/`. Outside Claude Code there is no checkout to run them from; a pack skill
//      reaches the team-brain through the MCP tools instead.
//   3. It does not rely on Claude Code to keep it from starting by itself
//      (`disable-model-invocation: true`). Other assistants have no such switch, and that flag
//      marks a ritual that is once-only or destructive.
//   4. Its frontmatter parses (cortex-frontmatter.mjs), its name is the folder's and is at most 64
//      characters of a-z, 0-9 and -, and its description is at most 1,024 characters.
//   5. Every relative link resolves: inside the skill's folder as it is, outside it to a file in
//      this repository, which the link is rewritten to name on the release (see below).
//   6. It ships only text files the check can read (.md, .yaml, .yml, .json, .txt).
//
// A skill that fails is not adapted further and not packed. It is listed in the pack's README and
// `pack.json` under "needs Claude Code", with every reason, so the person knows what they lack.
// Prose that mentions a ritual by its `/slash` name is fine: another assistant reads it as a name.
//
// ## The adaptation
//
// - Frontmatter keeps the Agent Skills keys (`AGENT_SKILLS_KEYS`) and drops the Claude Code ones
//   (`effort`, `argument-hint` and any other). `metadata` is kept whole.
// - A link out of the skill's folder becomes `<repository>/blob/v<VERSION>/<path>`, the file as
//   released. The pack is built for the release it is attached to.
// - Line endings become LF, so a Windows checkout builds the same bytes as a Linux one.
//
// ## Determinism
//
// Every list is sorted. The zips are STORED, not deflated: compressed output can change with the
// zlib a Node release bundles, and a skill is a few kilobytes. Every entry carries the same date,
// 1980-01-01, the earliest a zip can hold, and no file carries a build time.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { JOBS, JOB_SKILLS } from "../core/job.js";
import { scan } from "../core/scrub.js";
import { parseFrontmatter } from "./cortex-frontmatter.mjs";
import { entryFor, tomlTable } from "./_setup-agents.mjs";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The frontmatter keys the Agent Skills format defines. Every other key is dropped. */
export const AGENT_SKILLS_KEYS = Object.freeze(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);

const TEXT_EXT = /\.(md|ya?ml|json|txt)$/i;
const CLAUDE_ONLY_VARS = /\bCLAUDE_(PLUGIN_ROOT|PROJECT_DIR)\b/;
// A command that runs a file under tools/, index/ or mcp/: `node "${X}/index/cortex-index.mjs"`,
// `node tools/cortex-pack.mjs`, `bash tools/cortex-init.sh`. The path may be quoted or prefixed.
const RUNS_SCRIPT = /\b(node|bash|sh)\s+["']?[^\s"']*\b(tools|index|mcp)\/[\w./-]*\w/;
const NAME = /^[a-z0-9-]{1,64}$/;
const DESCRIPTION_MAX = 1024;

/** `VERSION` and the plugin manifest's `repository`, read from a checkout. */
export function releaseOf(root = REPO_ROOT) {
  const version = readFileSync(join(root, "VERSION"), "utf8").trim();
  const manifest = JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8"));
  const repository = String(manifest.repository ?? "").replace(/\.git$/, "").replace(/\/+$/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`VERSION is not x.y.z: ${version}`);
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("the plugin manifest names no GitHub repository");
  return { version, repository };
}

/** Every file under `dir`, as sorted posix paths relative to it. */
function filesUnder(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) filesUnder(p, base, out);
    else out.push(relative(base, p).split(sep).join("/"));
  }
  return out;
}

/** The text with code fences and code spans blanked to spaces. Same length, so offsets hold. */
function maskCode(text) {
  let fence = null;
  const lines = text.split("\n").map((line) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return " ".repeat(line.length);
    }
    if (m) {
      fence = m[1];
      return " ".repeat(line.length);
    }
    return line.replace(/(`+)[^`]*?\1/g, (s) => " ".repeat(s.length));
  });
  return lines.join("\n");
}

/** Keep the Agent Skills keys of a frontmatter block, and every line nested under a kept key. */
function adaptFrontmatter(text) {
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  const out = [lines[0]];
  let keep = false;
  for (let i = 1; i < end; i++) {
    const top = /^([A-Za-z0-9_-]+):/.exec(lines[i]);
    if (top) keep = AGENT_SKILLS_KEYS.includes(top[1]);
    if (keep) out.push(lines[i]);
  }
  return [...out, ...lines.slice(end)].join("\n");
}

/**
 * Rewrite the relative links in one file. Returns the new text and the problems found: a link to a
 * file that is not there, in the skill's folder or out of it.
 */
function adaptLinks(text, { fileAbs, skillDir, root, release }) {
  const masked = maskCode(text);
  const problems = [];
  const edits = [];
  for (const m of masked.matchAll(/\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
    const target = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || /[<{$]/.test(target) || target.startsWith("#")) continue;
    const hash = target.indexOf("#");
    const path = hash === -1 ? target : target.slice(0, hash);
    const anchor = hash === -1 ? "" : target.slice(hash);
    const abs = resolve(dirname(fileAbs), decodeURIComponent(path));
    const inSkill = abs === skillDir || abs.startsWith(skillDir + sep);
    if (!existsSync(abs)) {
      problems.push(`links to ${target}, which is not there`);
      continue;
    }
    if (inSkill) continue;
    const inRepo = abs.startsWith(root + sep);
    if (!inRepo) {
      problems.push(`links to ${target}, which is outside the repository`);
      continue;
    }
    const rel = relative(root, abs).split(sep).join("/");
    const kind = statSync(abs).isDirectory() ? "tree" : "blob";
    const url = `${release.repository}/${kind}/v${release.version}/${rel}${anchor}`;
    edits.push({ at: m.index + m[0].indexOf(target), length: target.length, url });
  }
  let out = text;
  for (const e of edits.reverse()) out = out.slice(0, e.at) + e.url + out.slice(e.at + e.length);
  return { text: out, problems };
}

/**
 * One skill, judged and adapted. `files` is `[{ rel, text }]` with `rel` relative to the skill's
 * folder, sorted; it is empty when the skill is not portable, and `reasons` says why.
 *
 * @returns {{ name: string, portable: boolean, reasons: string[], files: { rel: string, text: string }[] }}
 */
export function judgeSkill(name, { root: given = REPO_ROOT, release = releaseOf(given) } = {}) {
  // Resolved once, so a root spelt with forward slashes on Windows still contains its own files.
  const root = resolve(given);
  const skillDir = join(root, "skills", name);
  const reasons = [];
  const say = (why) => { if (!reasons.includes(why)) reasons.push(why); };
  if (!existsSync(join(skillDir, "SKILL.md"))) return { name, portable: false, reasons: ["has no SKILL.md"], files: [] };

  const src = readFileSync(join(skillDir, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  const fm = parseFrontmatter(src);
  if (fm.errors.length) say(`its frontmatter does not parse (${fm.errors[0].msg})`);
  if (fm.data.name !== name || !NAME.test(name)) say("its name must be the folder's, at most 64 characters of a-z, 0-9 and -");
  if (typeof fm.data.description !== "string" || fm.data.description.length > DESCRIPTION_MAX) {
    say(`its description must be text of at most ${DESCRIPTION_MAX} characters`);
  }
  if (fm.data["disable-model-invocation"] === "true") {
    say("relies on Claude Code to keep it from starting by itself (disable-model-invocation)");
  }

  const files = [];
  for (const rel of filesUnder(skillDir)) {
    if (!TEXT_EXT.test(rel)) { say(`ships ${rel}, which the portable check cannot read`); continue; }
    const fileAbs = join(skillDir, ...rel.split("/"));
    let text = rel === "SKILL.md" ? adaptFrontmatter(src) : readFileSync(fileAbs, "utf8").replace(/\r\n/g, "\n");
    if (CLAUDE_ONLY_VARS.test(text)) say(`${rel} uses a variable only Claude Code sets (${CLAUDE_ONLY_VARS.exec(text)[0]})`);
    const run = RUNS_SCRIPT.exec(text);
    if (run) say(`${rel} runs a Cortex script (${run[0].replace(/["']/g, "")})`);
    if (/\.md$/i.test(rel)) {
      const linked = adaptLinks(text, { fileAbs, skillDir, root, release });
      for (const p of linked.problems) say(`${rel} ${p}`);
      text = linked.text;
    }
    files.push({ rel, text });
  }
  const portable = reasons.length === 0;
  return { name, portable, reasons, files: portable ? files : [] };
}

/** The checks on a finished skill, apart from the adaptation. For a pack's own verification. */
export function portableText(text) {
  const problems = [];
  if (CLAUDE_ONLY_VARS.test(text)) problems.push("a variable only Claude Code sets");
  if (RUNS_SCRIPT.test(text)) problems.push("a command that runs a Cortex script");
  return problems;
}

// --- the MCP configuration --------------------------------------------------------------------------

// Placeholders, never values: a pack is shared, and a path on the machine that built it, or a
// credential, would ship to everyone who downloads it. The person fills both in.
const HOME_PLACEHOLDER = "<path to your Cortex checkout>";
const ROOT_PLACEHOLDER = "<path to your Cortex brain: a vault, or a repo's .cortex folder>";

/** The MCP config files a pack carries, as `[{ rel, text }]`. Copilot, Gemini and Codex come from `_setup-agents.mjs`. */
export function mcpFiles() {
  const desktop = { mcpServers: { cortex: { command: "node", args: [`${HOME_PLACEHOLDER}/mcp/server.js`], env: { CORTEX_ROOT: ROOT_PLACEHOLDER } } } };
  const json = (v) => JSON.stringify(v, null, 2) + "\n";
  return [
    { rel: "mcp/claude-desktop.json", text: json(desktop) },
    { rel: "mcp/codex-config.toml", text: tomlTable(entryFor("codex", { server: `${HOME_PLACEHOLDER}/mcp/server.js` })) },
    { rel: "mcp/gemini-settings.json", text: json({ mcpServers: { cortex: entryFor("gemini") } }) },
    { rel: "mcp/vscode-mcp.json", text: json({ servers: { cortex: entryFor("copilot") } }) },
  ];
}

// --- the pack ---------------------------------------------------------------------------------------

/** The folder, and the zip beside it, a job's pack is written as. */
export const packName = (job, version) => ({ dir: `cortex-pack-${job}`, zip: `cortex-pack-${job}-${version}.zip` });

function readme(job, version, packed, needs) {
  const lines = [
    `# Cortex ${version} — the ${job} pack`,
    "",
    `Generated by \`node tools/cortex-pack.mjs ${job}\` from the skills in Cortex ${version}. Nothing in it is`,
    "edited by hand; build it again rather than changing it.",
    "",
    "## The skills",
    "",
  ];
  if (packed.length) {
    lines.push(
      "Each is in the Agent Skills format, as a folder under `skills/` and as a zip under `zips/`.",
      "Upload a zip in claude.ai or Claude Desktop (Settings, then Capabilities, then Skills), or copy a",
      "folder to wherever your assistant reads skills from.",
      "",
      ...packed.map((s) => `- \`${s}\``),
      "",
    );
  } else {
    lines.push(`No skill offered to a ${job} works outside Claude Code yet. The MCP configuration below still`, "connects your assistant to the Cortex tools.", "");
  }
  if (needs.length) {
    lines.push(
      "## Needs Claude Code",
      "",
      "These are offered to this job too, and run only in Claude Code, with the Cortex plugin",
      "(`/plugin install cortex` there). Each is listed with why:",
      "",
      ...needs.map((n) => `- \`${n.name}\`: ${n.reasons.join("; ")}.`),
      "",
    );
  }
  lines.push(
    "## Connect your assistant to Cortex",
    "",
    "The Cortex MCP server runs from a Cortex checkout with Node. The files under `mcp/` are its entry",
    "for each assistant. Replace each `<...>` with a path on your machine:",
    "",
    "- `claude-desktop.json`: merge `mcpServers` into Claude Desktop's `claude_desktop_config.json`.",
    "- `vscode-mcp.json`: GitHub Copilot in VS Code, as `.vscode/mcp.json` in a repo. It reads",
    "  `CORTEX_HOME` from your environment.",
    "- `gemini-settings.json`: Gemini CLI, merged into `.gemini/settings.json` in a repo.",
    "- `codex-config.toml`: Codex, appended to `~/.codex/config.toml`.",
    "",
    "In a repo, `node tools/cortex-setup.mjs --agents copilot,gemini,codex` writes the last three for",
    "you and merges rather than replaces.",
    "",
    "This pack holds no credentials. A tracker token or any other secret stays in your own environment.",
    "",
  );
  return lines.join("\n");
}

/**
 * Build one job's pack in memory. `files` is every file of the pack folder as `[{ rel, data }]`,
 * sorted by path; `zip` is the whole folder zipped, the release asset.
 *
 * Refuses (throws) when any text it would write holds something `core/scrub.js` reads as a
 * credential: a pack is published, and the gate is the same one memory passes.
 */
export function buildPack(job, { root = REPO_ROOT, release = releaseOf(root) } = {}) {
  if (!JOBS.includes(job)) throw new Error(`unknown job '${job}'. Expected one of: ${JOBS.join(", ")}`);
  const judged = JOB_SKILLS[job].map((name) => judgeSkill(name, { root, release }));
  const packed = judged.filter((s) => s.portable).map((s) => s.name).sort();
  const needs = judged.filter((s) => !s.portable).map(({ name, reasons }) => ({ name, reasons })).sort((a, b) => (a.name < b.name ? -1 : 1));
  const { dir, zip } = packName(job, release.version);

  const text = [];
  for (const s of judged.filter((x) => x.portable)) {
    for (const f of s.files) text.push({ rel: `skills/${s.name}/${f.rel}`, text: f.text });
  }
  text.push(...mcpFiles());
  const manifest = { job, version: release.version, skills: packed, needsClaudeCode: needs, mcp: mcpFiles().map((f) => f.rel) };
  text.push({ rel: "pack.json", text: JSON.stringify(manifest, null, 2) + "\n" });
  text.push({ rel: "README.md", text: readme(job, release.version, packed, needs) });

  for (const f of text) {
    const hits = scan(f.text);
    if (hits.length) throw new Error(`refused: ${dir}/${f.rel} holds what reads as a credential (${hits[0].kind}, line ${hits[0].line}). Nothing was written.`);
  }

  const files = text.map((f) => ({ rel: f.rel, data: Buffer.from(f.text, "utf8") }));
  for (const name of packed) {
    const entries = files.filter((f) => f.rel.startsWith(`skills/${name}/`)).map((f) => ({ name: f.rel.slice("skills/".length), data: f.data }));
    files.push({ rel: `zips/${name}.zip`, data: zipStore(entries) });
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { job, version: release.version, dir, zipName: zip, manifest, files, zip: zipStore(files.map((f) => ({ name: `${dir}/${f.rel}`, data: f.data }))) };
}

// --- a zip, stored ----------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const UTF8_NAMES = 0x0800;

/** A zip of `[{ name, data }]`, every entry stored, in the order given. */
export function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42); // the four fields between are zero: extra, comment, disk, attributes
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/**
 * Read back a zip `zipStore` wrote: `[{ name, data }]`. Throws on anything else, or on an entry
 * whose CRC does not match. `cortex-pack.mjs --check` uses it so a pack is verified, not trusted.
 */
export function readStored(buf) {
  const endAt = buf.length - 22;
  if (endAt < 0 || buf.readUInt32LE(endAt) !== 0x06054b50) throw new Error("not a zip: no end of central directory");
  const count = buf.readUInt16LE(endAt + 10);
  let at = buf.readUInt32LE(endAt + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("not a zip: a central entry is missing");
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    if (method !== 0) throw new Error(`${name} is compressed; this reader takes stored entries only`);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataAt, dataAt + size);
    if (crc32(data) !== crc) throw new Error(`${name}: the CRC does not match`);
    out.push({ name, data });
    at += 46 + nameLen;
  }
  return out;
}
