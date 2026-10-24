import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { parseSource } from "../../core/source.js";
import { ensureIdentity, teamCloneDir } from "./gitsync.js";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

// The connector names the TEAM and the PROJECT as two fields, and takes them by name. It used to be
// `{ slug, teamBrainRepo }`, written by `team add` from `--slug <project>` and read by the resolver
// as the team — one field, two meanings, three positional strings — so every connected repo looked
// for its team-brain clone at `team/<project>` and captured into a directory that was not a clone.
// lib/resolve.js still reads the old shape (`legacyTeam` there).
//
// `source` is where the team runs Cortex from, when it is an organisation's fork (#622): copied from
// the team-brain's `team.json` by `team add`, and read by `core/source.js` below `CORTEX_SOURCE`. It
// is written only when the team set one, so a team on upstream gets the connector it always had.
export function connectorObject({ team, project, teamBrainRepo, source = null }) {
  return source ? { team, project, teamBrainRepo, source } : { team, project, teamBrainRepo };
}

export function writeConnector(cwd, { team, project, teamBrainRepo, source = null }) {
  const dir = join(cwd, ".cortex");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "connector.json");
  writeFileSync(path, JSON.stringify(connectorObject({ team, project, teamBrainRepo, source }), null, 2) + "\n");
  return path;
}

// `team.json` in a team-brain holds the team's Cortex source and nothing else: `{ "source": … }`.
// `team init --source` writes it once, so every `team add` stamps the fork without each member
// passing a flag. Both ends validate it through `parseSource`, which refuses a URL carrying a
// credential: the value is pushed to the brain and committed into every product repo.
export const TEAM_JSON = "team.json";

/** The team-brain clone's source, validated, or null when it has no `team.json` or no source. */
export function readTeamSource(cloneDir) {
  const path = join(cloneDir, TEAM_JSON);
  if (!existsSync(path)) return null;
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${TEAM_JSON} in the team-brain is not valid JSON (${e.message}); fix it there and run again`);
  }
  const v = typeof doc?.source === "string" ? doc.source.trim() : "";
  if (!v) return null;
  parseSource(v, `the source in the team-brain's ${TEAM_JSON}`);
  return v;
}

export function cloneTeamBrain(root, name, repo) {
  const dir = teamCloneDir(root, name);
  if (existsSync(join(dir, ".git"))) return { dir, cloned: false };
  mkdirSync(dirname(dir), { recursive: true });
  execFileSync("git", ["clone", "-q", repo, dir], { stdio: ["ignore", "pipe", "pipe"] });
  return { dir, cloned: true };
}

export function seedTeamBrain(cloneDir, { name, projects = [], source = null }) {
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
  // No list of projects here. `team.md` used to carry one, and it was never the registry: every
  // repo that joined later was missing from it, and a list two people edit on the same day is a
  // merge conflict. The projects are the files in `projects/`, one each, so this points there
  // (docs/adr/0024).
  const teamMd = join(cloneDir, "team.md");
  writeFileSync(
    teamMd,
    `# Team: ${name}\n\n## Projects\n` +
      "See `projects/`. Each project is one file there, `projects/<slug>.md`, written when its repo\n" +
      "joins with `/team-add`. A folder `projects/<slug>/` holds that project's notes.\n" +
      "\n## Members\n- (add members)\n",
  );
  written.push(teamMd);
  if (source) {
    const teamJson = join(cloneDir, TEAM_JSON);
    writeFileSync(teamJson, JSON.stringify({ source }, null, 2) + "\n");
    written.push(teamJson);
  }
  return written;
}

/**
 * Seed, commit and push a team-brain. `source` (an owner/repo, git URL or absolute path) is the
 * team's Cortex fork, written to `team.json`; it is validated before anything is cloned or written.
 */
export function initTeamBrain(root, { name, repo, projects = [], outwardSync = true, source = null }) {
  const src = source === null || source === undefined ? null : String(source).trim();
  if (source !== null && source !== undefined) parseSource(src, "--source");
  const { dir } = cloneTeamBrain(root, name, repo);
  seedTeamBrain(dir, { name, projects, source: src });
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
