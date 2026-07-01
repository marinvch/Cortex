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
