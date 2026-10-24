// Contracts: what each repo serves, calls and emits, published to the team-brain (#621, R12–R14).
//
// `index/cortex-contract.mjs` extracts a repo's contract; this module PUBLISHES it to
// `projects/<slug>/contract.json` (plus a short `contract.md` for people) and READS it back across
// the team. The leaves never import each other, so the two meet only in the JSON and in the path
// normal form, which lives in `core/route-path.js`.
//
// Publishing (R13):
//   - The input is untrusted text, so it is parsed into a known shape and re-serialised: unknown
//     keys are dropped, every string is length-capped, and a file path that is absolute or climbs
//     out (`..`) is refused. A contract never carries a code body or an environment value because
//     the extractor writes none; this is what makes that true of a hand-edited file too.
//   - The secret gate (`core/scrub.js`) reads the whole input text AND the text about to be written.
//     There is no tool row for publishing — it is a CLI step of /team-add — so the gate sits in the
//     one function that writes, which is the act (ADR 0016), and the test drives that function.
//   - It commits only when the content changed, as `contract: update <slug>`, so the brain's git
//     history of `contract.json` is the contract's changelog. On `lab` it commits and does not push.
//
// Reading (R6): the `contract` tool, `mode: ANY`, team only, `returns: FOREIGN`. `{ project }` is
// one project's contract, optionally narrowed by `path`; `{ calls }` is who calls an endpoint and
// who serves it. Matching is the route map's: a call's `{}` meets only an endpoint's `{}`.
//
// Drift (R14): `contractDrift` compares each `contract.json` at HEAD with its last version before a
// date, from the clone's git history. `catch_me_up` calls it.
//
// Every read and write in the clone goes through the Vault; git goes through gitsync.js.

import { assertWritable } from "../../core/scrub.js";
import { assertNotDenied } from "../../core/denylist.js";
import { resolveProfile } from "../../core/profile.js";
import { callReaches, normalizeRoutePath, routeSegments } from "../../core/route-path.js";
import { commitPaths, pull, pushHead, revBefore, showAt, teamCloneDir, touchedSince } from "./gitsync.js";
import { openVault } from "./vault.js";
import { slugify } from "./slug.js";
import { ensureTeamClone } from "./team.js";

export const CONTRACT_FORMAT = 1;
const SOURCES = new Set(["openapi", "routes", "none"]);
const EVENT_KINDS = new Set(["publish", "consume"]);
const METHOD = /^(?:GET|PUT|POST|DELETE|OPTIONS|HEAD|PATCH|TRACE|ANY)$/;
const STR_MAX = 300;
const ROWS_MAX = 5_000;

// What one read may return. The transport caps a whole result at 40,000 characters (lib/stdio.js),
// and a capped result is a truncation marker rather than the contract, so these stay under it.
const SHOW_ROWS = 150;
const CALLERS_MAX = 50;
const CALLS_PER_PROJECT = 20;
const DRIFT_ROWS = 30;
const DRIFT_PROJECTS = 30;

export class ContractRefused extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ContractRefused";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------------------------

const refuse = (why) => {
  throw new ContractRefused("bad_contract", `not a contract Cortex can publish: ${why}`);
};

function text(v, what, { optional = false } = {}) {
  if (v === undefined || v === null) {
    if (optional) return undefined;
    refuse(`${what} is missing`);
  }
  if (typeof v !== "string") refuse(`${what} is not a string`);
  const s = v.replace(/[\r\n\t]+/g, " ").trim();
  if (s.length > STR_MAX) refuse(`${what} is longer than ${STR_MAX} characters`);
  return s;
}

function relFile(v, what) {
  const s = text(v, what);
  // A machine's absolute path names a person's home directory; `..` climbs out of the repo.
  if (/^(?:[\\/]|[A-Za-z]:)/.test(s) || s.split(/[\\/]/).includes("..")) refuse(`${what} is not a path inside the repo`);
  return s.replace(/\\/g, "/");
}

function rows(v, what) {
  if (v === undefined) return [];
  if (!Array.isArray(v)) refuse(`${what} is not a list`);
  if (v.length > ROWS_MAX) refuse(`${what} has more than ${ROWS_MAX} rows`);
  return v.map((r, i) => {
    if (r === null || typeof r !== "object" || Array.isArray(r)) refuse(`${what}[${i}] is not an object`);
    return r;
  });
}

/** A row's files: repo-relative, at most five, the rest counted in `moreFiles`. */
function files(r, what) {
  if (r.files === undefined) return { files: [] };
  if (!Array.isArray(r.files)) refuse(`${what}.files is not a list`);
  if (r.files.length > ROWS_MAX) refuse(`${what}.files has more than ${ROWS_MAX} entries`);
  const all = [...new Set(r.files.map((f, i) => relFile(f, `${what}.files[${i}]`)))].sort();
  const more = (Number.isInteger(r.moreFiles) && r.moreFiles > 0 ? r.moreFiles : 0) + Math.max(0, all.length - 5);
  return { files: all.slice(0, 5), ...(more ? { moreFiles: more } : {}) };
}

function endpointPath(v, what) {
  const p = normalizeRoutePath(text(v, what));
  if (!p) refuse(`${what} is not a path`);
  return p;
}

function method(v, what) {
  const m = text(v ?? "ANY", what).toUpperCase();
  if (!METHOD.test(m)) refuse(`${what} is not an HTTP method`);
  return m;
}

const byEndpoint = (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || String(a.host ?? "").localeCompare(String(b.host ?? ""));

/**
 * Parse a contract's text into its one canonical shape, or throw `ContractRefused`. Only the keys
 * below survive; their order is fixed, and every list is sorted, so the same contract always
 * serialises to the same bytes.
 */
export function parseContract(input) {
  let doc;
  try {
    doc = JSON.parse(String(input));
  } catch (e) {
    refuse(`not valid JSON (${String(e.message).split("\n")[0]})`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) refuse("the top level is not an object");
  if (doc.format !== CONTRACT_FORMAT) refuse(`format is ${JSON.stringify(doc.format ?? null)}, and this Cortex reads ${CONTRACT_FORMAT}`);
  const source = text(doc.source, "source");
  if (!SOURCES.has(source)) refuse("source must be openapi, routes or none");

  const serves = rows(doc.serves, "serves").map((r, i) => {
    const w = `serves[${i}]`;
    const row = { method: method(r.method, `${w}.method`), path: endpointPath(r.path, `${w}.path`) };
    const raw = text(r.raw, `${w}.raw`, { optional: true });
    if (raw) row.raw = raw;
    const op = text(r.operationId, `${w}.operationId`, { optional: true });
    if (op) row.operationId = op;
    const resp = text(r.response, `${w}.response`, { optional: true });
    if (resp) row.response = resp;
    return { ...row, ...files(r, w) };
  }).sort(byEndpoint);

  const calls = rows(doc.calls, "calls").map((r, i) => {
    const w = `calls[${i}]`;
    const row = { method: method(r.method, `${w}.method`), path: endpointPath(r.path, `${w}.path`) };
    const host = text(r.host, `${w}.host`, { optional: true });
    if (host) {
      if (!/^[a-z0-9.-]+$/i.test(host)) refuse(`${w}.host is not a host name`);
      row.host = host.toLowerCase();
    }
    return { ...row, ...files(r, w) };
  }).sort(byEndpoint);

  if (doc.bases !== undefined && !Array.isArray(doc.bases)) refuse("bases is not a list");
  const bases = [...new Set((doc.bases ?? []).map((b, i) => endpointPath(b, `bases[${i}]`)))].sort();

  const events = rows(doc.events, "events").map((r, i) => {
    const w = `events[${i}]`;
    const kind = text(r.kind, `${w}.kind`);
    if (!EVENT_KINDS.has(kind)) refuse(`${w}.kind must be publish or consume`);
    return { kind, name: text(r.name, `${w}.name`), ...files(r, w) };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));

  const unread = rows(doc.unread, "unread")
    .map((r, i) => ({ what: text(r.what, `unread[${i}].what`), why: text(r.why, `unread[${i}].why`) }))
    .sort((a, b) => a.what.localeCompare(b.what) || a.why.localeCompare(b.why));

  const out = { format: CONTRACT_FORMAT, project: null, source, serves, calls, bases, events, unread };
  const reason = text(doc.reason, "reason", { optional: true });
  if (reason) out.reason = reason;
  else if (!serves.length && !calls.length && !events.length) out.reason = "The extractor found no HTTP surface to publish.";
  return out;
}

export const renderContract = (c) => `${JSON.stringify(c, null, 2)}\n`;

function listLines(items, line, max = 100) {
  const out = items.slice(0, max).map(line);
  if (items.length > max) out.push(`- … and ${items.length - max} more in contract.json`);
  return out.length ? out : ["- none"];
}

/** The short human summary beside the JSON. No frontmatter: it is not a dated note. */
export function renderContractMd(slug, c) {
  const ep = (r) => `\`${r.method} ${r.raw ?? r.path}\``;
  const lines = [
    `# Contract: ${slug}`,
    "",
    "Generated by `index/cortex-contract.mjs` and published by `ai-os contract publish`. Do not edit:",
    "`contract.json` beside this file is what the `contract` tool reads, and the next publish rewrites both.",
    "",
    `Source: **${c.source}**${c.source === "openapi" ? " (an OpenAPI or Swagger file)" : c.source === "routes" ? " (route handlers read from the code)" : ""}.`,
  ];
  if (c.reason) lines.push("", c.reason);
  lines.push("", `## Serves (${c.serves.length})`, "");
  lines.push(...listLines(c.serves, (r) => `- ${ep(r)}${r.operationId ? ` · ${r.operationId}` : ""}${r.response ? ` → ${r.response}` : ""}`));
  lines.push("", `## Calls (${c.calls.length})`, "");
  lines.push(...listLines(c.calls, (r) => `- ${ep(r)}${r.host ? ` on ${r.host}` : ""}`));
  if (c.bases.length) lines.push("", `Base paths its calls may be prefixed with: ${c.bases.map((b) => `\`${b}\``).join(", ")}.`);
  lines.push("", `## Events (${c.events.length})`, "");
  lines.push(...listLines(c.events, (e) => `- ${e.kind} \`${e.name}\``));
  if (c.unread.length) {
    lines.push("", "## Not read", "", "Every list above is a floor. Cortex could not read:", "");
    lines.push(...listLines(c.unread, (u) => `- ${u.what} — ${u.why}`));
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------------------------

const contractRel = (slug) => `projects/${slug}/contract.json`;
const contractMdRel = (slug) => `projects/${slug}/contract.md`;
const lf = (s) => String(s).replace(/\r\n/g, "\n");

function publish(clone, rels, message, outwardSync) {
  const c = commitPaths(clone, rels, message);
  if (!c.ok) return { committed: false, pushed: false, error: c.error };
  if (!c.committed) return { committed: false, pushed: false };
  if (!outwardSync) return { committed: true, pushed: false, error: "outward_sync_disabled" };
  const p = pushHead(clone);
  return p.ok ? { committed: true, pushed: true } : { committed: true, pushed: false, error: p.error };
}

/**
 * Write a project's contract into the team-brain clone, then commit and push it — only when the
 * content changed. Throws `ContractRefused` for a malformed contract and `RefusedWriteError` for one
 * the secret gate refuses; in both cases nothing is written.
 *
 * @param {string} clone
 * @param {{ slug: string, input: string, outwardSync?: boolean }} opts
 */
export function publishContract(clone, { slug, input, outwardSync = true, policy }) {
  const s = slugify(slug ?? "");
  if (!s) throw new ContractRefused("no_project", "a contract needs a project slug: pass --project, or run it in a repo joined with /team-add");
  // The gate first, on the text as given: a credential anywhere in it is a reason to stop, even in
  // a field the parser would have dropped. Then the employer denylist, on a `home` profile only;
  // without a policy the profile is resolved from the environment, never read as "refuses nothing".
  assertWritable(String(input));
  assertNotDenied(String(input), { policy: policy ?? resolveProfile({ env: process.env }).policy });
  const contract = { ...parseContract(input), project: s };
  const json = renderContract(contract);
  const md = renderContractMd(s, contract);
  assertWritable(`${json}\n${md}`);

  if (outwardSync) pull(clone);
  const vault = openVault(clone);
  const rels = [contractRel(s), contractMdRel(s)];
  const existed = vault.isFile(rels[0]);
  if (existed && lf(vault.read(rels[0])) === json && vault.isFile(rels[1]) && lf(vault.read(rels[1])) === md) {
    return { project: s, action: "unchanged", path: vault.abs(rels[0]), committed: false, pushed: false, ...counts(contract) };
  }
  vault.write(rels[0], json);
  vault.write(rels[1], md);
  const res = publish(clone, rels, `contract: update ${s}`, outwardSync);
  return { project: s, action: existed ? "updated" : "created", path: vault.abs(rels[0]), ...res, ...counts(contract) };
}

const counts = (c) => ({ source: c.source, serves: c.serves.length, calls: c.calls.length, events: c.events.length });

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

/** Every project in the clone with a `contract.json`: `{ slug, contract }` or `{ slug, error }`. */
export function readContracts(clone) {
  const vault = openVault(clone);
  const out = [];
  for (const e of vault.entries("projects", { ignore: false })) {
    if (!e.isDirectory || e.name.startsWith(".")) continue;
    const rel = contractRel(e.name);
    if (!vault.isFile(rel)) continue;
    try {
      out.push({ slug: e.name, contract: { ...parseContract(vault.read(rel)), project: e.name } });
    } catch (err) {
      out.push({ slug: e.name, error: err.message });
    }
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** `GET /items/` → `{ method: "GET", path: "/items" }`; a bare path has method null. */
export function parseEndpoint(q) {
  const s = String(q ?? "").trim();
  const m = s.match(/^([A-Za-z]+)\s+(\S.*)$/);
  const meth = m && METHOD.test(m[1].toUpperCase()) ? m[1].toUpperCase() : null;
  const path = normalizeRoutePath(meth ? m[2] : s);
  if (!path) throw new ContractRefused("not_a_path", `'${s}' is not an endpoint: give a path like /items or GET /items/{id}`);
  return { method: meth === "ANY" ? null : meth, path };
}

const methodOk = (want, have) => !want || !have || have === "ANY" || want === have;

/** Is `path` under `filter`, segment by segment? A `{}` on either side meets anything. */
function under(path, filter) {
  const p = routeSegments(path);
  const f = routeSegments(filter);
  if (f.length > p.length) return false;
  return f.every((s, i) => s === p[i] || s === "{}" || p[i] === "{}");
}

function cap(list, max) {
  return list.length > max ? { list: list.slice(0, max), truncated: true } : { list, truncated: false };
}

/** One project's contract, narrowed to the endpoints under `path` when one is given. */
export function showContract(clone, { project, path = null }) {
  const all = readContracts(clone);
  const slug = slugify(project ?? "");
  const hit = all.find((c) => c.slug === slug);
  if (!hit) {
    const have = all.map((c) => c.slug);
    throw new ContractRefused(
      "not_found",
      `no contract is published for '${project}'. Projects with one: ${have.length ? have.join(", ") : "none"}. ` +
        "A repo publishes its contract with `/team-add` (or `ai-os contract publish`).",
    );
  }
  if (hit.error) throw new ContractRefused("unreadable", `projects/${slug}/contract.json is unreadable: ${hit.error}`);
  const c = hit.contract;
  const filter = path ? parseEndpoint(path) : null;
  const keep = (r) => !filter || (under(r.path, filter.path) && methodOk(filter.method, r.method));
  let truncated = false;
  const pick = (rowsIn) => {
    const r = cap(rowsIn.filter(keep), SHOW_ROWS);
    truncated ||= r.truncated;
    return r.list;
  };
  const out = { project: slug, source: c.source, serves: pick(c.serves), calls: pick(c.calls), bases: c.bases, events: filter ? [] : c.events.slice(0, SHOW_ROWS), unread: c.unread };
  if (c.reason) out.reason = c.reason;
  if (filter) out.filter = filter;
  out.truncated = truncated || (!filter && c.events.length > SHOW_ROWS);
  return out;
}

/** The candidates a call's path may reach: as written, and behind each base its repo declares. */
function callPaths(call, bases) {
  const out = [call.path];
  for (const b of bases) {
    const bs = routeSegments(b);
    const cs = routeSegments(call.path);
    if (bs.length <= cs.length && bs.every((s, i) => s === cs[i])) continue; // already prefixed
    out.push(normalizeRoutePath(`${b}/${call.path}`));
  }
  return out;
}

/**
 * Which projects call an endpoint, and which serve it. `endpoint` is a path, optionally led by a
 * method: `/items`, `GET /items/{id}`, `/items/:id/`. A floor: a call whose URL is built at runtime
 * is in its project's `unread`, not here.
 */
export function whoCalls(clone, endpoint) {
  const want = parseEndpoint(endpoint);
  const all = readContracts(clone);
  const callers = [];
  const servedBy = [];
  const errors = [];
  for (const { slug, contract: c, error } of all) {
    if (error) {
      errors.push({ project: slug, error });
      continue;
    }
    const calls = c.calls.filter((r) => methodOk(want.method, r.method) && callPaths(r, c.bases).some((p) => callReaches(p, want.path)));
    if (calls.length) {
      const r = cap(calls, CALLS_PER_PROJECT);
      callers.push({ project: slug, calls: r.list, ...(r.truncated ? { truncated: true } : {}) });
    }
    for (const s of c.serves) {
      if (!methodOk(want.method, s.method)) continue;
      if (!callReaches(want.path, s.path) && !callReaches(s.path, want.path)) continue;
      const row = { project: slug, method: s.method, path: s.path };
      if (s.raw) row.raw = s.raw;
      if (s.operationId) row.operationId = s.operationId;
      if (s.response) row.response = s.response;
      servedBy.push(row);
    }
  }
  const c = cap(callers, CALLERS_MAX);
  const s = cap(servedBy, CALLERS_MAX);
  const out = {
    endpoint: { method: want.method ?? "ANY", path: want.path },
    callers: c.list,
    servedBy: s.list,
    read: all.length,
    note: "A floor: calls whose URL is built at runtime, and repos that have not published a contract, are not here.",
    truncated: c.truncated || s.truncated,
  };
  if (errors.length) out.errors = errors;
  return out;
}

/** The projects that have published a contract, with their counts. */
export function listContracts(clone) {
  return readContracts(clone).map((c) => (c.error ? { project: c.slug, error: c.error } : { project: c.slug, ...counts(c.contract) }));
}

// ---------------------------------------------------------------------------------------------
// Drift (R14)
// ---------------------------------------------------------------------------------------------

const endpointKey = (r) => `${r.method} ${r.path}`;
const brief = (r) => ({ method: r.method, path: r.path, ...(r.operationId ? { operationId: r.operationId } : {}), ...(r.response ? { response: r.response } : {}) });

function safeParse(t) {
  if (t === null) return null;
  try {
    return parseContract(t);
  } catch {
    return undefined;
  }
}

/** Added, removed and changed endpoints between two contracts' `serves`. */
export function diffServes(before, after) {
  const was = new Map((before?.serves ?? []).map((r) => [endpointKey(r), r]));
  const now = new Map((after?.serves ?? []).map((r) => [endpointKey(r), r]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [k, r] of now) {
    const old = was.get(k);
    if (!old) added.push(brief(r));
    else if ((old.operationId ?? null) !== (r.operationId ?? null) || (old.response ?? null) !== (r.response ?? null)) {
      changed.push({ method: r.method, path: r.path, before: brief(old), after: brief(r) });
    }
  }
  for (const [k, r] of was) if (!now.has(k)) removed.push(brief(r));
  const order = (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
  return { added: added.sort(order), removed: removed.sort(order), changed: changed.sort(order) };
}

/**
 * Per project, how its served endpoints changed since `since`: the contract at HEAD against its
 * last version committed before that day. A contract first published inside the window is `first:
 * true`, and every endpoint in it reads as added. Bounded so a catch-up stays under the transport
 * cap; `truncated` says a cap was hit.
 */
export function contractDrift(clone, since) {
  const vault = openVault(clone);
  const out = [];
  let truncated = false;
  for (const e of vault.entries("projects", { ignore: false })) {
    if (!e.isDirectory || e.name.startsWith(".")) continue;
    const rel = contractRel(e.name);
    if (!touchedSince(clone, rel, since)) continue;
    const base = revBefore(clone, rel, since);
    const before = base ? safeParse(showAt(clone, base, rel)) : null;
    const after = safeParse(showAt(clone, "HEAD", rel));
    if (before === undefined || after === undefined) {
      out.push({ project: e.name, error: "contract.json did not parse at one end of the window" });
      continue;
    }
    const d = diffServes(before, after);
    if (base && !d.added.length && !d.removed.length && !d.changed.length) continue;
    const row = { project: e.name, first: !base };
    for (const k of ["added", "removed", "changed"]) {
      const r = cap(d[k], DRIFT_ROWS);
      row[k] = r.list;
      if (r.truncated) {
        row[`${k}More`] = d[k].length - DRIFT_ROWS;
        truncated = true;
      }
    }
    if (!after) row.withdrawn = true;
    out.push(row);
  }
  out.sort((a, b) => a.project.localeCompare(b.project));
  if (out.length > DRIFT_PROJECTS) truncated = true;
  return { projects: out.slice(0, DRIFT_PROJECTS), truncated };
}

// ---------------------------------------------------------------------------------------------
// From a brain: what both adapters call
// ---------------------------------------------------------------------------------------------

/** `contract`: one project's surface, who calls an endpoint, or the list. Pulls (ff-only) first. */
export function contractFrom(brain, args = {}) {
  const { dir } = ensureTeamClone(brain, "contract");
  const pulled = pull(dir);
  const pullOut = pulled.ok ? { ok: true } : { ok: false, error: String(pulled.error).trim().split("\n").slice(0, 3).join("\n") };
  if (args.calls) return { pull: pullOut, ...whoCalls(dir, args.calls) };
  if (args.project) return { pull: pullOut, ...showContract(dir, { project: args.project, path: args.path ?? null }) };
  if (args.path) throw new ContractRefused("no_project", "`path` narrows one project's contract: pass `project` with it, or use `calls` to find who calls a path");
  return { pull: pullOut, contracts: listContracts(dir) };
}

/**
 * `ai-os contract publish`: the project is the one asked for, else the contract's own, else the
 * connector's. `team` overrides the connector's team, for a lead standing in the vault.
 */
export function publishFrom(brain, { input, project = null, team = null }) {
  let fromFile = null;
  try {
    fromFile = JSON.parse(String(input))?.project ?? null;
  } catch {
    fromFile = null; // parseContract below says what is wrong with it
  }
  const slug = project ?? (typeof fromFile === "string" ? fromFile : null) ?? brain.project;
  // As `memberFrom` does it: another team's clone must already be there, since no connector names a
  // remote for it.
  const target = team && team !== brain.team ? { ...brain, team, teamClone: teamCloneDir(brain.root, team), teamBrainRepo: null } : brain;
  const { dir } = ensureTeamClone(target, "contract publish");
  return publishContract(dir, { slug, input, outwardSync: brain.policy.outwardSync, policy: brain.policy });
}
