import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { parseSource } from "../../core/source.js";
import { ensureGitignored } from "../../core/gitignore.js";
import { ensureIdentity, teamCloneDir, destinationRefusal } from "./gitsync.js";
import { assertDestination } from "../../core/destinations.js";

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

/**
 * Clone the team-brain at `repo` into the vault's `team/<name>/`, unless a clone is already there.
 * `opts.policy` is required: the URL is checked against the profile's destinations before anything
 * is cloned or created, and a refusal throws `DestinationRefusedError` (core/destinations.js).
 */
export function cloneTeamBrain(root, name, repo, opts) {
  if (!opts || !opts.policy) throw new TypeError("cloneTeamBrain: { policy } is required — pass brain.policy");
  const dir = teamCloneDir(root, name);
  if (existsSync(join(dir, ".git"))) return { dir, cloned: false };
  // Inbound: lab may still clone. Work may clone only from an approved remote.
  assertDestination(repo, { kind: "git", policy: opts.policy, env: opts.env ?? process.env, inbound: true });
  mkdirSync(dirname(dir), { recursive: true });
  execFileSync("git", ["clone", "-q", repo, dir], { stdio: ["ignore", "pipe", "pipe"] });
  return { dir, cloned: true };
}

/** The line written above `.cortex/team/` in a product repo's `.gitignore`. */
export const CLONE_MARKER = "# Cortex — a team-brain clone, re-cloned on first use. Not this repo's code.";

export class NoTeamError extends Error {
  constructor(tool) {
    super(`${tool} needs a team-brain, and this brain is not joined to one. Run /join-team in this repo to join.`);
    this.name = "NoTeamError";
    this.code = "no_team";
  }
}

/**
 * The team-brain clone this brain reads and writes, cloned on first use (#620, design R7).
 *
 * In repo mode the clone sits inside the product repo, at `.cortex/team/<team>/`, and a nested
 * clone the repo does not ignore shows up in `git status` as an embedded repository someone will
 * one day `git add`. So `.cortex/team/` is ignored before the clone is made — the guarantee attaches
 * to the act (ADR 0016), and it is checked on every call, so a clone made before this existed is
 * covered the first time an ask tool runs. `core/gitignore.js` writes the line; `index/` uses the
 * same function for its generated directories.
 *
 * Cloning is inbound, so it happens on every profile; publishing is what `lab` seals.
 *
 * @param {{ team: string|null, teamClone: string|null, teamBrainRepo: string|null, root: string, isRepo: boolean }} brain
 * @param {string} tool  the tool or command asking, for the refusal
 * @returns {{ dir: string, cloned: boolean, ignored: string[] }}
 */
export function ensureTeamClone(brain, tool) {
  if (!brain.team || !brain.teamClone) throw new NoTeamError(tool);
  const ignored = brain.isRepo ? ensureGitignored(dirname(brain.root), [".cortex/team/"], CLONE_MARKER) : [];
  if (existsSync(join(brain.teamClone, ".git"))) return { dir: brain.teamClone, cloned: false, ignored };
  if (!brain.teamBrainRepo) {
    throw Object.assign(
      new Error(`${tool}: there is no team-brain clone at ${brain.teamClone}, and the connector names no teamBrainRepo to clone. Run /join-team in this repo again.`),
      { code: "no_clone" },
    );
  }
  const { dir } = cloneTeamBrain(brain.root, brain.team, brain.teamBrainRepo, { policy: brain.policy, env: brain.env });
  return { dir, cloned: true, ignored };
}

export function seedTeamBrain(cloneDir, { name, projects = [], source = null, integrations = null, workflow = null }) {
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
      "joins with `/join-team`. A folder `projects/<slug>/` holds that project's notes.\n" +
      "\n## Members\n- (add members)\n",
  );
  written.push(teamMd);
  // team.json holds `source` (#622) and the tracker selection (#624) — each only when the team set
  // it, so a team with neither gets no file. A re-run keeps what is already there (members, from
  // #620) and replaces only the keys it was given.
  const integ = integrations && integrations.integrations?.length ? integrations : null;
  if (source || integ) {
    const teamJson = join(cloneDir, TEAM_JSON);
    let doc = {};
    if (existsSync(teamJson)) {
      try { doc = JSON.parse(readFileSync(teamJson, "utf8")) ?? {}; } catch { doc = {}; }
    }
    if (source) doc.source = source;
    if (integ) {
      doc.integrations = integ.integrations;
      if (integ.primary) doc.primary = integ.primary; else delete doc.primary;
      if (integ.routes && Object.keys(integ.routes).length) doc.routes = integ.routes; else delete doc.routes;
    }
    writeFileSync(teamJson, JSON.stringify(doc, null, 2) + "\n");
    written.push(teamJson);
  }
  if (workflow) {
    const wf = join(cloneDir, ".github", "workflows", "cortex-sync.yml");
    mkdirSync(dirname(wf), { recursive: true });
    writeFileSync(wf, workflow);
    written.push(wf);
  }
  return written;
}

/**
 * Seed, commit and push a team-brain. `source` (an owner/repo, git URL or absolute path) is the
 * team's Cortex fork, written to `team.json`; it is validated before anything is cloned or written.
 */
export function initTeamBrain(root, { name, repo, projects = [], policy, env = process.env, source = null, integrations = null, workflow = null }) {
  if (!policy) throw new TypeError("initTeamBrain: { policy } is required — pass brain.policy");
  const src = source === null || source === undefined ? null : String(source).trim();
  if (source !== null && source !== undefined) parseSource(src, "--source");
  const { dir } = cloneTeamBrain(root, name, repo, { policy, env });
  seedTeamBrain(dir, { name, projects, source: src, integrations, workflow: typeof workflow === "function" ? workflow(dir) : workflow });
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
  if (!policy.outwardSync) return { dir, pushed: false, error: "outward_sync_disabled" };

  // The push is checked as every push is (core/destinations.js): a clone that was already here was
  // never checked on the way in, and its remote may since have been changed.
  const refused = destinationRefusal(dir, { policy, env }, { push: true });
  if (refused) return { dir, pushed: false, error: refused };

  git(dir, ["push", "-q", "-u", "origin", "master"]); // retry-safe if a prior commit was unpushed
  return { dir, pushed: true };
}
