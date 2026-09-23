import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { recall } from "./recall.js";
import { teamCloneDir, logSince } from "./gitsync.js";
import { recent as recentMemory } from "../../core/memory.js";

export function catchMeUp(root, { project, since, team }) {
  const notes = recall(root, { query: project, project, limit: 50 }).map(({ path, snippet }) => ({ path, snippet }));
  let commits = [];
  const clone = team ? teamCloneDir(root, team) : null;
  if (clone && existsSync(join(clone, ".git"))) {
    try {
      commits = execFileSync(
        "git",
        ["-C", clone, "log", `--since=${since}`, "--pretty=- %h %s"],
        { stdio: ["ignore", "pipe", "pipe"] }
      ).toString().split("\n").filter(Boolean);
    } catch {
      commits = [];
    }
  }
  return { notes, commits };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/**
 * The repo half of a catch-up: the days of the repo's committed `.cortex/memory/` on or after
 * `since`, and its own git log over the same window. This is what a plugin install has to read —
 * there is no vault on that machine, only the repo it was opened in — and it is readable by every
 * developer on the repo because both halves are committed.
 *
 * Writes nothing. `.cortex/` not existing yet is an empty `memory`, not an error: a repo nobody has
 * run `/dream` in still has a history worth catching up on, and saying the memory is empty is the
 * finding.
 *
 * @param {string} repoDir  top of the git work tree
 * @param {{ since: string }} opts
 */
export function catchUpRepo(repoDir, { since }) {
  const cortex = join(repoDir, ".cortex");
  const filtered = ISO_DAY.test(String(since));
  const day = filtered ? String(since).slice(0, 10) : null;
  // core/memory.js owns the store's layout (one YYYY-MM-DD.md per day, under the root guard), so
  // this asks it rather than listing the directory a second way.
  const memory = (existsSync(cortex) ? recentMemory(cortex, { days: Infinity }) : [])
    .filter((m) => !filtered || m.day >= day)
    .map(({ day: d, path, content }) => ({ day: d, path, content }));
  const { commits, truncated } = logSince(repoDir, since);
  const out = { path: repoDir, memory, commits, truncated };
  if (!filtered) out.note = `--since "${since}" is not YYYY-MM-DD, so every memory day is included; git filtered the commits itself`;
  return out;
}
