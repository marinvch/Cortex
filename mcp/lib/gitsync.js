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
