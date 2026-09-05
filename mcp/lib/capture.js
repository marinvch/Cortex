// Capture: where a note lands. This module owns ROUTING — personal note versus team-brain clone,
// project note versus dated inbox. The Vault owns touching the filesystem (docs/adr/0007).
//
// Note what did NOT move in here: scrubbing. Secret refusal is a policy decision that lives in
// core/scrub.js with the callers that apply it. Folding it into the Vault would make every write
// pay for it and would hide a refusal behind a path operation.

import { relative, sep } from "node:path";
import { commitAndPush, teamCloneDir, pull } from "./gitsync.js";
import { slugify } from "./slug.js";
import { openVault } from "./vault.js";

export function capture(root, { content, project, tags, today, team, noteId, outwardSync = true }) {
  const vault = openVault(root);
  const tagLine = tags && tags.length ? " " + tags.map((t) => `#${slugify(t)}`).join(" ") : "";

  // Team mode: one-file-per-note under the team-brain clone, then commit+push.
  //
  // A lab profile refuses outward sync (core/profile.js), and that is the ONLY difference between
  // the two team paths — where the note goes and what it says are identical, so they are written
  // once. Splitting them into two branches meant a change to the frontmatter had to be made twice.
  if (team) {
    const teamSlug = slugify(team);
    const clone = teamCloneDir(root, teamSlug);
    const slug = project ? slugify(project) : "inbox";
    const rel = `team/${teamSlug}/projects/${slug}/${today}-${noteId}.md`;

    // best-effort ff-only sync before committing/pushing (ignores failure); pointless if we will
    // not push.
    if (outwardSync) pull(clone);
    vault.write(rel, `---\ntype: brain-note\ncreated: ${today}\n---\n\n${content}${tagLine}\n`);
    const abs = vault.abs(rel);

    // What makes "no firewall" safe on a lab machine: permissive locally is only defensible where
    // nothing can publish. The note is still WRITTEN so nothing is lost; it simply is not pushed,
    // and the caller is told which so it can say so rather than reporting a silent success.
    if (!outwardSync) return { path: abs, pushed: false, error: "outward_sync_disabled" };

    const fileInClone = relative(clone, abs).split(sep).join("/"); // git wants forward slashes
    const res = commitAndPush(clone, [fileInClone], `capture: ${slug}`);
    return res.pushed ? { path: abs, pushed: true } : { path: abs, pushed: false, error: res.error };
  }

  // Personal mode (unchanged): append to project note or dated inbox.
  const rel = project ? `projects/${slugify(project)}.md` : `inbox/${today}.md`;
  const line = `\n- ${today} — ${content}${tagLine}\n`;
  if (!vault.exists(rel)) vault.append(rel, `---\ntype: brain-note\ncreated: ${today}\n---\n`);
  vault.append(rel, line);
  return { path: vault.abs(rel), pushed: false };
}
