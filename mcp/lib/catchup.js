import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { recall } from "./recall.js";
import { teamCloneDir, logSince, pull, repoTop } from "./gitsync.js";
import { slugify } from "./slug.js";
import { openVault } from "./vault.js";
import { recent as recentMemory } from "../../core/memory.js";
import { contractDrift } from "./contract.js";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

// What one call may return of the team's notes. The transport caps a whole result at 40 000
// characters (lib/stdio.js) and a capped result is a truncation marker, not the notes — so this
// stays well under it, beside up to 50 personal snippets and 100 commit lines. Newest first, so what
// a cap drops is the oldest; `truncated` says one was hit.
const TEAM_NOTES_MAX = 50;
const TEAM_NOTE_CHARS = 2_000;
const TEAM_NOTES_BUDGET = 12_000;
const TEAM_COMMITS_MAX = 100;

/**
 * The vault half of a catch-up: personal notes for `project`, and — on a team — what every project
 * of the team captured since `since`, read from the team-brain clone after a fast-forward pull.
 *
 * It reads the notes, not only the log. It used to return the clone's commit subjects and nothing
 * else, from a clone it never pulled, so a teammate's capture in another repo was invisible twice:
 * not fetched, and not read if it had been.
 *
 * The pull is ff-only: a clone with local commits the remote does not have is left exactly as it
 * is. A failed pull is REPORTED in `pull` and the local notes are still returned — an empty or stale
 * answer must never pass for a quiet week.
 *
 * @param {string} root  the vault
 * `policy` is required on a team: the pull reaches the team-brain's remote, and core/destinations.js
 * decides whether it may. A refused pull is reported in `pull` like any failed one.
 *
 * @param {{ project: string, since: string, team?: string, policy?: object, env?: object }} opts
 */
export function catchMeUp(root, { project, since, team, policy, env = process.env }) {
  const notes = recall(root, { query: project, project, limit: 50 }).map(({ path, snippet }) => ({ path, snippet }));
  if (!team) return { notes, commits: [] };

  const clone = teamCloneDir(root, team);
  const pulled = pull(clone, { policy, env });
  const out = {
    notes,
    pull: pulled.ok ? { ok: true } : { ok: false, error: firstLines(pulled.error) },
    teamNotes: [],
    commits: [],
    truncated: false,
  };
  if (pulled.error === "not_a_git_repo") return out;

  const log = logSince(clone, since, { max: TEAM_COMMITS_MAX });
  const read = teamNotes(root, team, since);
  // What each project's published contract gained, lost or changed in the window (#621, R14), from
  // the clone's history of `projects/*/contract.json`. A consumer learns a backend dropped an
  // endpoint without reading the backend's repo.
  const drift = contractDrift(clone, since);
  return {
    ...out,
    teamNotes: read.notes,
    commits: log.commits,
    contracts: drift.projects,
    truncated: read.truncated || log.truncated || drift.truncated,
  };
}

// Every note under `team/<team>/projects/*/`, through the Vault like any other vault read. Dated by
// the `YYYY-MM-DD-` prefix capture gives the filename, or its `created:` line; a note with neither
// cannot be placed in the window, so it is left out rather than shown as new.
function teamNotes(root, team, since) {
  const vault = openVault(root);
  const base = `team/${slugify(team)}/projects`;
  const day = ISO_DAY.test(String(since)) ? String(since).slice(0, 10) : null;
  const found = [];
  for (const rel of vault.list(base, { ext: ".md" })) {
    const [projectDir, ...rest] = rel.slice(base.length + 1).split("/");
    if (!rest.length) continue; // a file directly under projects/ belongs to no project
    const text = vault.read(rel);
    const created = rest.at(-1).match(ISO_DAY)?.[0] ?? text.match(/^created:\s*(\d{4}-\d{2}-\d{2})/m)?.[1];
    if (!created || (day && created < day)) continue;
    found.push({ project: projectDir, created, path: rel, text });
  }
  found.sort((a, b) => b.created.localeCompare(a.created) || b.path.localeCompare(a.path));

  const notes = [];
  let budget = TEAM_NOTES_BUDGET;
  let truncated = found.length > TEAM_NOTES_MAX;
  for (const n of found.slice(0, TEAM_NOTES_MAX)) {
    const body = n.text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, "").trim();
    const room = Math.min(TEAM_NOTE_CHARS, budget);
    if (room <= 0) { truncated = true; break; }
    const content = body.length > room ? body.slice(0, room) : body;
    if (content.length < body.length) truncated = true;
    notes.push({ project: n.project, created: n.created, path: n.path, content });
    budget -= content.length;
  }
  return { notes, truncated };
}

// git's stderr for a refused pull runs to a dozen hint lines; the first three say what happened.
function firstLines(text) {
  return String(text).trim().split("\n").slice(0, 3).join("\n");
}

/**
 * The repo half of a catch-up: the days of the repo's committed `.cortex/memory/` on or after
 * `since`, and its own git log over the same window. This is what a plugin install has to read —
 * there is no vault on that machine, only the repo it was opened in — and it is readable by every
 * developer on the repo because both halves are committed.
 *
 * Writes nothing. `.cortex/` not existing yet is an empty `memory`, not an error: a repo nobody has
 * run `/end-of-day-summary` in still has a history worth catching up on, and saying the memory is empty is the
 * finding.
 *
 * @param {string} repoDir  top of the git work tree
 * @param {{ since: string }} opts
 */
export function catchUpRepo(repoDir, { since }) {
  const cortex = join(repoDir, ".cortex");
  const filtered = ISO_DAY.test(String(since));
  const day = filtered ? String(since).slice(0, 10) : null;
  // core/memory.js owns the store's layout (a day file, or one file per author in a day directory,
  // under the root guard), so this asks it rather than listing the directory a second way. A row is
  // one file; `since` filters by day, so every file of a day in the window comes back. `author` is
  // the slug from the file's path, or null for a day file.
  const memory = (existsSync(cortex) ? recentMemory(cortex, { days: Infinity }) : [])
    .filter((m) => !filtered || m.day >= day)
    .map(({ day: d, author, path, content }) => ({ day: d, author, path, content }));
  const { commits, truncated } = logSince(repoDir, since);
  const out = { path: repoDir, memory, commits, truncated };
  if (!filtered) out.note = `--since "${since}" is not YYYY-MM-DD, so every memory day is included; git filtered the commits itself`;
  return out;
}

// --- which sources a catch-up reads ---------------------------------------------------------------

/** A catch-up that cannot be answered. `code` is `nothing_to_read` or `no_project`. */
export class CatchUpRefused extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CatchUpRefused";
    this.code = code;
  }
}

function samePath(a, b) {
  const norm = (p) => resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

/**
 * The team a catch-up reads: the one asked for, else the one the brain resolved from the connector.
 * An explicit team is an override, never the switch that turns team mode on. The CLI and the MCP
 * server both ask here, so one cannot consult the connector while the other does not.
 */
export function catchUpTeam(given, brain) {
  return given ?? brain.team ?? undefined;
}

/**
 * A whole catch-up, from whichever sources exist. Two, and either may be absent. The REPO is the
 * git work tree: its committed `.cortex/memory/` and its log. A plugin install has only this. The
 * VAULT is notes and a team-brain clone, when a root names one.
 *
 * `brain` is null when no root is set. That is a degradation and not a guess: nothing is read from
 * a vault that was not named, and `skipped` says which half is missing, so an empty result cannot
 * pass for a quiet week. Writes nothing.
 *
 * The decisions, which the CLI used to hold and only a subprocess could test:
 *   - a repo-mode root IS a repo's `.cortex/`, so its repo is the directory above it, whatever the cwd
 *   - a cwd inside the vault's own checkout is not a repo to catch up on: its log is the vault's
 *     notes arriving, which the notes half already reports
 *   - the project is the one asked for, else the connector's, else the repo's folder name
 *
 * `top` finds the work tree above a directory; it is a parameter so a test needs no git.
 * Throws `CatchUpRefused`.
 */
export function catchUp({ brain, since, project: asked, team: givenTeam, cwd, top = repoTop }) {
  const repoDir = brain?.isRepo ? dirname(resolve(brain.root)) : top(cwd);
  const isTheVault = brain && !brain.isRepo && repoDir && samePath(repoDir, brain.root);
  const repo = repoDir && !isTheVault ? catchUpRepo(repoDir, { since }) : null;

  if (!brain) {
    if (!repo) {
      throw new CatchUpRefused(
        "nothing_to_read",
        "catch-up found nothing to read: the current directory is not inside a git repository and CORTEX_ROOT is not set. " +
        "Run it from the repo to catch up on, or set CORTEX_ROOT to your vault.",
      );
    }
    return {
      repo, notes: [], commits: [],
      skipped: "vault notes and team-brain history — CORTEX_ROOT is not set, so only this repo was read",
    };
  }

  const project = asked ?? brain.project ?? (repoDir ? basename(repoDir) : null);
  if (!project) throw new CatchUpRefused("no_project", "catch-up needs a project, and none was given or found");
  const res = catchMeUp(brain.root, { project, since, team: catchUpTeam(givenTeam, brain), policy: brain.policy, env: brain.env });
  return { ...(repo ? { repo } : {}), ...res };
}
