import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { slugify } from "./slug.js";

export function teamCloneDir(root, team) { return join(root, "team", slugify(team)); }

function isGitRepo(dir) { return existsSync(join(dir, ".git")); }

function git(cwd, args) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

export function pull(cloneDir) {
  if (!isGitRepo(cloneDir)) return { ok: false, error: "not_a_git_repo" };
  try { git(cloneDir, ["pull", "--ff-only", "-q"]); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.stderr || e.message) }; }
}

export function commitAndPush(cloneDir, files, message) {
  if (!isGitRepo(cloneDir)) return { ok: false, pushed: false, error: "not_a_git_repo" };
  try {
    git(cloneDir, ["add", ...files]);
    git(cloneDir, ["commit", "-q", "-m", message]);
  } catch (e) { return { ok: false, pushed: false, error: String(e.stderr || e.message) }; }
  try { git(cloneDir, ["push", "-q"]); return { ok: true, pushed: true }; }
  catch (e) { return { ok: true, pushed: false, error: "push_failed: " + String(e.stderr || e.message) }; }
}

/**
 * A clone on a machine with no git identity cannot commit, and a team-brain clone is committed to
 * by Cortex, not by a person. Set a local one only when none resolves; never touch a real one.
 */
export function ensureIdentity(dir) {
  try { git(dir, ["config", "user.email"]); }
  catch { git(dir, ["config", "user.email", "cortex@local"]); git(dir, ["config", "user.name", "cortex"]); }
}

/**
 * Commit ONE path in a clone, as an addition or as a removal, and nothing else that happens to be
 * staged or lying in the tree. Separate from `commitAndPush` because a project file is committed
 * on every profile and pushed only on some: a `lab` install keeps the commit and declines the push
 * (core/profile.js), and one function that always does both cannot say that.
 *
 * `remove` runs `git rm` on a file the Vault has already deleted. `committed: false` with `ok: true`
 * means git had nothing to record — the file was identical, or was never tracked.
 */
export function commitPath(cloneDir, file, message, { remove = false } = {}) {
  if (!isGitRepo(cloneDir)) return { ok: false, committed: false, error: "not_a_git_repo" };
  try {
    ensureIdentity(cloneDir);
    git(cloneDir, remove ? ["rm", "-q", "--ignore-unmatch", "--", file] : ["add", "--", file]);
    if (!git(cloneDir, ["status", "--porcelain", "--", file]).trim()) return { ok: true, committed: false };
    git(cloneDir, ["commit", "-q", "-m", message, "--", file]);
    return { ok: true, committed: true };
  } catch (e) { return { ok: false, committed: false, error: String(e.stderr || e.message).trim() }; }
}

/** Push the current branch to `origin`. Named explicitly, so a clone of an empty remote works too. */
export function pushHead(cloneDir) {
  try { git(cloneDir, ["push", "-q", "origin", "HEAD"]); return { ok: true }; }
  catch (e) { return { ok: false, error: "push_failed: " + String(e.stderr || e.message).trim() }; }
}

/** The URL `origin` points at in `dir`, or null when there is no repo or no such remote. */
export function originUrl(dir) {
  if (!isGitRepo(dir)) return null;
  try {
    return git(dir, ["remote", "get-url", "origin"]).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The top of the git work tree `cwd` sits in, or null when it sits in none (or git is absent).
 * Asked of git rather than found by walking up for `.git`: a worktree or a submodule has a `.git`
 * FILE, and git already knows every shape that directory can take.
 */
export function repoTop(cwd) {
  try {
    const top = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
    return top || null;
  } catch {
    return null;
  }
}

/**
 * `- <hash> <date> <subject>` for each commit in `dir` since `since`, newest first, at most `max`.
 * `truncated` says the cap was hit, so a caller never mistakes the first page for the whole story.
 * A repo with no commits yet is an empty list rather than an error.
 */
export function logSince(dir, since, { max = 200 } = {}) {
  let lines;
  try {
    lines = git(dir, ["log", `--since=${since}`, `--max-count=${max + 1}`, "--date=short", "--pretty=- %h %ad %s"])
      .split("\n").filter(Boolean);
  } catch {
    return { commits: [], truncated: false };
  }
  return { commits: lines.slice(0, max), truncated: lines.length > max };
}

/**
 * Commit SEVERAL paths in a clone as one commit, and nothing else staged or lying in the tree. A
 * contract is two files (`contract.json` and `contract.md`) that change together, so one commit
 * carries both. `committed: false` with `ok: true` means git had nothing to record.
 */
export function commitPaths(cloneDir, files, message) {
  if (!isGitRepo(cloneDir)) return { ok: false, committed: false, error: "not_a_git_repo" };
  try {
    ensureIdentity(cloneDir);
    git(cloneDir, ["add", "--", ...files]);
    if (!git(cloneDir, ["status", "--porcelain", "--", ...files]).trim()) return { ok: true, committed: false };
    git(cloneDir, ["commit", "-q", "-m", message, "--", ...files]);
    return { ok: true, committed: true };
  } catch (e) { return { ok: false, committed: false, error: String(e.stderr || e.message).trim() }; }
}

/**
 * `YYYY-MM-DD` → the start of that day, which is what a person means by "since". git reads a bare
 * date as that date at the CURRENT time of day, so a commit made this morning is not "since today".
 * Anything else is handed to git as it was given.
 */
export function sinceArg(since) {
  const s = String(since);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s} 00:00:00` : s;
}

/**
 * The last commit touching `path` before `since`, or null when the path did not exist then (or
 * there is no repo). The other end of a drift report is `HEAD`.
 */
export function revBefore(cloneDir, path, since) {
  if (!isGitRepo(cloneDir)) return null;
  try {
    return git(cloneDir, ["rev-list", "-1", `--before=${sinceArg(since)}`, "HEAD", "--", path]).trim() || null;
  } catch {
    return null;
  }
}

/** Did any commit since `since` touch `path`? */
export function touchedSince(cloneDir, path, since) {
  if (!isGitRepo(cloneDir)) return false;
  try {
    return git(cloneDir, ["log", "-1", "--format=%H", `--since=${sinceArg(since)}`, "HEAD", "--", path]).trim() !== "";
  } catch {
    return false;
  }
}

/** The text of `path` at `rev`, or null when it is not there. Argument array, never a shell string. */
export function showAt(cloneDir, rev, path) {
  if (!isGitRepo(cloneDir) || !rev) return null;
  try {
    return git(cloneDir, ["show", `${rev}:${path}`]);
  } catch {
    return null;
  }
}
