#!/usr/bin/env node
// cortex-release-plan.mjs — what one push to master releases, if anything.
//
//   node tools/cortex-release-plan.mjs --before <sha> [--sha <sha>] [--repo <dir>]
//                                      [--remote <name>] [--notes-out <file>]
//   node tools/cortex-release-plan.mjs --highest < tag-names
//
// .github/workflows/release.yml cuts a release when a merge changes VERSION (ADR 0022). A workflow
// cannot be run before it is pushed, so everything it decides is here, where a test can run it on
// a scratch repo. This creates no tag and no release: it prints the plan and the workflow acts.
//
// stdout is `key=value` lines, the form $GITHUB_OUTPUT takes:
//
//   action=none      VERSION is the same before and after the push. Nothing else is checked.
//   action=exists    the tag v<version> is already on the remote. `points` is the commit it is on.
//   action=release   create v<version> on `target`. `latest` says whether it takes Latest, and
//                    --notes-out holds the notes. The file is written in this case only.
//
// Exit 0 with a plan. Exit 1, with one reason on stderr and NOTHING on stdout, when the push must
// not be released: no usable commit before it, VERSION lowered or not x.y.z, a version site that
// disagrees, a changelog section that cannot be bounded, a remote that cannot be listed. Exit 2 on
// a usage error.
//
// The order is fixed: VERSION changed, the sites agree, the notes extract, and only then is the
// remote asked for the tag. A tree that cannot be released fails before anything could be created.
//
// `untagged` lists every other version with a changelog section and no tag on the remote. A push
// that carried several stamped merges releases only its tip, and this names the rest.
//
// --highest reads tag names on stdin and prints the highest v<x.y.z> among them. The workflow uses
// it after creating a release, to put Latest back on a higher one that appeared meanwhile.
//
// Maintainer-only. Users never run this.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = /^\d+\.\d+\.\d+$/;
const TAG = /^v(\d+\.\d+\.\d+)$/;
const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const HEADING = /^## \[(\d+\.\d+\.\d+)\]/;

const usage = (why) => {
  process.stderr.write(
    `${why}\nusage: node tools/cortex-release-plan.mjs --before <sha> [--sha <sha>] [--repo <dir>] [--remote <name>] [--notes-out <file>]\n` +
      "       node tools/cortex-release-plan.mjs --highest < tag-names\n",
  );
  process.exit(2);
};
const refuse = (why) => {
  process.stderr.write(`${why.trimEnd()}\n`);
  process.exit(1);
};

/** Negative when a is the lower version, positive when it is the higher, 0 when equal. */
const compare = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

// --- arguments --------------------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes("--highest")) {
  if (args.length !== 1) usage("--highest takes no other argument");
  const names = readFileSync(0, "utf8").split(/\r?\n/).map((l) => l.trim());
  const versions = names.filter((n) => TAG.test(n)).sort((a, b) => compare(b.slice(1), a.slice(1)));
  if (!versions.length) refuse(`no v<x.y.z> among the ${names.filter(Boolean).length} name(s) on stdin`);
  process.stdout.write(`${versions[0]}\n`);
  process.exit(0);
}

const FLAGS = ["--before", "--sha", "--repo", "--remote", "--notes-out"];
const opt = {};
for (let i = 0; i < args.length; i += 2) {
  if (!FLAGS.includes(args[i])) usage(`unknown argument: ${args[i]}`);
  if (i + 1 >= args.length) usage(`${args[i]} needs a value`);
  opt[args[i]] = args[i + 1];
}
if (!("--before" in opt)) usage("--before is required: the commit the branch was at before the push");

const repo = resolve(opt["--repo"] ?? ".");
const remote = opt["--remote"] ?? "origin";

/** Run git in the repo. Returns trimmed stdout, or null when git exits non-zero. */
const git = (...a) => {
  try {
    return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
};

const head = git("rev-parse", "--verify", "HEAD^{commit}");
if (!head) usage(`${repo} is not a git repository with a commit checked out`);

// The sites and the changelog are read from the files on disk, so the commit asked about has to be
// the one checked out.
if ("--sha" in opt && opt["--sha"] !== head) {
  refuse(`the checkout is at ${head}, not at --sha ${opt["--sha"]}: nothing is released`);
}

// --- 1. did this push change VERSION ----------------------------------------------------------------

const before = opt["--before"];
if (!before || /^0+$/.test(before)) {
  refuse("there is no commit before this push (a new branch, or its first push): nothing is released");
}
if (!COMMIT.test(before)) refuse(`--before "${before}" is not a commit id: nothing is released`);
if (git("cat-file", "-e", `${before}^{commit}`) === null) {
  refuse(`the commit before this push, ${before}, is not in this checkout (fetch-depth: 0 is needed): nothing is released`);
}
if (git("merge-base", "--is-ancestor", before, head) === null) {
  refuse(`the commit before this push, ${before}, is not an ancestor of ${head}: the branch was rewritten, and nothing is released`);
}

const versionAt = (commit) => git("show", `${commit}:VERSION`);
const was = versionAt(before);
const now = versionAt(head);

if (was !== null && was === now) {
  process.stdout.write(`action=none\nreason=VERSION unchanged (${now})\n`);
  process.exit(0);
}
if (now === null) refuse(`VERSION is missing at ${head}: nothing is released`);
if (!VERSION.test(now)) refuse(`VERSION at ${head} holds "${now}", which is not a version (x.y.z): nothing is released`);
if (was === null || !VERSION.test(was)) {
  refuse(`VERSION before this push (${before}) is ${was === null ? "missing" : `"${was}"`}, so ${now} cannot be shown to be higher: nothing is released`);
}
if (compare(now, was) <= 0) refuse(`VERSION went from ${was} to ${now}, which is not higher: nothing is released`);

// --- 2. every version site agrees -------------------------------------------------------------------

const node = (script, scriptArgs, env = {}) =>
  spawnSync(process.execPath, [join(HERE, script), ...scriptArgs], { encoding: "utf8", env: { ...process.env, ...env } });

const sites = node("cortex-version.mjs", [], { CORTEX_VERSION_ROOT: repo });
if (sites.status !== 0) refuse(`${now} is not stamped at every site, so it is not released:\n${sites.stderr || sites.error?.message || ""}`);

// --- 3. the notes extract ---------------------------------------------------------------------------

const changelog = join(repo, "CHANGELOG.md");
const notes = node("cortex-release-notes.mjs", [now, "--changelog", changelog]);
if (notes.status !== 0 || !notes.stdout.trim()) {
  refuse(`${now} has no release notes, so it is not released:\n${notes.stderr || notes.error?.message || ""}`);
}

// --- 4. is the tag already on the remote ------------------------------------------------------------

const listing = git("ls-remote", "--tags", remote);
if (listing === null) refuse(`the tags on "${remote}" could not be listed, so whether v${now} exists is unknown: nothing is released`);

// An annotated tag is listed twice: the tag object, then `<name>^{}` with the commit it points at.
const tags = new Map();
for (const line of listing.split("\n")) {
  const m = /^([0-9a-f]+)\s+refs\/tags\/(.+?)(\^\{\})?$/.exec(line.trim());
  if (!m) continue;
  if (m[3] || !tags.has(m[2])) tags.set(m[2], m[1]);
}
const tagged = [...tags.keys()].flatMap((name) => TAG.exec(name)?.[1] ?? []);

const sections = readFileSync(changelog, "utf8").split(/\r?\n/).flatMap((l) => HEADING.exec(l)?.[1] ?? []);
const untagged = [...new Set(sections)]
  .filter((v) => v !== now && !tagged.includes(v))
  .sort(compare)
  .join(" ");

const tag = `v${now}`;
if (tags.has(tag)) {
  process.stdout.write(
    `action=exists\nversion=${now}\ntag=${tag}\npoints=${tags.get(tag)}\nuntagged=${untagged}\n` +
      `reason=${tag} is already on ${remote}, at ${tags.get(tag)}\n`,
  );
  process.exit(0);
}

// --- 5. the release ---------------------------------------------------------------------------------

const latest = tagged.every((v) => compare(v, now) < 0);
if ("--notes-out" in opt) writeFileSync(opt["--notes-out"], notes.stdout);
process.stdout.write(
  `action=release\nversion=${now}\nprevious=${was}\ntag=${tag}\ntarget=${head}\nlatest=${latest}\nuntagged=${untagged}\n` +
    `reason=VERSION went from ${was} to ${now}\n`,
);
