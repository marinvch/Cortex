import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { teamCloneDir } from "./gitsync.js";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

function ensureIdentity(dir) {
  try { git(dir, ["config", "user.email"]); }
  catch { git(dir, ["config", "user.email", "cortex@local"]); git(dir, ["config", "user.name", "cortex"]); }
}

// The connector names the TEAM and the PROJECT as two fields, and takes them by name. It used to be
// `{ slug, teamBrainRepo }`, written by `team add` from `--slug <project>` and read by the resolver
// as the team — one field, two meanings, three positional strings — so every connected repo looked
// for its team-brain clone at `team/<project>` and captured into a directory that was not a clone.
// lib/resolve.js still reads the old shape (`legacyTeam` there).
export function connectorObject({ team, project, teamBrainRepo }) {
  return { team, project, teamBrainRepo };
}

export function writeConnector(cwd, { team, project, teamBrainRepo }) {
  const dir = join(cwd, ".cortex");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "connector.json");
  writeFileSync(path, JSON.stringify(connectorObject({ team, project, teamBrainRepo }), null, 2) + "\n");
  return path;
}

export function cloneTeamBrain(root, name, repo) {
  const dir = teamCloneDir(root, name);
  if (existsSync(join(dir, ".git"))) return { dir, cloned: false };
  mkdirSync(dirname(dir), { recursive: true });
  execFileSync("git", ["clone", "-q", repo, dir], { stdio: ["ignore", "pipe", "pipe"] });
  return { dir, cloned: true };
}

export function seedTeamBrain(cloneDir, { name, projects = [] }) {
  const written = [];
  const projectsDir = join(cloneDir, "projects");
  mkdirSync(projectsDir, { recursive: true });
  const keep = join(projectsDir, ".gitkeep");
  writeFileSync(keep, ""); written.push(keep);
  for (const p of projects) {
    const pdir = join(projectsDir, p);
    mkdirSync(pdir, { recursive: true });
    const k = join(pdir, ".gitkeep");
    writeFileSync(k, ""); written.push(k);
  }
  const projLines = projects.length ? projects.map((p) => `- ${p}`).join("\n") : "- (none yet)";
  const teamMd = join(cloneDir, "team.md");
  writeFileSync(teamMd, `# Team: ${name}\n\n## Projects\n${projLines}\n\n## Members\n- (add members)\n`);
  written.push(teamMd);
  return written;
}

export function initTeamBrain(root, { name, repo, projects = [], outwardSync = true }) {
  const { dir } = cloneTeamBrain(root, name, repo);
  seedTeamBrain(dir, { name, projects });
  ensureIdentity(dir);
  git(dir, ["add", "."]);
  const pending = git(dir, ["status", "--porcelain"]).trim();
  if (pending) git(dir, ["commit", "-q", "-m", `chore: seed team-brain ${name}`]);
  git(dir, ["branch", "-M", "master"]);

  // What makes "no firewall" safe on a lab machine: permissive locally is only defensible where
  // nothing can publish, which is why core/profile.js calls sealed-outward the load-bearing half
  // of `lab`. The seed is still written and committed locally so nothing is lost; only the publish
  // is declined, and the caller is told which so it can say so rather than reporting a silent
  // success. capture.js made the same choice at the same seam.
  if (!outwardSync) return { dir, pushed: false, error: "outward_sync_disabled" };

  git(dir, ["push", "-q", "-u", "origin", "master"]); // retry-safe if a prior commit was unpushed
  return { dir, pushed: true };
}
