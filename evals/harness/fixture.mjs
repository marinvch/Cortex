// The outcome harness's fixture: one small repo, built twice.
//
//   buildFixture(dir, { arm: "with" })      the "shop" checkout service and its context layer
//   buildFixture(dir, { arm: "without" })   the same service, and nothing else
//
// Both arms are written from the same strings. The with-arm adds the files in CONTEXT_LAYER, and
// that list is the only difference between them: evals/test/harness-fixture.test.mjs compares the
// two built trees whole. There is no second code path that removes the layer from a copy.
//
// The build is the same on every machine. Files are written as LF bytes, and the one commit has a
// pinned author, date and message, so an arm has one commit id everywhere. The arm's name is in no
// path, no file and no commit message.
//
// Design: docs/specs/2026-10-09-outcome-harness-design.md.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SOURCE } from "./fixture/source.mjs";
import { TESTS } from "./fixture/tests.mjs";
import { CODENAME, LAYER } from "./fixture/layer.mjs";

// Raise this with any change to a file of the fixture. Results from two versions are never added
// together; the record carries the version and both tree hashes.
export const FIXTURE_VERSION = 1;
export const FIXTURE_NAME = "shop";
export const ARMS = ["with", "without"];
export { CODENAME };

// The context layer, listed once. The with-arm is the base tree plus exactly these files.
export const CONTEXT_LAYER = Object.keys(LAYER);

// The shop's own test files. accept.mjs writes these back before it runs them.
export const OWN_TESTS = Object.keys(TESTS);

// The four rules the layer states. `sentence` is the rule; `where` is each document that states it;
// `phrases` are words of the rule that must appear in no base file, so the without-arm cannot read
// the rule off a comment. A rule's evidence in the code (a helper, a pattern to copy) is allowed and
// intended: a task only a reader of the layer could pass would be rigged.
export const RULES = {
  R1: {
    name: "money",
    sentence: "An amount is an integer number of minor units. Any calculation that can leave a fraction goes through src/money/money.js, which rounds half to even; never Math.round on money. The ledger export is reconciled to the cent against a payment provider that rounds the same way.",
    where: ["AGENTS.md", "CONTEXT.md", "docs/adr/0001-money-is-integer-minor-units.md"],
    phrases: ["minor units", "Math.round", "reconciled", "payment provider"],
  },
  R2: {
    name: "orders",
    sentence: "An order is never removed from the store. Every status change appends exactly one audit entry, in the service function that makes the change. Refunds and the monthly export read the audit log.",
    where: ["src/orders/AGENTS.md", "CONTEXT.md"],
    phrases: ["never removed", "exactly one audit entry", "monthly export"],
  },
  R3: {
    name: "migrations",
    sentence: "The stored shape of a table changes only through a new numbered migration. A migration that has shipped is never edited, because deployed stores have already run it. A read path does not paper over a missing field.",
    where: ["docs/adr/0002-migrations-are-append-only.md", "src/store/AGENTS.md", "AGENTS.md"],
    phrases: ["append-only", "never edited", "paper over"],
  },
  R4: {
    name: "layering",
    sentence: "A module under src/routes/ imports services only. It never imports from src/store/ or a repository.js.",
    where: ["AGENTS.md", "docs/adr/0003-routes-call-services.md"],
    phrases: ["services only", "routes call services"],
  },
};

const BASE = { ...SOURCE, ...TESTS };

// Every file of one arm: repo-relative path → text. A fresh object each call.
export function fixtureFiles(arm) {
  if (!ARMS.includes(arm)) throw new Error(`unknown arm ${JSON.stringify(arm)}: it is one of ${ARMS.join(", ")}`);
  return arm === "with" ? { ...BASE, ...LAYER } : { ...BASE };
}

// One SHA-256 over a tree: each path and its bytes, in path order.
function hashEntries(entries) {
  const hash = createHash("sha256");
  for (const [rel, bytes] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    hash.update(rel).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex");
}

// The hash of an arm as built, without building it.
export function treeHash(arm) {
  return hashEntries(Object.entries(fixtureFiles(arm)).map(([rel, text]) => [rel, Buffer.from(text, "utf8")]));
}

// The same hash, read off a directory. `.git` and `node_modules` are not part of the tree.
export function listTree(dir, rel = "") {
  const out = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    if (rel === "" && (name === ".git" || name === "node_modules")) continue;
    const next = rel ? `${rel}/${name}` : name;
    if (statSync(join(dir, next)).isDirectory()) out.push(...listTree(dir, next));
    else out.push(next);
  }
  return out;
}

export function hashDir(dir) {
  return hashEntries(listTree(dir).map((rel) => [rel, readFileSync(join(dir, rel))]));
}

// Pinned, so the commit id of an arm is the same on every machine.
const COMMIT = {
  name: "shop",
  email: "shop@example.invalid",
  date: "2026-01-05T09:00:00+00:00",
  message: "Checkout service",
};

function git(dir, args) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: COMMIT.name, GIT_AUTHOR_EMAIL: COMMIT.email, GIT_AUTHOR_DATE: COMMIT.date,
    GIT_COMMITTER_NAME: COMMIT.name, GIT_COMMITTER_EMAIL: COMMIT.email, GIT_COMMITTER_DATE: COMMIT.date,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  // The contributor's own git settings must not reach the commit: no line-ending conversion, no
  // signing, no hooks, no global ignore file deciding what is added.
  const pinned = ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "core.fileMode=false",
    "-c", "commit.gpgsign=false", "-c", "core.hooksPath=.git/no-hooks", "-c", "core.excludesFile=", "-c", "core.attributesFile="];
  const run = spawnSync("git", [...pinned, ...args], { cwd: dir, env, encoding: "utf8" });
  if (run.error) throw new Error(`git ${args[0]} could not run: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(run.stderr || run.stdout).trim()}`);
  return run.stdout;
}

// Writes one arm into `dir`, which must be empty or absent, and commits it. `git: false` skips the
// repository, for a test that only needs the files.
export function buildFixture(dir, { arm, git: withGit = true } = {}) {
  const files = fixtureFiles(arm);
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} is not empty`);
  for (const [rel, text] of Object.entries(files)) {
    const at = join(dir, ...rel.split("/"));
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, Buffer.from(text, "utf8"));
  }
  if (withGit) {
    git(dir, ["init", "--quiet", "--initial-branch=main"]);
    git(dir, ["add", "--all"]);
    git(dir, ["commit", "--quiet", "--no-verify", "-m", COMMIT.message]);
  }
  return { dir, arm, files: Object.keys(files).sort(), treeHash: treeHash(arm) };
}

// What a session changed, as one patch: tracked edits, new files and deletions. Read by the runner
// after a session, for the record.
export function sessionDiff(dir) {
  git(dir, ["add", "--all"]);
  return git(dir, ["diff", "--cached", "--no-color", "HEAD"]);
}
