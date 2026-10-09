// Project files in a team-brain: the writer `team add` uses, the listing, and removal.
//
// A project file is `projects/<slug>.md` at the top of a team-brain, and a workspace is the set of
// them (docs/adr/0024). `core/project-file.js` owns what a valid one is and whether this install
// may hold it. This module owns the ACTS — and each act keeps the promises the rest of `mcp/`
// already makes:
//
//   - every path goes through the Vault (docs/adr/0007), so this file imports no filesystem module
//     and `test/vault-is-the-only-door.test.js` holds it to that;
//   - a refusal happens before the write, never after: validation, then the profile, then the
//     secret gate, and the first one that says no leaves both repositories as they were;
//   - a publish consults `policy.outwardSync`. On a sealed profile the commit is kept locally, the
//     push is declined, and the caller is told `outward_sync_disabled` — the same answer `capture`
//     and `team init` give.
//
// What it does not do: fetch a link, edit somebody else's file, or delete a note.

import {
  LINK_KEYS,
  carriesCredential,
  isSlug,
  profileRefusal,
  renderProjectFile,
  setFrontmatter,
  validateProjectFile,
} from "../../core/project-file.js";
import { RefusedWriteError, assertWritable } from "../../core/scrub.js";
import { commitPath, originUrl, pull, pushHead, teamCloneDir } from "./gitsync.js";
import { slugify } from "./slug.js";
import { cloneTeamBrain } from "./team.js";
import { openVault } from "./vault.js";

/** A project-file operation that was declined, with a `code` a caller can branch on. */
export class ProjectFileRefused extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "ProjectFileRefused";
    this.code = code;
    Object.assign(this, extra);
  }
}

/** The fields a caller may set, as `team add` names them on the command line. */
const FIELD_KEYS = ["title", ...LINK_KEYS, "related"];

const projectsDir = (team) => `team/${slugify(team)}/projects`;
const describe = (errors) => errors.map((e) => (e.line ? `line ${e.line}: ${e.msg}` : e.msg)).join("; ");

/**
 * The three gates a project file passes before it is written, in the order the design fixes:
 * is it valid, may this install hold it, does it carry a secret. Throws on the first no.
 */
function judge(text, slug, policy, others) {
  const v = validateProjectFile(text, { slug, others });
  if (!v.ok) throw new ProjectFileRefused("invalid", `projects/${slug}.md is not a valid project file — ${describe(v.errors)}`, { errors: v.errors });
  const refusal = profileRefusal(v.data, policy);
  if (refusal) throw new ProjectFileRefused(refusal.code, `projects/${slug}.md: ${refusal.message}`, { links: refusal.links });
  try {
    assertWritable(text);
  } catch (e) {
    if (!(e instanceof RefusedWriteError)) throw e;
    // The gate's own message says "memory"; this is the same refusal for a different file. Only
    // the KIND of secret is named, as there.
    const kinds = [...new Set(e.findings.map((f) => f.kind))].join(", ");
    throw new ProjectFileRefused(e.code, `refusing to write projects/${slug}.md: it contains ${kinds}. It is not stripped and written; remove it and run this again.`);
  }
  return v;
}

/** Every `.md` directly under a team's `projects/`, read once, plus the folders beside them. */
function readTeam(vault, team) {
  const files = [];
  const folders = [];
  for (const e of vault.entries(projectsDir(team), { ignore: false })) {
    if (e.isFile && e.name.endsWith(".md")) files.push({ slug: e.name.slice(0, -3), rel: e.rel, text: vault.read(e.rel) });
    else if (e.isDirectory && !e.name.startsWith(".")) folders.push(e);
  }
  const mine = files.filter((f) => validateProjectFile(f.text).isProject);
  const others = mine.map((f) => ({ slug: f.slug, repo: validateProjectFile(f.text).data.repo }));
  return { files: mine, folders, skipped: files.length - mine.length, others };
}

/**
 * The team half of `list_projects`: one entry per project file, and one per notes folder that has
 * no file beside it (`unregistered`). A `.md` in `projects/` that is not `type: project` — a
 * README, a note filed a level too high — is skipped and counted, never reported as broken.
 *
 * Where the profile refuses the file, the entry is the slug, the path and the reason. Title, links
 * and relations are withheld. The file itself is left exactly where it is: a reader reports.
 *
 * @param {string} root  the vault
 * @param {{ team: string, policy: object }} opts  `policy` is the object core/profile.js hands out
 * @returns {{ projects: object[], skipped: number }}
 */
export function listTeamProjects(root, { team, policy }) {
  const vault = openVault(root);
  const { files, folders, skipped, others } = readTeam(vault, team);
  const projects = [];
  for (const f of files) {
    const v = validateProjectFile(f.text, { slug: f.slug, others });
    const head = { slug: f.slug, path: vault.abs(f.rel), source: "team" };
    const refusal = profileRefusal(v.data, policy);
    if (refusal) {
      projects.push({ ...head, withheld: refusal.reason });
      continue;
    }
    const links = {};
    for (const key of LINK_KEYS) if (key !== "repo" && v.data[key] !== undefined) links[key] = v.data[key];
    projects.push({ ...head, title: v.data.title, repo: v.data.repo, links, related: v.data.related, errors: v.errors, warnings: v.warnings });
  }
  const registered = new Set(files.map((f) => f.slug));
  for (const d of folders) {
    if (!registered.has(d.name)) projects.push({ slug: d.name, path: vault.abs(d.rel), source: "team", unregistered: true });
  }
  return { projects: projects.sort((a, b) => a.slug.localeCompare(b.slug)), skipped };
}

/**
 * Write a project's file into the team-brain when its repo joins. Called by `ai-os team add`
 * before it writes the connector, so a refusal here means the repo did not join at all.
 *
 * - The file does not exist: it is written from `fields`, with `repo` falling back to the
 *   checkout's `origin`, `title` to the slug, and `created` to `today`.
 * - It exists and no field was passed: it is left byte for byte.
 * - It exists and a field was passed: those frontmatter lines change, the prose does not, and the
 *   whole file is judged again.
 *
 * A checkout with no usable `origin` and no `fields.repo` still joins; its project stays
 * unregistered (`action: "skipped"`) because a project file with no repo is not written.
 *
 * @param {string} root  the vault
 * @param {{ team: string, teamRepo: string, project: string, cwd: string, today: string,
 *           policy: object, fields?: Record<string, string|string[]> }} opts
 */
export function addProject(root, { team, teamRepo, project, cwd, today, policy, fields = {} }) {
  if (!isSlug(project)) {
    throw new ProjectFileRefused("invalid_slug", `--project ${JSON.stringify(String(project).slice(0, 80))} is not a slug: lower-case letters and digits in words joined by single dashes, at most 64 characters`);
  }
  const given = {};
  for (const key of FIELD_KEYS) if (fields[key] !== undefined && fields[key] !== null) given[key] = fields[key];

  // The repo link a NEW file would carry. An origin holding a password or a token is refused
  // outright, not stripped and written: the person is told, and nothing of theirs is guessed at.
  let origin = null;
  let unusable = null;
  if (given.repo === undefined) {
    origin = originUrl(cwd);
    if (origin && carriesCredential(origin)) {
      throw new ProjectFileRefused("origin_has_credential", "this checkout's `origin` URL carries a credential, so it is not written into a shared file. Pass --project-repo <url> with the repository's plain address.");
    }
    if (origin) {
      const asRepo = validateProjectFile(renderProjectFile({ title: project, repo: origin }), { slug: project });
      if (!asRepo.ok) {
        unusable = "this checkout's `origin` is not a link a project file can hold (an https:// URL or the user@host:path form)";
        origin = null;
      }
    }
  }

  // Before anything is cloned or pulled: what this install may not hold is refused while both
  // repositories are still exactly as they were. Run again after the file is assembled, because
  // an existing file can hold a link the flags did not.
  const early = profileRefusal({ ...given, repo: given.repo ?? origin ?? undefined }, policy);
  if (early) throw new ProjectFileRefused(early.code, `projects/${project}.md: ${early.message}`, { links: early.links });

  const { dir, cloned } = cloneTeamBrain(root, team, teamRepo);
  // Best effort and fast-forward only, as `capture` does it. Pulling BEFORE looking for the file is
  // what makes "an existing file is left alone" true for a file a teammate pushed an hour ago.
  if (policy.outwardSync) pull(dir);

  const vault = openVault(root);
  const rel = `${projectsDir(team)}/${project}.md`;
  const inClone = `projects/${project}.md`;
  const path = vault.abs(rel);
  const exists = vault.isFile(rel);

  let text;
  let action;
  if (!exists) {
    const repo = given.repo ?? origin;
    if (!repo) {
      const why = unusable ?? "this checkout has no `origin` remote";
      return { dir, cloned, file: { path, action: "skipped", committed: false, pushed: false, warnings: [], reason: `${why}, and a project file is not written without a repo. Run this again with --project-repo <url> to register it.` } };
    }
    text = renderProjectFile({ title: project, created: today, ...given, repo });
    action = "written";
  } else {
    const current = vault.read(rel);
    if (!Object.keys(given).length) {
      return { dir, cloned, file: { path, action: "unchanged", committed: false, pushed: false, warnings: [], status: existingStatus(current, project, policy) } };
    }
    text = setFrontmatter(current, given);
    if (text === current) return { dir, cloned, file: { path, action: "unchanged", committed: false, pushed: false, warnings: [] } };
    action = "updated";
  }

  const others = readTeam(vault, team).others;
  const judged = judge(text, project, policy, others);
  vault.write(rel, text);
  const file = { path, action, warnings: judged.warnings, ...publish(dir, inClone, `project: add ${project}`, policy) };
  return { dir, cloned, file };
}

/** One word for a file this run did not touch, so `team add` can say what it joined. */
function existingStatus(text, slug, policy) {
  const v = validateProjectFile(text, { slug });
  if (!v.isProject) return "not a project file";
  if (profileRefusal(v.data, policy)) return "withheld on this profile";
  return v.ok ? "valid" : `invalid — ${describe(v.errors)}`;
}

/** Commit one path, then push it unless the profile seals outward sync. */
function publish(cloneDir, file, message, policy, { remove = false } = {}) {
  const c = commitPath(cloneDir, file, message, { remove });
  if (!c.ok) return { committed: false, pushed: false, error: c.error };
  if (!policy.outwardSync) return { committed: c.committed, pushed: false, error: "outward_sync_disabled" };
  const p = pushHead(cloneDir);
  return p.ok ? { committed: c.committed, pushed: true } : { committed: c.committed, pushed: false, error: p.error };
}

/**
 * Remove a project from the workspace: delete its file with `git rm`, commit, and push.
 *
 * The slug comes from a person, and this is the one command that deletes, so the root it resolves
 * against is the narrowest directory that can hold a project file — the team's `projects/`. A slug
 * such as `../x` is refused there by `core/paths.js`, through the Vault's `remove`, and not by a
 * string check a link could walk around. After the guard: it must be a slug, the file must exist,
 * and it must parse as `type: project`, so the command cannot be pointed at a note.
 *
 * What it leaves, and reports in `left`: the notes folder `projects/<slug>/` (memory is never
 * deleted), every project file whose `related:` still names the slug (Cortex does not rewrite
 * somebody's file on its own authority), and the connector line in the product repo.
 *
 * @param {string} root  the vault
 * @param {{ team: string, project: string, policy: object }} opts
 */
export function removeProject(root, { team, project, policy }) {
  const vault = openVault(root);
  const base = projectsDir(team);
  if (!vault.isDirectory(base)) {
    throw new ProjectFileRefused("no_team_clone", `no team-brain for '${team}' under this vault (looked for ${base}/). Join it with \`ai-os team add\` first.`);
  }
  const dir = openVault(vault.abs(base));
  const rel = `${project}.md`;

  // The guard first: `isFile` resolves before it answers, so an escaping slug throws here.
  const there = dir.isFile(rel);
  if (!isSlug(project)) throw new ProjectFileRefused("invalid_slug", `${JSON.stringify(String(project).slice(0, 80))} is not a project slug, so nothing was removed`);
  if (!there) throw new ProjectFileRefused("not_found", `no project file at ${base}/${rel}`);
  if (!validateProjectFile(dir.read(rel), { slug: project }).isProject) {
    throw new ProjectFileRefused("not_a_project_file", `${base}/${rel} has no \`type: project\` line, so it is not a project file and was not removed`);
  }

  const clone = teamCloneDir(root, team);
  if (policy.outwardSync) {
    pull(clone);
    if (!dir.isFile(rel)) throw new ProjectFileRefused("not_found", `${base}/${rel} was already removed upstream; the pull brought that in`);
  }

  const path = dir.remove(rel);
  const result = publish(clone, `projects/${project}.md`, `project: remove ${project}`, policy, { remove: true });

  const relatedIn = readTeam(vault, team).files
    .filter((f) => validateProjectFile(f.text, { slug: f.slug }).data.related?.includes(project))
    .map((f) => f.slug)
    .sort();
  return {
    path,
    ...result,
    left: {
      notes: vault.isDirectory(`${base}/${project}`) ? vault.abs(`${base}/${project}`) : null,
      relatedIn,
      connector: `.cortex/connector.json in the product repo still names project '${project}'; edit or delete it there`,
    },
  };
}
