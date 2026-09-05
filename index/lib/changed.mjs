// What changed, and whether we could tell.
//
// `cortex-impact.mjs` and `cortex-review.mjs` each carried their own copy of this: staged first,
// falling back to the worktree when nothing is staged; `<ref>...HEAD` falling back to a bare ref;
// dedupe. Twenty lines, line for line the same — except that one of them had `maxBuffer` and the
// other did not, so a fix landed in one copy and not the other.
//
// That divergence is a live bug rather than an untidiness. `execFileSync` throws when git's output
// exceeds the 1 MB default, both copies turn a throw into `null`, and `null` becomes an empty change
// set — so a wide `--since` on a long-lived repo made `/cortex-impact` print "nothing to analyse",
// in the one command whose stated contract is that a confident total tells someone to stop looking.
//
// So the module owns three things, and the third is the point:
//
//   1. the git invocation, with one buffer size;
//   2. the fallback chains, in one place;
//   3. the difference between "git returned nothing" and "git could not answer".
//
// Those two are different facts and no caller could previously tell them apart. They are separate
// fields in the return, not a repaired internal, because the honest report is different in each
// case: an empty diff means the working tree is clean, and a failure means the change set is
// unknown — and a floor computed from an unknown change set is not a floor.

import { execFileSync } from "node:child_process";

/**
 * 64 MB. `git log -M --name-status` over the whole history of a long-lived repo runs to tens of
 * megabytes, and the 1 MB default turns that into a throw — which used to read as "git recorded no
 * renames". Big enough that the remaining failures are real git errors rather than plumbing.
 */
export const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * A git runner bound to a root: `argv → { out }` or `{ error }`.
 *
 * Never throws, and never returns a bare null — the caller has to look at which field it got, so
 * "no output" cannot be written in the same shape as "no answer". stderr is captured rather than
 * discarded so the error can say *why*; `fatal: bad revision 'HEAD~99'` is a sentence the user can
 * act on, and the previous `stdio: [..., "ignore"]` threw it away.
 */
export function gitReader(root) {
  return (argv) => {
    try {
      return {
        out: execFileSync("git", argv, {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: GIT_MAX_BUFFER,
        }),
      };
    } catch (e) {
      const stderr = String(e.stderr ?? "").trim();
      return { error: (stderr || String(e.message ?? "git failed")).split("\n")[0] };
    }
  };
}

/**
 * The set of paths a caller asked about.
 *
 * `{ paths, staged, since }` are additive: explicit paths, plus the staged/worktree diff, plus the
 * diff since a ref. Returns `{ files, failures }` where `failures` names the SOURCE that could not
 * be resolved, not every attempt — a first probe that the fallback recovers from is not a failure,
 * and reporting it would cry wolf on every ordinary run.
 *
 * `git` is injectable so this stays testable without building a repository for every branch. The
 * real behaviour still earns a test against a real git fixture; a stub agrees with whatever the
 * person who wrote it believed.
 */
export function changedFiles(root, { paths = [], staged = false, since = null, git = null } = {}) {
  const run = git ?? gitReader(root);
  const files = [...paths];
  const failures = [];
  const push = (out) => files.push(...out.split("\n").filter(Boolean));

  if (staged) {
    // Staged first, falling back to the worktree when nothing is staged: someone mid-edit asking
    // "what does this touch" means their working tree, and an empty answer would read as
    // "nothing depends on this".
    const cached = run(["diff", "--cached", "--name-only"]);
    if (!cached.error && cached.out.trim()) {
      push(cached.out);
    } else {
      const worktree = run(["diff", "--name-only"]);
      if (worktree.error) failures.push({ source: "--staged", error: cached.error ?? worktree.error });
      else push(worktree.out);
    }
  }

  if (since) {
    // `a...b` is the merge-base diff and is what a reviewer means by "since"; a bare ref is the
    // fallback for the cases where three dots has no merge base to work from.
    const merge = run(["diff", "--name-only", `${since}...HEAD`]);
    if (!merge.error) {
      push(merge.out);
    } else {
      const direct = run(["diff", "--name-only", since]);
      if (direct.error) failures.push({ source: `--since ${since}`, error: direct.error });
      else push(direct.out);
    }
  }

  return { files: [...new Set(files)], failures };
}

/**
 * The one line a CLI prints when a source could not be resolved.
 *
 * Shared because the sentence is the fix. An empty list after a failure must not be reported with
 * the same words as an empty list after a clean tree, and two commands describing one fault two
 * ways is how a user learns to distrust both.
 */
export function failureLines(failures) {
  return failures.map((f) => `git could not resolve ${f.source}: ${f.error}`);
}
