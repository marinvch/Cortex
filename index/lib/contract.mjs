// contract.mjs — what one repo serves, calls and emits, as a summary a team-brain can hold (#621).
//
// Design: docs/specs/2026-10-24-team-brain-rollout-design.md, R12. Deterministic like the rest of
// the index: no clock, no network, no model. The same tree gives the same bytes, which is what makes
// a republished contract an empty diff when nothing changed, and the brain's git history of
// `projects/<slug>/contract.json` a changelog of the API.
//
// It reads; it never writes into a team-brain. Publishing is mcp/'s job (`ai-os contract publish`),
// because the leaves never import each other and the index CLI has no business pushing to git.
//
// Where each half comes from:
//   - `serves` — an OpenAPI or Swagger file when the repo has one with paths, else the route
//     handlers `lib/routes.mjs` already extracted into `index.routes.handlers`. Not both: a spec
//     names operation ids and response schemas, and mixing it with regex-read handlers would make a
//     route missing from the spec look served. `source` says which.
//   - `calls` — `index.routes.calls`: fetch/axios-style and Python client call sites with a literal
//     path. One detector for routes, `lib/routes.mjs`; this module does not keep a second.
//   - `events` — an AsyncAPI file, plus a few literal topic names in Kafka and RabbitMQ code. May
//     be empty, and usually is.
//   - `unread` — what could not be read and why: runtime-built URLs, a spec file that does not
//     parse, languages Cortex reads no routes in. Every list here is a FLOOR.
//
// What never goes in: a code body, a line number (a line moves on every unrelated edit and would
// make every republish a change), a query string (it can carry a key), an environment value, the
// absolute root. The publish side passes the whole text through the secret gate as well.
//
// YAML is read by `parseYaml` below, a subset reader — block mappings and sequences, quoted and
// plain scalars, block scalars, simple flow collections. ADR 0004 rules out a parser dependency.
// What it cannot read is reported in `unread`, never guessed.

import { normalizeRoutePath } from "./routes.mjs";

export const CONTRACT_FORMAT = 1;

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const SPEC_FILE = /(?:^|[._-])(?:openapi|swagger|asyncapi)(?:[._-]|$)/i;
const SPEC_EXT = /\.(?:json|ya?ml)$/i;
/** The code languages `lib/routes.mjs` reads handlers or calls in. Any other is reported unread. */
const READ_LANGS = new Set(["javascript", "typescript", "java", "python"]);
const MAX_FILES_PER_ROW = 5;

// --- a YAML subset ------------------------------------------------------------------------------

export class YamlUnsupported extends Error {
  constructor(line, why) {
    super(`line ${line}: ${why}`);
    this.name = "YamlUnsupported";
  }
}

/** Strip a trailing ` # comment` that sits outside quotes. */
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q && !(q === '"' && s[i - 1] === "\\")) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      if (i === 0 || /[\s:[{,-]/.test(s[i - 1])) q = c;
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s;
}

function unquoteYaml(s) {
  const t = s.trim();
  if (t.length >= 2 && t[0] === "'" && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t.length >= 2 && t[0] === '"' && t.endsWith('"')) {
    try {
      return JSON.parse(t);
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

/** Split a flow collection's body on top-level commas. */
function splitFlow(body) {
  const out = [];
  let depth = 0;
  let q = null;
  let cur = "";
  for (const c of body) {
    if (q) {
      cur += c;
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x !== "");
}

/** The key of `key: value` and the index of its separator, or null. */
function splitKey(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      continue;
    }
    if ((c === '"' || c === "'") && i === 0) {
      q = c;
      continue;
    }
    if (c === ":" && (i + 1 === s.length || s[i + 1] === " " || s[i + 1] === "\t")) {
      return { key: unquoteYaml(s.slice(0, i)), rest: s.slice(i + 1).trim() };
    }
  }
  return null;
}

function scalar(raw, line) {
  const s = raw.trim();
  if (s.startsWith("[") && s.endsWith("]")) return splitFlow(s.slice(1, -1)).map((x) => scalar(x, line));
  if (s.startsWith("{") && s.endsWith("}")) {
    const obj = {};
    for (const part of splitFlow(s.slice(1, -1))) {
      const kv = splitKey(part) ?? (part.includes(":") ? { key: unquoteYaml(part.slice(0, part.indexOf(":"))), rest: part.slice(part.indexOf(":") + 1) } : null);
      if (!kv) throw new YamlUnsupported(line, "a flow mapping this reader cannot split");
      obj[kv.key] = scalar(kv.rest, line);
    }
    return obj;
  }
  if (s.startsWith("[") || s.startsWith("{")) throw new YamlUnsupported(line, "a flow collection over several lines");
  if (s.startsWith("*") || s.startsWith("&") || s.startsWith("!")) throw new YamlUnsupported(line, "an anchor, alias or tag");
  if (s === "null" || s === "~" || s === "") return null;
  return unquoteYaml(s);
}

/**
 * Parse the first document of a YAML text into plain objects, arrays and strings. Throws
 * `YamlUnsupported` for anything outside the subset rather than returning a wrong tree.
 */
export function parseYaml(text) {
  const lines = [];
  const src = String(text).replace(/\r\n?/g, "\n").replace(/^﻿/, "").split("\n");
  for (let n = 0; n < src.length; n++) {
    const rawLine = src[n];
    if (/^(?:---|\.\.\.)\s*$/.test(rawLine)) {
      if (lines.length) break;
      continue;
    }
    if (/^\s*%/.test(rawLine) && !lines.length) continue; // a directive
    if (/\t/.test(rawLine.match(/^\s*/)[0])) throw new YamlUnsupported(n + 1, "a tab in indentation");
    lines.push({ n: n + 1, raw: rawLine, indent: rawLine.match(/^ */)[0].length });
  }
  let i = 0;
  const content = (l) => stripComment(l.raw.slice(l.indent));
  const skipBlank = () => {
    while (i < lines.length && content(lines[i]).trim() === "") i++;
  };

  function blockScalar(parentIndent, style) {
    const out = [];
    let ind = null;
    while (i < lines.length) {
      const l = lines[i];
      if (l.raw.trim() === "") {
        out.push("");
        i++;
        continue;
      }
      if (l.indent <= parentIndent) break;
      if (ind === null) ind = l.indent;
      out.push(l.raw.slice(Math.min(ind, l.indent)));
      i++;
    }
    while (out.length && out[out.length - 1] === "") out.pop();
    return style.startsWith(">") ? out.join(" ") : out.join("\n");
  }

  function value(rest, indent, line) {
    if (/^[|>][-+0-9]*$/.test(rest)) {
      i++;
      return blockScalar(indent, rest);
    }
    if (rest === "") {
      i++;
      skipBlank();
      if (i >= lines.length) return null;
      const next = lines[i];
      const text = content(next);
      if (next.indent > indent) return block(next.indent);
      if (next.indent === indent && /^-(?:\s|$)/.test(text)) return block(indent);
      return null;
    }
    // A plain scalar may continue on deeper lines (a wrapped description).
    let s = rest;
    i++;
    while (i < lines.length) {
      const l = lines[i];
      const t = content(l).trim();
      if (t === "" || l.indent <= indent || splitKey(t) || /^-(?:\s|$)/.test(t)) break;
      if (/^["']/.test(rest) || /^[[{]/.test(rest)) break;
      s += ` ${t}`;
      i++;
    }
    return scalar(s, line);
  }

  function block(indent) {
    skipBlank();
    const first = content(lines[i]);
    return /^-(?:\s|$)/.test(first) ? sequence(indent) : mapping(indent);
  }

  function mapping(indent) {
    const obj = {};
    for (;;) {
      skipBlank();
      if (i >= lines.length) return obj;
      const l = lines[i];
      if (l.indent < indent) return obj;
      if (l.indent > indent) throw new YamlUnsupported(l.n, "unexpected indentation");
      const t = content(l);
      if (/^-(?:\s|$)/.test(t)) return obj;
      if (t.startsWith("? ")) throw new YamlUnsupported(l.n, "a complex key");
      const kv = splitKey(t);
      if (!kv) throw new YamlUnsupported(l.n, "a line that is neither a key nor a list item");
      if (kv.key === "<<") throw new YamlUnsupported(l.n, "a merge key");
      obj[kv.key] = value(kv.rest, indent, l.n);
    }
  }

  function sequence(indent) {
    const arr = [];
    for (;;) {
      skipBlank();
      if (i >= lines.length) return arr;
      const l = lines[i];
      const t = content(l);
      if (l.indent !== indent || !/^-(?:\s|$)/.test(t)) {
        if (l.indent > indent) throw new YamlUnsupported(l.n, "unexpected indentation");
        return arr;
      }
      const rest = t.slice(1).trimStart();
      if (rest === "") {
        arr.push(value("", indent, l.n));
        continue;
      }
      const offset = l.indent + (t.length - rest.length);
      const kv = splitKey(rest);
      if (kv && !/^["'[{]/.test(rest)) {
        // `- key: value` opens a mapping whose keys sit at the column after the dash.
        lines[i] = { n: l.n, raw: " ".repeat(offset) + rest, indent: offset };
        arr.push(mapping(offset));
        continue;
      }
      arr.push(value(rest, offset, l.n));
    }
  }

  skipBlank();
  if (i >= lines.length) return null;
  const root = block(lines[i].indent);
  skipBlank();
  if (i < lines.length) throw new YamlUnsupported(lines[i].n, "text after the end of the top-level block");
  return root;
}

// --- reading a spec -------------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** `#/components/schemas/Item` → the object it points at in `doc`, or null. */
function deref(doc, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  let cur = doc;
  for (const raw of ref.slice(2).split("/")) {
    const k = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObj(cur) || !(k in cur)) return null;
    cur = cur[k];
  }
  return cur;
}

const refName = (ref) => (typeof ref === "string" ? ref.split("/").pop().replace(/~1/g, "/").replace(/~0/g, "~") : null);

function schemaName(schema) {
  if (!isObj(schema)) return null;
  if (str(schema.$ref)) return refName(schema.$ref);
  if (schema.type === "array" && isObj(schema.items)) {
    const inner = schemaName(schema.items);
    return inner ? `${inner}[]` : null;
  }
  return null;
}

/** The schema name of an operation's first success response, or null. */
function responseName(doc, op) {
  const responses = isObj(op.responses) ? op.responses : {};
  const codes = Object.keys(responses).filter((c) => /^2(?:\d\d|XX)$/i.test(c)).sort();
  if (!codes.length) return null;
  let resp = responses[codes[0]];
  if (isObj(resp) && str(resp.$ref)) resp = deref(doc, resp.$ref) ?? resp;
  if (!isObj(resp)) return null;
  if (isObj(resp.schema)) return schemaName(resp.schema);
  if (isObj(resp.content)) {
    const types = Object.keys(resp.content).sort();
    const pick = types.includes("application/json") ? "application/json" : types[0];
    const media = resp.content[pick];
    return isObj(media) ? schemaName(media.schema) : null;
  }
  if (str(resp.$ref)) return refName(resp.$ref);
  return null;
}

/** The path prefix a spec puts in front of every path: Swagger's basePath, or one literal server. */
function specPrefix(doc) {
  if (str(doc.basePath)) return doc.basePath.trim();
  if (Array.isArray(doc.servers) && doc.servers.length === 1 && isObj(doc.servers[0])) {
    const url = str(doc.servers[0].url);
    if (url && !url.includes("{")) {
      const p = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "");
      return p.startsWith("/") ? p : "";
    }
  }
  return "";
}

const joinPath = (a, b) => {
  const parts = [a, b].map((p) => String(p ?? "").replace(/^\/+|\/+$/g, "")).filter(Boolean);
  return `/${parts.join("/")}`;
};

function openApiServes(doc, file) {
  const prefix = specPrefix(doc);
  const out = [];
  for (const raw of Object.keys(doc.paths).sort()) {
    const item = doc.paths[raw];
    if (!isObj(item)) continue;
    for (const m of METHODS) {
      const op = item[m];
      if (!isObj(op)) continue;
      const full = joinPath(prefix, raw);
      const path = normalizeRoutePath(full);
      if (!path) continue;
      const row = { method: m.toUpperCase(), path, raw: full };
      if (str(op.operationId)) row.operationId = op.operationId.trim();
      const response = responseName(doc, op);
      if (response) row.response = response;
      row.files = [file];
      out.push(row);
    }
  }
  return out;
}

function asyncApiEvents(doc, file) {
  const out = [];
  const channels = isObj(doc.channels) ? doc.channels : {};
  if (isObj(doc.operations)) {
    // AsyncAPI 3: operations name an action and a channel.
    for (const id of Object.keys(doc.operations).sort()) {
      const op = doc.operations[id];
      if (!isObj(op)) continue;
      const kind = op.action === "send" ? "publish" : op.action === "receive" ? "consume" : null;
      if (!kind) continue;
      const ch = isObj(op.channel) ? deref(doc, op.channel.$ref) : null;
      const name = (isObj(ch) && str(ch.address)) || refName(op.channel?.$ref) || id;
      out.push({ kind, name, files: [file] });
    }
    return out;
  }
  // AsyncAPI 2: `subscribe` is what this application sends, `publish` what it receives.
  for (const name of Object.keys(channels).sort()) {
    const ch = channels[name];
    if (!isObj(ch)) continue;
    if (isObj(ch.subscribe)) out.push({ kind: "publish", name, files: [file] });
    if (isObj(ch.publish)) out.push({ kind: "consume", name, files: [file] });
  }
  return out;
}

/**
 * One spec file → `{ serves, events, unread }`. A file named like a spec that is not one (a
 * generator config, say) contributes nothing and is not reported.
 */
export function readSpecFile(file, text) {
  if (text === null || text === undefined) return { serves: [], events: [], unread: [{ what: file, why: "could not be read" }] };
  let doc;
  try {
    doc = /\.json$/i.test(file) ? JSON.parse(text) : parseYaml(text);
  } catch (e) {
    const why = e instanceof YamlUnsupported ? `YAML this reader does not cover (${e.message})` : `not valid JSON (${String(e.message).split("\n")[0]})`;
    return { serves: [], events: [], unread: [{ what: file, why }] };
  }
  if (!isObj(doc)) return { serves: [], events: [], unread: [] };
  if (str(doc.openapi) || str(doc.swagger) || doc.swagger === 2) {
    if (!isObj(doc.paths)) return { serves: [], events: [], unread: [{ what: file, why: "an OpenAPI file with no paths" }] };
    return { serves: openApiServes(doc, file), events: [], unread: [] };
  }
  if (str(doc.asyncapi)) return { serves: [], events: asyncApiEvents(doc, file), unread: [] };
  return { serves: [], events: [], unread: [] };
}

// --- events in code ---------------------------------------------------------------------------------

const EVENT_RULES = [
  // kafkajs: producer.send({ topic: "orders" }), consumer.subscribe({ topic: "orders" } | { topics: [...] })
  { kind: "publish", lang: /^(?:javascript|typescript)$/, re: /\.send\s*\(\s*\{[^}]*?\btopic\s*:\s*(["'`])([\w.\-/]+)\1/g },
  { kind: "consume", lang: /^(?:javascript|typescript)$/, re: /\.subscribe\s*\(\s*\{[^}]*?\btopics?\s*:\s*\[?\s*(["'`])([\w.\-/]+)\1/g },
  // Spring Kafka and RabbitMQ.
  { kind: "consume", lang: /^(?:java|kotlin)$/, re: /@KafkaListener\s*\([^)]*?\btopics\s*=\s*\{?\s*(")([\w.\-/]+)"/g },
  { kind: "consume", lang: /^(?:java|kotlin)$/, re: /@RabbitListener\s*\([^)]*?\bqueues\s*=\s*\{?\s*(")([\w.\-/]+)"/g },
  { kind: "publish", lang: /^(?:java|kotlin)$/, re: /\bkafkaTemplate\s*\.\s*send\s*\(\s*(")([\w.\-/]+)"/gi },
];

function codeEvents(files, read) {
  const out = [];
  for (const f of files) {
    const rules = EVENT_RULES.filter((r) => r.lang.test(f.lang ?? ""));
    if (!rules.length) continue;
    const text = read(f.path);
    if (typeof text !== "string" || !/topic|Listener|kafkaTemplate/i.test(text)) continue;
    for (const r of rules) {
      for (const m of text.matchAll(r.re)) {
        // A comment naming a call is not one. Line-based, which is enough for a one-line call.
        const line = text.slice(text.lastIndexOf("\n", m.index) + 1, m.index).trimStart();
        if (/^(?:\/\/|\/\*|\*)/.test(line)) continue;
        out.push({ kind: r.kind, name: m[2], files: [f.path] });
      }
    }
  }
  return out;
}

// --- assembling ------------------------------------------------------------------------------------

/** Merge rows that share `key(row)`, keeping the union of their files (sorted, capped). */
function merge(rows, key, order) {
  const by = new Map();
  for (const r of rows) {
    const k = key(r);
    const prev = by.get(k);
    if (!prev) by.set(k, { ...r, files: [...r.files] });
    else prev.files.push(...r.files);
  }
  const out = [...by.values()];
  for (const r of out) {
    const files = [...new Set(r.files)].sort();
    r.files = files.slice(0, MAX_FILES_PER_ROW);
    if (files.length > MAX_FILES_PER_ROW) r.moreFiles = files.length - MAX_FILES_PER_ROW;
    else delete r.moreFiles;
  }
  return out.sort(order);
}

const byEndpoint = (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || String(a.host ?? "").localeCompare(String(b.host ?? ""));

/** A host with its credentials and port stripped; null when none. */
function cleanHost(h) {
  if (!h) return null;
  const host = String(h).split("@").pop().split(":")[0].toLowerCase();
  return host || null;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * The contract of one repo, from its index and a reader of its text.
 *
 * @param {object} index  an index from `buildIndex` (needs `files` and `routes`)
 * @param {(path: string) => string|null} read
 * @param {{ project?: string|null }} [opts]
 */
export function extractContract(index, read, { project = null } = {}) {
  const files = (index?.files ?? []).filter((f) => !f.isTest && !f.vendored);
  const routes = index?.routes ?? { calls: [], bases: [], handlers: [], unread: { calls: 0, handlers: 0 } };
  const unread = [];

  // The spec files: named like one, JSON or YAML, not a test, not vendored.
  const specServes = [];
  const specEvents = [];
  for (const f of files) {
    const base = f.path.split("/").pop();
    if (!SPEC_EXT.test(base) || !SPEC_FILE.test(base.replace(SPEC_EXT, ""))) continue;
    const r = readSpecFile(f.path, read(f.path));
    specServes.push(...r.serves);
    specEvents.push(...r.events);
    unread.push(...r.unread);
  }

  let source;
  let serves;
  if (specServes.length) {
    source = "openapi";
    serves = specServes;
  } else if ((routes.handlers ?? []).length) {
    source = "routes";
    serves = routes.handlers.map((h) => ({ method: h.method, path: h.path, raw: h.raw, files: [h.file] }));
  } else {
    source = "none";
    serves = [];
  }
  serves = merge(serves, (r) => `${r.method} ${r.path}`, byEndpoint);

  const calls = merge(
    (routes.calls ?? []).map((c) => {
      const host = cleanHost(c.host);
      return { method: c.method ?? "ANY", path: c.path, ...(host ? { host } : {}), files: [c.file] };
    }),
    (r) => `${r.method} ${r.path} ${r.host ?? ""}`,
    byEndpoint,
  );
  const bases = [...new Set((routes.bases ?? []).map((b) => b.prefix))].sort();

  const events = merge(
    [...specEvents, ...codeEvents(files, read)],
    (e) => `${e.kind} ${e.name}`,
    (a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind),
  );

  const ru = routes.unread ?? { calls: 0, handlers: 0 };
  if (ru.calls) unread.push({ what: plural(ru.calls, "call"), why: "the URL is built at runtime, so its path was not read" });
  if (ru.handlers) unread.push({ what: plural(ru.handlers, "route handler"), why: "the path is built at runtime or is not a literal, so it was not read" });
  const other = new Map();
  for (const f of files) {
    if (f.category !== "code" || READ_LANGS.has(f.lang)) continue;
    other.set(f.lang, (other.get(f.lang) ?? 0) + 1);
  }
  for (const [lang, n] of [...other].sort((a, b) => a[0].localeCompare(b[0]))) {
    unread.push({ what: `${lang} (${plural(n, "file")})`, why: `Cortex reads no route handlers or calls in ${lang}` });
  }
  unread.sort((a, b) => a.what.localeCompare(b.what) || a.why.localeCompare(b.why));

  const contract = {
    format: CONTRACT_FORMAT,
    project: project ?? null,
    source,
    serves,
    calls,
    bases,
    events,
    unread,
  };
  if (!serves.length && !calls.length && !events.length) {
    contract.reason =
      "No HTTP surface Cortex can read: no OpenAPI or Swagger file with paths, no route handler " +
      "(Spring, Express-style, NestJS, FastAPI, Flask) and no call with a literal path" +
      (unread.length ? ". `unread` lists what was not read." : ".");
  }
  return contract;
}

/** The contract as the bytes `cortex-contract.mjs` writes. Two runs on one tree are identical. */
export function renderContractJson(contract) {
  return `${JSON.stringify(contract, null, 2)}\n`;
}
