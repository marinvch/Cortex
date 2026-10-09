// Projects in a personal vault: `projects/<slug>.md` (flat) or `projects/<slug>/*.md` (folder).
// This module owns that SHAPE. Filesystem access belongs to the Vault (docs/adr/0007) — it used to
// join `projects` onto the root itself, one of the doors the guard did not cover.

import { listTeamProjects } from "./project-files.js";
import { openVault } from "./vault.js";

/**
 * Every project the brain knows, each marked with where it came from.
 *
 * `source: "vault"` is a personal vault's own `projects/` — a project stub or a notes folder, as
 * this function has always returned. `source: "team"` is a project file in the team-brain clone
 * (docs/adr/0024), added when the brain is on a team: `team` and `policy` come off the record
 * `lib/brain.js` opens, never from the caller's arguments. The two are different things with the
 * same filename, so they are never merged: one slug can appear once from each source.
 *
 * @param {string} root
 * @param {{ team?: string|null, policy?: object }} [brain]
 */
export function listProjects(root, { team = null, policy } = {}) {
  const vault = openVault(root);
  const out = [];
  // Shallow on purpose: a folder-form project is ONE entry, not the notes inside it.
  // `.cortexignore` decides what is knowledge — the same contract recall.js and the bash generators
  // honour. This used to be a hand-coded `README.md` check, which meant the vault had two different
  // notions of noise and only one of them was configurable.
  for (const e of vault.entries("projects")) {
    if (e.isFile && e.name.endsWith(".md")) {
      out.push({ slug: e.name.replace(/\.md$/, ""), path: vault.abs(e.rel), source: "vault" });
    } else if (e.isDirectory && !e.name.startsWith(".")) {
      out.push({ slug: e.name, path: vault.abs(e.rel), source: "vault" });
    }
  }
  if (team) out.push(...listTeamProjects(root, { team, policy }).projects);
  return out.sort((a, b) => a.slug.localeCompare(b.slug) || a.source.localeCompare(b.source));
}

export function getProjectContext(root, slug) {
  const vault = openVault(root);
  // `slug` is caller-supplied, so both candidate paths go through the root guard — which is now
  // unavoidable rather than remembered, since the Vault is the only way to touch either one.
  // Without the guard, a slug like `../../secret` reads any file on disk (see projects.test.js).
  const fileRel = `projects/${slug}.md`;
  const dirRel = `projects/${slug}`;

  if (vault.isFile(fileRel)) {
    return { slug, path: vault.abs(fileRel), content: vault.read(fileRel) };
  }
  if (vault.isDirectory(dirRel)) {
    const notes = vault
      .entries(dirRel, { ignore: false })
      .filter((e) => e.isFile && e.name.endsWith(".md"))
      .sort((a, b) => a.name.localeCompare(b.name));
    const content = notes.map((e) => vault.read(e.rel)).join("\n\n---\n\n");
    return { slug, path: vault.abs(dirRel), content };
  }
  const err = new Error(`project not found: ${slug}`);
  err.code = "not_found";
  throw err;
}
