// graph-stories.js — the `graph` tool's story ops, answered from the team-brain (R4 of
// docs/specs/2026-10-25-role-packs-design.md), and the one entry both adapters call for any op.
//
//   story        one epic or story: its code across the team's repos, the clusters and contracts
//                that code sits in, what no test covers, the hubs it touches, and open asks naming it
//   stories-for  which stories changed a file, a directory or a cluster
//   risk         open stories whose code is untested or a hub
//
// The code ops (stats, node, ...) read this repo's index and live in lib/graph.js. These read three
// things every repo of a team published to the team-brain clone: the story mirror (`stories/`,
// lib/story-file.js), each repo's story links (`projects/<slug>/stories.json`, lib/story-links.js)
// and contracts (`projects/<slug>/contract.json`, lib/contract.js), plus the open asks.
//
// The rules, the code ops' rules carried over:
//
// - **Read-only.** It pulls the clone fast-forward first, as `contract` and `inbox` do, and returns a
//   failed pull in `pull`; it writes nothing.
// - **The freshness refusal.** A repo's links were built from its index at one commit. In a repo,
//   the brain's own project is checked against HEAD: when the code has moved since the links were
//   published, that project's links are refused, never answered from, and `rebuild` gives the two
//   commands. Another repo's cannot be checked from here; each project's `asOf` and `commit` are in
//   `links.projects` so the reader can say how old they are. With no links at all the answer is
//   refused with the same commands.
// - **The path guard.** In a repo every file argument goes through `resolveInRoot`, so `../x` is an
//   `OutsideRootError`. Without a repo there is no root to resolve against, and an absolute path or
//   one with a `..` segment is refused as `outside_root` before anything is read.
// - **Caps.** Every list stops at `LIST_MAX` and carries `total` and `truncated`.
// - **Floors.** A story's code is at least what its links name (lib/stories.mjs in index/), and a
//   contract row names at most five files, so a contract touched only through a sixth is missed.
//   Every answer carries `note`.

import { execFileSync } from "node:child_process";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInRoot } from "../../core/paths.js";
import { isStoryKey } from "../../core/story-key.js";
import { listAsks } from "./ask-file.js";
import { readContracts } from "./contract.js";
import { pull } from "./gitsync.js";
import { GraphRefused, graphAnswer, graphRepo, LIST_MAX, OPS as CODE_OPS } from "./graph.js";
import { readStories } from "./story-file.js";
import { readStoryLinks } from "./story-links.js";
import { ensureTeamClone } from "./team.js";

export const STORY_OPS = ["story", "stories-for", "risk"];
export const ALL_OPS = [...CODE_OPS, ...STORY_OPS];

export const NOTE =
  "A floor: a story's code is at least these files. Commits that name no key, branches merged without a trace, " +
  "repos that have not published story links, and a contract file past the fifth on its row are not here.";

const EXTRACTOR = fileURLToPath(new URL("../../index/cortex-stories.mjs", import.meta.url));
const CLI = fileURLToPath(new URL("../ai-os.js", import.meta.url));
const REBUILD = `node "${EXTRACTOR}" . --out .cortex/index/stories.json, then node "${CLI}" stories publish --file .cortex/index/stories.json, in the repo`;

const RANK = { extracted: 2, inferred: 1 };
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const capped = (list) => ({ items: list.slice(0, LIST_MAX), total: list.length, truncated: list.length > LIST_MAX });

/**
 * Any `graph` op, for both adapters: the code ops from this repo's index, the story ops from the
 * team-brain. `cwd` is where the caller stands; `opts.tracked` reaches the code ops' freshness test.
 */
export function graphFrom(brain, args = {}, { cwd, tracked, git = runGit } = {}) {
  if (!STORY_OPS.includes(args?.op)) return graphAnswer(graphRepo(brain, { cwd }), args, tracked ? { tracked } : {});
  return storyAnswer(brain, args, { git });
}

function runGit(cwd, argv) {
  try {
    return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

/** The question, checked before anything is read. */
function question(brain, args, repo) {
  const op = args.op;
  const given = (k) => typeof args[k] === "string" && args[k].trim() !== "";
  const q = { op };
  if (op === "story") {
    if (!given("key")) throw new GraphRefused("missing_argument", "story needs `key`, a ticket key such as ABC-123, STRY0010001 or owner/repo#45");
    const raw = args.key.trim();
    const key = /^[a-z][a-z0-9_]{1,19}-\d+$/.test(raw) ? raw.toUpperCase() : raw;
    if (!isStoryKey(key)) throw new GraphRefused("bad_key", `${raw.slice(0, 60)} is not a ticket key: ABC-123, STRY0010001, owner/repo#45 or #45`);
    q.key = key;
  }
  if (op === "stories-for") {
    if (!given("file") && !given("cluster")) throw new GraphRefused("missing_argument", "stories-for needs `file` (a path or a directory) or `cluster`");
    if (given("file")) {
      const f = args.file.trim();
      if (repo) {
        const base = resolveInRoot(repo, ".");
        q.file = relative(base, resolveInRoot(repo, f)).split(sep).join("/");
      } else {
        if (/^(?:[\\/]|[A-Za-z]:)/.test(f) || f.split(/[\\/]/).includes("..")) {
          throw new GraphRefused("outside_root", `${f.slice(0, 80)} is not a path inside a repo: give it relative to the repo, with no ..`);
        }
        q.file = f.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
      }
    }
    if (given("cluster")) {
      q.cluster = args.cluster.trim();
      q.project = given("project") ? args.project.trim() : brain.project;
      if (!q.project) throw new GraphRefused("missing_argument", "a cluster id belongs to one repo: pass `project` with `cluster`");
    }
  }
  if (given("project") && !q.project) q.project = args.project.trim();
  return q;
}

/** What the clone holds, loaded once per answer. */
function load(dir) {
  const { stories } = readStories(dir);
  const links = readStoryLinks(dir);
  const contracts = new Map(readContracts(dir).filter((c) => c.contract).map((c) => [c.slug, c.contract]));
  const asks = listAsks(dir).filter((a) => a.meta.status === "open");
  return { stories, links, contracts, asks };
}

/**
 * The freshness check: each project's links, and whether this repo's own are behind its HEAD.
 * Returns `{ usable, projects }`; `usable` holds only links that may be answered from.
 */
function freshness(brain, links, { git }) {
  const repo = brain.isRepo ? dirname(resolve(brain.root)) : null;
  const projects = [];
  const usable = [];
  for (const l of links) {
    if (l.error) {
      projects.push({ project: l.slug, state: "unreadable", error: l.error });
      continue;
    }
    const row = { project: l.slug, asOf: l.links.asOf, commit: l.links.commit ? l.links.commit.slice(0, 12) : null, state: "unchecked" };
    if (repo && l.slug === brain.project && l.links.commit) {
      const n = git(repo, ["rev-list", "--count", `${l.links.commit}..HEAD`]);
      if (n === null) row.state = "unknown";
      else if (Number(n.trim()) > 0) {
        row.state = "stale";
        row.behind = Number(n.trim());
      } else row.state = "fresh";
    }
    projects.push(row);
    if (row.state !== "stale") usable.push(l);
  }
  return { usable, projects };
}

/** One story op. Returns `{ op, pull, links, ... }`, or a refusal shaped like the code ops'. */
export function storyAnswer(brain, args, { git = runGit } = {}) {
  if (!brain) {
    throw new GraphRefused("no_team", `${args.op} reads the team-brain: set CORTEX_ROOT, and join a team with /join-team or name one with CORTEX_TEAM`);
  }
  const repo = brain.isRepo ? dirname(resolve(brain.root)) : null;
  const q = question(brain, args, repo);
  const { dir } = ensureTeamClone(brain, `graph ${q.op}`);
  const pulled = pull(dir, { policy: brain.policy, env: brain.env });
  const pullOut = pulled.ok ? { ok: true } : { ok: false, error: String(pulled.error).trim().split("\n").slice(0, 3).join("\n") };

  const data = load(dir);
  const fresh = freshness(brain, data.links, { git });
  const head = { op: q.op, pull: pullOut, links: { projects: fresh.projects } };
  const stale = fresh.projects.filter((p) => p.state === "stale");
  if (!data.links.length || (!fresh.usable.length && stale.length)) {
    return {
      ...head,
      refused: true,
      message: !data.links.length
        ? "No repo of this team has published story links, so no story can be traced to code yet."
        : `The story links of ${stale.map((p) => p.project).join(", ")} are older than the code (${stale.map((p) => `${p.behind} commit${p.behind === 1 ? "" : "s"} behind`).join(", ")}). Publish them again, then ask again.`,
      rebuild: REBUILD,
    };
  }
  if (stale.length) head.links.refused = stale.map((p) => ({ project: p.project, why: `${p.behind} commit${p.behind === 1 ? "" : "s"} behind HEAD`, rebuild: REBUILD }));
  const answer = HANDLERS[q.op](q, { ...data, links: fresh.usable });
  return { ...head, ...answer, note: NOTE };
}

// ---------------------------------------------------------------------------------------------
// The ops
// ---------------------------------------------------------------------------------------------

const storyBrief = (s) => (s ? { key: s.key, kind: s.kind, title: s.title, status: s.status, ...(s.epic ? { epic: s.epic } : {}) } : null);

/** Every links row for a key, across projects: `[{ project, row, links }]`. A bare `#45` matches any repo's. */
function rowsFor(key, links) {
  const out = [];
  const bare = /^#\d+$/.test(key);
  for (const { slug, links: l } of links) {
    for (const row of l.stories) {
      if (row.key === key || (bare && row.key.endsWith(key))) out.push({ project: slug, row, links: l });
    }
  }
  return out;
}

function story(q, { stories, links, contracts, asks }) {
  const s = stories.get(q.key) ?? null;
  const children = [...stories.values()].filter((c) => c.epic === q.key).sort((a, b) => byCodeUnit(a.key, b.key));
  const keys = [q.key, ...children.map((c) => c.key)];
  const rows = keys.flatMap((k) => rowsFor(k, links).map((r) => ({ ...r, key: k })));
  if (!s && !rows.length) {
    const near = [...new Set([...stories.keys(), ...links.flatMap((l) => l.links.stories.map((r) => r.key))])]
      .filter((k) => k.toLowerCase().includes(q.key.toLowerCase().replace(/^#/, "")))
      .sort(byCodeUnit)
      .slice(0, 5);
    throw new GraphRefused("not_found", `${q.key} is neither a mirrored story nor named in any published story links` + (near.length ? `. Did you mean: ${near.join(", ")}` : ""));
  }

  // One row per project and file, at the surest confidence any key gave it.
  const files = new Map();
  const commits = new Set();
  let gone = 0;
  let moreFiles = 0;
  for (const { project, row, key } of rows) {
    for (const c of row.commits) commits.add(`${project}\n${c.sha}`);
    gone += row.gone ?? 0;
    moreFiles += row.moreFiles ?? 0;
    for (const f of row.files) {
      const id = `${project}\n${f.path}`;
      const was = files.get(id);
      if (!was) files.set(id, { project, ...f, stories: [key] });
      else {
        if (RANK[f.confidence] > RANK[was.confidence]) was.confidence = f.confidence;
        if (!was.stories.includes(key)) was.stories.push(key);
      }
    }
  }
  const fileRows = [...files.values()].sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || byCodeUnit(a.project, b.project) || byCodeUnit(a.path, b.path));

  const clusterInfo = new Map();
  for (const { project, links: l } of rows) for (const c of l.clusters) clusterInfo.set(`${project}\n${c.id}`, c);
  const clusterCount = new Map();
  for (const f of fileRows) if (f.cluster) clusterCount.set(`${f.project}\n${f.cluster}`, (clusterCount.get(`${f.project}\n${f.cluster}`) ?? 0) + 1);
  const clusters = [...clusterCount]
    .map(([id, n]) => {
      const [project, cluster] = id.split("\n");
      const c = clusterInfo.get(id);
      return { project, cluster, files: n, hub: c?.hub ?? null, size: c?.size ?? null };
    })
    .sort((a, b) => b.files - a.files || byCodeUnit(a.project, b.project) || byCodeUnit(a.cluster, b.cluster));

  const touched = new Set(fileRows.map((f) => `${f.project}\n${f.path}`));
  const contractRows = [];
  for (const [project, c] of contracts) {
    for (const side of ["serves", "calls"]) {
      for (const r of c[side]) {
        const hit = (r.files ?? []).filter((p) => touched.has(`${project}\n${p}`));
        if (hit.length) contractRows.push({ project, side, method: r.method, path: r.path, files: hit });
      }
    }
  }
  contractRows.sort((a, b) => byCodeUnit(a.project, b.project) || byCodeUnit(a.side, b.side) || byCodeUnit(a.path, b.path) || byCodeUnit(a.method, b.method));

  const product = fileRows.filter((f) => !f.test);
  const out = {
    key: q.key,
    story: s ? { ...storyBrief(s), state: s.state, assignee: s.assignee, tracker: s.tracker, url: s.url } : null,
    mirrored: Boolean(s),
    children: capped(children.map(storyBrief)),
    projects: [...new Set(rows.map((r) => r.project))].sort(byCodeUnit),
    commits: commits.size,
    files: capped(fileRows.map((f) => ({ project: f.project, path: f.path, confidence: f.confidence, cluster: f.cluster, hub: f.hub, tested: f.tested, ...(f.test ? { test: true } : {}), ...(keys.length > 1 ? { stories: f.stories.sort(byCodeUnit) } : {}) }))),
    clusters: capped(clusters),
    contracts: capped(contractRows),
    untested: capped(product.filter((f) => f.tested === false).map((f) => ({ project: f.project, path: f.path }))),
    hubs: capped(product.filter((f) => f.hub).map((f) => ({ project: f.project, path: f.path }))),
    asks: capped(asksNaming(keys, asks)),
  };
  if (!s) out.mirrorNote = "Not mirrored from a tracker: its title and status are unknown here. The links come from commits and branches only.";
  if (gone) out.gone = gone;
  if (moreFiles) out.moreFiles = moreFiles;
  return out;
}

/** Open asks whose title, question or links name one of `keys`. */
function asksNaming(keys, asks) {
  const out = [];
  for (const a of asks) {
    const hay = [a.meta.title, a.question, ...(a.meta.links ?? []).map((l) => (typeof l === "string" ? l : `${l.key ?? ""} ${l.url ?? ""}`))].join("\n");
    const named = keys.filter((k) => new RegExp(`(?<![A-Za-z0-9_/#-])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`).test(hay));
    if (named.length) out.push({ id: a.meta.id, title: a.meta.title, to: a.meta.to, from: a.meta.from || null, created: a.meta.created, keys: named });
  }
  return out.sort((a, b) => byCodeUnit(String(a.created), String(b.created)) || byCodeUnit(a.id, b.id));
}

function storiesFor(q, { stories, links }) {
  const hits = [];
  for (const { slug, links: l } of links) {
    if (q.project && slug !== q.project) continue;
    for (const row of l.stories) {
      const matched = row.files.filter((f) =>
        q.cluster ? f.cluster === q.cluster : f.path === q.file || f.path.startsWith(`${q.file}/`) || q.file === "" || q.file === ".");
      if (!matched.length) continue;
      const best = matched.some((f) => f.confidence === "extracted") ? "extracted" : "inferred";
      const s = stories.get(row.key);
      hits.push({
        key: row.key, project: slug, confidence: best,
        ...(s ? { title: s.title, status: s.status, kind: s.kind, ...(s.epic ? { epic: s.epic } : {}) } : { mirrored: false }),
        files: matched.map((f) => f.path).sort(byCodeUnit).slice(0, 5),
        ...(matched.length > 5 ? { moreFiles: matched.length - 5 } : {}),
      });
    }
  }
  hits.sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || byCodeUnit(a.key, b.key) || byCodeUnit(a.project, b.project));
  return { ...(q.file !== undefined ? { file: q.file } : { cluster: q.cluster, project: q.project }), stories: capped(hits) };
}

function risk(q, { stories, links }) {
  const rows = [];
  let unmirrored = 0;
  const linkedKeys = new Set(links.flatMap((l) => l.links.stories.map((r) => r.key)));
  for (const k of linkedKeys) if (!stories.has(k)) unmirrored++;
  for (const s of stories.values()) {
    if (s.status === "done" || s.kind === "epic") continue;
    const untested = [];
    const hubs = [];
    for (const { project, row } of rowsFor(s.key, links)) {
      for (const f of row.files) {
        if (f.test) continue;
        if (f.tested === false) untested.push({ project, path: f.path });
        if (f.hub) hubs.push({ project, path: f.path });
      }
    }
    if (!untested.length && !hubs.length) continue;
    const order = (a, b) => byCodeUnit(a.project, b.project) || byCodeUnit(a.path, b.path);
    rows.push({
      key: s.key, title: s.title, status: s.status, ...(s.epic ? { epic: s.epic } : {}),
      untestedCount: untested.length, hubCount: hubs.length,
      untested: untested.sort(order).slice(0, 10), hubs: hubs.sort(order).slice(0, 10),
    });
  }
  rows.sort((a, b) => b.untestedCount + b.hubCount - (a.untestedCount + a.hubCount) || byCodeUnit(a.key, b.key));
  // Each epic, by its open children at risk.
  const epics = new Map();
  for (const r of rows) if (r.epic) epics.set(r.epic, [...(epics.get(r.epic) ?? []), r.key]);
  const epicRows = [...epics]
    .map(([key, keys]) => ({ key, title: stories.get(key)?.title ?? null, storiesAtRisk: keys.length, stories: keys.slice(0, 10) }))
    .sort((a, b) => b.storiesAtRisk - a.storiesAtRisk || byCodeUnit(a.key, b.key));
  void q;
  return {
    stories: capped(rows),
    epics: capped(epicRows),
    unmirrored,
    ...(unmirrored ? { unmirroredNote: "Keys named in commits with no mirrored story have no status here, so they are not ranked. Turn on the story mirror for the tracker (`ai-os integrations add <kind> --stories`)." } : {}),
  };
}

const HANDLERS = { story, "stories-for": storiesFor, risk };
