import { tempDir } from "./tmp.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, utimesSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  INDEX_REL,
  defaultIndexPath,
  generatedNotice,
  indexFreshness,
  openTarget,
  parseArgv,
  readIndex,
  staleNote,
} from "../lib/open.mjs";
import { INDEX_VERSION } from "../lib/format.mjs";

// The point of the front door is that argument handling stops being reachable only by spawning a
// real process from a shell test. Everything below drives it from literals.

// --- a test harness that stands in for a process -------------------------------------------------

/**
 * Run openTarget with a fake io, so a refusal is an observation instead of a dead test runner.
 *
 * Returns `{ result, out, err, code }`. `code` is null when the command was allowed to proceed.
 */
function open(argv, spec, { cwd = process.cwd() } = {}) {
  let out = "";
  let err = "";
  let code = null;
  const io = {
    out: (s) => (out += s),
    err: (s) => (err += s),
    exit: (c) => (code = c),
    cwd: () => cwd,
  };
  let result = null;
  try {
    result = openTarget(argv, spec, io);
  } catch {
    // openTarget throws after calling io.exit, so nothing downstream of a refusal ever runs. With
    // the real io the process is already gone by then.
  }
  return { result, out, err, code };
}

function tempRepo(name = "cortex-open-") {
  return tempDir(name);
}

function writeIndex(root, index) {
  mkdirSync(join(root, ".cortex", "index"), { recursive: true });
  const p = defaultIndexPath(root);
  writeFileSync(p, typeof index === "string" ? index : JSON.stringify(index));
  return p;
}

const validIndex = { version: INDEX_VERSION, files: [], edges: [], areas: [], layers: [], cycles: [], stats: {} };

const SPEC = {
  usage: "usage: cortex-thing [root] [--out FILE] [--json]",
  flags: { "--out": "value", "--json": "boolean" },
  root: "positional",
  index: "none",
};

// --- the flag allowlist ---------------------------------------------------------------------------

test("an unregistered flag is refused, and the message names it", () => {
  // The live bug: `cortex-index.mjs . --ouput x.json` matched no branch, so the typo was dropped,
  // `x.json` was ignored because the root was already set, and the index went to the default path.
  // A confident wrong destination with no error.
  const root = tempRepo();
  const r = open([root, "--ouput", "x.json"], SPEC);
  assert.equal(r.code, 1, "a flag nobody declared is a usage error, not a silent reinterpretation");
  assert.match(r.err, /unknown flag: --ouput/);
  assert.ok(r.err.includes(SPEC.usage), "and the usage line says what was available instead");
  assert.equal(r.result, null, "nothing downstream of the refusal runs");
});

test("a single-dash argument is a flag, not a repo root", () => {
  // `!a.startsWith("--")` let `-v` through as a path. cortex-enrich found it, fixed its own copy,
  // and left it live in seven siblings: the run created a directory literally named `-v`.
  const r = open(["-v"], SPEC, { cwd: tempRepo() });
  assert.equal(r.code, 1);
  assert.match(r.err, /unknown flag: -v/);
});

test("every unknown flag is named, not just the first", () => {
  const r = open(["--ouput", "x", "--jsno"], SPEC, { cwd: tempRepo() });
  assert.match(r.err, /unknown flag: --ouput, --jsno/);
});

test("a valued flag's value is consumed as a value, never promoted to the root", () => {
  // `plan --include src <repo>` left `src` looking like the first bare argument, so the named repo
  // was never touched and `.cortex/` landed in whatever directory the caller was standing in.
  const root = tempRepo();
  const spec = { ...SPEC, flags: { "--include": "list" } };
  const r = open(["--include", "src", root], spec);
  assert.equal(r.code, null);
  assert.equal(r.result.root, resolve(root));
  assert.deepEqual(r.result.args.include, ["src"]);
});

test("the inline form carries its own value, so the next argument is still the root", () => {
  const root = tempRepo();
  const spec = { ...SPEC, flags: { "--include": "list" } };
  const r = open(["--include=src,lib", root], spec);
  assert.equal(r.result.root, resolve(root));
  assert.deepEqual(r.result.args.include, ["src", "lib"], "comma-separated, and trimmed");
});

test("a list flag repeats", () => {
  const p = parseArgv(["--include", "a", "--include", "b"], { ...SPEC, flags: { "--include": "list" } });
  assert.deepEqual(p.args.include, ["a", "b"]);
});

test("a valued flag with nothing after it is refused rather than read as null", () => {
  const p = parseArgv(["--out"], SPEC);
  assert.match(p.problem, /--out needs a value/);
});

test("--no-open becomes noOpen, so the declaration is the only place the name is written", () => {
  const p = parseArgv(["--no-open"], { ...SPEC, flags: { "--no-open": "boolean" } });
  assert.equal(p.args.noOpen, true);
});

test("a second bare argument is refused, not dropped on the floor", () => {
  // Dropping it is how a typo'd flag's value became invisible instead of being reported.
  const root = tempRepo();
  const r = open([root, "extra"], SPEC);
  assert.equal(r.code, 1);
  assert.match(r.err, /unexpected argument: extra/);
});

test("a command whose bare arguments are paths takes its root from --root", () => {
  const root = tempRepo();
  const spec = { ...SPEC, root: "flag", flags: { ...SPEC.flags, "--root": "value" } };
  const r = open(["src/a.js", "--root", root, "src/b.js"], spec);
  assert.equal(r.result.root, resolve(root));
  assert.deepEqual(r.result.paths, ["src/a.js", "src/b.js"]);
});

test("--help prints the usage and exits 0", () => {
  const r = open(["--help"], SPEC);
  assert.equal(r.code, 0);
  assert.equal(r.out, `${SPEC.usage}\n`);
  assert.equal(r.err, "", "a usage request is not an error");
});

// --- the root -------------------------------------------------------------------------------------

test("a root that is not a directory is refused before anything is read", () => {
  const missing = join(tempRepo(), "nope");
  const r = open([missing], { ...SPEC, index: "require" });
  assert.equal(r.code, 1, "exit 1: what you asked for is not a thing");
  assert.match(r.err, /not a directory/);
  assert.match(r.err, /Nothing was changed/);
  assert.ok(!r.err.includes("no index at"), "the root is settled first — one problem, one message");
});

// --- one error mode for the index ------------------------------------------------------------------

test("the default index path is derived from the constant, not spelled again", () => {
  // Restating the string here would make this a second copy of the thing under test, and it would
  // pass for a tenth literal as happily as for the constant.
  const root = tempRepo();
  assert.equal(defaultIndexPath(root), join(root, ...INDEX_REL));
  assert.equal(defaultIndexPath("/a"), defaultIndexPath("/a"), "and it is a function of the root alone");
});

// --- the property, asserted over whatever is in the directory ------------------------------------
//
// Not a list of eight command names. The rule is "every CLI here comes through the front door", and
// a hardcoded list passes cheerfully for the ninth CLI somebody adds next month with its own
// `parseArgs` — which is exactly how there came to be seven. So the directory is the input, and a
// command that opts out has to say so here, by name and with a reason.

const INDEX_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `cortex-memory.mjs` is the one exemption, and it is declared rather than assumed: its `--root`
 * means a `.cortex` directory rather than a repository root, it takes a subcommand, and it never
 * reads an index. It has nothing the front door owns. Any other exemption belongs here with its own
 * sentence — an unexplained one is the check switched off wearing the check's clothes.
 */
const NOT_A_TARGET_CLI = new Set(["cortex-memory.mjs"]);

function cliSources() {
  const names = readdirSync(INDEX_DIR).filter((f) => f.startsWith("cortex-") && f.endsWith(".mjs"));
  assert.ok(names.length >= 8, "the scan found the CLIs at all — a glob that matches nothing passes everything");
  return names
    .filter((n) => !NOT_A_TARGET_CLI.has(n))
    .map((name) => ({ name, src: readFileSync(join(INDEX_DIR, name), "utf8") }));
}

test("every CLI in this directory opens through the front door", () => {
  for (const { name, src } of cliSources()) {
    assert.match(src, /from "\.\/lib\/open\.mjs"/, `${name} must import lib/open.mjs`);
  }
});

test("no CLI has rolled its own argument parser", () => {
  // Seven did. Each was a different subset of the same bugs, and the one that found the `-v` hole
  // fixed its own copy and left it live in the rest.
  for (const { name, src } of cliSources()) {
    assert.doesNotMatch(src, /function parseArgs\b/, `${name} must not parse argv itself`);
  }
});

test("no CLI spells the index path, so there is one place it can be wrong", () => {
  // Nine files carried this literal. The test is over the directory rather than over a list,
  // because the failure mode is a file nobody remembered to check.
  for (const { name, src } of cliSources()) {
    assert.ok(
      !src.includes('".cortex", "index", "index.json"'),
      `${name} must ask defaultIndexPath() rather than joining the path again`,
    );
  }
});

test("no CLI re-derives what the front door already refuses", () => {
  // rootProblem and the JSON.parse of an index are the two steps every one of them used to repeat,
  // and repeating them is how three different answers to "this index is corrupt" came about.
  for (const { name, src } of cliSources()) {
    assert.doesNotMatch(src, /rootProblem\s*\(/, `${name} must not re-run the root check`);
    assert.doesNotMatch(
      src,
      /JSON\.parse\(readFileSync\(indexPath/,
      `${name} must not parse an index behind the front door's back`,
    );
  }
});

test("a missing index is refused by `require`, with the command that makes one", () => {
  const root = tempRepo();
  const r = open([root], { ...SPEC, index: "require" });
  assert.equal(r.code, 2, "exit 2: the repo is not in a state this command can answer about");
  assert.match(r.err, /no index at/);
  assert.match(r.err, /cortex-index\.mjs/);
});

test("the rebuild hint quotes the root the user actually typed", () => {
  const root = tempRepo();
  const r = open([root], { ...SPEC, index: "require" });
  assert.ok(r.err.includes(`cortex-index.mjs ${root}`), "so it can be pasted, not translated");
});

test("a corrupt index is one declared error mode, not a raw SyntaxError", () => {
  // Four CLIs handed the user a parser stack trace for this, which names the parser and not the
  // file. A fifth rebuilt in silence and a sixth degraded to null. Three answers, one question.
  const root = tempRepo();
  const p = writeIndex(root, "{ this is not json");
  const r = open([root], { ...SPEC, index: "require" });
  assert.equal(r.code, 2);
  assert.ok(r.err.includes(p), "the message names the file");
  assert.match(r.err, /not readable JSON/);
  assert.match(r.err, /cortex-index\.mjs/, "and the fix, because the file is generated");
});

test("an index in a format this build does not read is refused, not guessed at", () => {
  // INDEX_VERSION was written at build time and read by no consumer at all, so a v1 index handed to
  // a v2 reader produced a confident answer from a shape that no longer held.
  const root = tempRepo();
  writeIndex(root, { ...validIndex, version: "0" });
  const r = open([root], { ...SPEC, index: "require" });
  assert.equal(r.code, 2);
  assert.match(r.err, /is format 0; this Cortex reads 1/);
});

test("an index with no version field at all counts as a mismatch", () => {
  const root = tempRepo();
  writeIndex(root, { files: [], stats: {} });
  const r = open([root], { ...SPEC, index: "require" });
  assert.equal(r.code, 2);
  assert.match(r.err, /is format \(none\)/);
});

test("a good index is handed back parsed", () => {
  const root = tempRepo();
  const p = writeIndex(root, { ...validIndex, files: [{ path: "a.js" }] });
  const r = open([root], { ...SPEC, index: "require" });
  assert.equal(r.code, null);
  assert.equal(r.result.indexPath, p);
  assert.deepEqual(r.result.index.files, [{ path: "a.js" }]);
});

test("`optional` degrades to null when there is no index — that is its ordinary case", () => {
  const root = tempRepo();
  const r = open([root], { ...SPEC, index: "optional" });
  assert.equal(r.code, null);
  assert.equal(r.result.index, null);
  assert.equal(r.err, "", "an absent index is not news to a command built to answer without one");
});

test("`optional` still says so when an index EXISTS and cannot be read", () => {
  // Silence here is how a ✓ ends up beside a step nobody ran: the file is right there, and the
  // command decided on its own not to mention that it ignored it.
  const root = tempRepo();
  writeIndex(root, "{ nope");
  const r = open([root], { ...SPEC, index: "optional" });
  assert.equal(r.code, null, "it still answers");
  assert.equal(r.result.index, null);
  assert.match(r.err, /not readable JSON/, "but never in silence");
});

test("`build` builds one when none is stored, and refuses when one is stored and broken", () => {
  const root = tempRepo();
  let built = 0;
  const spec = { ...SPEC, index: "build", buildIndex: () => (built++, { ...validIndex, built: true }) };

  const fresh = open([root], spec);
  assert.equal(fresh.code, null);
  assert.equal(built, 1);
  assert.equal(fresh.result.index.built, true);

  writeIndex(root, "{ nope");
  const broken = open([root], spec);
  assert.equal(broken.code, 2, "rebuilding over it would answer from something the user never saw");
  assert.equal(built, 1, "and it does not build one behind their back");
});

test("readIndex returns text, never an exception, so a caller keeps its own exit code", () => {
  const root = tempRepo();
  const r = readIndex(defaultIndexPath(root), { rootArg: "." });
  assert.equal(r.kind, "absent");
  assert.equal(r.index, undefined);
  assert.match(r.problem, /no index at/);
});

// --- freshness --------------------------------------------------------------------------------------

function gitRepo() {
  const root = tempRepo("cortex-fresh-");
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  git("init", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(root, "a.js"), "export const a = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return root;
}

/** Age a path by seconds, so the comparison is a fact rather than a race. */
function age(path, seconds) {
  const when = new Date(Date.now() - seconds * 1000);
  utimesSync(path, when, when);
}

test("an index older than a tracked source file is stale", () => {
  const root = gitRepo();
  const p = writeIndex(root, validIndex);
  age(p, 600);
  const f = indexFreshness(root, p);
  assert.equal(f.present, true);
  assert.equal(f.stale, true);
  assert.deepEqual(f.changedSince, ["a.js"], "and it names what moved, so the claim is checkable");
});

test("an index newer than everything tracked is not stale", () => {
  const root = gitRepo();
  const p = writeIndex(root, validIndex);
  age(join(root, "a.js"), 600);
  assert.equal(indexFreshness(root, p).stale, false);
});

test("an untracked file is not a reason to re-index", () => {
  // A node_modules refresh or a build artefact is not a reason, and treating it as one trains the
  // reader to ignore the warning.
  const root = gitRepo();
  const p = writeIndex(root, validIndex);
  age(p, 600);
  writeFileSync(join(root, "untracked.log"), "x\n");
  assert.deepEqual(indexFreshness(root, p).changedSince, ["a.js"], "only tracked files count");
});

test("outside git, freshness says it cannot tell rather than guessing", () => {
  const root = tempRepo();
  const p = writeIndex(root, validIndex);
  const f = indexFreshness(root, p);
  assert.equal(f.stale, null, "null is not false — one of them would be a claim");
  assert.match(f.reason, /not a git repo/);
});

test("freshness accepts a directory too, so preflight can adopt it unchanged", () => {
  const root = gitRepo();
  const p = writeIndex(root, validIndex);
  age(p, 600);
  const f = indexFreshness(root, join(root, ".cortex", "index"));
  assert.equal(f.stale, true);
});

test("the stale note is one line pair, and absent when the index is current", () => {
  const root = gitRepo();
  const p = writeIndex(root, validIndex);
  assert.equal(staleNote(root, p), null, "no banner on a run where there is nothing to say");
  age(p, 600);
  const note = staleNote(root, p, { rootArg: "." });
  assert.match(note, /tracked file is newer/);
  assert.match(note, /a\.js/);
  assert.match(note, /cortex-index\.mjs \./);
});

test("a command that declares freshness reports it; one that does not pays nothing", () => {
  const root = gitRepo();
  const p = writeIndex(root, validIndex);
  age(p, 600);

  const quiet = open([root], { ...SPEC, index: "require" });
  assert.equal(quiet.result.stale, null, "undeclared is not computed, and not claimed either");
  assert.equal(quiet.err, "");

  const loud = open([root], { ...SPEC, index: "require", freshness: true });
  assert.equal(loud.result.stale, true);
  assert.match(loud.err, /It describes code that has moved/);
});

test("a machine-readable mode gets no prose on either stream", () => {
  // Callers pipe `--offers` and `--json` with 2>&1 straight into JSON.parse. An advisory mixed into
  // that is not a warning, it is a parse error.
  const root = gitRepo();
  age(writeIndex(root, validIndex), 600);
  const spec = { ...SPEC, index: "require", freshness: (a) => !a.json };
  const r = open([root, "--json"], spec);
  assert.equal(r.err, "");
  assert.equal(r.result.stale, null);
});

// --- what landed in someone's repository --------------------------------------------------------------

test("generatedNotice says what was created and what was ignored, and stays silent otherwise", () => {
  assert.equal(generatedNotice({ created: false, ignored: [] }), "");
  const both = generatedNotice({ created: true, ignored: [".cortex/index/"] });
  assert.match(both, /Created \.cortex\//);
  assert.match(both, /memory\/ is committed on purpose/);
  assert.match(both, /Added to \.gitignore: \.cortex\/index\//);
  assert.ok(both.endsWith("\n"));
});
