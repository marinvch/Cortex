import { existsSync } from "node:fs";
import { join } from "node:path";
import { recall } from "./recall.js";
import { teamCloneDir, logSince, pull } from "./gitsync.js";
import { slugify } from "./slug.js";
import { openVault } from "./vault.js";
import { recent as recentMemory } from "../../core/memory.js";

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
 * @param {{ project: string, since: string, team?: string }} opts
 */
export function catchMeUp(root, { project, since, team }) {
  const notes = recall(root, { query: project, project, limit: 50 }).map(({ path, snippet }) => ({ path, snippet }));
  if (!team) return { notes, commits: [] };

  const clone = teamCloneDir(root, team);
  const pulled = pull(clone);
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
  return { ...out, teamNotes: read.notes, commits: log.commits, truncated: read.truncated || log.truncated };
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
