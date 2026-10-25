// GitHub issues as a tracker (#624): one issue per ask, in the repo that owns the ask's project.
//
// Shapes checked against GitHub's REST docs on 2026-10-24:
//   https://docs.github.com/en/rest/issues/issues        create (POST /repos/{o}/{r}/issues → 201),
//                                                        get, update (PATCH state + state_reason),
//                                                        list (GET /repos/{o}/{r}/issues?state=all&since=)
//   https://docs.github.com/en/rest/issues/comments      list (GET …/issues/{n}/comments?per_page=100),
//                                                        create (POST …/issues/{n}/comments {body} → 201)
//   https://docs.github.com/en/rest/about-the-rest-api/api-versions
//                                                        X-GitHub-Api-Version 2022-11-28: still
//                                                        supported (until 2028-03-10) and the default
// Issue fields read: number, html_url, state, state_reason, assignees[].login, updated_at,
// pull_request (a PR in a list result). Comment fields: id, body, user.login, created_at.
//
// Idempotency: the title carries `[ask:<id>]`. Before creating, the repo's issues updated since
// the ask was created are listed and searched for that tag — the list endpoint, not search, because
// the search index lags a fresh issue and the retry this exists for comes seconds later.
//
// Token: GITHUB_TOKEN, else GH_TOKEN. From the environment only.

import { stamp } from "../../../core/date.js";
import { request, baseUrl, MissingCredential, TrackerError, askTag, itemBody } from "./http.js";

export const KIND = "github";
export const CREDENTIALS = "GITHUB_TOKEN (or GH_TOKEN)";
export const DEFAULT_API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const REPO_RE = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;

/** Issue state → ask status. `state_reason` decides between answered and wontfix. */
export function mapStatus(issue) {
  if (issue?.state !== "closed") return "open";
  return issue.state_reason === "not_planned" || issue.state_reason === "duplicate" ? "wontfix" : "answered";
}

const parseKey = (key) => {
  const m = String(key).match(/^([^/#]+)\/([^/#]+)#(\d+)$/);
  if (!m) throw new TrackerError(KIND, `not a GitHub issue key: ${key}`, { retryable: false });
  return { owner: m[1], repo: m[2], number: m[3] };
};

/**
 * @param {object} entry  the team.json integration: `{ kind: "github", api?, repo? }`
 * @param {{ env?: object, fetch?: Function, timeoutMs?: number }} io
 */
export function githubAdapter(entry, io = {}) {
  const api = baseUrl(KIND, entry.api ?? DEFAULT_API, "api");
  const env = io.env ?? {};
  const headers = () => {
    const token = env.GITHUB_TOKEN || env.GH_TOKEN;
    if (!token) throw new MissingCredential(KIND, CREDENTIALS);
    return { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": API_VERSION, Authorization: `Bearer ${token}` };
  };
  const call = (method, path, body) => request(KIND, io, method, `${api}${path}`, { headers: headers(), body });
  const repoOf = (ask) => {
    const r = ask.target?.repo;
    if (!r || !REPO_RE.test(r)) throw new TrackerError(KIND, `no GitHub repo to file ask ${ask.id} in`, { retryable: false });
    return r;
  };
  const keyOf = (repo, issue) => ({ key: `${repo}#${issue.number}`, url: issue.html_url });

  return {
    kind: KIND,
    /** The issue already filed for this ask, or null. */
    async find(ask) {
      const repo = repoOf(ask);
      // Two days before the ask's local date: `created` is the asker's day, `since` is UTC, and an
      // ask made just after midnight east of Greenwich is still yesterday there.
      const day = Date.parse(`${ask.created}T00:00:00Z`);
      const since = Number.isFinite(day) ? `&since=${stamp(new Date(day - 2 * 86_400_000))}T00:00:00Z` : "";
      const tag = askTag(ask.id);
      for (let page = 1; page <= 3; page++) {
        const list = await call("GET", `/repos/${repo}/issues?state=all&per_page=100&page=${page}${since}`);
        if (!Array.isArray(list)) return null;
        const hit = list.find((i) => !i.pull_request && String(i.title ?? "").includes(tag));
        if (hit) return keyOf(repo, hit);
        if (list.length < 100) return null;
      }
      return null;
    },
    async create(ask) {
      const repo = repoOf(ask);
      const issue = await call("POST", `/repos/${repo}/issues`, { title: `${ask.title} ${askTag(ask.id)}`, body: itemBody(ask) });
      return keyOf(repo, issue);
    },
    async read(key) {
      const { owner, repo, number } = parseKey(key);
      const issue = await call("GET", `/repos/${owner}/${repo}/issues/${number}`);
      const comments = await call("GET", `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`);
      return {
        status: mapStatus(issue),
        state: issue.state_reason ? `${issue.state}/${issue.state_reason}` : String(issue.state),
        assignee: issue.assignees?.[0]?.login ?? issue.assignee?.login ?? null,
        updatedAt: issue.updated_at ?? null,
        comments: (Array.isArray(comments) ? comments : []).map((c) => ({
          id: String(c.id), author: c.user?.login ?? "someone", created: c.created_at ?? null, text: String(c.body ?? ""),
        })),
      };
    },
    async comment(key, text) {
      const { owner, repo, number } = parseKey(key);
      const c = await call("POST", `/repos/${owner}/${repo}/issues/${number}/comments`, { body: text });
      return { id: c?.id === undefined ? null : String(c.id) };
    },
    /**
     * The story mirror's read (lib/stories.js): every open issue in `repos`, and those closed since
     * `closedSince` (YYYY-MM-DD). An issue labelled `epic` is an epic; GitHub gives an issue no
     * parent epic in this list, so `epic` is null. Pull requests and Cortex's own ask issues are
     * left out. At most five pages of 100 per repo and state.
     */
    async stories({ repos = [], closedSince = null } = {}) {
      const out = [];
      for (const repo of repos) {
        if (!REPO_RE.test(repo)) throw new TrackerError(KIND, `not a GitHub repo: ${repo}`, { retryable: false });
        for (const state of ["open", "closed"]) {
          const since = state === "closed" && closedSince ? `&since=${closedSince}T00:00:00Z` : "";
          for (let page = 1; page <= 5; page++) {
            const list = await call("GET", `/repos/${repo}/issues?state=${state}&per_page=100&page=${page}${since}`);
            if (!Array.isArray(list)) break;
            for (const i of list) {
              if (i.pull_request || /\[ask:[0-9a-z-]+\]/.test(String(i.title ?? ""))) continue;
              const epic = (i.labels ?? []).some((l) => String(typeof l === "string" ? l : l?.name ?? "").toLowerCase() === "epic");
              out.push({
                key: `${repo}#${i.number}`,
                kind: epic ? "epic" : "story",
                title: String(i.title ?? ""),
                status: i.state === "closed" ? "done" : "open",
                state: i.state_reason ? `${i.state}/${i.state_reason}` : String(i.state ?? ""),
                assignee: i.assignees?.[0]?.login ?? i.assignee?.login ?? null,
                epic: null,
                url: i.html_url ?? null,
              });
            }
            if (list.length < 100) break;
          }
        }
      }
      return out;
    },
    async close(key, resolution) {
      const { owner, repo, number } = parseKey(key);
      await call("PATCH", `/repos/${owner}/${repo}/issues/${number}`, {
        state: "closed",
        state_reason: resolution === "wontfix" ? "not_planned" : "completed",
      });
    },
  };
}

/**
 * `owner/name` from a project file's `repo` link when it is on this GitHub host, else null. `host`
 * is where the repos are browsed — github.com, or a GitHub Enterprise Server's host (the entry's
 * `host`), which is not the API's host on every install.
 */
export function githubRepoOf(link, host = "github.com") {
  const v = String(link ?? "").trim();
  if (!v || !host) return null;
  const m = v.match(/^(?:https?:\/\/|ssh:\/\/)?(?:[^@/\s]+@)?([^/:\s]+)[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (!m || m[1].toLowerCase() !== host.toLowerCase()) return null;
  const repo = `${m[2]}/${m[3]}`;
  return REPO_RE.test(repo) ? repo : null;
}
