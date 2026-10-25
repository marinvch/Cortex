#!/usr/bin/env node
// cortex-pack.mjs — build the role pack for one job: its portable skills and its MCP config.
//
//   node tools/cortex-pack.mjs <job> [--out DIR]   # write DIR/cortex-pack-<job>/ and its zip
//   node tools/cortex-pack.mjs --all [--out DIR]   # all five; the release workflow runs this
//   node tools/cortex-pack.mjs <job> --list        # what the pack would hold; writes nothing
//   node tools/cortex-pack.mjs --check             # build every pack in memory and verify it; writes nothing
//   add --json to --list or --check for a tool to read
//
// A job is developer, architect, lead, pm or qa (core/job.js). DIR defaults to `cortex-packs/` in
// the current directory, which this repo's .gitignore covers: a pack is generated, never committed.
//
// Why this exists: people on a team need different parts of Cortex, and some of them never open a
// repository. A developer installs the Claude Code plugin; a project manager in Claude Desktop or
// claude.ai installs this. The pack is generated from `skills/`, so there is no second copy of a
// skill to keep true. What goes in, what "portable" means and how a skill is adapted are in the
// header of `_pack.mjs`, beside the code.
//
// What it writes, per job, under DIR:
//
//   cortex-pack-<job>/README.md            what is here, what needs Claude Code and why, how to connect
//   cortex-pack-<job>/pack.json            the same, for a tool
//   cortex-pack-<job>/skills/<name>/...    each portable skill, adapted
//   cortex-pack-<job>/zips/<name>.zip      the same skill as a zip to upload
//   cortex-pack-<job>/mcp/*                the MCP server entry for Claude Desktop, Copilot, Gemini CLI, Codex
//   cortex-pack-<job>-<version>.zip        the folder zipped, the release asset
//
// Deterministic: the same tree gives the same bytes, on any machine. A pack holds no credential and
// no path on the machine that built it; the MCP entries carry placeholders, and every text passes
// the credential scan in core/scrub.js before anything is written.
//
// It replaces a pack folder it wrote before (one holding a `pack.json` for the same job) and
// refuses any other folder in its way. Exit codes: 1 for a check that failed or a refused write,
// 2 for a bad argument.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { JOBS } from "../core/job.js";
import { buildPack, portableText, readStored, releaseOf } from "./_pack.mjs";

const USAGE = `usage: node tools/cortex-pack.mjs <job> [--out DIR] [--list] [--json]
       node tools/cortex-pack.mjs --all [--out DIR]
       node tools/cortex-pack.mjs --check [--json]

Builds the role pack for one job: the skills it is offered that work outside Claude Code, in the
Agent Skills format, and the MCP configuration that reaches the Cortex server.

  <job>      one of ${JOBS.join(", ")}
  --all      every job
  --out DIR  where to write (default: ./cortex-packs)
  --list     print what the pack would hold, and what needs Claude Code; write nothing
  --check    build every pack in memory, read each zip back, and fail on a skill that is not
             portable or a zip that does not round-trip; write nothing
  --json     with --list or --check, print JSON`;

function parse(argv) {
  const o = { jobs: [], out: "cortex-packs", all: false, list: false, check: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--all") o.all = true;
    else if (a === "--list") o.list = true;
    else if (a === "--check") o.check = true;
    else if (a === "--json") o.json = true;
    else if (a === "--out") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error("--out needs a directory");
      o.out = v;
    } else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else if (JOBS.includes(a)) o.jobs.push(a);
    else throw new Error(`unknown job '${a}'. Expected one of: ${JOBS.join(", ")}`);
  }
  if (o.all || o.check) o.jobs = [...JOBS];
  if (!o.help && !o.jobs.length) throw new Error("name a job, or pass --all or --check");
  if (o.all && o.list) throw new Error("--list takes one job");
  return o;
}

/** Every problem with a built pack: a skill that is not portable after all, or a zip that does not read back. */
function verify(pack) {
  const problems = [];
  for (const f of pack.files) {
    if (f.rel.startsWith("skills/")) for (const p of portableText(f.data.toString("utf8"))) problems.push(`${pack.dir}/${f.rel}: ${p}`);
    if (f.rel.endsWith(".zip")) {
      try { readStored(f.data); } catch (e) { problems.push(`${pack.dir}/${f.rel}: ${e.message}`); }
    }
  }
  try {
    const back = readStored(pack.zip);
    if (back.length !== pack.files.length) problems.push(`${pack.zipName}: ${back.length} entries for ${pack.files.length} files`);
  } catch (e) {
    problems.push(`${pack.zipName}: ${e.message}`);
  }
  return problems;
}

function write(pack, out) {
  const dir = join(out, pack.dir);
  if (existsSync(dir)) {
    let ours = false;
    try { ours = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8")).job === pack.job; } catch { ours = false; }
    if (!ours) throw Object.assign(new Error(`refused: ${dir} exists and is not a ${pack.job} pack this tool wrote. Nothing was written.`), { exit: 1 });
    rmSync(dir, { recursive: true });
  }
  for (const f of pack.files) {
    const p = join(dir, ...f.rel.split("/"));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.data);
  }
  writeFileSync(join(out, pack.zipName), pack.zip);
}

function main(argv) {
  let o;
  try {
    o = parse(argv);
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (o.help) { console.log(USAGE); return 0; }

  const release = releaseOf();
  const packs = o.jobs.map((job) => buildPack(job, { release }));

  if (o.check) {
    const problems = packs.flatMap(verify);
    if (o.json) console.log(JSON.stringify({ version: release.version, ok: !problems.length, problems, packs: packs.map((p) => p.manifest) }, null, 2));
    else {
      for (const p of packs) console.log(`${p.job.padEnd(10)} ${p.manifest.skills.length} skill(s): ${p.manifest.skills.join(", ") || "none"}`);
      for (const p of problems) console.log(`  problem: ${p}`);
      console.log(problems.length ? `${problems.length} problem(s).` : `every pack builds, every skill in one is portable, every zip reads back.`);
    }
    return problems.length ? 1 : 0;
  }

  if (o.list) {
    const m = packs[0].manifest;
    if (o.json) { console.log(JSON.stringify(m, null, 2)); return 0; }
    console.log(`The ${m.job} pack, Cortex ${m.version}`);
    console.log(`  skills:  ${m.skills.join(", ") || "none"}`);
    for (const n of m.needsClaudeCode) console.log(`  needs Claude Code: ${n.name} — ${n.reasons.join("; ")}`);
    console.log(`  mcp:     ${m.mcp.join(", ")}`);
    return 0;
  }

  const out = resolve(o.out);
  mkdirSync(out, { recursive: true });
  for (const p of packs) {
    const problems = verify(p);
    if (problems.length) {
      console.error(`refused: the ${p.job} pack failed its own check:\n  ${problems.join("\n  ")}`);
      return 1;
    }
  }
  try {
    for (const p of packs) {
      write(p, out);
      console.log(`${join(out, p.zipName)}  (${p.manifest.skills.length} skill(s): ${p.manifest.skills.join(", ") || "none"}; ${p.manifest.needsClaudeCode.length} need Claude Code)`);
    }
  } catch (e) {
    console.error(e.message);
    return e.exit ?? 1;
  }
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
