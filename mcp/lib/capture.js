import { mkdirSync, appendFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { resolveInRoot } from "./paths.js";
import { commitAndPush, teamCloneDir, pull } from "./gitsync.js";
import { slugify } from "./slug.js";

export function capture(root, { content, project, tags, today, team, noteId }) {
  const tagLine = tags && tags.length ? " " + tags.map((t) => `#${slugify(t)}`).join(" ") : "";

  // Team mode: one-file-per-note under the team-brain clone, then commit+push.
  if (team) {
    const teamSlug = slugify(team);
    const clone = teamCloneDir(root, teamSlug);
    pull(clone); // best-effort ff-only sync before committing/pushing (ignores failure)
    const slug = project ? slugify(project) : "inbox";
    const rel = `team/${teamSlug}/projects/${slug}/${today}-${noteId}.md`;
    const abs = resolveInRoot(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `---\ntype: brain-note\ncreated: ${today}\n---\n\n${content}${tagLine}\n`);
    const fileInClone = relative(clone, abs).split(sep).join("/"); // git wants forward slashes
    const res = commitAndPush(clone, [fileInClone], `capture: ${slug}`);
    return res.pushed ? { path: abs, pushed: true } : { path: abs, pushed: false, error: res.error };
  }

  // Personal mode (unchanged): append to project note or dated inbox.
  const rel = project ? `projects/${slugify(project)}.md` : `inbox/${today}.md`;
  const abs = resolveInRoot(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const line = `\n- ${today} — ${content}${tagLine}\n`;
  if (!existsSync(abs)) appendFileSync(abs, `---\ntype: brain-note\ncreated: ${today}\n---\n`);
  appendFileSync(abs, line);
  return { path: abs, pushed: false };
}
