import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { recall } from "./recall.js";
import { teamCloneDir } from "./gitsync.js";

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
