// Which trackers a team-brain is connected to (#624, design R17): `team.json → integrations`.
//
//   {
//     "integrations": [
//       { "kind": "github", "repo": "acme/backlog" },
//       { "kind": "servicenow", "instance": "https://acme.service-now.com", "table": "rm_story",
//         "groups": { "backend": "Backend Team" } },
//       { "kind": "jira", "site": "https://acme.atlassian.net", "project": "ACME", "issueType": "Story" }
//     ],
//     "primary": "servicenow",
//     "routes": { "gateway": "github", "backend": ["servicenow", "github"] }
//   }
//
// - None, one or several. With none, nothing in Cortex touches the network but git (R19).
// - `primary` is the tracker whose status wins. Unset, it is the agile tracker if one is selected
//   (ServiceNow, then Jira), otherwise GitHub.
// - `routes` narrows the trackers an ask goes to by its addressee — a role or a project. An
//   addressee with no route goes to every selected tracker.
// - **No credential is ever here.** team.json is committed and pushed to every member, so a
//   credential-shaped value or a key named like one is refused, not stripped. Credentials come from
//   the environment, and each adapter names its variable.
//
// The whole file is read and written through the Vault opened on the team-brain clone.

import { scan } from "../../core/scrub.js";
import { openVault } from "./vault.js";
import { TEAM_JSON } from "./team.js";
import { githubAdapter, CREDENTIALS as GITHUB_CREDS } from "./trackers/github.js";
import { servicenowAdapter, CREDENTIALS as SERVICENOW_CREDS } from "./trackers/servicenow.js";
import { jiraAdapter, CREDENTIALS as JIRA_CREDS } from "./trackers/jira.js";

export const KINDS = Object.freeze(["github", "servicenow", "jira"]);
/** The trackers a team plans sprints in; one of them is primary by default when selected. */
const AGILE = ["servicenow", "jira"];

const ADAPTERS = { github: githubAdapter, servicenow: servicenowAdapter, jira: jiraAdapter };
/** The variables each tracker reads, as a sentence and as names, for `integrations list` and errors. */
export const CREDENTIAL_VARS = Object.freeze({
  github: { text: GITHUB_CREDS, any: [["GITHUB_TOKEN"], ["GH_TOKEN"]] },
  servicenow: { text: SERVICENOW_CREDS, any: [["SERVICENOW_TOKEN"], ["SERVICENOW_USER", "SERVICENOW_PASSWORD"]] },
  jira: { text: JIRA_CREDS, any: [["JIRA_EMAIL", "JIRA_API_TOKEN"]] },
});

// What each kind's entry may hold. Anything else is refused: an unknown key is either a typo that
// would be silently ignored or somewhere a credential was about to be put.
//
// `stories: true` turns on the story mirror for that tracker (R3 of the role-packs design,
// lib/stories.js): its epics and stories are written to `stories/<key>.md` on each full sync. Off
// unless set, because a tracker that only receives asks is not where the team plans.
const SHAPE = {
  github: { api: "url", host: "host", repo: "repo", stories: "bool" },
  servicenow: {
    instance: "url!", table: "name", journalTable: "name", group: "text", groups: "map",
    fields: "map", states: "map", closeState: "text", wontfixState: "text", stories: "bool", epicTable: "name",
  },
  jira: { site: "url!", project: "jirakey!", issueType: "text", closeTransition: "text", wontfixResolutions: "list", stories: "bool", storyTypes: "names" },
};

/** A key whose NAME says it holds a secret. Refused anywhere in the integrations, at any depth. */
const SECRET_KEY = /token|password|passwd|secret|credential|api[_-]?key|apikey|auth/i;

export class IntegrationError extends Error {
  constructor(message) {
    super(message);
    this.name = "IntegrationError";
    this.code = "invalid_integration";
  }
}

function checkValue(kind, key, type, v) {
  const where = `integrations.${kind}.${key}`;
  const isText = (x) => typeof x === "string" && x.length > 0 && x.length <= 200 && !/[\u0000-\u001f]/.test(x);
  switch (type.replace(/!$/, "")) {
    case "url":
      // http only on a loopback host: the tests' mock servers. A tracker on the network is https.
      if (!isText(v) || !/^(?:https:\/\/[^\s/@?#]+|http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)(\/[^\s?#@]*)?$/i.test(v)) {
        throw new IntegrationError(`${where} must be a plain https:// URL with no user, query or fragment`);
      }
      return v.replace(/\/+$/, "");
    case "host":
      if (!isText(v) || !/^[a-z0-9](?:[a-z0-9.-]{0,252})$/i.test(v)) throw new IntegrationError(`${where} must be a host name (github.example.com)`);
      return v.toLowerCase();
    case "repo":
      if (!isText(v) || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/.test(v)) throw new IntegrationError(`${where} must be owner/name`);
      return v;
    case "name":
      if (!isText(v) || !/^[a-z][a-z0-9_]{0,79}$/.test(v)) throw new IntegrationError(`${where} must be a table name (a-z, 0-9, _)`);
      return v;
    case "jirakey":
      if (!isText(v) || !/^[A-Z][A-Z0-9_]{0,19}$/.test(v)) throw new IntegrationError(`${where} must be a Jira project key (ACME)`);
      return v;
    case "text":
      if (!isText(String(v ?? "")) || (typeof v !== "string" && typeof v !== "number")) throw new IntegrationError(`${where} must be a short line of text`);
      return String(v);
    case "map": {
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new IntegrationError(`${where} must be an object of names to values`);
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(k) || !isText(String(x ?? "")) || typeof x === "object") throw new IntegrationError(`${where}.${k} must be a short line of text`);
        out[k] = String(x);
      }
      return out;
    }
    case "list":
      if (!Array.isArray(v) || v.some((x) => !isText(x))) throw new IntegrationError(`${where} must be a list of short lines`);
      return [...v];
    case "names":
      // Quoted into a JQL query, so a quote or a backslash would end the string early.
      if (!Array.isArray(v) || !v.length || v.some((x) => !isText(x) || /["\\]/.test(x))) {
        throw new IntegrationError(`${where} must be a list of names, with no quote or backslash`);
      }
      return [...v];
    case "bool":
      if (typeof v !== "boolean") throw new IntegrationError(`${where} must be true or false`);
      return v;
    default:
      throw new IntegrationError(`${where}: unknown field type`);
  }
}

function secretKeys(value, path = []) {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(SECRET_KEY.test(k) && !Array.isArray(value) ? [[...path, k].join(".")] : []),
    ...secretKeys(v, [...path, k]),
  ]);
}

/**
 * One integration entry, normalised, or `IntegrationError`. Never repeats a value in the message:
 * the value may be the credential that was refused.
 */
export function checkIntegration(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new IntegrationError("an integration is not an object");
  const kind = raw.kind;
  if (!KINDS.includes(kind)) throw new IntegrationError(`integration kind must be one of ${KINDS.join(", ")}`);
  const named = secretKeys(raw);
  if (named.length) {
    throw new IntegrationError(
      `integrations.${kind} has a field named like a credential (${named.join(", ")}). Credentials never go in team.json — set ${CREDENTIAL_VARS[kind].text} in the environment.`,
    );
  }
  const found = scan(JSON.stringify(raw));
  if (found.length) {
    throw new IntegrationError(
      `integrations.${kind} carries a ${[...new Set(found.map((f) => f.kind))].join(", ")}. Credentials never go in team.json — set ${CREDENTIAL_VARS[kind].text} in the environment.`,
    );
  }
  const shape = SHAPE[kind];
  const out = { kind };
  for (const [k, v] of Object.entries(raw)) {
    if (k === "kind") continue;
    if (!shape[k]) throw new IntegrationError(`integrations.${kind} has an unknown field '${k.slice(0, 40)}'; it takes ${Object.keys(shape).join(", ")}`);
    if (v === undefined || v === null || v === "") continue;
    out[k] = checkValue(kind, k, shape[k], v);
  }
  for (const [k, t] of Object.entries(shape)) {
    if (t.endsWith("!") && out[k] === undefined) throw new IntegrationError(`integrations.${kind} needs '${k}'`);
  }
  return out;
}

/** The default primary for a selection: the first agile tracker, else GitHub, else none. */
export function defaultPrimary(kinds) {
  return AGILE.find((k) => kinds.includes(k)) ?? (kinds.includes("github") ? "github" : null);
}

/**
 * Parse the integration half of a team.json document. Throws `IntegrationError` on anything that
 * cannot be used — a team that asked for a tracker and gets silence instead is the worse failure.
 *
 * @returns {{ integrations: object[], kinds: string[], primary: string|null, routes: Record<string,string[]> }}
 */
export function parseIntegrations(doc) {
  const list = doc?.integrations ?? [];
  if (!Array.isArray(list)) throw new IntegrationError("integrations must be a list");
  const integrations = list.map(checkIntegration);
  const kinds = integrations.map((i) => i.kind);
  const dup = kinds.find((k, i) => kinds.indexOf(k) !== i);
  if (dup) throw new IntegrationError(`integrations lists ${dup} twice; one entry per tracker`);
  let primary = doc?.primary ?? null;
  if (primary !== null && !kinds.includes(primary)) {
    throw new IntegrationError(`primary is '${String(primary).slice(0, 20)}', which is not a selected integration (${kinds.join(", ") || "none"})`);
  }
  primary = primary ?? defaultPrimary(kinds);
  const routes = {};
  const rawRoutes = doc?.routes ?? {};
  if (!rawRoutes || typeof rawRoutes !== "object" || Array.isArray(rawRoutes)) throw new IntegrationError("routes must be an object of role or project to tracker");
  for (const [to, v] of Object.entries(rawRoutes)) {
    const want = (Array.isArray(v) ? v : [v]).map(String);
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(to) || !want.length || want.some((k) => !KINDS.includes(k))) {
      throw new IntegrationError(`routes.${to.slice(0, 40)} must name a role or project and one or more of ${KINDS.join(", ")}`);
    }
    routes[to] = [...new Set(want)];
  }
  return { integrations, kinds, primary, routes };
}

/** The team.json document of a clone, or `{}` when there is none. */
export function readTeamDoc(clone) {
  const vault = openVault(clone);
  if (!vault.isFile(TEAM_JSON)) return {};
  try {
    const doc = JSON.parse(vault.read(TEAM_JSON));
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("not an object");
    return doc;
  } catch (e) {
    throw new IntegrationError(`${TEAM_JSON} in the team-brain is not a JSON object (${e.message}); fix it there and run again`);
  }
}

/** The integrations of the team-brain cloned at `clone`. */
export function readIntegrations(clone) {
  return parseIntegrations(readTeamDoc(clone));
}

/**
 * The trackers an ask goes to: its route when the addressee has one, every selected tracker
 * otherwise. A route naming a tracker that is no longer selected names nothing.
 */
export function routedKinds(config, to) {
  const route = config.routes[to];
  return route ? route.filter((k) => config.kinds.includes(k)) : [...config.kinds];
}

/** The tracker whose status wins for one ask: the team's primary if the ask goes there, else its first. */
export function primaryFor(config, kinds) {
  return kinds.includes(config.primary) ? config.primary : defaultPrimary(kinds) ?? kinds[0] ?? null;
}

/**
 * The adapter for one integration. Constructing it touches no network; the first call does.
 *
 * @param {object} entry
 * @param {{ env?: object, fetch?: Function, timeoutMs?: number }} io
 */
export function adapterFor(entry, io) {
  return ADAPTERS[entry.kind](entry, io);
}

/** Which credential variables are set for a tracker. Reports names, never a value. */
export function credentialStatus(kind, environment = {}) {
  const { text, any } = CREDENTIAL_VARS[kind];
  const set = any.some((group) => group.every((v) => Boolean(environment[v])));
  return { variables: text, set };
}

/**
 * The integration selection written as a team.json document: `doc` with `integrations`, `primary`
 * and `routes` replaced, everything else — `source`, `members` — kept. Validates before returning,
 * so nothing invalid is ever written.
 */
export function withIntegrations(doc, { integrations, primary = null, routes = {} }) {
  const next = { ...doc, integrations };
  if (primary) next.primary = primary; else delete next.primary;
  if (Object.keys(routes).length) next.routes = routes; else delete next.routes;
  if (!integrations.length) { delete next.integrations; delete next.primary; delete next.routes; }
  parseIntegrations(next);
  return next;
}

/**
 * Add or replace one integration. When `primary` is given it becomes the primary; when the current
 * primary was the default it stays the default (recomputed from the new selection).
 */
export function addIntegration(doc, entry, { primary = null } = {}) {
  const current = parseIntegrations(doc);
  const checked = checkIntegration(entry);
  const integrations = [...current.integrations.filter((i) => i.kind !== checked.kind), checked];
  const explicit = primary ?? doc.primary ?? null;
  return withIntegrations(doc, { integrations, primary: explicit, routes: doc.routes ?? {} });
}

/**
 * Remove one integration. Links to it stay in every ask file, readable; sync stops reading and
 * writing them because the kind is no longer selected. A primary that pointed at it falls back to
 * the default, and routes keep their other trackers.
 */
export function removeIntegration(doc, kind) {
  const current = parseIntegrations(doc);
  if (!current.kinds.includes(kind)) throw new IntegrationError(`${kind} is not a selected integration (${current.kinds.join(", ") || "none"})`);
  const integrations = current.integrations.filter((i) => i.kind !== kind);
  const primary = doc.primary && doc.primary !== kind ? doc.primary : null;
  const routes = {};
  for (const [to, ks] of Object.entries(current.routes)) {
    const left = ks.filter((k) => k !== kind);
    if (left.length) routes[to] = left.length === 1 ? left[0] : left;
  }
  return withIntegrations(doc, { integrations, primary, routes });
}

/**
 * The integrations `ai-os team init --integrations …` or `integrations add` asks for, built from
 * flags. `flags` holds the raw CLI values; nothing here reads the environment.
 *
 * @returns {{ integrations: object[], primary: string|null, routes: Record<string,string|string[]> }}
 */
export function integrationsFromFlags(flags) {
  const raw = String(flags.integrations ?? "").trim();
  const kinds = raw === "" || raw === "none" ? [] : raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const k of kinds) if (!KINDS.includes(k)) throw new IntegrationError(`--integrations takes ${KINDS.join(", ")} or none; '${k.slice(0, 20)}' is not one`);
  const pairs = (s, flag) => {
    if (s === undefined) return undefined;
    const out = {};
    for (const p of String(s).split(",").map((x) => x.trim()).filter(Boolean)) {
      const [k, ...v] = p.split("=");
      if (!k || !v.length) throw new IntegrationError(`--${flag} takes name=value pairs, comma-separated`);
      out[k.trim()] = v.join("=").trim();
    }
    return out;
  };
  // `--stories` alone mirrors every selected tracker's stories; `--stories jira,github` names them.
  const storyKinds = flags.stories === true ? kinds : flags.stories ? String(flags.stories).split(",").map((s) => s.trim()).filter(Boolean) : [];
  for (const k of storyKinds) if (!kinds.includes(k)) throw new IntegrationError(`--stories names ${k.slice(0, 20)}, which is not a selected integration`);
  const stories = (kind) => (storyKinds.includes(kind) ? true : undefined);
  const integrations = kinds.map((kind) => {
    if (kind === "github") return checkIntegration({ kind, api: flags["github-api"], repo: flags["github-repo"], stories: stories(kind) });
    if (kind === "servicenow") {
      return checkIntegration({
        kind, instance: flags["servicenow-instance"], table: flags["servicenow-table"],
        group: flags["servicenow-group"], groups: pairs(flags["servicenow-groups"], "servicenow-groups"), stories: stories(kind),
      });
    }
    return checkIntegration({ kind, site: flags["jira-site"], project: flags["jira-project"], issueType: flags["jira-issue-type"], stories: stories(kind) });
  });
  const routes = {};
  for (const [to, k] of Object.entries(pairs(flags.route, "route") ?? {})) {
    const ks = k.split("+").map((x) => x.trim());
    routes[to] = ks.length === 1 ? ks[0] : ks;
  }
  // Written out even when it is the default, so a person reading team.json sees which one wins.
  const primary = typeof flags.primary === "string" ? flags.primary : defaultPrimary(kinds);
  // Validated as a whole, so a primary or a route naming an unselected tracker fails here.
  parseIntegrations({ integrations, primary, routes });
  return { integrations, primary, routes };
}

/** The checkbox list `/create-team` shows, with this selection ticked. */
export function checkboxes(kinds) {
  const box = (on) => (on ? "[x]" : "[ ]");
  return [
    "Connect this team-brain to:",
    `  ${box(kinds.includes("github"))} GitHub issues      (in the owning repo of each ask)`,
    `  ${box(kinds.includes("servicenow"))} ServiceNow Agile   (instance URL, table, group per role)`,
    `  ${box(kinds.includes("jira"))} Jira               (site, project, issue type)`,
    `  ${box(!kinds.length)} none: asks stay in the brain only`,
  ];
}
