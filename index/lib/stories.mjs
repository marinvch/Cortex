// stories.mjs — a repo's story links: which ticket keys its history names, and the code each touched.
//
// R3 of docs/specs/2026-10-25-role-packs-design.md. The chain is key → commits → files → clusters.
// `cortex-stories.mjs` reads git and the index and hands the result here; this module is a pure
// function of that input, so the same history and index give the same bytes. Publishing is mcp/'s
// (`ai-os stories publish`), as it is for the contract: this package reads a repo and never writes
// into a team-brain.
//
// The rules:
//
// - **Confidence is the evidence, per link.** A key written in a commit's message links that commit
//   as `extracted`. A key found only in a branch name links the branch's commits as `inferred`: the
//   branch said where the work was made, nobody wrote the key on the commit. A commit linked both
//   ways is `extracted`. A file takes the surest confidence of the commits that changed it, and a
//   story the surest of its commits. `core/story-key.js` holds which text counts as which.
// - **Which commits a branch holds is read from git, not guessed.** A merge commit whose subject
//   names a branch holds `first parent..second parent`; a branch ref that still exists holds what is
//   on it and not on the default branch. A branch merged by fast-forward or squash, then deleted,
//   left no trace, and its keys are not here.
// - **A story's code is a floor.** A commit that names no key is invisible to every story, and the
//   window is the last `maxCommits` commits. `note` says so in every output, and a reader must too.
// - **A merge commit changed what it brought in over its first parent.** `git log` lists no files
//   for one, so when its own message names a key, the CLI reads that diff.
// - **Files are the index's.** A path the index does not hold — deleted, renamed, or never indexed —
//   is counted in `gone`, not listed: its cluster and tests cannot be told. Each listed file carries
//   its cluster, whether it is a hub, and `tested` (true, false, or null for a file that needs no
//   test), from the same coverage `findings.mjs` reports, so "untested" means one thing everywhere.
// - **No commit text leaves the repo.** A commit is its short sha and, when it merged one, its PR
//   number. Messages can hold anything, and authors are personal data, so neither is written.

import { isStoryKey } from "../../core/story-key.js";

export const STORY_LINKS_FORMAT = 1;
export const SHA_LEN = 12;
/** What one story carries before the rest is counted. */
export const COMMITS_MAX = 30;
export const FILES_MAX = 100;
/** Stories in one file, most commits first, before the rest are counted. */
export const STORIES_MAX = 2000;

export const FLOOR_NOTE =
  "A floor: a story's code is at least these files. Commits that name no key, branches merged without a " +
  "trace, and commits older than the window are not here.";

const RANK = { extracted: 2, inferred: 1 };
const surer = (a, b) => (RANK[a] >= RANK[b] ? a : b);
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Build the story links.
 *
 * @param {{
 *   commits: Map<string, { sha: string, keys: string[], prs: number[], files: string[] }>,
 *   branches: { branch: string, keys: string[], shas: string[] }[],
 *   index: object,
 *   untested: Set<string>, testable: Set<string>, hubs: Set<string>,
 *   project: string|null, repo: string|null, head: string|null, asOf: string|null,
 *   window: object, unread?: { what: string, why: string }[],
 * }} input
 */
export function buildStoryLinks(input) {
  const { commits, branches, index, untested, testable, hubs } = input;
  const files = new Map((index.files ?? []).map((f) => [f.path, f]));

  // key → sha → confidence
  const links = new Map();
  const link = (key, sha, confidence) => {
    if (!isStoryKey(key) || !commits.has(sha)) return;
    if (!links.has(key)) links.set(key, new Map());
    const m = links.get(key);
    m.set(sha, m.has(sha) ? surer(m.get(sha), confidence) : confidence);
  };
  for (const c of commits.values()) for (const k of c.keys) link(k, c.sha, "extracted");
  for (const b of branches) for (const k of b.keys) for (const sha of b.shas) link(k, sha, "inferred");

  const clustersUsed = new Set();
  const stories = [];
  for (const [key, bySha] of links) {
    const fileConf = new Map();
    let gone = 0;
    const goneSeen = new Set();
    for (const [sha, conf] of bySha) {
      for (const p of commits.get(sha).files) {
        if (!files.has(p)) {
          if (!goneSeen.has(p)) { goneSeen.add(p); gone++; }
          continue;
        }
        fileConf.set(p, fileConf.has(p) ? surer(fileConf.get(p), conf) : conf);
      }
    }
    const commitRows = [...bySha]
      .map(([sha, confidence]) => {
        const c = commits.get(sha);
        const row = { sha: sha.slice(0, SHA_LEN), confidence };
        if (c.prs.length) row.prs = c.prs;
        return row;
      })
      .sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || byCodeUnit(a.sha, b.sha));
    const fileRows = [...fileConf]
      .map(([path, confidence]) => {
        const f = files.get(path);
        const row = { path, confidence, cluster: f.cluster ?? null, hub: hubs.has(path), tested: testable.has(path) ? !untested.has(path) : null };
        if (f.isTest) row.test = true;
        if (row.cluster) clustersUsed.add(row.cluster);
        return row;
      })
      .sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || byCodeUnit(a.path, b.path));
    const confidence = commitRows.some((c) => c.confidence === "extracted") ? "extracted" : "inferred";
    const story = { key, confidence, commits: commitRows.slice(0, COMMITS_MAX), files: fileRows.slice(0, FILES_MAX) };
    if (commitRows.length > COMMITS_MAX) story.moreCommits = commitRows.length - COMMITS_MAX;
    if (fileRows.length > FILES_MAX) story.moreFiles = fileRows.length - FILES_MAX;
    if (gone) story.gone = gone;
    stories.push({ story, weight: commitRows.length });
  }
  stories.sort((a, b) => b.weight - a.weight || byCodeUnit(a.story.key, b.story.key));
  const kept = stories.slice(0, STORIES_MAX).map((s) => s.story).sort((a, b) => byCodeUnit(a.key, b.key));

  const clusters = (index.clusters?.items ?? [])
    .filter((c) => clustersUsed.has(c.id))
    .map((c) => ({ id: c.id, hub: c.hub ?? null, size: c.size ?? (c.files ?? []).length }))
    .sort((a, b) => byCodeUnit(a.id, b.id));

  const out = {
    format: STORY_LINKS_FORMAT,
    project: input.project ?? null,
    repo: input.repo ?? null,
    commit: input.head ?? null,
    asOf: input.asOf ?? null,
    window: input.window,
    note: FLOOR_NOTE,
    stories: kept,
    clusters,
    unread: [...(input.unread ?? [])].sort((a, b) => byCodeUnit(a.what, b.what)),
  };
  if (stories.length > STORIES_MAX) out.moreStories = stories.length - STORIES_MAX;
  return out;
}

export const renderStoryLinksJson = (links) => `${JSON.stringify(links, null, 2)}\n`;

// ---------------------------------------------------------------------------------------------
// Reading git's output
// ---------------------------------------------------------------------------------------------

/** The record separator and field separator the CLI asks `git log` for. */
export const LOG_FORMAT = "%x1e%H%x1f%P%x1f%B%x1f";

/**
 * Parse `git log --format=<LOG_FORMAT> --name-only` into `[{ sha, parents, message, files }]`.
 * A merge commit lists no files: git prints none for it without `-m`, and that is what is wanted,
 * since its changes are the merged commits'.
 */
export function parseLog(text) {
  const out = [];
  for (const rec of String(text ?? "").split("\x1e")) {
    if (!rec.trim()) continue;
    const parts = rec.split("\x1f");
    if (parts.length < 4) continue;
    const [sha, parents, message, rest] = parts;
    const files = rest.split("\n").map((s) => s.trim()).filter(Boolean);
    out.push({ sha: sha.trim(), parents: parents.trim() ? parents.trim().split(/\s+/) : [], message, files });
  }
  return out;
}
