// Local `node:http` servers that play GitHub, ServiceNow and Jira (#624, design R20).
//
// Each one implements the slice of the vendor's REST API an adapter calls, in the documented
// request and response shapes (the adapter headers cite the pages and the date), keeps its items
// in memory, and records every request — method, path, headers, body — so a test can assert what
// was sent as well as what came back. No test in this repo reaches a real tracker.
//
// `npm test` is a bare `node --test`, which runs this file too; it defines no test, so that is a
// no-op.

import { createServer } from "node:http";

function start(handle) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => { raw += d; });
    req.on("end", async () => {
      const url = new URL(req.url, "http://127.0.0.1");
      let body;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
      const rec = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body };
      requests.push(rec);
      const send = (status, json) => {
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(json === undefined ? "" : JSON.stringify(json));
      };
      try { await handle(rec, send); } catch (e) { send(500, { message: String(e.message) }); }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        /** Requests that changed something on the tracker. */
        writes: () => requests.filter((r) => r.method !== "GET"),
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GitHub issues and comments. `opts.createDelayMs` makes POST /issues store the issue and answer
 * late — a client with a shorter timeout sees a timeout for a call that did succeed.
 */
export async function mockGitHub(opts = {}) {
  const issues = [];
  let commentId = 1000;
  const state = { createDelayMs: opts.createDelayMs ?? 0 };
  const m = await start(async (r, send) => {
    if (!/^Bearer \S+$/.test(r.headers.authorization ?? "")) return send(401, { message: "Requires authentication" });
    const repoM = r.path.match(/^\/repos\/([^/]+)\/([^/]+)\/issues(?:\/(\d+))?(\/comments)?$/);
    if (!repoM) return send(404, { message: "Not Found" });
    const [, owner, repo, num, comments] = repoM;
    const full = `${owner}/${repo}`;
    const issue = num ? issues.find((i) => i.repo === full && i.number === Number(num)) : null;
    if (num && !issue) return send(404, { message: "Not Found" });
    if (!num && r.method === "GET") {
      const since = r.query.since ? Date.parse(r.query.since) : 0;
      return send(200, issues.filter((i) => i.repo === full && Date.parse(i.updated_at) >= since).map(publicIssue));
    }
    if (!num && r.method === "POST") {
      if (typeof r.body?.title !== "string") return send(422, { message: "Validation Failed" });
      const number = issues.filter((i) => i.repo === full).length + 1;
      const now = new Date().toISOString();
      const created = {
        repo: full, number, title: r.body.title, body: r.body.body ?? null, state: "open", state_reason: null,
        assignees: [], updated_at: now, html_url: `https://github.com/${full}/issues/${number}`, comments: [],
      };
      issues.push(created);
      if (state.createDelayMs) await sleep(state.createDelayMs);
      return send(201, publicIssue(created));
    }
    if (comments && r.method === "GET") return send(200, issue.comments);
    if (comments && r.method === "POST") {
      if (typeof r.body?.body !== "string") return send(422, { message: "Validation Failed" });
      const c = { id: ++commentId, body: r.body.body, user: { login: "cortex-bot" }, created_at: new Date().toISOString(), html_url: `${issue.html_url}#issuecomment-${commentId}` };
      issue.comments.push(c);
      issue.updated_at = c.created_at;
      return send(201, c);
    }
    if (r.method === "GET") return send(200, publicIssue(issue));
    if (r.method === "PATCH") {
      if (r.body.state) issue.state = r.body.state;
      if ("state_reason" in r.body) issue.state_reason = r.body.state_reason;
      issue.updated_at = new Date().toISOString();
      return send(200, publicIssue(issue));
    }
    return send(405, { message: "Method Not Allowed" });
  });
  const publicIssue = (i) => {
    const { repo, comments, ...rest } = i;
    return { ...rest, comments: comments.length };
  };
  return {
    ...m,
    issues,
    state,
    /** A person comments on the issue in GitHub. */
    humanComment(repo, number, login, body) {
      const i = issues.find((x) => x.repo === repo && x.number === number);
      i.comments.push({ id: ++commentId, body, user: { login }, created_at: new Date().toISOString() });
    },
  };
}

/** The ServiceNow Table API over one table, plus `sys_journal_field` for its work notes. */
export async function mockServiceNow({ table = "rm_story" } = {}) {
  const records = [];
  const journal = [];
  let seq = 0;
  const sysId = () => (++seq).toString(16).padStart(32, "a");
  const field = (rec, name, display) => {
    const v = rec[name] ?? "";
    return display ? { value: v, display_value: name === "state" ? STATES[v] ?? v : name === "assigned_to" ? rec.assigned_to_name ?? "" : v } : v;
  };
  const m = await start(async (r, send) => {
    if (!/^(Bearer|Basic) \S+$/.test(r.headers.authorization ?? "")) return send(401, { error: { message: "User Not Authenticated" } });
    if (r.path === "/api/now/table/sys_journal_field" && r.method === "GET") {
      const q = r.query.sysparm_query ?? "";
      const el = q.match(/element_id=([0-9a-f]+)/)?.[1];
      const name = q.match(/\^element=([a-z_]+)/)?.[1];
      return send(200, { result: journal.filter((j) => j.element_id === el && j.element === name) });
    }
    const m2 = r.path.match(/^\/api\/now\/table\/([a-z_]+)(?:\/([0-9a-f]{32}))?$/);
    if (!m2 || m2[1] !== table) return send(400, { error: { message: "Invalid table" } });
    const id = m2[2];
    const rec = id ? records.find((x) => x.sys_id === id) : null;
    if (id && !rec) return send(404, { error: { message: "No Record found" } });
    if (!id && r.method === "GET") {
      const corr = (r.query.sysparm_query ?? "").match(/^correlation_id=(.+)$/)?.[1];
      return send(200, { result: records.filter((x) => !corr || x.correlation_id === corr).map((x) => ({ sys_id: x.sys_id })) });
    }
    if (!id && r.method === "POST") {
      const created = { sys_id: sysId(), number: `STRY00${10 + records.length}`, state: "1", assigned_to: "", ...r.body, sys_updated_on: "2026-10-24 10:00:00" };
      records.push(created);
      return send(201, { result: { sys_id: created.sys_id, number: created.number } });
    }
    if (r.method === "GET") {
      const display = r.query.sysparm_display_value === "all";
      const fields = (r.query.sysparm_fields ?? "state,assigned_to,sys_updated_on").split(",");
      return send(200, { result: Object.fromEntries(fields.map((f) => [f, field(rec, f, display)])) });
    }
    if (r.method === "PATCH") {
      for (const [k, v] of Object.entries(r.body ?? {})) {
        if (k === "work_notes" || k === "comments") journal.push({ sys_id: sysId(), element_id: rec.sys_id, element: k, value: v, sys_created_by: "cortex.integration", sys_created_on: "2026-10-24 10:05:00" });
        else rec[k] = v;
      }
      return send(200, { result: { sys_id: rec.sys_id } });
    }
    return send(405, { error: { message: "Method not allowed" } });
  });
  return {
    ...m,
    records,
    journal,
    /** A person closes the story in ServiceNow. */
    closeAsHuman(sys, who = "Jane Doe") {
      const rec = records.find((x) => x.sys_id === sys);
      rec.state = "3";
      rec.assigned_to = "6816f79cc0a8016401c5a33be04be441";
      rec.assigned_to_name = who;
    },
    humanNote(sys, who, value) {
      journal.push({ sys_id: sysId(), element_id: sys, element: "work_notes", value, sys_created_by: who, sys_created_on: "2026-10-24 11:00:00" });
    },
  };
}
const STATES = { "-6": "Draft", 1: "Ready", 2: "Work in progress", 3: "Complete", 4: "Cancelled" };

/** Jira Cloud REST v3: issues, JQL search by label, comments in ADF, transitions. */
export async function mockJira({ project = "ACME" } = {}) {
  const issues = [];
  let cid = 500;
  const TRANSITIONS = [
    { id: "11", name: "To Do", to: { name: "To Do", statusCategory: { key: "new" } } },
    { id: "21", name: "In Progress", to: { name: "In Progress", statusCategory: { key: "indeterminate" } } },
    { id: "31", name: "Done", to: { name: "Done", statusCategory: { key: "done" } } },
  ];
  const m = await start(async (r, send) => {
    if (!/^Basic \S+$/.test(r.headers.authorization ?? "")) return send(401, { errorMessages: ["Unauthorized"] });
    if (r.path === "/rest/api/3/search/jql" && r.method === "GET") {
      const label = (r.query.jql ?? "").match(/labels = "([^"]+)"/)?.[1];
      return send(200, { issues: issues.filter((i) => i.labels.includes(label)).map((i) => ({ id: i.id, key: i.key })) });
    }
    if (r.path === "/rest/api/3/issue" && r.method === "POST") {
      const f = r.body?.fields ?? {};
      if (f.project?.key !== project || !f.summary || f.description?.type !== "doc") return send(400, { errorMessages: ["bad fields"] });
      const n = issues.length + 1;
      const issue = { id: String(10000 + n), key: `${project}-${n}`, summary: f.summary, labels: f.labels ?? [], status: TRANSITIONS[0].to, assignee: null, resolution: null, comments: [] };
      issues.push(issue);
      return send(201, { id: issue.id, key: issue.key, self: `${m.url}/rest/api/3/issue/${issue.id}` });
    }
    const im = r.path.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)(\/comment|\/transitions)?$/);
    const issue = im ? issues.find((i) => i.key === im[1]) : null;
    if (!issue) return send(404, { errorMessages: ["Issue does not exist"] });
    if (!im[2] && r.method === "GET") {
      return send(200, { key: issue.key, fields: { status: issue.status, assignee: issue.assignee, updated: "2026-10-24T10:00:00.000+0000", resolution: issue.resolution } });
    }
    if (im[2] === "/comment" && r.method === "GET") return send(200, { startAt: 0, maxResults: 100, total: issue.comments.length, comments: issue.comments });
    if (im[2] === "/comment" && r.method === "POST") {
      if (r.body?.body?.type !== "doc") return send(400, { errorMessages: ["body must be ADF"] });
      const c = { id: String(++cid), author: { displayName: "Cortex Bot" }, body: r.body.body, created: "2026-10-24T10:01:00.000+0000" };
      issue.comments.push(c);
      return send(201, c);
    }
    if (im[2] === "/transitions" && r.method === "GET") return send(200, { transitions: TRANSITIONS });
    if (im[2] === "/transitions" && r.method === "POST") {
      const t = TRANSITIONS.find((x) => x.id === r.body?.transition?.id);
      if (!t) return send(400, { errorMessages: ["bad transition"] });
      issue.status = t.to;
      if (t.to.statusCategory.key === "done") issue.resolution = { name: "Done" };
      return send(204);
    }
    return send(405, { errorMessages: ["Method not allowed"] });
  });
  return { ...m, issues };
}
