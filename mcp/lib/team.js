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

export function connectorObject(slug, teamBrainRepo) {
  return { slug, teamBrainRepo };
}

export function writeConnector(cwd, slug, teamBrainRepo) {
  const dir = join(cwd, ".cortex");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "connector.json");
  writeFileSync(path, JSON.stringify(connectorObject(slug, teamBrainRepo), null, 2) + "\n");
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

export function initTeamBrain(root, { name, repo, projects = [] }) {
  const { dir } = cloneTeamBrain(root, name, repo);
  seedTeamBrain(dir, { name, projects });
  ensureIdentity(dir);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", `chore: seed team-brain ${name}`]);
  git(dir, ["branch", "-M", "master"]);
  git(dir, ["push", "-q", "-u", "origin", "master"]);
  return dir;
}
