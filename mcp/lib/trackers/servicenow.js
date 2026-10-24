// ServiceNow as a tracker (#624): one record per ask in a configurable table — `rm_story`
// (Agile Development) by default — through the REST Table API.
//
// Shapes checked against ServiceNow's docs on 2026-10-24:
//   https://www.servicenow.com/docs/bundle/zurich-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html
//     POST  /api/now/table/{table}            insert one record → 201 {result:{…}}
//     GET   /api/now/table/{table}?sysparm_query=…&sysparm_fields=…&sysparm_limit=…  → 200 {result:[…]}
//     GET   /api/now/table/{table}/{sys_id}?sysparm_display_value=all → 200 {result:{…}}
//     PATCH /api/now/table/{table}/{sys_id}   update the fields sent → 200 {result:{…}}
//   With sysparm_display_value=all every field is `{ value, display_value }`; without it, a plain
//   value (a reference field `{ link, value }`). Both are read.
// Journal fields (`work_notes`, `comments`) are written by PATCHing the field with the new entry's
// text; the docs page above shows the field in a PATCH body. Entries are READ from the
// `sys_journal_field` table (element_id = the record's sys_id, element = the field name, value,
// sys_created_by, sys_created_on). That table's columns are the platform's, and the Table API page
// does not list them: this half is verified against the mock only, and `journalTable` is
// configurable for an instance that restricts it.
//
// Instances customise both the table and the fields, so every name below is a default that
// team.json's entry may override (`fields`, `states`, `closeState`, `wontfixState`).
//
// Idempotency: `correlation_id` (a field every task-derived table has) carries `cortex-ask-<id>`;
// the record is looked up by it before one is inserted.
//
// Credentials: SERVICENOW_TOKEN (an OAuth bearer token), else SERVICENOW_USER + SERVICENOW_PASSWORD
// (basic). From the environment only.

import { request, baseUrl, MissingCredential, TrackerError, askMarker, askTag, itemBody } from "./http.js";

export const KIND = "servicenow";
export const CREDENTIALS = "SERVICENOW_TOKEN, or SERVICENOW_USER and SERVICENOW_PASSWORD";

export const DEFAULT_FIELDS = Object.freeze({
  title: "short_description",
  body: "description",
  group: "assignment_group",
  marker: "correlation_id",
  state: "state",
  assignee: "assigned_to",
  updated: "sys_updated_on",
  comments: "work_notes",
});
/** Task-table state values → ask status. Anything not listed is `open`. */
export const DEFAULT_STATES = Object.freeze({ 3: "answered", 4: "wontfix", 7: "wontfix" });
const NAME_RE = /^[a-z][a-z0-9_]{0,79}$/;

const val = (x) => (x && typeof x === "object" ? x.value ?? "" : x ?? "");
const disp = (x) => (x && typeof x === "object" ? x.display_value ?? x.value ?? "" : x ?? "");

/**
 * @param {object} entry  `{ kind: "servicenow", instance, table?, group?, groups?, fields?, states?, closeState?, wontfixState?, journalTable? }`
 * @param {{ env?: object, fetch?: Function, timeoutMs?: number }} io
 */
export function servicenowAdapter(entry, io = {}) {
  const instance = baseUrl(KIND, entry.instance, "instance");
  const table = entry.table ?? "rm_story";
  const journal = entry.journalTable ?? "sys_journal_field";
  const f = { ...DEFAULT_FIELDS, ...(entry.fields ?? {}) };
  for (const n of [table, journal, ...Object.values(f)]) {
    if (!NAME_RE.test(n)) throw new TrackerError(KIND, `'${n}' is not a table or field name`, { retryable: false });
  }
  const states = { ...DEFAULT_STATES, ...(entry.states ?? {}) };
  const closeState = String(entry.closeState ?? "3");
  const wontfixState = String(entry.wontfixState ?? "4");
  const env = io.env ?? {};
  const headers = () => {
    if (env.SERVICENOW_TOKEN) return { Authorization: `Bearer ${env.SERVICENOW_TOKEN}` };
    if (env.SERVICENOW_USER && env.SERVICENOW_PASSWORD) {
      return { Authorization: `Basic ${Buffer.from(`${env.SERVICENOW_USER}:${env.SERVICENOW_PASSWORD}`).toString("base64")}` };
    }
    throw new MissingCredential(KIND, CREDENTIALS);
  };
  const call = (method, path, body) => request(KIND, io, method, `${instance}${path}`, { headers: headers(), body });
  const recordUrl = (sysId) => `${instance}/${table}.do?sys_id=${sysId}`;
  const q = (s) => encodeURIComponent(s);
  const checkKey = (key) => {
    if (!/^[0-9a-f]{32}$/i.test(String(key))) throw new TrackerError(KIND, `not a sys_id: ${key}`, { retryable: false });
    return key;
  };

  return {
    kind: KIND,
    async find(ask) {
      const res = await call("GET", `/api/now/table/${table}?sysparm_query=${q(`${f.marker}=${askMarker(ask.id)}`)}&sysparm_fields=sys_id&sysparm_limit=1`);
      const hit = Array.isArray(res?.result) ? res.result[0] : null;
      return hit?.sys_id ? { key: hit.sys_id, url: recordUrl(hit.sys_id) } : null;
    },
    async create(ask) {
      const body = { [f.title]: `${askTag(ask.id)} ${ask.title}`, [f.body]: itemBody(ask), [f.marker]: askMarker(ask.id) };
      if (ask.target?.group) body[f.group] = ask.target.group;
      const res = await call("POST", `/api/now/table/${table}?sysparm_fields=sys_id,number`, body);
      const sysId = res?.result?.sys_id;
      if (!sysId) throw new TrackerError(KIND, "the insert answered with no sys_id");
      return { key: sysId, url: recordUrl(sysId) };
    },
    async read(key) {
      checkKey(key);
      const fields = [f.state, f.assignee, f.updated].join(",");
      const rec = (await call("GET", `/api/now/table/${table}/${key}?sysparm_fields=${fields}&sysparm_display_value=all`))?.result ?? {};
      const state = String(val(rec[f.state]));
      const journalQuery = `element_id=${key}^element=${f.comments}^ORDERBYsys_created_on`;
      const rows = (await call("GET", `/api/now/table/${journal}?sysparm_query=${q(journalQuery)}&sysparm_fields=sys_id,value,sys_created_by,sys_created_on&sysparm_limit=200`))?.result;
      return {
        status: states[state] ?? "open",
        state: String(disp(rec[f.state]) || state),
        assignee: String(disp(rec[f.assignee])) || null,
        updatedAt: String(val(rec[f.updated])) || null,
        comments: (Array.isArray(rows) ? rows : []).map((r) => ({
          id: String(val(r.sys_id)), author: String(val(r.sys_created_by)) || "someone", created: String(val(r.sys_created_on)) || null, text: String(val(r.value)),
        })),
      };
    },
    async comment(key, text) {
      await call("PATCH", `/api/now/table/${table}/${checkKey(key)}?sysparm_fields=sys_id`, { [f.comments]: text });
      return { id: null };
    },
    async close(key, resolution) {
      await call("PATCH", `/api/now/table/${table}/${checkKey(key)}?sysparm_fields=sys_id`, {
        [f.state]: resolution === "wontfix" ? wontfixState : closeState,
      });
    },
  };
}
