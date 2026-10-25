#!/usr/bin/env node
// cortex-stories.mjs — this repo's story links: ticket keys in its history, and the code each touched.
//
//   node index/cortex-stories.mjs [root]                                  # the links on stdout
//   node index/cortex-stories.mjs [root] --out .cortex/index/stories.json
//   node index/cortex-stories.mjs [root] --keys ABC,DEF                   # only these Jira-style projects
//   node index/cortex-stories.mjs [root] --max-commits 2000 --since 2026-01-01
//   node index/cortex-stories.mjs [root] --project <slug> --repo <owner/name>
//
// Publishing is `node mcp/ai-os.js stories publish --file <it>`, never this command: the index
// reads, and mcp/ owns the team-brain, as it does for the contract. The rules are in
// lib/stories.mjs's header and core/story-key.js's.
//
// It refuses a missing or stale index (exit 2): a file's cluster and its tests come from the index,
// and an index older than the code would attach this week's commits to last month's map. It
// refuses outside a git repository for the same reason the history is the input.
//
// `--repo` names the GitHub repo a bare `#45` belongs to; without it, `origin` is read, and only its
// owner and name are kept. `--keys` narrows the Jira shape to the team's real project keys, which
// is the precise answer; without it, a fixed list of non-ticket prefixes (UTF-8, ISO-8601) is left
// out and everything else of that shape is a key.
//
// Deterministic: the same history and index give the same bytes. Nothing is written except `--out`,
// and under `.cortex/` only to a generated directory.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { keysInBranch, keysInMessage, mergedBranch, repoFromRemote } from "../core/story-key.js";
import { rebuildHint } from "../core/index-file.js";
import { codeCoverage } from "./lib/findings.mjs";
import { ensureGeneratedFileDir } from "./lib/generated.mjs";
import { graphReport } from "./lib/graph-report.mjs";
import { defaultIndexPath, generatedNotice, indexFreshness, openTarget } from "./lib/open.mjs";
import { textSource } from "./lib/repo-text.mjs";
import { buildStoryLinks, LOG_FORMAT, parseLog, renderStoryLinksJson } from "./lib/stories.mjs";
import { GIT_MAX_BUFFER } from "./lib/changed.mjs";

const usage =
  "usage: node index/cortex-stories.mjs [root] [--out FILE] [--project SLUG] [--repo OWNER/NAME] [--keys ABC,DEF]\n" +
  "                                     [--max-commits N] [--since YYYY-MM-DD] [--index FILE]";
const { root, rootArg, args, index, indexPath } = openTarget(process.argv.slice(2), {
  usage,
  flags: {
    "--out": "value", "--project": "value", "--repo": "value", "--keys": "list",
    "--max-commits": "value", "--since": "value", "--index": "value",
  },
  root: "positional",
  index: "require",
});

const fail = (msg, code) => {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
};

const maxCommits = args.maxCommits === null || args.maxCommits === undefined ? 2000 : Number(args.maxCommits);
if (!Number.isInteger(maxCommits) || maxCommits < 1 || maxCommits > 100_000) fail(`--max-commits is a whole number from 1 to 100000\n${usage}`, 1);
if (args.since && !/^\d{4}-\d{2}-\d{2}$/.test(args.since)) fail(`--since is a date, YYYY-MM-DD\n${usage}`, 1);
if (args.repo && !repoFromRemote(`x:${args.repo}`)) fail(`--repo is owner/name\n${usage}`, 1);
const prefixes = args.keys?.length ? new Set(args.keys.map((k) => k.toUpperCase())) : null;
for (const p of prefixes ?? []) if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(p)) fail(`--keys takes project keys such as ABC, comma-separated\n${usage}`, 1);

function git(argv, input) {
  try {
    return execFileSync("git", argv, {
      cwd: root, encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER,
      ...(input === undefined ? {} : { input }),
    });
  } catch {
    return null;
  }
}

if (git(["rev-parse", "--is-inside-work-tree"])?.trim() !== "true") {
  fail(`${root} is not inside a git repository. Story links are read from its history.`, 2);
}
const head = git(["rev-parse", "HEAD"])?.trim();
if (!head) fail(`${root} has no commits yet, so there is no history to read story links from.`, 2);

// The freshness refusal: the clusters and tests every link carries come from the index.
const fresh = indexFreshness(root, indexPath);
if (fresh.stale) {
  const n = fresh.changedSince.length;
  fail(
    `The index is ${fresh.ageDays}d old and ${n}${n >= 5 ? "+" : ""} tracked file${n === 1 ? " is" : "s are"} newer, so its clusters ` +
      `describe code that has moved. Rebuild it, then run this again:\n  ${rebuildHint(rootArg)}`,
    2,
  );
}

const repo = args.repo ?? repoFromRemote(git(["remote", "get-url", "origin"]) ?? "");
const keyOpts = { repo, prefixes };
const unread = [];

// The window: the last `maxCommits` commits reachable from HEAD.
const logArgs = ["log", `-n${maxCommits}`, `--format=${LOG_FORMAT}`, "--name-only", "--no-renames"];
if (args.since) logArgs.push(`--since=${args.since}T00:00:00`);
const log = parseLog(git([...logArgs, "HEAD"]) ?? "");
if (log.length >= maxCommits) unread.push({ what: "history", why: `only the last ${maxCommits} commits were read; --max-commits reads more` });
if (git(["rev-parse", "--is-shallow-repository"])?.trim() === "true") {
  unread.push({ what: "history", why: "this clone is shallow, so older commits are not in it" });
}

const commits = new Map();
const add = (c) => {
  const { keys, prs } = keysInMessage(c.message, keyOpts);
  commits.set(c.sha, { sha: c.sha, keys, prs, files: c.files, parents: c.parents, subject: c.message.split("\n")[0] });
};
for (const c of log) add(c);

const revList = (range) => (git(["rev-list", "--max-count=500", range]) ?? "").split("\n").map((s) => s.trim()).filter(Boolean);

// Branch evidence, from merge subjects in the window and from branch refs that still exist.
const branches = [];
for (const c of [...commits.values()]) {
  if (c.parents.length < 2) continue;
  const name = mergedBranch(c.subject);
  if (!name) continue;
  const keys = keysInBranch(name, keyOpts);
  if (!keys.length) continue;
  branches.push({ branch: name, keys, shas: revList(`${c.parents[0]}..${c.parents[1]}`) });
}

function defaultBranch() {
  const sym = git(["symbolic-ref", "-q", "refs/remotes/origin/HEAD"])?.trim();
  if (sym) return sym;
  for (const r of ["refs/heads/main", "refs/heads/master", "refs/remotes/origin/main", "refs/remotes/origin/master"]) {
    if (git(["rev-parse", "--verify", "-q", r])) return r;
  }
  return null;
}
const base = defaultBranch();
if (!base) unread.push({ what: "branches", why: "no default branch (origin/HEAD, main or master), so unmerged branches were not read" });
else {
  const refs = (git(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]) ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  for (const ref of refs) {
    if (ref === base || ref.endsWith("/HEAD")) continue;
    const name = ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/[^/]+\//, "");
    const keys = keysInBranch(name, keyOpts);
    if (!keys.length) continue;
    branches.push({ branch: name, keys, shas: revList(`${base}..${ref}`) });
  }
}

// A merge commit lists no files in `git log`. When its own message names a key, what it changed is
// what it brought in over its first parent.
for (const c of commits.values()) {
  if (c.parents.length < 2 || !c.keys.length) continue;
  c.files = (git(["diff", "--name-only", "--no-renames", c.parents[0], c.sha]) ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
}

// Commits a branch holds that the window did not read: read them too, so their files are known.
const missing = [...new Set(branches.flatMap((b) => b.shas))].filter((s) => !commits.has(s));
if (missing.length) {
  for (const c of parseLog(git(["log", "--no-walk=unsorted", `--format=${LOG_FORMAT}`, "--name-only", "--no-renames", "--stdin"], `${missing.join("\n")}\n`) ?? "")) add(c);
}

const coverage = codeCoverage(index, textSource(root, { index }));
const report = graphReport(index);
const hubs = new Set(report.hubs.flatMap((h) => [h.path, ...(h.twins ?? [])]));

function connectorProject() {
  const p = join(root, ".cortex", "connector.json");
  if (!existsSync(p)) return null;
  try {
    const v = JSON.parse(readFileSync(p, "utf8"))?.project;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

const links = buildStoryLinks({
  commits,
  branches,
  index,
  untested: new Set(coverage.untested),
  testable: new Set(coverage.testable),
  hubs,
  project: args.project ?? connectorProject(),
  repo,
  head,
  asOf: git(["log", "-1", "--format=%cs", "HEAD"])?.trim() || null,
  window: {
    maxCommits,
    since: args.since ?? null,
    commitsRead: log.length,
    branchesRead: branches.length,
    keys: prefixes ? [...prefixes].sort() : null,
  },
  unread,
});
const json = renderStoryLinksJson(links);

if (!args.out) {
  process.stdout.write(json);
  process.exit(0);
}
const out = isAbsolute(args.out) ? args.out : resolve(args.out);
const gen = ensureGeneratedFileDir(root, out);
writeFileSync(out, json);
process.stderr.write(generatedNotice(gen));
const inferred = links.stories.filter((s) => s.confidence === "inferred").length;
process.stdout.write(
  `Wrote ${out} — ${links.stories.length} stor${links.stories.length === 1 ? "y" : "ies"} ` +
    `(${links.stories.length - inferred} named in a commit message, ${inferred} only in a branch name), ` +
    `from ${log.length} commits and ${branches.length} branch${branches.length === 1 ? "" : "es"}. A floor.\n`,
);
