#!/usr/bin/env node
// cortex-stamps.mjs — render and record what /cortex stamps into a repo, and bring it up to date.
//
//   node index/cortex-stamps.mjs render <template> [--value K=V ...] [--values-file F] [--templates DIR]
//   node index/cortex-stamps.mjs record <repo> <path> <template> [--version X.Y.Z] [--value K=V ...]
//                                       [--values-file F] [--templates DIR]
//   node index/cortex-stamps.mjs <repo> [--json] [--all] [--templates DIR]
//   node index/cortex-stamps.mjs diff <repo> <path> [--templates DIR]
//   node index/cortex-stamps.mjs update <repo> [<path> ...] [--version X.Y.Z] [--templates DIR]
//   node index/cortex-stamps.mjs adopt <repo> [<path> ...]
//   node index/cortex-stamps.mjs forget <repo> <path> ...
//
// `adopt` is for a repo an older /cortex stamped before the record existed: loop files at the
// locations `loop.mjs` lists and no `.cortex/stamps.json`. It records them with nothing known, so
// each reads as `conflict` and is compared with this release's template before anything changes. It
// writes the record and not one byte of any loop file, and refuses once a record exists. `forget`
// drops an entry — a file removed on purpose, a retired template — and leaves the file alone.
//
// `render` prints a template filled from values (lib/placeholders.mjs), writing nothing. `/cortex`
// writes a loop file with it, so the file is exactly what the recorded values reproduce.
//
// `record` is called by /cortex after each file it writes (spec S2): the model never computes a
// hash, because that is the one step that must never be approximate. It reads the file as written
// and the template it came from, and writes one entry to `.cortex/stamps.json` — the only file it
// touches. When the values do not reproduce the file, the entry is still written but marked not
// re-renderable, and the first line that differs is printed: that file is never updated
// automatically. The record is committed so the whole team shares it, so a repo whose ignore rules
// hide it is told which rule does and how to fix it. Its `.gitignore` is never edited here.
//
// Status writes nothing and exits 0 whatever it finds — an out-of-date file is information, not a
// failure. `diff` shows what an update of one file would change, and writes nothing.
//
// `update` is the one command that rewrites a file in the repo, and only a file in state `update`:
// untouched since it was recorded, re-renderable, and its template changed. It re-renders the new
// template from the recorded values, writes it, and records it again. A named path in any other
// state is refused before anything is written; `edited`, `conflict` and `review` are the team's to
// decide file by file. Files are written before the record, so an interrupted run leaves a file
// newer than its entry — which status reads as `conflict`, the state that asks.
//
// An older plugin never updates. When the record was written by a newer Cortex than this one, its
// templates are the older ones, and every untouched file would read as `update` — applying it would put
// the older template back. Status, `diff` and `--json` name it with the two commands that update the
// plugin; `update` refuses all of it and writes nothing. `--version` is the release that asks.
//
// Exit codes: 1 for a bad argument or a refused update, 2 for a repo state that cannot be answered
// about (a damaged record, a file that is not there). A repo directory named like a command is
// passed as `./record`. Templates and version default to the plugin this file ships in:
// `../templates/` and `../VERSION`, the same layout in a clone and in an installed plugin.

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeChangedPath } from "./lib/changed.mjs";
import { LOOP_STAMPS } from "./lib/loop.mjs";
import { openTarget, parseArgv } from "./lib/open.mjs";
import { renderTemplate, unfilledPlaceholders } from "./lib/placeholders.mjs";
import {
  STAMPS_REL, STATES, adoptStamp, adoptionCandidates, forgetStamp, ignoreAdvice, olderPlugin, planUpdates, readStamps,
  recordStamp, runningCortex, stampDiff, stampPathProblem, stampStatus, stampsIgnoreRule, writeStamps,
} from "./lib/stamps.mjs";

const USAGE = {
  render: "usage: node index/cortex-stamps.mjs render <template> [--value KEY=VAL ...] [--values-file FILE] [--templates DIR]",
  record: "usage: node index/cortex-stamps.mjs record <repo> <path> <template> [--version X.Y.Z] [--value KEY=VAL ...] [--values-file FILE] [--templates DIR]",
  status: "usage: node index/cortex-stamps.mjs <repo> [--json] [--all] [--templates DIR]",
  diff: "usage: node index/cortex-stamps.mjs diff <repo> <path> [--templates DIR]",
  update: "usage: node index/cortex-stamps.mjs update <repo> [<path> ...] [--version X.Y.Z] [--templates DIR]",
  adopt: "usage: node index/cortex-stamps.mjs adopt <repo> [<path> ...]",
  forget: "usage: node index/cortex-stamps.mjs forget <repo> <path> ...",
};

const refuse = (text, code) => {
  process.stderr.write(text.endsWith("\n") ? text : text + "\n");
  process.exit(code);
};

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

function versionFrom(args, usage) {
  const version = args.version ?? runningCortex();
  if (!version) refuse(`no --version given and this plugin's VERSION could not be read\n${usage}`, 1);
  if (!/^\d+\.\d+\.\d+$/.test(version)) refuse(`--version must be X.Y.Z: ${version}`, 1);
  return version;
}

/** `--templates DIR`, or the plugin's own `templates/`. A directory that is not there is refused. */
function templatesDirFrom(args, usage) {
  const dir = args.templates ? resolve(args.templates) : fileURLToPath(new URL("../templates/", import.meta.url));
  if (!isDir(dir)) refuse(`templates directory not found: ${dir}\n${usage}`, 1);
  return dir;
}

/** A template id checked for shape and existence; returns `{ template, abs }`. */
function templateFrom(arg, templatesDir) {
  const template = normalizeChangedPath(arg);
  const issue = stampPathProblem(template);
  if (issue) refuse(`template ${issue}, relative to the templates directory: ${arg}`, 1);
  const abs = join(templatesDir, ...template.split("/"));
  if (!isFile(abs)) refuse(`no template ${template} in ${templatesDir}`, 1);
  return { template, abs };
}

/**
 * `--value KEY=VAL` (repeatable, commas kept) and `--values-file F` (a JSON object of strings), as one
 * map. A key given twice is refused rather than resolved by order — two values for one placeholder is
 * a mistake, and picking one silently records the other as never having been said.
 */
function valuesFrom(args) {
  const values = {};
  const put = (key, value, where) => {
    if (Object.hasOwn(values, key)) refuse(`${key} given twice (${where})`, 1);
    values[key] = value;
  };
  if (args.valuesFile) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(resolve(args.valuesFile), "utf8"));
    } catch (e) {
      refuse(`--values-file ${args.valuesFile} is not readable JSON (${e.message})`, 1);
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) refuse(`--values-file ${args.valuesFile} must hold a JSON object`, 1);
    for (const [k, v] of Object.entries(doc)) {
      if (typeof v !== "string") refuse(`--values-file ${args.valuesFile}: ${k} must be a string`, 1);
      put(k, v, "--values-file");
    }
  }
  for (const kv of args.value) {
    const eq = kv.indexOf("=");
    if (eq <= 0) refuse(`--value must be KEY=VALUE: ${kv}`, 1);
    put(kv.slice(0, eq), kv.slice(eq + 1), "--value");
  }
  return values;
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

/** The first line where two texts differ, under the hash's rule — for a sentence a person can act on. */
function firstDifference(a, b) {
  const lines = (t) => String(t).replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const A = lines(a);
  const B = lines(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] !== B[i]) return { line: i + 1, file: A[i] ?? "(end of file)", rendered: B[i] ?? "(end of file)" };
  }
  return null;
}

// --- render ------------------------------------------------------------------------------------------

function render(argv) {
  const parsed = parseArgv(argv, {
    usage: USAGE.render,
    flags: { "--value": "multi", "--values-file": "value", "--templates": "value" },
  });
  if (parsed.problem) refuse(parsed.problem, 1);
  const { args, positional } = parsed;
  if (args.help) { console.log(USAGE.render); return; }
  if (positional.length !== 1) refuse(`render needs one template\n${USAGE.render}`, 1);
  const templatesDir = templatesDirFrom(args, USAGE.render);
  const { abs } = templateFrom(positional[0], templatesDir);
  const values = valuesFrom(args);
  const text = readFileSync(abs, "utf8");
  process.stdout.write(renderTemplate(text, values));
  // Said on stderr so a redirect into the file stays clean: a placeholder left as written is right
  // for intent/TEMPLATE.md and wrong everywhere else, and only the caller knows which this is.
  const left = unfilledPlaceholders(text, values);
  if (left.length) process.stderr.write(`kept as written, no value given: ${left.map((n) => `{{${n}}}`).join(", ")}\n`);
}

// --- record ------------------------------------------------------------------------------------------

function record(argv) {
  const { root, args, paths } = openTarget(argv, {
    usage: USAGE.record,
    flags: { "--version": "value", "--value": "multi", "--values-file": "value", "--templates": "value" },
    root: "first",
    index: "none",
  });
  if (paths.length !== 2) refuse(`record needs a repo, a path and a template\n${USAGE.record}`, 1);

  const path = normalizeChangedPath(paths[0], root);
  const pathIssue = stampPathProblem(path);
  if (pathIssue) refuse(`path ${pathIssue}, relative to the repo: ${paths[0]}`, 1);
  const version = versionFrom(args, USAGE.record);
  const values = valuesFrom(args);
  const templatesDir = templatesDirFrom(args, USAGE.record);
  const { template, abs: templateAbs } = templateFrom(paths[1], templatesDir);
  const fileAbs = join(root, ...path.split("/"));
  // Record runs after the write. Nothing there means the write did not happen, and recording a hash
  // of nothing would make the next run call the real file `edited`.
  if (!isFile(fileAbs)) refuse(`nothing to record: ${path} is not a file in ${root}. Record runs after the file is written.`, 2);

  const before = readRecordOrRefuse(root);
  const templateText = readFileSync(templateAbs, "utf8");
  const fileText = readFileSync(fileAbs, "utf8");
  const next = recordStamp(before, { path, template, version, templateText, fileText, values });
  writeStamps(root, next);

  console.log(`Recorded ${path} (template ${template}, Cortex ${version}) in ${STAMPS_REL}.`);
  if (!next.files[path].renderable) {
    const d = firstDifference(fileText, renderTemplate(templateText, values));
    process.stderr.write(
      `\nWarning: ${path} is recorded but not re-renderable — ${template} filled with these values differs ` +
        `from the file at line ${d.line}:\n  file:     ${d.file}\n  rendered: ${d.rendered}\n` +
        "Its edits are still tracked, but a template change will show as review, never as an automatic update. " +
        "Record it again with the values that produced it to make it updatable.\n",
    );
  }
  // "Commit it" is advice only when git would let you; otherwise the warning says why it cannot.
  const rule = warnIfIgnored(root);
  if (!before && !rule) console.log(`Commit ${STAMPS_REL}: it is how the next /cortex run tells your edits from its own.`);
}

// --- status ------------------------------------------------------------------------------------------

// Worst first: what a re-run would act on, then what it would ask about, then what it leaves alone.
const ORDER = ["update", "review", "conflict", "missing", "retired", "edited", "current"];
const MEANS = {
  update: "the template changed and the file is untouched: safe to re-render",
  review: "the template changed and the file is untouched, but its values do not reproduce it: compare by hand",
  conflict: "the template and the file both changed: compare them, then decide",
  missing: "the file is gone: stamp it again, or drop it from the record",
  retired: "this Cortex no longer ships the template, so there is nothing to update it from",
  edited: "the team changed it and the template did not: theirs, nothing to do",
  current: "unchanged on both sides",
};

function status(argv) {
  const { root, args } = openTarget(argv, {
    usage: USAGE.status,
    flags: { "--json": "boolean", "--all": "boolean", "--templates": "value" },
    root: "positional",
    index: "none",
  });
  const templatesDir = templatesDirFrom(args, USAGE.status);
  const rec = readRecordOrRefuse(root);
  const files = stampStatus({ repoRoot: root, record: rec, templatesDir });
  const running = runningCortex();
  const adopt = adoptionCandidates(root, rec, LOOP_STAMPS);
  const behind = olderPlugin(rec, running);

  if (args.json) {
    // The machine form `cortex-next` reads. `files: null` is "no record", never an empty list — an
    // empty list would read as "everything current". Paths are repo-relative, and no absolute path is
    // printed: this is pasted into issues and PRs.
    let counts = null;
    if (files) {
      counts = Object.fromEntries(STATES.map((s) => [s, 0]));
      for (const f of files) counts[f.state]++;
    }
    // Asked with or without a record: a first install reads this BEFORE writing one, so the fix can
    // be offered inside its one confirmation. git answers for a path that does not exist yet.
    const rule = stampsIgnoreRule(root);
    console.log(JSON.stringify({
      record: rec ? STAMPS_REL : null,
      cortex: rec?.cortex ?? null,
      running,
      // Set when a newer Cortex wrote the record: `{ stamped, running, commands, advice }`. While it is,
      // the states below are measured against this plugin's older templates, and `update` refuses.
      olderPlugin: behind,
      counts,
      files,
      // Loop files an older /cortex left, with no record to say so. Always an array; empty once a
      // record exists, because adoption is offered only at first contact with one.
      adopt,
      ignored: rule ? { ...rule, advice: ignoreAdvice(rule) } : null,
    }, null, 2));
    return;
  }

  if (!rec) {
    console.log(`No stamp record at ${STAMPS_REL}, so nothing Cortex wrote here can be compared.`);
    if (adopt.length) {
      console.log(`\n${adopt.length} loop file${adopt.length === 1 ? "" : "s"} sit where /cortex writes them — an earlier Cortex stamped them before the record existed:`);
      for (const a of adopt) console.log(`  ${a.path}  ← ${a.template}`);
      console.log("\n`cortex-stamps.mjs adopt .` records them with nothing known, so each reads as conflict and is");
      console.log("compared with this release's template before anything changes. /cortex offers it in its confirmation.");
    } else {
      console.log("/cortex records each file as it writes it; until then there is nothing to report.");
    }
    return;
  }

  console.log(`${files.length} stamped file${files.length === 1 ? "" : "s"} in ${STAMPS_REL} — newest writer ` +
    (rec.cortex ? `Cortex ${rec.cortex}` : "unknown (adopted)") + (running ? `, this is Cortex ${running}.` : "."));
  if (behind) {
    console.log(`\n${behind.advice}`);
    console.log("Until then, the states below compare the files with this plugin's older templates — an `update` among them is not one.");
  }
  const current = files.filter((f) => f.state === "current");
  if (current.length === files.length && !args.all) {
    console.log(`All ${files.length} stamped files are current.`);
  } else {
    for (const state of ORDER) {
      if (state === "current" && !args.all) continue;
      const group = files.filter((f) => f.state === state);
      if (!group.length) continue;
      console.log(`\n${state} (${group.length}) — ${MEANS[state]}`);
      for (const f of group) {
        console.log(`  ${f.path}  ← ${f.template}  (${f.version ? `stamped by ${f.version}` : "adopted, release unknown"})`);
      }
    }
    if (!args.all && current.length) console.log(`\n${current.length} current (not listed; --all shows them).`);
  }
  warnIfIgnored(root);
  console.log("\nNothing was changed.");
}

// --- diff --------------------------------------------------------------------------------------------

function diff(argv) {
  const { root, args, paths } = openTarget(argv, {
    usage: USAGE.diff,
    flags: { "--templates": "value" },
    root: "first",
    index: "none",
  });
  if (paths.length !== 1) refuse(`diff needs a repo and one path\n${USAGE.diff}`, 1);
  const templatesDir = templatesDirFrom(args, USAGE.diff);
  const rec = readRecordOrRefuse(root);
  if (!rec) refuse(`no stamp record at ${STAMPS_REL}; nothing to compare`, 1);
  const path = normalizeChangedPath(paths[0], root);
  const d = stampDiff({ repoRoot: root, record: rec, templatesDir, path });
  if (!d) refuse(`${path} is not in ${STAMPS_REL}`, 1);
  const e = rec.files[path];
  console.log(`${path}: ${d.state}`);
  const behind = olderPlugin(rec, runningCortex());
  if (behind) console.log(behind.advice);
  if (d.diff === null) {
    console.log(`${e.template} is not in this Cortex's templates, so there is nothing to compare it with.`);
    return;
  }
  console.log(`--- ${path} (the file now)`);
  console.log(`+++ ${e.template} (this Cortex's template, filled with the recorded values)`);
  process.stdout.write(d.diff || "(no difference)\n");
}

// --- update ------------------------------------------------------------------------------------------

function update(argv) {
  const { root, args, paths } = openTarget(argv, {
    usage: USAGE.update,
    flags: { "--version": "value", "--templates": "value" },
    root: "first",
    index: "none",
  });
  const version = versionFrom(args, USAGE.update);
  const templatesDir = templatesDirFrom(args, USAGE.update);
  const rec = readRecordOrRefuse(root);
  if (!rec) refuse(`no stamp record at ${STAMPS_REL}; nothing to update`, 1);
  const named = paths.length ? paths.map((p) => normalizeChangedPath(p, root)) : null;
  const plan = planUpdates({ repoRoot: root, record: rec, templatesDir, paths: named, running: version });

  // A refusal against the record itself is the older plugin: the whole plan, named or not.
  const whole = plan.refused.find((r) => r.path === STAMPS_REL);
  if (whole) refuse(`not updated: ${whole.why}\nNothing was written.`, 1);

  // Named paths are all-or-nothing: someone listed exactly these, so a partial run is not what they
  // asked for.
  if (named && plan.refused.length) {
    refuse(plan.refused.map((r) => `not updated: ${r.why}`).join("\n") + "\nNothing was written.", 1);
  }

  let next = rec;
  for (const u of plan.updates) {
    writeFileSync(join(root, ...u.path.split("/")), u.text);
    next = recordStamp(next, { path: u.path, template: u.template, version, templateText: u.templateText, fileText: u.text, values: u.values });
  }
  if (plan.updates.length) writeStamps(root, next);

  for (const u of plan.updates) console.log(`Updated ${u.path} (template ${u.template}, Cortex ${version}).`);
  for (const r of plan.refused) console.log(`Not updated: ${r.why}`);
  if (!plan.updates.length && !plan.refused.length) console.log("Nothing to update: no file is in state update.");
  if (plan.refused.length) process.exit(1);
}

// ------------------------------------------------------------------------------------------------------

// --- adopt and forget ----------------------------------------------------------------------------------

function adopt(argv) {
  const { root, paths } = openTarget(argv, { usage: USAGE.adopt, flags: {}, root: "first", index: "none" });
  const rec = readRecordOrRefuse(root);
  if (rec) {
    refuse(`${root} already has ${STAMPS_REL}. Adoption is for a repo stamped before the record existed; ` +
      "record a file with `cortex-stamps.mjs record` instead.", 1);
  }
  const candidates = adoptionCandidates(root, null, LOOP_STAMPS);
  let chosen = candidates;
  if (paths.length) {
    const byPath = new Map(candidates.map((c) => [c.path, c]));
    const named = paths.map((p) => normalizeChangedPath(p, root));
    const unknown = named.filter((p) => !byPath.has(p));
    if (unknown.length) {
      refuse(unknown.map((p) => `${p} is not a loop file /cortex writes, or is not here`).join("\n") + "\nNothing was written.", 1);
    }
    chosen = named.map((p) => byPath.get(p));
  }
  if (!chosen.length) {
    console.log("Nothing to adopt: no loop file sits where /cortex writes one.");
    return;
  }
  const next = chosen.reduce((r, c) => adoptStamp(r, c), null);
  writeStamps(root, next);
  console.log(`Adopted ${chosen.length} file${chosen.length === 1 ? "" : "s"} into ${STAMPS_REL}: ${chosen.map((c) => c.path).join(", ")}.`);
  console.log("Nothing about them is known yet, so each reads as conflict until it is compared with this release's");
  console.log("template (`cortex-stamps.mjs diff . <path>`) and recorded again. No loop file was changed.");
  warnIfIgnored(root);
}

function forget(argv) {
  const { root, paths } = openTarget(argv, { usage: USAGE.forget, flags: {}, root: "first", index: "none" });
  if (!paths.length) refuse(`forget needs a repo and at least one path\n${USAGE.forget}`, 1);
  const rec = readRecordOrRefuse(root);
  if (!rec) refuse(`no stamp record at ${STAMPS_REL}; nothing to forget`, 1);
  const named = paths.map((p) => normalizeChangedPath(p, root));
  const unknown = named.filter((p) => !Object.hasOwn(rec.files, p));
  if (unknown.length) refuse(unknown.map((p) => `${p} is not in the record`).join("\n") + "\nNothing was written.", 1);
  writeStamps(root, named.reduce((r, p) => forgetStamp(r, p), rec));
  console.log(`Dropped from ${STAMPS_REL}: ${named.join(", ")}. The files themselves were not touched.`);
}

const COMMANDS = { render, record, diff, update, adopt, forget };
const argv = process.argv.slice(2);
if (Object.hasOwn(COMMANDS, argv[0])) COMMANDS[argv[0]](argv.slice(1));
else status(argv);
