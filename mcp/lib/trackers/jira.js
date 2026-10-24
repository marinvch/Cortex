// Jira Cloud as a tracker (#624): one issue per ask in one project, through REST API v3.
//
// Shapes checked against Atlassian's docs on 2026-10-24:
//   https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/
//     POST /rest/api/3/issue  {fields:{project:{key}, summary, issuetype:{name}, description: ADF, labels}}
//                             → 201 {id, key, self}
//     GET  /rest/api/3/issue/{key}?fields=status,assignee,updated,resolution
//                             → fields.status.statusCategory.key, fields.assignee.displayName, fields.updated
//     GET  /rest/api/3/issue/{key}/transitions → {transitions:[{id, name, to:{statusCategory:{key}}}]}
//     POST /rest/api/3/issue/{key}/transitions {transition:{id}} → 204
//   https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/
//     GET  /rest/api/3/issue/{key}/comment → {startAt, maxResults, total, comments:[{id, author.displayName, body: ADF, created}]}
//     POST /rest/api/3/issue/{key}/comment {body: ADF} → 201
//   https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/
//     GET  /rest/api/3/search/jql?jql=…&fields=…&maxResults=… → {issues:[{id, key}], nextPageToken}
//     (the changelog of 2026-10-08 names /search/jql "the new Search REST API"; the old /search is
//     not used here. The page itself was not readable on the check date, so this shape is verified
//     against the mock only.)
// Comments and descriptions are Atlassian Document Format: text goes out as paragraphs and comes
// back as the text of every text node.
//
// Idempotency: the issue carries the label `cortex-ask-<id>`, looked up with JQL before one is
// created. A label is an exact match; a summary search is tokenised.
//
// Credentials: JIRA_EMAIL + JIRA_API_TOKEN (basic). From the environment only.

import { request, baseUrl, MissingCredential, TrackerError, askMarker, askTag, itemBody } from "./http.js";

export const KIND = "jira";
export const CREDENTIALS = "JIRA_EMAIL and JIRA_API_TOKEN";
export const DEFAULT_WONTFIX = Object.freeze(["Won't Do", "Won't Fix", "Declined", "Duplicate", "Cannot Reproduce"]);

/** Plain text → an ADF document: one paragraph per blank-line-separated block. */
export function toAdf(text) {
  const blocks = String(text ?? "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return {
    type: "doc",
    version: 1,
    content: (blocks.length ? blocks : [""]).map((b) => ({ type: "paragraph", content: b ? [{ type: "text", text: b }] : [] })),
  };
}

/** An ADF document → its text: text nodes joined, a blank line between blocks. */
export function fromAdf(doc) {
  if (typeof doc === "string") return doc;
  const blocks = [];
  const walk = (node, out) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "text" && typeof node.text === "string") out.push(node.text);
    if (node.type === "hardBreak") out.push("\n");
    for (const c of Array.isArray(node.content) ? node.content : []) walk(c, out);
  };
  for (const block of Array.isArray(doc?.content) ? doc.content : []) {
    const out = [];
    walk(block, out);
    blocks.push(out.join(""));
  }
  return blocks.join("\n\n").trim();
}

/** An issue's fields → ask status: done in the `done` category, wontfix when the resolution says so. */
export function mapStatus(fields, wontfix = DEFAULT_WONTFIX) {
  if (fields?.status?.statusCategory?.key !== "done") return "open";
  const r = fields?.resolution?.name;
  return r && wontfix.some((w) => w.toLowerCase() === String(r).toLowerCase()) ? "wontfix" : "answered";
}

const KEY_RE = /^[A-Z][A-Z0-9_]{0,19}-\d+$/;

/**
 * @param {object} entry  `{ kind: "jira", site, project, issueType?, closeTransition?, wontfixResolutions? }`
 * @param {{ env?: object, fetch?: Function, timeoutMs?: number }} io
 */
export function jiraAdapter(entry, io = {}) {
  const site = baseUrl(KIND, entry.site, "site");
  const project = String(entry.project ?? "");
  if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(project)) throw new TrackerError(KIND, "project must be a Jira project key (ACME)", { retryable: false });
  const issueType = entry.issueType ?? "Task";
  const wontfix = entry.wontfixResolutions ?? DEFAULT_WONTFIX;
  const env = io.env ?? {};
  const headers = () => {
    if (!env.JIRA_EMAIL || !env.JIRA_API_TOKEN) throw new MissingCredential(KIND, CREDENTIALS);
    return { Authorization: `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64")}` };
  };
  const call = (method, path, body) => request(KIND, io, method, `${site}${path}`, { headers: headers(), body });
  const checkKey = (key) => {
    if (!KEY_RE.test(String(key))) throw new TrackerError(KIND, `not a Jira issue key: ${key}`, { retryable: false });
    return key;
  };
  const browse = (key) => `${site}/browse/${key}`;

  return {
    kind: KIND,
    async find(ask) {
      const jql = `project = "${project}" AND labels = "${askMarker(ask.id)}"`;
      const res = await call("GET", `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary&maxResults=1`);
      const hit = Array.isArray(res?.issues) ? res.issues[0] : null;
      return hit?.key ? { key: hit.key, url: browse(hit.key) } : null;
    },
    async create(ask) {
      const res = await call("POST", "/rest/api/3/issue", {
        fields: {
          project: { key: project },
          summary: `${askTag(ask.id)} ${ask.title}`,
          issuetype: { name: issueType },
          description: toAdf(itemBody(ask)),
          labels: [askMarker(ask.id)],
        },
      });
      if (!res?.key) throw new TrackerError(KIND, "the create answered with no key");
      return { key: res.key, url: browse(res.key) };
    },
    async read(key) {
      checkKey(key);
      const issue = await call("GET", `/rest/api/3/issue/${key}?fields=status,assignee,updated,resolution`);
      const page = await call("GET", `/rest/api/3/issue/${key}/comment?maxResults=100`);
      const fields = issue?.fields ?? {};
      return {
        status: mapStatus(fields, wontfix),
        state: String(fields.status?.name ?? ""),
        assignee: fields.assignee?.displayName ?? null,
        updatedAt: fields.updated ?? null,
        comments: (Array.isArray(page?.comments) ? page.comments : []).map((c) => ({
          id: String(c.id), author: c.author?.displayName ?? "someone", created: c.created ?? null, text: fromAdf(c.body),
        })),
      };
    },
    async comment(key, text) {
      const c = await call("POST", `/rest/api/3/issue/${checkKey(key)}/comment`, { body: toAdf(text) });
      return { id: c?.id === undefined ? null : String(c.id) };
    },
    async close(key) {
      const { transitions = [] } = (await call("GET", `/rest/api/3/issue/${checkKey(key)}/transitions`)) ?? {};
      const want = entry.closeTransition ? String(entry.closeTransition).toLowerCase() : null;
      const t = want
        ? transitions.find((x) => String(x.name).toLowerCase() === want)
        : transitions.find((x) => x.to?.statusCategory?.key === "done");
      if (!t) throw new TrackerError(KIND, `no transition to a done status on ${key}${want ? ` named '${entry.closeTransition}'` : ""}`, { retryable: false });
      await call("POST", `/rest/api/3/issue/${key}/transitions`, { transition: { id: String(t.id) } });
    },
  };
}
