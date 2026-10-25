import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { slugify } from "./slug.js";
import { assertDestination, DestinationRefusedError, DESTINATION_MODES } from "../../core/destinations.js";

export function teamCloneDir(root, team) { return join(root, "team", slugify(team)); }

function isGitRepo(dir) { return existsSync(join(dir, ".git")); }

function git(cwd, args) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

// --- the destination check ------------------------------------------------------------------------
//
// Every function here that reaches a remote — `pull`, the push in `commitAndPush`, `pushHead` —
// asks `assertDestination` (core/destinations.js, docs/adr/0030) first, and takes the profile's
// policy as a REQUIRED option, so a caller that forgets it fails in its tests rather than pushing
// unchecked. A refusal is returned in the shape the function already returns for a git failure,
// `error: "unapproved_destination: …"`, and git is never run.
//
// The URLs checked are every remote's, as git itself resolves them (`remote get-url --all`, with
// `--push` for a push), not `origin`'s fetch URL alone: a `pushurl`, an `insteadOf` rewrite or an
// upstream on another remote is where a push actually goes, and the check must look there.

/** The `{ policy, env }` option, checked. A missing policy is a programming error, never "any". */
function gateOf(fn, opts) {
  if (!opts || !opts.policy || !DESTINATION_MODES.includes(opts.policy.destinations)) {
    throw new TypeError(`${fn}: { policy } is required — pass brain.policy`);
  }
  return { policy: opts.policy, env: opts.env ?? process.env };
}

/** Every URL git would use for this clone's remotes, push or fetch. */
export function remoteUrls(dir, { push = false } = {}) {
  let names;
  try { names = git(dir, ["remote"]).split("\n").map((s) => s.trim()).filter(Boolean); } catch { return []; }
  const urls = [];
  for (const name of names) {
    try {
      for (const u of git(dir, ["remote", "get-url", "--all", ...(push ? ["--push"] : []), name]).split("\n")) if (u.trim()) urls.push(u.trim());
    } catch { /* a remote with no URL is not a destination */ }
  }
  return urls;
}

/** null when every remote may be reached; otherwise the `unapproved_destination: …` error string. */
export function destinationRefusal(dir, { policy, env }, { push }) {
  // Nothing to ask on a profile that allows any destination, so git is not asked for the URLs.
  if (policy.destinations === "any") return null;
  for (const url of remoteUrls(dir, { push })) {
    try {
      assertDestination(url, { kind: "git", policy, env, inbound: !push });
    } catch (e) {
      if (e instanceof DestinationRefusedError) return `unapproved_destination: ${e.message}`;
      throw e;
    }
  }
  return null;
}

/** Fast-forward pull. `opts.policy` is required: a pull reaches the remote, so it is checked. */
export function pull(cloneDir, opts) {
  const gate = gateOf("pull", opts);
  if (!isGitRepo(cloneDir)) return { ok: false, error: "not_a_git_repo" };
  const refused = destinationRefusal(cloneDir, gate, { push: false });
  if (refused) return { ok: false, error: refused };
  try { git(cloneDir, ["pull", "--ff-only", "-q"]); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.stderr || e.message) }; }
}

/**
 * Commit, then push. The commit is local and always made; the push is checked first, so a refused
 * destination leaves the commit in the clone and returns `ok: true, pushed: false` with the reason.
 */
export function commitAndPush(cloneDir, files, message, opts) {
  const gate = gateOf("commitAndPush", opts);
  if (!isGitRepo(cloneDir)) return { ok: false, pushed: false, error: "not_a_git_repo" };
  try {
    git(cloneDir, ["add", ...files]);
    git(cloneDir, ["commit", "-q", "-m", message]);
  } catch (e) { return { ok: false, pushed: false, error: String(e.stderr || e.message) }; }
  const refused = destinationRefusal(cloneDir, gate, { push: true });
  if (refused) return { ok: true, pushed: false, error: refused };
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

/**
 * Push the current branch to `origin`. Named explicitly, so a clone of an empty remote works too.
 * `opts.policy` is required, and the destination is checked before git runs.
 */
export function pushHead(cloneDir, opts) {
  const gate = gateOf("pushHead", opts);
  const refused = destinationRefusal(cloneDir, gate, { push: true });
  if (refused) return { ok: false, error: refused };
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
