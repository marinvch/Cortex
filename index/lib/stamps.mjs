// stamps.mjs — which files Cortex wrote into a repo, and whether each is still what it wrote.
//
// `/cortex` stamps files from `templates/loop/` into a target repo — the hooks, `REVIEW.md`, the
// verifier, the workflows — and until this record nothing said which release wrote them. A repo
// stamped by 2.36.0 kept 2.36.0's hook after 2.39.0 fixed it for bash 3.2, and 2.39.1's Windows-path
// fix reached only repos stamped after it. `skill-drift.mjs` answers a different question (does a
// skill's text still match the repo); this one asks whether a stamped file still matches the
// template that wrote it, and whether that template has moved since.
//
// The record is `.cortex/stamps.json`, committed, one entry per stamped file:
//
//   { "format": 1,
//     "cortex": "2.40.0",                        newest Cortex that wrote to it — never lowered
//     "files": { "<repo-relative posix path>": {
//         "template": "loop/REVIEW.md",          relative to the plugin's templates/ directory
//         "version": "2.40.0",                   the Cortex that wrote THIS entry
//         "templateSha256": "…",                 the template source as it was then
//         "fileSha256": "…",                     the rendered file as written
//         "renderable": true,                    the template and values reproduce that file
//         "values": { "NIT_CAP": "3" } } } }     the placeholder values it was rendered with
//
// Two comparisons decide every state (spec S3), and no model is asked:
//
//   file now = as written?  template now = as then?
//        yes                     yes                  current
//        yes                     no                   update    — safe to re-render from `values`
//        yes                     no, not renderable   review    — the file holds more than its values
//        no                      no                   conflict  — both moved; show both, ask
//        no                      yes                  edited    — the team's; say nothing
//   (file gone)                                       missing
//   (template gone)                                   retired   — nothing to render; never an update
//
// `renderable` is the reproducibility guard, and `recordStamp` sets it, so no caller can skip it:
// rendering the template with the recorded values (`placeholders.mjs`) must give back the file as
// written, under the hash's rule. /cortex fills some templates partly by hand — a CI setup block,
// a formatter line per detected formatter — and a file whose values do not account for every line
// it holds would lose those lines on a re-render. Such a file is still recorded (its edits are
// still worth tracking), but a template change under it is `review`, never `update`: a caller that
// auto-applies `update` can then never drop content the model wrote. `review` is a state rather
// than a flag on `update` for exactly that reason — a flag is a thing every caller must remember.
// The field is part of format 1, which no release has shipped yet, so adding it bumped nothing.
//
// `retired` is the sixth answer, for a template this Cortex no longer ships. Calling it `current`
// would claim a comparison nobody made; `update` would offer a render with no source; `edited` would
// hide it. So it is its own state, and a caller reports it and offers nothing. `missing` wins over
// it: "the file is gone" is a fact about the repo that holds whatever the template did.
//
// The direction of error is chosen, as in `orphans.mjs`: only `update` leads to a write without a
// per-file question, so every doubt resolves away from it. A recorded hash of `null` (unknown) never
// equals anything. A templates directory that is not there is an error, not a list of `retired`
// files — a wrong path from the caller must not read as a release that retired everything.
//
// Hashes are sha256 over text with CRLF folded to LF and trailing newlines dropped. The first rule
// is the lesson of `.gitattributes templates/** text eol=lf` (2.39.0): a `core.autocrlf` checkout
// must never read as an edit, or every Windows teammate's copy is `edited` and never updated. The
// second is the same argument one step on — an editor or formatter adding or removing the final
// newline is not a change anyone made, and counting it would freeze the file at `edited` just as
// silently. Losing that difference on an update costs nothing a formatter does not put back.
// Nothing else is normalised: a trailing space, a blank line, a BOM are all edits.
//
// `planUpdates` says what an update would write and `stampDiff` what a per-file question shows; both
// only read. Pure apart from reading files; `writeStamps` is the one write, and it touches only
// `.cortex/stamps.json` — the CLI writes the updated files themselves. Deterministic: no clock, no
// network, sorted output, no locale compare. The one outside question is `git check-ignore`
// (`stampsIgnoreRule`), as in `skill-drift.mjs`: the record only works if it is committed, and the
// repo's own ignore rules are the witness for that.
//
// Adoption is for a repo /cortex stamped before this record existed (every 2.39.x install): loop
// files at the locations `loop.mjs` lists (`LOOP_STAMPS`), and no record. Nothing about them is
// known — not the release, not the values, not whether the team has edited them since — so an
// adopted entry says exactly that: `version: null`, both hashes `null`, `renderable: false`, no
// values. A null hash equals no digest, so every adopted file reads as `conflict` and is compared
// with this release's template before anything changes; `update` can never touch it. Adoption is
// offered only while there is no record at all: once one exists, a file outside it is the team's.
//
// An older plugin (spec S5). The record is shared, the plugin is per machine: a teammate a release
// behind reads a record a newer Cortex wrote against their own, older templates. Every untouched file
// then reads as `update`, and applying it would put the older template back — undoing the fix the
// newer release shipped, behind a green status. So `olderPlugin` names it, with the two commands that
// update the plugin, and `planUpdates` refuses the whole plan while it holds: no file at all, whatever
// its state, because the states themselves are measured against the wrong templates. `planUpdates`
// takes `running` as a required argument rather than reading `VERSION` itself, so the check is not a
// thing a caller can forget — omit it and the call throws. `cortex: null` (an adopted-only record)
// was written by no known release and never warns; equal versions never warn.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { lineDiff } from "./linediff.mjs";
import { LOOP_STAMPS } from "./loop.mjs";
import { placeholderMatches, renderTemplate, unfilledPlaceholders } from "./placeholders.mjs";

export const STAMPS_REL = ".cortex/stamps.json";
export const STAMPS_FORMAT = 1;

export const STATES = ["current", "update", "review", "conflict", "edited", "missing", "retired"];

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const SHA = /^[0-9a-f]{64}$/;
const ENTRY_KEYS = ["template", "version", "templateSha256", "fileSha256", "renderable", "values"];
const RECORD_KEYS = ["format", "cortex", "files"];

// --- hashing -------------------------------------------------------------------------------------

/** sha256 hex of `text` with CRLF folded to LF and trailing newlines dropped — see the header. */
export function hashText(text) {
  const normal = String(text).replace(/\r\n/g, "\n").replace(/\n+$/, "");
  return createHash("sha256").update(normal, "utf8").digest("hex");
}

// --- shape ---------------------------------------------------------------------------------------

// A path the record may name: repo-relative, forward slashes, no `.`/`..` segment, no drive. The
// record is committed, so anyone can edit it, and status reads every path it names.
function relPathProblem(p) {
  if (typeof p !== "string" || p === "") return "must be a non-empty string";
  if (p.includes("\\")) return "must use forward slashes";
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return "must be relative";
  if (p.split("/").some((s) => s === "" || s === "." || s === "..")) return "must not contain empty, . or .. segments";
  return null;
}

/** Why `p` cannot be a recorded path or template id, or `null` — for a CLI to refuse before reading. */
export const stampPathProblem = relPathProblem;

// A version is x.y.z, or null where it is not known (an adopted entry). A known version is newer
// than an unknown one, so recording a real file into an adopted record sets `cortex` for the first time.
const isVersionOrNull = (v) => v === null || (typeof v === "string" && VERSION.test(v));

/** Is known version `a` newer than `b`, which may be unknown (null)? `a` is always a real version. */
function newer(a, b) {
  if (b === null) return true;
  const x = VERSION.exec(a).slice(1).map(Number);
  const y = VERSION.exec(b).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// --- the Cortex doing the asking ------------------------------------------------------------------

/** This Cortex's release, from the `VERSION` file every release stamps — or null when unreadable. */
export function runningCortex() {
  try {
    const v = readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();
    return VERSION.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Updating an installed plugin takes both, in order: the first refreshes the marketplace's copy, the
 * second installs from it. The first alone leaves the old version installed.
 */
export const PLUGIN_UPDATE_COMMANDS = ["claude plugin marketplace update cortex", "claude plugin update cortex@cortex"];

/**
 * `{ stamped, running, commands, advice }` when the record was written by a newer Cortex than
 * `running`, else null. Null too for no record, a record no known release wrote (`cortex: null`),
 * or an unknown `running` — nothing is claimed that was not compared. `advice` is the one sentence
 * status, `cortex-next` and a refused update all print.
 */
export function olderPlugin(record, running) {
  const stamped = record?.cortex ?? null;
  if (stamped === null || !VERSION.test(running)) return null;
  if (!newer(stamped, running)) return null;
  const [marketplace, plugin] = PLUGIN_UPDATE_COMMANDS;
  return {
    stamped,
    running,
    commands: [...PLUGIN_UPDATE_COMMANDS],
    advice:
      `This repo was stamped by Cortex ${stamped} and this is Cortex ${running}, an older plugin — it never ` +
      `rewrites files a newer Cortex stamped. Update it: \`${marketplace}\`, then \`${plugin}\`, then ` +
      "`/reload-plugins` or a new session.",
  };
}

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function sortedValues(values) {
  const out = {};
  for (const k of Object.keys(values).sort(byCodeUnit)) out[k] = values[k];
  return out;
}

/** Every problem with a record, as sentences. Empty means well-formed. */
function recordProblems(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["not an object"];
  const problems = [];
  for (const k of Object.keys(doc)) if (!RECORD_KEYS.includes(k)) problems.push(`unknown key "${k}"`);
  if (doc.format !== STAMPS_FORMAT) problems.push(`format must be ${STAMPS_FORMAT}, found ${JSON.stringify(doc.format)}`);
  if (!isVersionOrNull(doc.cortex)) problems.push(`cortex must be an x.y.z version or null, found ${JSON.stringify(doc.cortex)}`);
  if (!doc.files || typeof doc.files !== "object" || Array.isArray(doc.files)) {
    problems.push("files must be an object keyed by path");
    return problems;
  }
  for (const [path, e] of Object.entries(doc.files)) {
    const bad = (why) => problems.push(`files["${path}"]: ${why}`);
    const pp = relPathProblem(path);
    if (pp) bad(`path ${pp}`);
    if (!e || typeof e !== "object" || Array.isArray(e)) { bad("not an object"); continue; }
    for (const k of Object.keys(e)) if (!ENTRY_KEYS.includes(k)) bad(`unknown key "${k}"`);
    const tp = relPathProblem(e.template);
    if (tp) bad(`template ${tp}`);
    if (!isVersionOrNull(e.version)) bad("version must be an x.y.z version or null");
    for (const k of ["templateSha256", "fileSha256"]) {
      if (e[k] !== null && !(typeof e[k] === "string" && SHA.test(e[k]))) bad(`${k} must be a sha256 hex digest or null`);
    }
    if (typeof e.renderable !== "boolean") bad("renderable must be true or false");
    if (!e.values || typeof e.values !== "object" || Array.isArray(e.values)) bad("values must be an object");
    else for (const [k, v] of Object.entries(e.values)) if (typeof v !== "string") bad(`values["${k}"] must be a string`);
  }
  return problems;
}

/** The record in its one written form: fixed key order, paths and values sorted. */
function canonical(doc) {
  const files = {};
  for (const path of Object.keys(doc.files).sort(byCodeUnit)) {
    const e = doc.files[path];
    files[path] = {
      template: e.template,
      version: e.version,
      templateSha256: e.templateSha256,
      fileSha256: e.fileSha256,
      renderable: e.renderable,
      values: sortedValues(e.values),
    };
  }
  return { format: doc.format, cortex: doc.cortex, files };
}

function stampsError(file, why) {
  const err = new Error(`${file}: ${why}`);
  err.code = "stamps_invalid";
  err.file = file;
  return err;
}

// --- read ----------------------------------------------------------------------------------------

/**
 * The repo's stamp record, or `null` when it has none.
 *
 * Absent is `null` — never an empty record, because "Cortex recorded nothing here" and "Cortex
 * recorded these files" are different answers. Present but unreadable, unparseable or the wrong
 * shape is an error naming the file: a damaged record read as absent would let the next `/cortex`
 * run treat every stamped file as unknown and re-stamp over the team's edits.
 */
export function readStamps(repoRoot) {
  const file = join(repoRoot, ...STAMPS_REL.split("/"));
  if (!existsSync(file)) return null;
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw stampsError(file, `not readable as JSON (${e.message})`);
  }
  if (doc && typeof doc === "object" && typeof doc.format === "number" && doc.format > STAMPS_FORMAT) {
    throw stampsError(file, `format ${doc.format} was written by a newer Cortex than this one (reads format ${STAMPS_FORMAT}); update the plugin`);
  }
  const problems = recordProblems(doc);
  if (problems.length) throw stampsError(file, `not a stamp record: ${problems.join("; ")}`);
  return canonical(doc);
}

// --- record --------------------------------------------------------------------------------------

/**
 * A new record with `path` stamped — the old record is not touched. `record` may be `null`.
 *
 * `templateText` is the template source and `fileText` the rendered file as written; only their
 * hashes are kept. `values` are the placeholder values it was rendered with (strings — they are
 * substituted text), kept so an `update` can re-render. A second record of a path replaces the
 * first. The record's `cortex` is the newest version seen, so a teammate on an older plugin never
 * lowers it.
 */
export function recordStamp(record, { path, template, version, templateText, fileText, values = {} } = {}) {
  const pp = relPathProblem(path);
  if (pp) throw new TypeError(`recordStamp: path ${pp}: ${JSON.stringify(path)}`);
  const tp = relPathProblem(template);
  if (tp) throw new TypeError(`recordStamp: template ${tp}: ${JSON.stringify(template)}`);
  if (typeof version !== "string" || !VERSION.test(version)) throw new TypeError(`recordStamp: version must be x.y.z: ${JSON.stringify(version)}`);
  if (typeof templateText !== "string") throw new TypeError("recordStamp: templateText must be a string");
  if (typeof fileText !== "string") throw new TypeError("recordStamp: fileText must be a string");
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new TypeError("recordStamp: values must be an object");
  for (const [k, v] of Object.entries(values)) {
    if (typeof v !== "string") throw new TypeError(`recordStamp: values["${k}"] must be a string`);
  }

  const base = record ? canonical(record) : { format: STAMPS_FORMAT, cortex: null, files: {} };
  const cortex = newer(version, base.cortex) ? version : base.cortex;
  return canonical({
    format: STAMPS_FORMAT,
    cortex,
    files: {
      ...base.files,
      [path]: {
        template,
        version,
        templateSha256: hashText(templateText),
        fileSha256: hashText(fileText),
        renderable: hashText(renderTemplate(templateText, values)) === hashText(fileText),
        values: { ...values },
      },
    },
  });
}

/** A new record without `path`. Pure. For a file someone removed on purpose, or a retired template. */
export function forgetStamp(record, path) {
  const doc = canonical(record);
  if (!Object.hasOwn(doc.files, path)) throw new TypeError(`forgetStamp: ${path} is not in the record`);
  const files = { ...doc.files };
  delete files[path];
  return canonical({ ...doc, files });
}

// --- adoption ------------------------------------------------------------------------------------

/**
 * The loop files an older /cortex left here, as `{ path, template }` sorted by path: every file at a
 * location in `LOOP_STAMPS` that exists — but only when there is no record. With one, `[]`: a file
 * outside an existing record was not stamped by a Cortex that records, and it is the team's.
 */
export function adoptionCandidates(repoRoot, record) {
  if (record) return [];
  return LOOP_STAMPS
    .filter((s) => { try { return statSync(join(repoRoot, ...s.path.split("/"))).isFile(); } catch { return false; } })
    .map((s) => ({ path: s.path, template: s.template }))
    .sort((a, b) => byCodeUnit(a.path, b.path));
}

/**
 * A new record with `path` adopted: known to be a loop file, and nothing else known. Pure. Refuses a
 * path the record already holds — adopting would replace what was recorded with what was not.
 */
export function adoptStamp(record, { path, template }) {
  const pp = relPathProblem(path);
  if (pp) throw new TypeError(`adoptStamp: path ${pp}: ${JSON.stringify(path)}`);
  const tp = relPathProblem(template);
  if (tp) throw new TypeError(`adoptStamp: template ${tp}: ${JSON.stringify(template)}`);
  const base = record ? canonical(record) : { format: STAMPS_FORMAT, cortex: null, files: {} };
  if (Object.hasOwn(base.files, path)) throw new TypeError(`adoptStamp: ${path} is already in the record`);
  return canonical({
    ...base,
    files: {
      ...base.files,
      [path]: { template, version: null, templateSha256: null, fileSha256: null, renderable: false, values: {} },
    },
  });
}

// --- write ---------------------------------------------------------------------------------------

/**
 * Write the record to `<repoRoot>/.cortex/stamps.json`: two-space JSON, keys in a fixed order, paths
 * and values sorted, LF, one trailing newline — so the committed file diffs by the entry that
 * changed and nothing else. A record `readStamps` would refuse is refused here, before any write.
 * Returns the path written.
 */
export function writeStamps(repoRoot, record) {
  const file = join(repoRoot, ...STAMPS_REL.split("/"));
  const problems = recordProblems(record);
  if (problems.length) throw stampsError(file, `refusing to write an invalid stamp record: ${problems.join("; ")}`);
  mkdirSync(join(repoRoot, ".cortex"), { recursive: true });
  const text = JSON.stringify(canonical(record), null, 2) + "\n";
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file); // a half-written record would read as damaged, which blocks every re-run
  return file;
}

// --- is the record hidden from git? --------------------------------------------------------------

function defaultGit(repoRoot) {
  return (args) => {
    const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return { status: r.status, stdout: r.stdout ?? "" };
  };
}

/**
 * The ignore rule that keeps `.cortex/stamps.json` out of git, or `null` when none does.
 *
 * Returns `{ source, line, pattern, dirIgnored }`. `dirIgnored` says the rule excludes `.cortex`
 * itself, which changes the fix: git cannot re-include a file inside an excluded directory, so a
 * bare `!.cortex/stamps.json` under a `.cortex/` rule does nothing. Checked on real git, not assumed.
 *
 * Three answers are `null`, each deliberately. A tracked file is committed whatever the rules say
 * (git answers "not ignored" for it). Outside git there is no commit to miss. And a `!` pattern is
 * git naming the rule that RE-INCLUDES the file: `check-ignore -v` exits 0 for it too, so reading the
 * exit code alone would warn about the very fix this module recommends.
 */
export function stampsIgnoreRule(repoRoot, { git = defaultGit(repoRoot) } = {}) {
  const r = git(["check-ignore", "-v", STAMPS_REL]);
  if (r.status !== 0) return null;
  const m = /^(.*):(\d+):(.*)\t/.exec(r.stdout.split(/\r?\n/)[0] ?? "");
  if (!m || m[3].startsWith("!")) return null;
  // git answers "is .cortex excluded" correctly only when .cortex exists: for a path that is not
  // there it cannot know it is a directory, so a directory-only rule (`.cortex/`) does not match it —
  // and asking about `.cortex/` instead makes `.cortex/*` match too. A first install asks before the
  // directory exists, so then the matched rule itself is read: a directory-only pattern whose name
  // matches `.cortex` excludes the directory.
  const dirIgnored =
    git(["check-ignore", "-q", ".cortex"]).status === 0 ||
    (!existsSync(join(repoRoot, ".cortex")) && dirOnlyRuleMatchesCortex(m[3]));
  return { source: m[1], line: Number(m[2]), pattern: m[3], dirIgnored };
}

/** Does a directory-only ignore pattern (`name/`) name the top-level `.cortex` directory? */
function dirOnlyRuleMatchesCortex(pattern) {
  if (!pattern.endsWith("/")) return false;
  const stem = pattern.slice(0, -1).replace(/^\//, "").replace(/^\*\*\//, "");
  if (stem.includes("/")) return false;
  const re = new RegExp("^" + stem.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "$");
  return re.test(".cortex");
}

/**
 * The sentences a CLI prints for an ignored record: what hides it, what that costs, and the fix that
 * works for that rule. Never applied here — the user's ignore file is theirs, and editing it belongs
 * to the consent-gated install.
 */
export function ignoreAdvice({ source, line, pattern, dirIgnored }) {
  // A .gitignore's patterns are relative to its own directory, so the negation must be too. Every
  // other source (`.git/info/exclude`, a global excludes file) is read from the repo root.
  const inRepoGitignore = /(^|\/)\.gitignore$/.test(source) && !posix.isAbsolute(source) && !/^[A-Za-z]:/.test(source);
  const base = inRepoGitignore ? posix.dirname(source) : ".";
  const rel = base === "." ? STAMPS_REL : posix.relative(base, STAMPS_REL);
  const head =
    `${STAMPS_REL} is ignored by ${source}:${line} (\`${pattern}\`), so it will not be committed — ` +
    "the team will not share it, and the next run elsewhere cannot tell what Cortex wrote here.";
  const fix = dirIgnored
    ? `Fix: that rule ignores the whole .cortex directory, and git cannot re-include a file inside an ` +
      `ignored directory. In ${source}, change line ${line} to \`.cortex/*\` and add \`!${rel}\` after it.`
    : `Fix: add \`!${rel}\` to ${source}, after line ${line}.`;
  return `${head}\n${fix}\nNothing was changed in ${source}.`;
}

// --- status --------------------------------------------------------------------------------------

function readIfFile(abs) {
  let st;
  try {
    st = statSync(abs);
  } catch (e) {
    if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return null;
    throw e;
  }
  return st.isFile() ? readFileSync(abs, "utf8") : null;
}

/**
 * One entry per recorded path, sorted: `{ path, template, version, state }`, where `state` is one of
 * `STATES` — decided as in the header. `null` when there is no record, so "nothing recorded" never
 * reads as "everything current". `templatesDir` is the running Cortex's `templates/` directory.
 */
export function stampStatus({ repoRoot, record, templatesDir }) {
  if (record == null) return null;
  // Status reads every path the record names, so a record built by hand is held to the same shape.
  const problems = recordProblems(record);
  if (problems.length) throw new TypeError(`stampStatus: not a stamp record: ${problems.join("; ")}`);
  let dirOk = false;
  try { dirOk = statSync(templatesDir).isDirectory(); } catch { dirOk = false; }
  if (!dirOk) throw new Error(`stampStatus: templates directory not found: ${templatesDir}`);

  const doc = canonical(record);
  const out = [];
  for (const [path, e] of Object.entries(doc.files)) {
    const fileText = readIfFile(join(repoRoot, ...path.split("/")));
    const templateText = readIfFile(join(templatesDir, ...e.template.split("/")));
    let state;
    if (fileText === null) state = "missing";
    else if (templateText === null) state = "retired";
    else {
      // A `null` (unknown) recorded hash equals no digest, so it always reads as changed.
      const fileSame = hashText(fileText) === e.fileSha256;
      const templateSame = hashText(templateText) === e.templateSha256;
      state = fileSame
        ? (templateSame ? "current" : e.renderable ? "update" : "review")
        : (templateSame ? "edited" : "conflict");
    }
    out.push({ path, template: e.template, version: e.version, renderable: e.renderable, state });
  }
  return out;
}

// --- update and diff -----------------------------------------------------------------------------

/**
 * What an update would write: `{ updates: [{ path, template, templateText, text, values }], refused:
 * [{ path, why }] }`. Reads only; the caller writes each `text` and records it again.
 *
 * Only a file in state `update` is ever planned. With `paths`, only those, and a named path that is
 * not in the record or not in state `update` is a refusal the caller must report — someone asked for
 * it by name. Without `paths`, every `update` file, and the other states are simply not planned.
 *
 * One more refusal: a new template can add a placeholder no recorded value fills. Rendering would
 * leave `{{OWNER}}` in the file, so that file is refused, naming it. A placeholder the file as written
 * still holds (it is untouched, so it is the file as written) was kept on purpose, as
 * `intent/TEMPLATE.md` keeps `{{TITLE}}`, and stays.
 *
 * `running` is the Cortex doing the update, and is required. When the record was written by a newer
 * one, nothing is planned: one refusal, against the record, carrying `olderPlugin`'s advice.
 */
export function planUpdates({ repoRoot, record, templatesDir, paths = null, running }) {
  if (!VERSION.test(running)) {
    throw new Error(`running must be an x.y.z version — the Cortex doing the update — found ${JSON.stringify(running)}`);
  }
  const behind = olderPlugin(record, running);
  if (behind) return { updates: [], refused: [{ path: STAMPS_REL, why: behind.advice }] };
  const status = stampStatus({ repoRoot, record, templatesDir }) ?? [];
  const byPath = new Map(status.map((s) => [s.path, s]));
  const doc = canonical(record);
  const updates = [];
  const refused = [];

  let targets;
  if (paths) {
    targets = [];
    for (const p of paths) {
      const s = byPath.get(p);
      if (!s) refused.push({ path: p, why: `${p} is not in the record` });
      else if (s.state !== "update") refused.push({ path: p, why: `${p} is ${s.state}, not update — it is never rewritten without a per-file yes` });
      else targets.push(s);
    }
  } else {
    targets = status.filter((s) => s.state === "update");
  }

  for (const s of targets) {
    const e = doc.files[s.path];
    const templateText = readFileSync(join(templatesDir, ...e.template.split("/")), "utf8");
    const fileNow = readFileSync(join(repoRoot, ...s.path.split("/")), "utf8");
    const kept = new Set(placeholderMatches(fileNow).map((m) => m.name));
    const unvalued = unfilledPlaceholders(templateText, e.values).filter((n) => !kept.has(n));
    if (unvalued.length) {
      refused.push({
        path: s.path,
        why: `the new ${e.template} adds ${unvalued.map((n) => `{{${n}}}`).join(", ")}, which no recorded value fills — stamp it again with a value`,
      });
      continue;
    }
    updates.push({ path: s.path, template: e.template, templateText, text: renderTemplate(templateText, e.values), values: e.values });
  }
  return { updates, refused };
}

/**
 * The per-file question's evidence: `{ path, state, diff }`, where `diff` runs from the file now to
 * the current template rendered with the recorded values — what an update would change. `diff` is
 * `null` for a retired template (nothing to render). `null` overall when the record has no `path`.
 */
export function stampDiff({ repoRoot, record, templatesDir, path }) {
  const s = (stampStatus({ repoRoot, record, templatesDir }) ?? []).find((x) => x.path === path);
  if (!s) return null;
  const e = canonical(record).files[path];
  const templateText = readIfFile(join(templatesDir, ...e.template.split("/")));
  if (templateText === null) return { path, state: s.state, diff: null };
  const fileText = readIfFile(join(repoRoot, ...path.split("/"))) ?? "";
  return { path, state: s.state, diff: lineDiff(fileText, renderTemplate(templateText, e.values)) };
}
