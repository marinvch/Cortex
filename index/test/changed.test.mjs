import { test } from "node:test";
import assert from "node:assert/strict";
import { changedFiles, failureLines, gitReader, GIT_MAX_BUFFER } from "../lib/changed.mjs";

// cortex-impact.mjs and cortex-review.mjs each carried this, line for line, differing in one thing:
// review passed maxBuffer and impact did not. So a wide --since on a long-lived repo overflowed the
// 1 MB default, threw, became null, became an empty change set, and /cortex-impact printed
// "nothing to analyse" — a confident zero in the command whose contract is that a confident total
// tells someone to stop looking.

/** A git stub: map from joined argv → output string, or an Error to throw. */
const stub = (table) => (argv) => {
  const key = argv.join(" ");
  const v = table[key];
  if (v === undefined) return { error: `no stub for: ${key}` };
  return v instanceof Error ? { error: v.message } : { out: v };
};

test("explicit paths need no git at all", () => {
  const r = changedFiles("/x", { paths: ["a.js", "b.js"], git: () => ({ error: "should not be called" }) });
  assert.deepEqual(r.files, ["a.js", "b.js"]);
  assert.deepEqual(r.failures, []);
});

test("--staged reads the index, and falls back to the worktree when nothing is staged", () => {
  const staged = changedFiles("/x", { staged: true, git: stub({ "diff --cached --name-only": "a.js\n" }) });
  assert.deepEqual(staged.files, ["a.js"]);

  // Someone mid-edit asking "what does this touch" means their working tree. An empty answer here
  // would read as "nothing depends on this", which is the dangerous direction.
  const worktree = changedFiles("/x", {
    staged: true,
    git: stub({ "diff --cached --name-only": "", "diff --name-only": "b.js\n" }),
  });
  assert.deepEqual(worktree.files, ["b.js"]);
});

test("--since tries the merge-base diff, then the bare ref", () => {
  const three = changedFiles("/x", { since: "HEAD~3", git: stub({ "diff --name-only HEAD~3...HEAD": "a.js\n" }) });
  assert.deepEqual(three.files, ["a.js"]);

  const two = changedFiles("/x", {
    since: "HEAD~3",
    git: stub({ "diff --name-only HEAD~3...HEAD": new Error("no merge base"), "diff --name-only HEAD~3": "b.js\n" }),
  });
  assert.deepEqual(two.files, ["b.js"]);
  assert.deepEqual(two.failures, [], "a probe the fallback recovers from is not a failure worth reporting");
});

test("an empty diff and a failed diff are different facts", () => {
  // The whole reason this module exists. Both produce zero files; only one means the tree is clean.
  const clean = changedFiles("/x", { since: "HEAD~1", git: stub({ "diff --name-only HEAD~1...HEAD": "" }) });
  assert.deepEqual(clean.files, []);
  assert.deepEqual(clean.failures, [], "an empty diff is an answer");

  const broken = changedFiles("/x", {
    since: "HEAD~99999",
    git: stub({
      "diff --name-only HEAD~99999...HEAD": new Error("fatal: bad revision"),
      "diff --name-only HEAD~99999": new Error("fatal: bad revision"),
    }),
  });
  assert.deepEqual(broken.files, [], "the file list is empty either way");
  assert.equal(broken.failures.length, 1, "but the caller can tell which case it is in");
  assert.equal(broken.failures[0].source, "--since HEAD~99999", "and which source could not be resolved");
  assert.match(broken.failures[0].error, /bad revision/, "with git's own reason, not a generic one");
});

test("a failure on one source does not discard what another source found", () => {
  // Reporting the fault must not also throw away the paths that were read. The radius is smaller
  // than the truth, which is exactly what the caller is told.
  const r = changedFiles("/x", {
    paths: ["kept.js"],
    since: "bad",
    git: stub({ "diff --name-only bad...HEAD": new Error("fatal: bad revision"), "diff --name-only bad": new Error("fatal: bad revision") }),
  });
  assert.deepEqual(r.files, ["kept.js"]);
  assert.equal(r.failures.length, 1);
});

test("--staged reports a failure only when both the index and the worktree fail", () => {
  const r = changedFiles("/x", {
    staged: true,
    git: stub({ "diff --cached --name-only": new Error("not a git repository"), "diff --name-only": new Error("not a git repository") }),
  });
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].source, "--staged");
});

test("paths are deduped across sources", () => {
  const r = changedFiles("/x", {
    paths: ["a.js"],
    since: "HEAD~1",
    git: stub({ "diff --name-only HEAD~1...HEAD": "a.js\nb.js\n" }),
  });
  assert.deepEqual(r.files, ["a.js", "b.js"]);
});

test("the failure sentence is shared, so two commands cannot describe one fault two ways", () => {
  const lines = failureLines([{ source: "--since X", error: "fatal: bad revision" }]);
  assert.deepEqual(lines, ["git could not resolve --since X: fatal: bad revision"]);
});

test("the buffer is big enough that overflow is not the failure mode any more", () => {
  // Named rather than inline: `git log -M --name-status` over a long history runs to tens of
  // megabytes, and the 1 MB default is what turned that into "git recorded no renames".
  assert.equal(GIT_MAX_BUFFER, 64 * 1024 * 1024);
});

test("the real runner never throws, and says why when git refuses", () => {
  // Driven against this repository, which is a real git repo with real history.
  const run = gitReader(process.cwd());
  const ok = run(["rev-parse", "--is-inside-work-tree"]);
  assert.equal(ok.error, undefined);
  assert.match(ok.out, /true/);

  const bad = run(["rev-parse", "definitely-not-a-ref-xyz"]);
  assert.equal(bad.out, undefined, "a failure must not arrive in the same field as an answer");
  assert.ok(bad.error, "and it must carry git's own message");
});
