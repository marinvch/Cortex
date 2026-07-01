import { execFileSync } from "node:child_process";
import { mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

export function collectCommits(repoDir, since) {
  const out = execFileSync(
    "git",
    ["-C", repoDir, "log", `--since=${since}`, "--pretty=- %h %s (%an, %ad)", "--date=short"],
    { stdio: ["ignore", "pipe", "pipe"] }
  ).toString();
  return out.split("\n").filter(Boolean);
}

export function collectMergedPRs(repoDir, since) {
  try {
    const out = execFileSync(
      "gh",
      ["pr", "list", "--state", "merged", "--search", `merged:>=${since}`, "--json", "number,title",
       "--jq", '.[] | "- #\\(.number) \\(.title)"'],
      { cwd: repoDir, stdio: ["ignore", "pipe", "pipe"] }
    ).toString();
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function buildDigest(repoDir, since, prs = []) {
  const commits = collectCommits(repoDir, since);
  const lines = [`## Digest since ${since}`, "", "### Commits", commits.length ? commits.join("\n") : "- (none)"];
  if (prs.length) lines.push("", "### Merged PRs", prs.join("\n"));
  return lines.join("\n") + "\n";
}

export function writeDigest(outFile, content) {
  mkdirSync(dirname(outFile), { recursive: true });
  appendFileSync(outFile, content);
  return outFile;
}

export function digest(repoDir, since, outFile) {
  const prs = collectMergedPRs(repoDir, since);
  return writeDigest(outFile, buildDigest(repoDir, since, prs));
}
