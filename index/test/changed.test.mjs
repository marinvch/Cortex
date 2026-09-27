import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { branchChanges, changedFiles, failureLines, gitReader, normalizeChangedPath, GIT_MAX_BUFFER } from "../lib/changed.mjs";

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

// --- another session's change set (#408) ----------------------------------------------------------

test("a branch's changes are read from the merge base, so my own commits are not counted as theirs", () => {
  // `HEAD...ref` is what the other branch did since the two diverged. A two-dot or bare diff would
  // include every commit I made too, and report my own files as their overlap with me.
  const r = branchChanges("/x", "feat/other", { git: stub({ "diff --name-only HEAD...feat/other": "a.js\nb.js\n" }) });
  assert.deepEqual(r.files, ["a.js", "b.js"]);
  assert.deepEqual(r.failures, []);
});

test("a ref git cannot resolve is a named failure, not an empty change set", () => {
  // No fallback to a bare diff: without a merge base, "everything that differs" would hand my own
  // work back to me as theirs.
  const r = branchChanges("/x", "nope", { git: stub({ "diff --name-only HEAD...nope": new Error("fatal: bad revision 'HEAD...nope'") }) });
  assert.deepEqual(r.files, []);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].source, "--against-ref nope");
  assert.match(failureLines(r.failures)[0], /bad revision/);
});

test("one normaliser for every changed path: separators, ./ and absolute paths inside the root", () => {
  assert.equal(normalizeChangedPath("src\\lib\\a.js"), "src/lib/a.js");
  assert.equal(normalizeChangedPath("./src/a.js"), "src/a.js");
  assert.equal(normalizeChangedPath(".\\src\\a.js"), "src/a.js");
  const root = resolve("some-root");
  assert.equal(normalizeChangedPath(join(root, "src", "a.js"), root), "src/a.js");
  // Outside the root there is no repo-relative form; the path stays as given (slashes normalised)
  // so it lands in "not in the index" and is named there, rather than being silently rewritten.
  const outside = resolve("other-root", "a.js");
  assert.equal(normalizeChangedPath(outside, root), outside.split("\\").join("/"));
});
