// Story links: which code each ticket key touched, per repo, published to the team-brain as
// `projects/<slug>/stories.json` (R3 of docs/specs/2026-10-25-role-packs-design.md).
//
// `index/cortex-stories.mjs` extracts a repo's links; this module PUBLISHES them and READS them back
// across the team, as lib/contract.js does for a contract. The leaves never import each other: they
// meet in the JSON, and in core/story-key.js, which says what a key is for both.
//
// Publishing:
//   - **Parsed and re-serialised, never copied.** Unknown keys are dropped, every string is capped,
//     a key must be one of the three shapes, and a file path that is absolute or climbs out (`..`) is
//     refused. So a hand-edited file cannot carry a commit message, an author or anything else the
//     extractor never writes.
//   - **The publish gate reads the input text and the text written** (`core/gate.js`): a credential,
//     the employer denylist on `home` — a ticket key the denylist names refuses the whole file — and
//     personal data. It refuses; it never drops the offending story and publishes the rest.
//   - Committed only when the content changed, as `stories: update <slug>`; on `lab` committed and
//     not pushed. Every git call reaching a remote is checked against the profile's destinations
//     in gitsync.js.
//
// Every read and write in the clone goes through the Vault.

import { assertPublished } from "../../core/gate.js";
import { resolveProfile } from "../../core/profile.js";
import { isStoryKey } from "../../core/story-key.js";
import { commitPaths, pull, pushHead, teamCloneDir } from "./gitsync.js";
import { openVault } from "./vault.js";
import { slugify } from "./slug.js";
import { ensureTeamClone } from "./team.js";

export const STORY_LINKS_FORMAT = 1;
const STR_MAX = 300;
const STORIES_MAX = 5_000;
const ROWS_MAX = 1_000;
const CONFIDENCE = new Set(["extracted", "inferred"]);

export class StoryLinksRefused extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StoryLinksRefused";
    this.code = code;
  }
}

const refuse = (why) => {
  throw new StoryLinksRefused("bad_story_links", `not story links Cortex can publish: ${why}`);
};

function text(v, what, { optional = false } = {}) {
  if (v === undefined || v === null) {
    if (optional) return null;
    refuse(`${what} is missing`);
  }
  if (typeof v !== "string") refuse(`${what} is not a string`);
  const s = v.replace(/[\r\n\t]+/g, " ").trim();
  if (s.length > STR_MAX) refuse(`${what} is longer than ${STR_MAX} characters`);
  return s;
}

function relFile(v, what) {
  const s = text(v, what);
  if (/^(?:[\\/]|[A-Za-z]:)/.test(s) || s.split(/[\\/]/).includes("..")) refuse(`${what} is not a path inside the repo`);
  return s.replace(/\\/g, "/");
}

function count(v, what) {
  if (v === undefined || v === null) return 0;
  if (!Number.isInteger(v) || v < 0) refuse(`${what} is not a count`);
  return v;
}

function list(v, what, max = ROWS_MAX) {
  if (v === undefined) return [];
  if (!Array.isArray(v)) refuse(`${what} is not a list`);
  if (v.length > max) refuse(`${what} has more than ${max} rows`);
  return v.map((r, i) => {
    if (r === null || typeof r !== "object" || Array.isArray(r)) refuse(`${what}[${i}] is not an object`);
    return r;
  });
}

function confidence(v, what) {
  if (!CONFIDENCE.has(v)) refuse(`${what} must be extracted or inferred`);
  return v;
}

const clusterId = (v, what) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || !/^c\d{1,6}$/.test(v)) refuse(`${what} is not a cluster id`);
  return v;
};

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Parse story links into their one canonical shape, or throw `StoryLinksRefused`. */
export function parseStoryLinks(input) {
  let doc;
  try {
    doc = JSON.parse(String(input));
  } catch (e) {
    refuse(`not valid JSON (${String(e.message).split("\n")[0]})`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) refuse("the top level is not an object");
  if (doc.format !== STORY_LINKS_FORMAT) refuse(`format is ${JSON.stringify(doc.format ?? null)}, and this Cortex reads ${STORY_LINKS_FORMAT}`);
  const repo = text(doc.repo, "repo", { optional: true });
  if (repo && !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(repo)) refuse("repo is not owner/name");
  const commit = text(doc.commit, "commit", { optional: true });
  if (commit && !/^[0-9a-f]{7,64}$/.test(commit)) refuse("commit is not a commit id");
  const asOf = text(doc.asOf, "asOf", { optional: true });
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) refuse("asOf is not a date");

  const w = doc.window ?? {};
  if (typeof w !== "object" || Array.isArray(w)) refuse("window is not an object");
  const since = text(w.since, "window.since", { optional: true });
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) refuse("window.since is not a date");
  const window = { maxCommits: count(w.maxCommits, "window.maxCommits"), since, commitsRead: count(w.commitsRead, "window.commitsRead"), branchesRead: count(w.branchesRead, "window.branchesRead") };

  const stories = list(doc.stories, "stories", STORIES_MAX).map((s, i) => {
    const at = `stories[${i}]`;
    const key = text(s.key, `${at}.key`);
    if (!isStoryKey(key)) refuse(`${at}.key is not a ticket key`);
    const commits = list(s.commits, `${at}.commits`).map((c, j) => {
      const sha = text(c.sha, `${at}.commits[${j}].sha`);
      if (!/^[0-9a-f]{7,64}$/.test(sha)) refuse(`${at}.commits[${j}].sha is not a commit id`);
      const row = { sha, confidence: confidence(c.confidence, `${at}.commits[${j}].confidence`) };
      if (c.prs !== undefined) {
        if (!Array.isArray(c.prs) || c.prs.some((n) => !Number.isInteger(n) || n < 1)) refuse(`${at}.commits[${j}].prs is not a list of numbers`);
        if (c.prs.length) row.prs = [...new Set(c.prs)].sort((a, b) => a - b);
      }
      return row;
    }).sort((a, b) => byCodeUnit(a.sha, b.sha));
    const files = list(s.files, `${at}.files`).map((f, j) => {
      const fw = `${at}.files[${j}]`;
      const row = {
        path: relFile(f.path, `${fw}.path`),
        confidence: confidence(f.confidence, `${fw}.confidence`),
        cluster: clusterId(f.cluster, `${fw}.cluster`),
        hub: f.hub === true,
        tested: f.tested === true ? true : f.tested === false ? false : null,
      };
      if (f.test === true) row.test = true;
      return row;
    }).sort((a, b) => byCodeUnit(a.path, b.path));
    const out = { key, confidence: confidence(s.confidence, `${at}.confidence`), commits, files };
    for (const k of ["moreCommits", "moreFiles", "gone"]) {
      const n = count(s[k], `${at}.${k}`);
      if (n) out[k] = n;
    }
    return out;
  }).sort((a, b) => byCodeUnit(a.key, b.key));

  const clusters = list(doc.clusters, "clusters").map((c, i) => ({
    id: clusterId(c.id, `clusters[${i}].id`) ?? refuse(`clusters[${i}].id is missing`),
    hub: c.hub === null || c.hub === undefined ? null : relFile(c.hub, `clusters[${i}].hub`),
    size: count(c.size, `clusters[${i}].size`),
  })).sort((a, b) => byCodeUnit(a.id, b.id));

  const unread = list(doc.unread, "unread")
    .map((r, i) => ({ what: text(r.what, `unread[${i}].what`), why: text(r.why, `unread[${i}].why`) }))
    .sort((a, b) => byCodeUnit(a.what, b.what) || byCodeUnit(a.why, b.why));

  return {
    format: STORY_LINKS_FORMAT, project: null, repo, commit, asOf, window,
    note: "A floor: a story's code is at least these files. Commits that name no key, and commits older than the window, are not here.",
    stories, clusters, unread,
  };
}

export const renderStoryLinks = (l) => `${JSON.stringify(l, null, 2)}\n`;

const linksRel = (slug) => `projects/${slug}/stories.json`;
const lf = (s) => String(s).replace(/\r\n/g, "\n");

/**
 * Write a project's story links into the team-brain clone, then commit and push them, only when the
 * content changed. Throws `StoryLinksRefused` for malformed links and a `RefusedWriteError` for links
 * the publish gate refuses; in both cases nothing is written.
 */
export function publishStoryLinks(clone, { slug, input, policy, env = process.env }) {
  const s = slugify(slug ?? "");
  if (!s) throw new StoryLinksRefused("no_project", "story links need a project slug: pass --project, or run it in a repo joined with /join-team");
  const pol = policy ?? resolveProfile({ env }).policy;
  const gate = { policy: pol, env };
  // The gate on the text as given, then on the text written.
  const first = assertPublished(String(input), gate);
  const links = { ...parseStoryLinks(input), project: s };
  const json = renderStoryLinks(links);
  const second = assertPublished(json, gate);
  const warnings = [...new Set([...first.warnings, ...second.warnings])];

  if (pol.outwardSync) pull(clone, gate);
  const vault = openVault(clone);
  const rel = linksRel(s);
  const existed = vault.isFile(rel);
  const base = { project: s, path: vault.abs(rel), stories: links.stories.length, ...(warnings.length ? { warnings } : {}) };
  if (existed && lf(vault.read(rel)) === json) return { ...base, action: "unchanged", committed: false, pushed: false };
  vault.write(rel, json);
  const c = commitPaths(clone, [rel], `stories: update ${s}`);
  if (!c.ok) return { ...base, action: existed ? "updated" : "created", committed: false, pushed: false, error: c.error };
  if (!c.committed) return { ...base, action: existed ? "updated" : "created", committed: false, pushed: false };
  if (!pol.outwardSync) return { ...base, action: existed ? "updated" : "created", committed: true, pushed: false, error: "outward_sync_disabled" };
  const p = pushHead(clone, gate);
  return { ...base, action: existed ? "updated" : "created", committed: true, pushed: p.ok, ...(p.ok ? {} : { error: p.error }) };
}

/** Every project's published links: `{ slug, links }` or `{ slug, error }`, by slug. */
export function readStoryLinks(clone) {
  const vault = openVault(clone);
  const out = [];
  if (!vault.isDirectory("projects")) return out;
  for (const e of vault.entries("projects", { ignore: false })) {
    if (!e.isDirectory || e.name.startsWith(".")) continue;
    const rel = linksRel(e.name);
    if (!vault.isFile(rel)) continue;
    try {
      out.push({ slug: e.name, links: { ...parseStoryLinks(vault.read(rel)), project: e.name } });
    } catch (err) {
      out.push({ slug: e.name, error: err.message });
    }
  }
  return out.sort((a, b) => byCodeUnit(a.slug, b.slug));
}

/**
 * `ai-os stories publish`: the project is the one asked for, else the file's own, else the
 * connector's. `team` overrides the connector's team, for a lead standing in the vault.
 */
export function publishStoryLinksFrom(brain, { input, project = null, team = null }) {
  let fromFile = null;
  try {
    fromFile = JSON.parse(String(input))?.project ?? null;
  } catch {
    fromFile = null; // parseStoryLinks says what is wrong with it
  }
  const slug = project ?? (typeof fromFile === "string" ? fromFile : null) ?? brain.project;
  const target = team && team !== brain.team ? { ...brain, team, teamClone: teamCloneDir(brain.root, team), teamBrainRepo: null } : brain;
  const { dir } = ensureTeamClone(target, "stories publish");
  return publishStoryLinks(dir, { slug, input, policy: brain.policy, env: brain.env });
}
