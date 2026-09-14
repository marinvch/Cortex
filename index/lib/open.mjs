// open.mjs — the front door every CLI in this package comes through.
//
// Eight commands opened the same way and none of them shared the code: parse argv, check the root,
// resolve `--index` or fall back to the default path, load the index, print what was generated.
// Seven hand-rolled `parseArgs`, nine copies of the `.cortex/index/index.json` literal, four copies
// of `generatedNotice`, and three different answers for a corrupt index — degrade to null, rebuild
// in silence, or throw a raw SyntaxError at the user.
//
// Copies that agree today is not the failure; the failure is already on the record. `cortex-enrich`
// found that `!a.startsWith("--")` lets `-v` through as a repo ROOT, wrote `.cortex/` into a
// directory it had invented from a mangled flag, and exited 0. It fixed its own copy, wrote the
// reason in a comment, and left the bug live in the other seven. The same shape without a dash is
// still live everywhere: `cortex-index.mjs . --ouput x.json` matches no branch, so the typo is
// dropped, `x.json` is ignored because the root is already set, and the index is written to the
// default path — a confident wrong destination with no error.
//
// So the flags are DECLARED, per command, and the declaration is the allowlist. An unregistered or
// misspelled flag is refused with a message naming it, never reinterpreted as a path. Everything a
// caller genuinely differs on — where the root comes from, whether a missing index is fatal — is a
// field in that declaration rather than a re-decision in each file. The behaviour stays intentional;
// only the mechanism is shared.
//
// Deliberately NOT `core/`: nothing here is kernel, and `core/paths.js` answers a different question
// (is this path inside the root we may touch). This is the opening of a Cortex command, and it is
// the only place in `index/` that is allowed to call `process.exit`.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { rootProblem } from "./root.mjs";
import { INDEX_VERSION, defaultIndexPath } from "./format.mjs";

// Where an index lives is a fact about the format, so it is declared there — but a CLI asks the
// front door for everything, and re-exporting is what keeps that true without a second definition.
export { INDEX_REL, defaultIndexPath } from "./format.mjs";

/** The command that produces one, quoted back to the user with the root they actually typed. */
function rebuildHint(rootArg) {
  return `node index/cortex-index.mjs ${rootArg || "."}`;
}

// --- what landed in someone's repository ----------------------------------------------------------

/**
 * A directory appearing in someone's project on a run they did not explicitly ask for should be
 * visible. ADR 0005 puts the consent gate in the skill; this is the other half — saying what
 * landed, so "generated and gitignored" never quietly means "invisible".
 *
 * Takes the `{ created, ignored }` that `generated.mjs` returns. Four copies of this existed and
 * agreed; the fifth would not have.
 */
export function generatedNotice(gen) {
  const out = [];
  if (gen?.created) out.push("Created .cortex/ — generated artifacts live here; .cortex/memory/ is committed on purpose.");
  if (gen?.ignored?.length) out.push("Added to .gitignore: " + gen.ignored.join(", "));
  return out.length ? out.join("\n") + "\n" : "";
}

// --- reading an index, with one error mode ---------------------------------------------------------

/**
 * Read an index file, or say exactly what is wrong with it.
 *
 * Returns `{ index }` on success and `{ problem }` on failure — text, not an exception, so the
 * caller keeps ownership of its exit code and the tests can drive this from literals.
 *
 * Three failures, one shape:
 * - **absent** — there is no file there.
 * - **unreadable** — it is not JSON. Four CLIs used to hand the user a raw `SyntaxError` stack for
 *   this, which names the parser and not the file.
 * - **wrong format** — `version` is not the one this build reads. Nothing checked that at all, so a
 *   v1 index read by a v2 consumer produced a plausible answer from a shape that no longer held.
 *   A missing `version` counts as a mismatch: it means an index older than the field itself.
 */
export function readIndex(indexPath, { rootArg = "" } = {}) {
  if (!existsSync(indexPath)) {
    return { problem: `no index at ${indexPath}\nRun: ${rebuildHint(rootArg)}\n`, kind: "absent" };
  }
  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch (e) {
    return {
      problem:
        `index at ${indexPath} is not readable JSON — ${e.message}\n` +
        `It is generated, so the fix is to write it again: ${rebuildHint(rootArg)}\n`,
      kind: "unreadable",
    };
  }
  const found = index?.version ?? null;
  if (found !== INDEX_VERSION) {
    return {
      problem:
        `index at ${indexPath} is format ${found ?? "(none)"}; this Cortex reads ${INDEX_VERSION}.\n` +
        `Reading it would produce a confident answer from a shape that no longer holds. ` +
        `Re-run: ${rebuildHint(rootArg)}\n`,
      kind: "version",
    };
  }
  return { index };
}

// --- freshness -------------------------------------------------------------------------------------

/**
 * Is this index older than the code it describes?
 *
 * "Re-run the index first if it is stale" is advice six rituals give and none can act on, because
 * none of them defines stale. `tools/cortex-preflight.mjs` defines it and no CLI can reach it — it
 * lives in `tools/`, which ships as scripts a person runs rather than as a module this package may
 * import. This is that same definition, in `index/lib/` where the CLIs can call it, and it accepts a
 * directory as well as a file so preflight can adopt it verbatim instead of keeping the second copy.
 * Until it does, there are two — said out loud rather than left to be discovered.
 *
 * mtime, not git history, because an uncommitted edit is exactly the case a pre-read check must
 * catch. The known cost: a `git checkout` or a fresh clone rewrites mtimes and reads as stale when
 * nothing changed. That error points at re-running a deterministic index — cheap and correct — while
 * the opposite error hands someone a confident map of code that moved. Prefer the cheap one.
 *
 * Only tracked files count. A `node_modules` refresh is not a reason to re-index, and treating it as
 * one trains the reader to ignore the warning.
 */
export function indexFreshness(root, target) {
  let newest = 0;
  let stat = null;
  try {
    stat = statSync(target);
  } catch {
    stat = null;
  }
  if (stat?.isDirectory()) {
    for (const name of readdirSync(target)) {
      try {
        newest = Math.max(newest, statSync(join(target, name)).mtimeMs);
      } catch { /* a file that vanished mid-walk is not a freshness signal */ }
    }
  } else if (stat) {
    newest = stat.mtimeMs;
  }
  if (!newest) return { present: false, stale: null, changedSince: [] };

  const ageDays = Math.floor((Date.now() - newest) / 86_400_000);

  let tracked = null;
  try {
    tracked = execFileSync("git", ["ls-files"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    tracked = null;
  }
  if (tracked === null) {
    return { present: true, ageDays, stale: null, changedSince: [], reason: "not a git repo — cannot tell" };
  }

  const changed = [];
  for (const rel of tracked.split("\n")) {
    if (!rel || rel.startsWith(".cortex/")) continue;
    try {
      if (statSync(join(root, rel)).mtimeMs > newest) changed.push(rel);
    } catch { /* deleted-but-tracked; a file that is gone cannot make the index stale */ }
    if (changed.length >= 5) break;
  }
  return { present: true, ageDays, stale: changed.length > 0, changedSince: changed };
}

/**
 * The one line a command prints when the index it just read is older than the repo, or `null`.
 *
 * stderr, one line, and only when it is true — a banner on every run is a banner nobody reads.
 */
export function staleNote(root, indexPath, { rootArg = "" } = {}) {
  const f = indexFreshness(root, indexPath);
  if (!f.stale) return null;
  const n = f.changedSince.length;
  return (
    `Note: this index is ${f.ageDays}d old and ${n}${n >= 5 ? "+" : ""} tracked file${n === 1 ? " is" : "s are"} newer ` +
    `(${f.changedSince.slice(0, 3).join(", ")}${n > 3 ? ", …" : ""}).\n` +
    `      It describes code that has moved. Re-run: ${rebuildHint(rootArg)}\n`
  );
}

// --- argv -------------------------------------------------------------------------------------------

/** `--no-open` → `noOpen`. Explicit `key` in the declaration wins. */
function keyFor(name, decl) {
  if (typeof decl === "object" && decl.key) return decl.key;
  return name.replace(/^-+/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function typeOf(decl) {
  return typeof decl === "string" ? decl : decl.type;
}

const HELP_FLAGS = { "--help": { type: "boolean", key: "help" }, "-h": { type: "boolean", key: "help" } };

/**
 * Parse argv against a command's declared flags.
 *
 * Returns `{ args, positional }`, or `{ problem }` with the text to print. Pure — no filesystem, no
 * exit — which is the point: argument handling used to be reachable only by spawning a real process
 * from a shell test.
 *
 * Three rules, each one a bug that shipped:
 * - **A leading `-` is a flag, not a path.** `--`-only was the sibling convention, and it let `-v`
 *   through as a repo root.
 * - **An unregistered flag is refused, never ignored.** A typo that matches no branch used to be
 *   dropped silently, and whatever followed it was then read as something else.
 * - **A valued flag's value is consumed as a value.** Otherwise `--include src <repo>` promotes
 *   `src` to the repo root, and the named repo is never touched.
 */
export function parseArgv(argv, spec) {
  const declared = { ...HELP_FLAGS, ...(spec.flags ?? {}) };
  const args = {};
  for (const [name, decl] of Object.entries(declared)) {
    const key = keyFor(name, decl);
    const t = typeOf(decl);
    if (!(key in args)) args[key] = t === "boolean" ? false : t === "list" ? [] : null;
  }

  const positional = [];
  const unknown = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq === -1 ? a : a.slice(0, eq);
    const decl = declared[name];
    if (!decl) {
      unknown.push(name);
      continue;
    }
    const t = typeOf(decl);
    const key = keyFor(name, decl);
    if (t === "boolean") {
      args[key] = true;
      continue;
    }
    // `--include=src` carries its value inline, so the next argument is not part of it.
    const value = eq === -1 ? argv[++i] : a.slice(eq + 1);
    if (value === undefined) {
      return { problem: `${name} needs a value\n${spec.usage}\n` };
    }
    if (t === "list") args[key].push(...String(value).split(",").map((s) => s.trim()).filter(Boolean));
    else args[key] = value;
  }

  if (unknown.length) {
    return { problem: `unknown flag: ${unknown.join(", ")}\n${spec.usage}\n` };
  }
  return { args, positional };
}

// --- the door ----------------------------------------------------------------------------------------

const realIo = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  exit: (code) => process.exit(code),
  cwd: () => process.cwd(),
};

/**
 * Open a target repository for a command: argv in, `{ root, args, paths, index, indexPath, stale }`
 * out, and a refusal on stderr with a non-zero exit for anything that would otherwise produce a
 * confident wrong answer.
 *
 * `spec` declares what this command is, not what every command does:
 * - `usage`     — printed under every refusal and by `--help`. Required.
 * - `flags`     — `{ "--json": "boolean", "--since": "value", "--include": "list" }`. The allowlist.
 * - `root`      — `"positional"` (the first bare argument) or `"flag"` (`--root`, bare arguments are
 *                 paths). A command taking file paths cannot also take a bare root; saying which it
 *                 is here is what stops a path from silently becoming a root.
 * - `index`     — `"none"` · `"optional"` · `"require"` · `"build"`. The declared error mode: refuse,
 *                 degrade to `null`, or build one in memory (`buildIndex` must be passed as
 *                 `spec.buildIndex`, so the decision to build lives at the call site that means it).
 * - `freshness` — print the stale note when the index this command just read is older than the code.
 *                 `true`, or a predicate on the parsed args for a command with a machine-readable
 *                 mode that must stay parseable.
 *
 * Exit codes are the existing convention, unchanged: **1** for "what you asked for is not a thing"
 * (bad flag, bad root), **2** for "this repo is not in a state I can answer about" (no index, an
 * index I cannot read).
 */
export function openTarget(argv, spec, io = realIo) {
  const fail = (text, code) => {
    io.err(text);
    io.exit(code);
    // A fake io in a test does not exit. Throwing keeps the contract honest either way: nothing
    // downstream of a refusal ever runs.
    throw new Error(text);
  };

  const parsed = parseArgv(argv, spec);
  if (parsed.problem) fail(parsed.problem, 1);
  const { args, positional } = parsed;

  if (args.help) {
    io.out(`${spec.usage}\n`);
    io.exit(0);
    throw new Error("help");
  }

  let rootArg = null;
  let paths = [];
  if (spec.root === "flag") {
    rootArg = args.root ?? null;
    paths = positional;
  } else {
    // Exactly one bare argument. A second used to be dropped on the floor, which is how a typo'd
    // flag's value became invisible rather than refused.
    if (positional.length > 1) {
      fail(`unexpected argument: ${positional[1]}\n${spec.usage}\n`, 1);
    }
    rootArg = positional[0] ?? null;
  }

  const root = resolve(rootArg || io.cwd());

  // A root that is not a directory produces a confident empty answer, not an error: buildIndex
  // returns zero files rather than throwing. Refuse instead — the route in (a mangled flag, a typo,
  // a stale path in a script) does not matter, the output does.
  const rootIssue = rootProblem(root);
  if (rootIssue) fail(rootIssue, 1);

  const indexPath = args.index
    ? isAbsolute(args.index)
      ? args.index
      : resolve(args.index)
    : defaultIndexPath(root);

  let index = null;
  let read = null;
  if (spec.index && spec.index !== "none") {
    read = readIndex(indexPath, { rootArg });
    if (read.problem) {
      if (spec.index === "require") fail(read.problem, 2);
      else if (spec.index === "build") {
        // Absent is the ordinary case this mode exists for — the report can be produced without a
        // stored index. Unreadable or the wrong format is not: rebuilding over it would hide a file
        // the user still has, and answer from something they never inspected.
        if (read.kind !== "absent") fail(read.problem, 2);
        index = spec.buildIndex(root);
      } else {
        // "optional" — the command has something to say without an index, and says it. The note is
        // still printed, because a silently ignored index file is the failure this package is built
        // around.
        if (read.kind !== "absent") io.err(read.problem);
      }
    } else {
      index = read.index;
    }
  }

  // A machine-readable mode gets no prose, on either stream. Callers pipe `--offers` and `--json`
  // with `2>&1` and hand the result to `JSON.parse`; an advisory line mixed into that is not a
  // warning, it is a parse error. So the declaration is a function of the parsed args, and each
  // command says which of its modes has a human on the other end.
  const wantFresh = typeof spec.freshness === "function" ? spec.freshness(args) : Boolean(spec.freshness);

  let stale = null;
  if (wantFresh && index && read && !read.problem) {
    const note = staleNote(root, indexPath, { rootArg });
    stale = Boolean(note);
    if (note) io.err(note);
  }

  return { root, rootArg, args, paths, index, indexPath, stale };
}
