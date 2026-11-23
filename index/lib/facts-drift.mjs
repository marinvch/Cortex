// facts-drift.mjs — what the team has that this machine does not.
//
// Two people can ask their AI the same question and get different answers because one of them has
// not pulled the changed definition of done. Nothing said so: `cortex-next` read only the working
// tree, and the working tree cannot know what it is missing.
//
// This compares against the refs git already holds and never fetches. `cortex-next` is read-only
// in the strongest sense, a fetch writes refs and needs a network, and a footer must not hang on a
// remote. So every answer means "as of your last fetch", and the caller has to say that.
//
// Only what the other side changed counts. A three-dot diff starts at the merge base, so a branch
// that edits AGENTS.md itself is not told it is behind for its own edit.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gitReader } from "./changed.mjs";

/** The files that tell an AI what is true here. */
const CONTEXT_FILE = /(^|\/)(AGENTS|CLAUDE|GEMINI|CONTEXT|REVIEW)\.md$|^docs\/adr\/.+\.md$|^\.github\/copilot-instructions\.md$/;

/** Origin's default branch as this clone knows it, or null. */
function originDefault(run) {
  const head = run(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]).out?.trim();
  if (head) return head;
  for (const ref of ["origin/main", "origin/master"]) {
    if (run(["rev-parse", "--verify", "-q", `refs/remotes/${ref}`]).out) return ref;
  }
  return null;
}

/** How far a team-brain clone under `.cortex/team/` is from its upstream. */
function teamClones(root, reader) {
  const base = join(root, ".cortex", "team");
  if (!existsSync(base)) return [];
  const out = [];
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory() || !existsSync(join(base, e.name, ".git"))) continue;
    const count = reader(join(base, e.name))(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]).out;
    const m = count?.trim().match(/^(\d+)\s+(\d+)$/);
    if (m) out.push({ team: e.name, ahead: Number(m[1]), behind: Number(m[2]) });
  }
  return out.sort((a, b) => a.team.localeCompare(b.team));
}

/**
 * factsDrift(root) → null outside a git repo, else `{ ref, behind, files, teams }`: the origin branch
 * compared with (null when there is none), how many commits it has that HEAD lacks, which context
 * files those commits changed, and each team-brain clone's distance from its upstream.
 */
export function factsDrift(root, { reader = gitReader } = {}) {
  const run = reader(root);
  if (run(["rev-parse", "--is-inside-work-tree"]).out?.trim() !== "true") return null;
  const teams = teamClones(root, reader);
  const ref = originDefault(run);
  if (!ref) return { ref: null, behind: 0, files: [], teams };
  const behind = Number(run(["rev-list", "--count", `HEAD..${ref}`]).out?.trim() ?? 0) || 0;
  const names = behind ? run(["diff", "--name-only", "-z", `HEAD...${ref}`]).out ?? "" : "";
  const files = names.split("\0").filter((p) => CONTEXT_FILE.test(p)).sort();
  return { ref, behind, files, teams };
}

/** The lines a person should see, or none when this machine has everything it knows of. */
export function factsDriftLines(drift) {
  if (!drift) return [];
  const lines = [];
  if (drift.files.length) {
    const shown = drift.files.slice(0, 5).join(", ");
    const more = drift.files.length > 5 ? ` and ${drift.files.length - 5} more` : "";
    lines.push(`${drift.ref} changed ${drift.files.length} context file(s) you do not have: ${shown}${more}. Run git pull.`);
  }
  for (const t of drift.teams) {
    if (t.behind) lines.push(`The team-brain '${t.team}' is ${t.behind} commit(s) behind. Its next inbox or catch-up pulls them.`);
    if (t.ahead) lines.push(`The team-brain '${t.team}' has ${t.ahead} commit(s) nobody else has yet. Its next write pushes them.`);
  }
  return lines;
}
