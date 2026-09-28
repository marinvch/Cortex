#!/usr/bin/env node
// cortex-stamps.mjs — record what /cortex stamped into a repo, and say which of it is out of date.
//
//   node index/cortex-stamps.mjs record <repo> <path> <template> [--version X.Y.Z] [--value KEY=VAL ...]
//                                       [--templates DIR]
//   node index/cortex-stamps.mjs <repo> [--json] [--all] [--templates DIR]
//
// `record` is called by /cortex after each file it writes (spec S2): the model never computes a
// hash, because that is the one step that must never be approximate. It reads the file as written
// and the template it came from, and writes one entry to `.cortex/stamps.json` — the only file it
// touches. The record is committed so the whole team shares it, so a repo whose ignore rules hide
// it is told which rule does and how to fix it. Its `.gitignore` is never edited here: that is the
// consent-gated install's job.
//
// The status form writes nothing and exits 0 whatever it finds. An out-of-date file is information
// for the next /cortex run, not a failure; a damaged record (2) and a bad argument (1) are.
//
// A repo directory literally named `record` is passed as `./record`.
//
// Templates and the version default to the plugin this file ships in: `../templates/` and
// `../VERSION`, the same layout in a clone and in an installed plugin.

import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeChangedPath } from "./lib/changed.mjs";
import { openTarget } from "./lib/open.mjs";
import {
  STAMPS_REL, STATES, ignoreAdvice, readStamps, recordStamp, stampPathProblem, stampStatus, stampsIgnoreRule,
  writeStamps,
} from "./lib/stamps.mjs";

const RECORD_USAGE =
  "usage: node index/cortex-stamps.mjs record <repo> <path> <template> [--version X.Y.Z] [--value KEY=VAL ...] [--templates DIR]";
const STATUS_USAGE = "usage: node index/cortex-stamps.mjs <repo> [--json] [--all] [--templates DIR]";

const refuse = (text, code) => {
  process.stderr.write(text.endsWith("\n") ? text : text + "\n");
  process.exit(code);
};

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** The plugin's own version, or null — read from the one file every release stamps. */
function pluginVersion() {
  try {
    const v = readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim();
    return /^\d+\.\d+\.\d+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** `--templates DIR`, or the plugin's own `templates/`. A directory that is not there is refused. */
function templatesDirFrom(args, usage) {
  const dir = args.templates ? resolve(args.templates) : fileURLToPath(new URL("../templates/", import.meta.url));
  if (!isDir(dir)) refuse(`templates directory not found: ${dir}\n${usage}`, 1);
  return dir;
}

/** The record, or a refusal naming the file. A damaged record is never overwritten or read past. */
function readRecordOrRefuse(root) {
  try {
    return readStamps(root);
  } catch (e) {
    refuse(`${e.message}\nNothing was written. Fix the file, or delete it to start the record again.`, 2);
  }
}

function warnIfIgnored(root) {
  const rule = stampsIgnoreRule(root);
  if (rule) process.stderr.write(`\nWarning: ${ignoreAdvice(rule)}\n`);
  return rule;
}

// --- record ------------------------------------------------------------------------------------------

function record(argv) {
  const { root, args, paths } = openTarget(argv, {
    usage: RECORD_USAGE,
    flags: { "--version": "value", "--value": "multi", "--templates": "value" },
    root: "first",
    index: "none",
  });
  if (paths.length !== 2) refuse(`record needs a repo, a path and a template\n${RECORD_USAGE}`, 1);

  const path = normalizeChangedPath(paths[0], root);
  const template = normalizeChangedPath(paths[1]);
  const pathIssue = stampPathProblem(path);
  if (pathIssue) refuse(`path ${pathIssue}, relative to the repo: ${paths[0]}`, 1);
  const templateIssue = stampPathProblem(template);
  if (templateIssue) refuse(`template ${templateIssue}, relative to the templates directory: ${paths[1]}`, 1);

  const version = args.version ?? pluginVersion();
  if (!version) refuse(`no --version given and this plugin's VERSION could not be read\n${RECORD_USAGE}`, 1);
  if (!/^\d+\.\d+\.\d+$/.test(version)) refuse(`--version must be X.Y.Z: ${version}`, 1);

  const values = {};
  for (const kv of args.value) {
    const eq = kv.indexOf("=");
    if (eq <= 0) refuse(`--value must be KEY=VALUE: ${kv}`, 1);
    const key = kv.slice(0, eq);
    if (key in values) refuse(`--value ${key} given twice`, 1);
    values[key] = kv.slice(eq + 1);
  }

  const templatesDir = templatesDirFrom(args, RECORD_USAGE);
  const templateAbs = join(templatesDir, ...template.split("/"));
  if (!isFile(templateAbs)) refuse(`no template ${template} in ${templatesDir}`, 1);
  const fileAbs = join(root, ...path.split("/"));
  // Record runs after the write. Nothing there means the write did not happen, and recording a hash
  // of nothing would make the next run call the real file `edited`.
  if (!isFile(fileAbs)) refuse(`nothing to record: ${path} is not a file in ${root}. Record runs after the file is written.`, 2);

  const before = readRecordOrRefuse(root);
  const next = recordStamp(before, {
    path, template, version,
    templateText: readFileSync(templateAbs, "utf8"),
    fileText: readFileSync(fileAbs, "utf8"),
    values,
  });
  writeStamps(root, next);

  console.log(`Recorded ${path} (template ${template}, Cortex ${version}) in ${STAMPS_REL}.`);
  // "Commit it" is advice only when git would let you; otherwise the warning says why it cannot.
  const rule = warnIfIgnored(root);
  if (!before && !rule) console.log(`Commit ${STAMPS_REL}: it is how the next /cortex run tells your edits from its own.`);
}

// --- status ------------------------------------------------------------------------------------------

// Worst first: what a re-run would act on, then what it would ask about, then what it leaves alone.
const ORDER = ["update", "conflict", "missing", "retired", "edited", "current"];
const MEANS = {
  update: "the template changed and the file is untouched: safe to re-render",
  conflict: "the template and the file both changed: compare them, then decide",
  missing: "the file is gone: stamp it again, or drop it from the record",
  retired: "this Cortex no longer ships the template, so there is nothing to update it from",
  edited: "the team changed it and the template did not: theirs, nothing to do",
  current: "unchanged on both sides",
};

function status(argv) {
  const { root, args } = openTarget(argv, {
    usage: STATUS_USAGE,
    flags: { "--json": "boolean", "--all": "boolean", "--templates": "value" },
    root: "positional",
    index: "none",
  });
  const templatesDir = templatesDirFrom(args, STATUS_USAGE);
  const rec = readRecordOrRefuse(root);
  const files = stampStatus({ repoRoot: root, record: rec, templatesDir });
  const running = pluginVersion();

  if (args.json) {
    // The machine form step 4's `cortex-next` row reads. `files: null` is "no record", never an
    // empty list — an empty list would read as "everything current". Paths are repo-relative, and no
    // absolute path is printed: this is pasted into issues and PRs.
    let counts = null;
    if (files) {
      counts = Object.fromEntries(STATES.map((s) => [s, 0]));
      for (const f of files) counts[f.state]++;
    }
    const rule = rec ? stampsIgnoreRule(root) : null;
    console.log(JSON.stringify({
      record: rec ? STAMPS_REL : null,
      cortex: rec?.cortex ?? null,
      running,
      counts,
      files,
      ignored: rule ? { ...rule, advice: ignoreAdvice(rule) } : null,
    }, null, 2));
    return;
  }

  if (!rec) {
    console.log(`No stamp record at ${STAMPS_REL}, so nothing Cortex wrote here can be compared.`);
    console.log("/cortex records each file as it writes it; until then there is nothing to report.");
    return;
  }

  console.log(`${files.length} stamped file${files.length === 1 ? "" : "s"} in ${STAMPS_REL} — newest writer Cortex ${rec.cortex}` +
    (running ? `, this is Cortex ${running}.` : "."));
  const current = files.filter((f) => f.state === "current");
  if (current.length === files.length && !args.all) {
    console.log(`All ${files.length} stamped files are current.`);
  } else {
    for (const state of ORDER) {
      if (state === "current" && !args.all) continue;
      const group = files.filter((f) => f.state === state);
      if (!group.length) continue;
      console.log(`\n${state} (${group.length}) — ${MEANS[state]}`);
      for (const f of group) console.log(`  ${f.path}  ← ${f.template}  (stamped by ${f.version})`);
    }
    if (!args.all && current.length) console.log(`\n${current.length} current (not listed; --all shows them).`);
  }
  warnIfIgnored(root);
  console.log("\nNothing was changed.");
}

// ------------------------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv[0] === "record") record(argv.slice(1));
else status(argv);
