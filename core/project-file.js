// The project file: what it is, whether one is valid, and whether this install may hold it.
//
// A project file is `projects/<slug>.md` at the top of a team-brain — flat frontmatter naming one
// project's repo, up to three outside links and the projects it relates to, then free prose
// (docs/adr/0024). A workspace is nothing more than the set of them.
//
// It lives in core/ because both leaves read it and neither may import the other: `mcp/` writes,
// lists and removes these files, and `index/` draws them. One owner for the format means the page
// and the writer cannot disagree about what a valid file is.
//
// Three properties hold for everything below, and the tests pin each:
//
//   - Text in, a result out. This module reads no file and no environment variable, and it has no
//     way to make a request. A link is the characters of a URL and nothing behind them.
//   - Validation never throws. It returns { ok, isProject, data, errors, warnings }, and an error
//     names its line and its key.
//   - The employer check is a FLOOR. It recognises two shapes of host and nothing else, so a file
//     that passes is not cleared (docs/adr/0015 still says employer content cannot be detected).

import { scan } from "./scrub.js";

// ---------------------------------------------------------------------------------------------
// The format
// ---------------------------------------------------------------------------------------------

/** Every key a project file may hold, in the order the writer emits them. Any other is an error. */
export const KEYS = Object.freeze(["type", "title", "repo", "tracker", "design", "docs", "related", "created"]);
/** The four links. Shown, never fetched. */
export const LINK_KEYS = Object.freeze(["repo", "tracker", "design", "docs"]);

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX = 64;
const TITLE_MAX = 80;

/** A project's slug: the filename without `.md`, and the `project` a connector names. */
export function isSlug(s) {
  return typeof s === "string" && s.length <= SLUG_MAX && SLUG_RE.test(s);
}

// The grammar is the subset tools/cortex-frontmatter.mjs holds skills to: one `key: value` per
// line, the value plain or quoted, no nesting, no block scalar, no list. It is restated here and
// not imported because core/ may not reach into tools/ (test/architecture.test.js).
const KEY_RE = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*?))?[ \t]*$/;
const BLOCK_SCALAR_RE = /^[|>][0-9]?[+-]?[0-9]?$/;
// A plain scalar may not START with these; YAML reads each as structure, not text.
const INDICATORS = new Set(["@", "`", "[", "{", "*", "&", "!", "%", "|", ">"]);

/** Unquote one value. Returns { value } or { error }. */
function scalar(raw) {
  if (BLOCK_SCALAR_RE.test(raw)) return { error: `is a block scalar (${raw}); a value sits on its own line` };
  if (raw.startsWith('"')) {
    if (raw.length < 2 || !raw.endsWith('"')) return { error: "opens a double quote it never closes" };
    try {
      const value = JSON.parse(raw);
      return typeof value === "string" ? { value } : { error: "is not a quoted string" };
    } catch {
      return { error: "is not a valid double-quoted string; check the quote and any backslash" };
    }
  }
  if (raw.startsWith("'")) {
    if (raw.length < 2 || !raw.endsWith("'")) return { error: "opens a single quote it never closes" };
    const inner = raw.slice(1, -1);
    if (/'(?!')/.test(inner.replace(/''/g, ""))) return { error: "has a lone ' inside single quotes; write it as '' or use a double quote" };
    return { value: inner.replace(/''/g, "'") };
  }
  if (raw && INDICATORS.has(raw[0])) return { error: `starts with ${raw[0]}, which is list or structure syntax; a value is plain text, so quote it` };
  if (raw.includes(": ") || raw.endsWith(":")) return { error: 'is unquoted and holds ": "; quote the value' };
  if (raw.includes(" #")) return { error: 'is unquoted and holds " #", which starts a comment; quote the value' };
  return { value: raw };
}

/**
 * Read the frontmatter and the prose. Grammar only: which keys are allowed is the validator's
 * question. Never throws.
 *
 * @returns {{ found: boolean, data: Record<string,string>, lines: Record<string,number>,
 *             broken: Set<string>, body: string, errors: {line:number,key:string|null,msg:string}[] }}
 */
export function parseProjectFile(text) {
  const src = typeof text === "string" ? text.replace(/^﻿/, "") : "";
  const lines = src.split(/\r?\n/);
  const out = { found: false, data: {}, lines: {}, broken: new Set(), body: "", errors: [] };
  if (lines[0] !== "---") return out;
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    out.errors.push({ line: 1, key: null, msg: "the frontmatter is never closed with a --- line" });
    return out;
  }
  out.found = true;
  out.body = lines.slice(end + 1).join("\n");

  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const n = i + 1;
    if (/^\s*(#|$)/.test(line)) continue;
    if (/^\s/.test(line)) {
      out.errors.push({ line: n, key: null, msg: "indented line: the frontmatter is flat, one key per line, with no nesting" });
      continue;
    }
    if (/^-(\s|$)/.test(line)) {
      out.errors.push({ line: n, key: null, msg: "list syntax: several values go on one line, separated by commas" });
      continue;
    }
    const m = line.match(KEY_RE);
    if (!m) {
      out.errors.push({ line: n, key: null, msg: "not a `key: value` line" });
      continue;
    }
    const [, key, raw = ""] = m;
    if (key in out.data) {
      out.errors.push({ line: n, key, msg: `repeated key '${key}': a key appears once` });
      continue;
    }
    const s = scalar(raw);
    out.lines[key] = n;
    if (s.error) {
      out.errors.push({ line: n, key, msg: `'${key}' ${s.error}` });
      out.broken.add(key);
      out.data[key] = raw;
      continue;
    }
    out.data[key] = s.value;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The link shape
// ---------------------------------------------------------------------------------------------

// The `user@host:path` form git uses for SSH. No scheme, so no `//`; the character classes are
// what keep a query, a fragment and a second `@` out.
const SCP_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+$/;
// A query or fragment parameter whose NAME says it carries a credential.
const CREDENTIAL_PARAM_RE = /[?&#](?:access[_-]?token|token|api[_-]?key|key|secret|password|passwd|pwd|auth|signature|sig|credential)=/i;
const USERINFO_RE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#@]*)@/i;

/**
 * Does this link carry a password or a token? True for anything `core/scrub.js` would refuse, for
 * a credential-named parameter, for `user:password@` under any scheme, and for any `user@` at all
 * under http or https — a web link has no reason to name a user, and a token is what sits there.
 * `ssh://git@host/…` and `git@host:path` are not credentials: that user is how SSH is addressed.
 */
export function carriesCredential(link) {
  const v = String(link ?? "");
  if (scan(v).length) return true;
  if (CREDENTIAL_PARAM_RE.test(v)) return true;
  const m = v.match(USERINFO_RE);
  if (!m) return false;
  return m[2].includes(":") || /^https?$/i.test(m[1]);
}

/**
 * Why `value` is not an acceptable link for `key`, or null. `repo` is the strict one: https or the
 * SSH form, with no query and no fragment. The message never repeats the value, because the value
 * may be the secret.
 */
function linkProblem(key, value) {
  const v = String(value);
  if (/[\s\u0000-\u001f\u007f]/.test(v)) return "holds whitespace or a control character; a link is one unbroken URL";
  if (carriesCredential(v)) return "carries a credential (a password, a token or a credential parameter); a link holds none";
  if (key === "repo") {
    if (SCP_RE.test(v)) return null;
    if (!/^https:\/\//i.test(v)) return "must be an https:// URL, or the user@host:path form git uses for SSH";
    if (v.includes("?")) return "holds a query; a repo link is the repository's address and nothing after it";
    if (v.includes("#")) return "holds a fragment; a repo link is the repository's address and nothing after it";
  } else if (!/^https?:\/\//i.test(v)) {
    return "must be an http:// or https:// URL";
  }
  try {
    if (!new URL(v).hostname) return "names no host";
  } catch {
    return "is not a URL";
  }
  return null;
}

/**
 * The host and path of a link, or null when it names no host. The host comes back in lower case
 * and without the trailing dot of a fully-qualified name: `tenant.example.net.` is the same host,
 * and read literally it would match no suffix below.
 *
 * A value with no scheme is read too — `host/path` or `host:path` — as long as the host has a dot
 * in it. Validation refuses such a link, so no writer writes one, but a reader meets it in a file
 * somebody committed and must still be able to say what shape it is. A bare word is not a host.
 */
function hostOf(link) {
  const v = String(link ?? "").trim();
  const at = (host, path) => {
    const h = host.toLowerCase().replace(/\.$/, "");
    return h ? { host: h, path } : null;
  };
  if (!v.includes("://")) {
    const scp = v.match(/^[^@\s/:]+@([^:\s/]+):(\S*)$/);
    if (scp) return at(scp[1], scp[2]);
    const bare = v.match(/^([^@\s/:]+\.[^@\s/:]+)(?:[/:](\S*))?$/);
    return bare ? at(bare[1], bare[2] ?? "") : null;
  }
  try {
    const u = new URL(v);
    return at(u.hostname, u.pathname);
  } catch {
    return null;
  }
}

/**
 * One repo spelt several ways, reduced to `host/path` for comparison only: no scheme, no user, the
 * host in lower case, no `.git`, no trailing slash, the SSH form read as host and path. The path
 * keeps its case. Nothing is ever fetched from the result.
 */
export function normalizeRepo(link) {
  const v = String(link ?? "").trim();
  let host;
  let path;
  const scp = v.includes("://") ? null : v.match(/^(?:[^@\s/:]+@)?([^:\s/]+):(.*)$/);
  if (scp) {
    [, host, path] = scp;
  } else {
    const rest = v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^[^/@]*@/, "");
    const cut = rest.indexOf("/");
    host = cut === -1 ? rest : rest.slice(0, cut);
    path = cut === -1 ? "" : rest.slice(cut + 1);
  }
  path = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  return `${host.toLowerCase()}/${path}`;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDay(s) {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** The first thing wrong with a `related` value, or the slugs it names. */
function readRelated(value, ownSlug) {
  if (value.trim() === "") return { slugs: [] };
  const slugs = [];
  for (const item of value.split(",").map((s) => s.trim())) {
    if (!isSlug(item)) return { error: `'related' holds ${JSON.stringify(item)}, which is not a slug (lower-case words joined by single dashes, separated by commas)` };
    if (slugs.includes(item)) return { error: `'related' names '${item}' twice` };
    if (item === ownSlug) return { error: `'related' names the file's own slug '${item}'` };
    slugs.push(item);
  }
  return { slugs };
}

/**
 * Validate one project file. Never throws.
 *
 * `slug` is the filename without `.md`; give it and the filename rule and the own-slug rule apply.
 * `others` is what the rest of the workspace holds, as `[{ slug, repo }]`; give it and the two
 * rules another file causes are checked. Those two are WARNINGS — this file is not what is wrong.
 *
 * `isProject` is false for a file whose frontmatter has no `type: project`: a README or a note in
 * `projects/` is not a broken project file, and a reader skips and counts it.
 *
 * @param {string} text
 * @param {{ slug?: string, others?: {slug:string, repo?:string}[] }} [opts]
 * @returns {{ ok: boolean, isProject: boolean, data: object,
 *             errors: {line:number,key:string|null,msg:string}[],
 *             warnings: {line:number,key:string,msg:string}[] }}
 */
export function validateProjectFile(text, { slug, others } = {}) {
  const p = parseProjectFile(text);
  if (!p.found || p.broken.has("type") || p.data.type !== "project") {
    return {
      ok: false,
      isProject: false,
      data: {},
      errors: [...p.errors, { line: p.lines.type ?? 1, key: "type", msg: "not a project file: its frontmatter has no `type: project` line" }],
      warnings: [],
    };
  }

  const errors = [...p.errors];
  const warnings = [];
  const d = p.data;
  const lineOf = (key) => p.lines[key] ?? 1;
  const fail = (key, msg) => errors.push({ line: lineOf(key), key, msg });
  /** Present, and not already reported as unreadable — a value that did not parse is not judged twice. */
  const readable = (key) => key in d && !p.broken.has(key);

  if (slug !== undefined && !isSlug(slug)) {
    errors.push({ line: 0, key: "slug", msg: `the filename '${String(slug).slice(0, 80)}' is not a slug: lower-case letters and digits in words joined by single dashes, at most ${SLUG_MAX} characters` });
  }

  for (const key of Object.keys(d)) {
    if (!KEYS.includes(key)) fail(key, `unknown key '${key}': a project file holds ${KEYS.join(", ")}`);
  }

  const data = { type: "project", related: [], prose: p.body };

  if (!("title" in d)) fail("title", "'title' is required");
  else if (readable("title")) {
    if (/[\r\n]/.test(d.title)) fail("title", "'title' is one line of text");
    else if (d.title.trim().length < 1 || d.title.trim().length > TITLE_MAX) fail("title", `'title' is 1 to ${TITLE_MAX} characters`);
    data.title = d.title;
  }

  if (!("repo" in d)) fail("repo", "'repo' is required: a project with no repository has nothing to index or relate");
  for (const key of LINK_KEYS) {
    if (!readable(key)) continue;
    const problem = linkProblem(key, d[key]);
    if (problem) fail(key, `'${key}' ${problem}`);
    data[key] = d[key];
  }

  if (readable("related")) {
    const r = readRelated(d.related, slug);
    if (r.error) fail("related", r.error);
    else data.related = r.slugs;
  }

  if (readable("created")) {
    if (!isRealDay(d.created)) fail("created", "'created' is a date written YYYY-MM-DD");
    data.created = d.created;
  }

  if (others) {
    const rest = others.filter((o) => o && o.slug !== slug);
    const known = new Set(rest.map((o) => o.slug));
    const missing = data.related.filter((s) => !known.has(s));
    if (missing.length) {
      warnings.push({ line: lineOf("related"), key: "related", msg: `'related' names ${missing.map((s) => `'${s}'`).join(", ")}, which ${missing.length === 1 ? "has" : "have"} no project file in this workspace` });
    }
    if (typeof data.repo === "string") {
      const mine = normalizeRepo(data.repo);
      const same = rest.filter((o) => typeof o.repo === "string" && normalizeRepo(o.repo) === mine).map((o) => o.slug);
      if (same.length) warnings.push({ line: lineOf("repo"), key: "repo", msg: `'repo' is the repository ${same.map((s) => `'${s}'`).join(", ")} also ${same.length === 1 ? "names" : "name"}` });
    }
  }

  return { ok: errors.length === 0, isProject: true, data, errors, warnings };
}

// ---------------------------------------------------------------------------------------------
// The employer-shaped link
// ---------------------------------------------------------------------------------------------
//
// A link is employer-shaped when its HOST is one of two shapes. That is all this recognises. A repo
// under an employer's organisation on a public forge has the shape of a personal one, and so does
// a self-hosted tool on a company domain; neither is caught, and no list could catch them. The
// check exists so the recognisable cases cannot be written by accident, not to clear what passes.

/** Top-level names that exist only inside a private network. */
const PRIVATE_SUFFIXES = Object.freeze(["internal", "corp", "lan", "intranet", "local", "home.arpa"]);

/**
 * Hosted work tools that give each organisation its own address. `tenant` says where the
 * organisation sits: `subdomain` is `<tenant>.<suffix>`, `path` is the first path segment on the
 * suffix itself.
 *
 * Kept short on purpose. Every row refuses a person who uses that tool for a project of their own,
 * so a row is here only when the tool is sold to organisations and the address names one. A public
 * forge is never a row: an organisation there has the same shape as a person. `test/project-file.test.js`
 * holds one test per row and fails when a row has none.
 */
export const WORK_TOOLS = Object.freeze([
  // Jira and Confluence Cloud: a site per organisation. The example the design spec uses.
  Object.freeze({ suffix: "atlassian.net", tenant: "subdomain" }),
  // Microsoft 365: every SharePoint site and shared document sits under the tenant's name.
  Object.freeze({ suffix: "sharepoint.com", tenant: "subdomain" }),
  // Azure DevOps, the older address: one subdomain per organisation, for repos and boards.
  Object.freeze({ suffix: "visualstudio.com", tenant: "subdomain" }),
  // Azure DevOps, the current address: the organisation is the first path segment.
  Object.freeze({ suffix: "dev.azure.com", tenant: "path" }),
  // Slack: a workspace per organisation. A channel link is a common "tracker" or "docs" value.
  Object.freeze({ suffix: "slack.com", tenant: "subdomain" }),
  // ServiceNow: an instance per organisation, used for tickets and change records.
  Object.freeze({ suffix: "service-now.com", tenant: "subdomain" }),
]);

/** Subdomains a vendor keeps for itself. `api.slack.com` is Slack, not a tenant called api. */
const NOT_A_TENANT = new Set(["www", "api", "app", "status", "support", "developer", "marketplace"]);

function privateNetwork(host) {
  const h = host.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  // fc00::/7 is unique-local, fe80::/10 is link-local.
  if (h.includes(":")) return /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
  if (!h.includes(".")) return h !== "";
  return PRIVATE_SUFFIXES.some((s) => h.endsWith(`.${s}`));
}

function workToolTenant({ host, path }) {
  for (const { suffix, tenant } of WORK_TOOLS) {
    if (tenant === "path") {
      if (host === suffix && path.split("/").some(Boolean)) return true;
    } else if (host.endsWith(`.${suffix}`)) {
      if (!NOT_A_TENANT.has(host.slice(0, -suffix.length - 1))) return true;
    }
  }
  return false;
}

/**
 * The employer shape of one link: `{ shape: "private-network" | "work-tool-tenant" }`, or null.
 * Null means "not one of the two shapes", never "personal".
 */
export function employerShape(link) {
  const at = hostOf(link);
  if (!at) return null;
  if (privateNetwork(at.host)) return { shape: "private-network" };
  if (workToolTenant(at)) return { shape: "work-tool-tenant" };
  return null;
}

/** Every employer-shaped link in a file's data, as `[{ field, shape }]`. All four fields, repo included. */
export function employerLinks(data) {
  const out = [];
  for (const field of LINK_KEYS) {
    const hit = typeof data?.[field] === "string" ? employerShape(data[field]) : null;
    if (hit) out.push({ field, shape: hit.shape });
  }
  return out;
}

const SHAPE_WORDS = {
  "private-network": "a private-network host",
  "work-tool-tenant": "a tenant of a hosted work tool",
};

/**
 * The firewall, for a project file. Returns null when this install may hold the file, or
 * `{ code, links, reason, message }` when it may not.
 *
 * It reads `policy.refuses` from the object `core/profile.js` hands out and nothing else: no
 * environment variable, no profile name. A fourth profile that refuses employer material is
 * covered without this function or any caller changing. A missing policy throws — a caller that
 * forgot to pass one must not be read as an install that refuses nothing.
 *
 * `reason` names the field and the shape and never the link, so a reader that withholds a file can
 * still say why.
 */
export function profileRefusal(data, policy) {
  if (!policy || typeof policy !== "object" || typeof policy.refuses !== "string") {
    throw new TypeError("profileRefusal needs the policy object from core/profile.js");
  }
  if (policy.refuses !== "employer") return null;
  const links = employerLinks(data);
  if (!links.length) return null;
  const reason = links.map((l) => `\`${l.field}\` is a link to ${SHAPE_WORDS[l.shape]}`).join("; ");
  const where = policy.label ? `a ${policy.label} install` : "this install";
  return {
    code: "employer_shaped_link",
    links,
    reason,
    message:
      `refused on ${where}: ${reason}. A project with a link like that belongs in a work install, ` +
      "and there is no override here. This check is a floor: it recognises private-network hosts and " +
      "tenants of a few hosted work tools, so a file that passes it is not cleared.",
  };
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

/** A value as it goes on a frontmatter line: plain when the grammar reads it back whole, quoted when not. */
function plain(value) {
  const v = Array.isArray(value) ? value.join(", ") : String(value);
  const s = scalar(v);
  const safe = !s.error && s.value === v && v === v.trim() && !/^[-#'"]/.test(v) && !/[\u0000-\u001f]/.test(v);
  return safe ? v : JSON.stringify(v);
}

/**
 * The text of a project file from its fields. `type: project` is always written; a field that is
 * absent or empty is left out. Rendering does not validate — the caller validates the result, so
 * a bad field fails there with its line and is never quietly repaired here.
 */
export function renderProjectFile(fields, prose = "") {
  const lines = ["---", "type: project"];
  for (const key of KEYS) {
    if (key === "type") continue;
    const v = fields?.[key];
    if (v === undefined || v === null || (Array.isArray(v) && !v.length)) continue;
    if (key !== "title" && v === "") continue;
    lines.push(`${key}: ${plain(v)}`);
  }
  lines.push("---");
  const body = String(prose ?? "").trim();
  return `${lines.join("\n")}\n${body ? `\n${body}\n` : ""}`;
}

/**
 * Change frontmatter lines and nothing else. A key the file has is replaced where it stands; a key
 * it lacks is added before the closing `---`. Everything after the frontmatter comes back byte for
 * byte, and each changed line keeps the line ending the file uses. A file with no frontmatter is
 * returned unchanged.
 */
export function setFrontmatter(text, changes) {
  const src = String(text ?? "");
  const head = /^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/.exec(src)?.[0];
  if (!head) return src;
  const eol = head.includes("\r\n") ? "\r\n" : "\n";
  const lines = head.match(/[^\n]*\n|[^\n]+$/g);
  const closing = lines.length - 1;
  const added = [];
  for (const key of KEYS) {
    if (!(key in changes) || changes[key] === undefined) continue;
    const line = `${key}: ${plain(changes[key])}`;
    const at = lines.findIndex((l, i) => i > 0 && i < closing && l.startsWith(`${key}:`));
    if (at === -1) added.push(line + eol);
    else lines[at] = line + (lines[at].endsWith("\r\n") ? "\r\n" : "\n");
  }
  lines.splice(closing, 0, ...added);
  return lines.join("") + src.slice(head.length);
}
