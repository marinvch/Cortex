// routes.mjs — the FE ↔ BE route map: who serves this call?
//
// Design: docs/specs/2026-09-27-route-map-design.md. Two halves, kept apart on purpose:
//
// - `extractRoutes(files, read)` runs inside `buildIndex`, per repo, and becomes `index.routes`.
//   Pure: the file list and a reader in, rows out. Same tree, same bytes.
// - `resolveRoutes(repos)` joins those rows across the repos of one workspace. Also pure; the CLI
//   (`cortex-routes.mjs`) owns finding the repos and reading their indexes.
//
// Regex over text, like every resolver here (ADR 0004): a URL assembled at runtime is invisible, so
// it is COUNTED in `unread` rather than guessed at, and every "nothing calls this" is a floor.
//
// One normal form for a path, used by both halves: `/orders/{}/events`. Every variable — Spring's
// `{id}` and `{id:\d+}`, Express's `:id`, a template literal's `${id}` — is `{}`, and a segment that
// holds any variable is a variable.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// --- the normal form ------------------------------------------------------------------------------

const VAR_SEGMENT = /\$\{\}|\{[^/{}]*\}|^:[\w$]+[?]?$/;

/**
 * A URL or route pattern → `/a/{}/b`, or null when it is not a path.
 *
 * Origin, query, fragment, doubled and trailing slashes go; every variable becomes `{}`.
 */
export function normalizeRoutePath(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.replace(/\r/g, "").trim();
  const origin = s.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i);
  if (origin) s = s.slice(origin[0].length) || "/";
  if (!s.startsWith("/")) return null;
  s = s.replace(/[?#].*$/s, "");
  const segs = s
    .split("/")
    .filter(Boolean)
    .map((seg) => (VAR_SEGMENT.test(seg) ? "{}" : seg));
  return `/${segs.join("/")}`;
}

/** Trailing catch-alls — `*`, `**`, `:path*`, `(.*)`, `{*rest}` — mark a prefix, not a segment. */
function stripWildcards(raw) {
  const segs = raw.split("/");
  while (segs.length > 1 && /^(?:\*\*?|:[\w$]+[*+]|\(\.\*\)|\{\*[\w$]*\})$/.test(segs[segs.length - 1])) segs.pop();
  const out = segs.join("/");
  return out === "" ? "/" : out;
}

const segsOf = (path) => (path === "/" ? [] : path.slice(1).split("/"));
const pathOf = (segs) => `/${segs.join("/")}`;

// --- text plumbing --------------------------------------------------------------------------------

const lf = (text) => text.replace(/\r\n?/g, "\n");

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

// A placeholder for one `${…}` inside a template literal's value. A NUL cannot occur in an indexed
// file (walk.mjs drops anything that holds one), so it cannot collide with real text.
const HOLE = "\u0000";

/**
 * JS/TS text → `{ code, literals, mask }`.
 *
 * `code` is the text with comments blanked to spaces (newlines kept, so offsets and line numbers
 * survive). String, template and regex literals stay in `code` — a key like `method: "POST"` is
 * read straight off it — but `mask` marks every character inside one, so a `fetch(` in a string or
 * a `{` in a regex is never mistaken for code. `literals` are the string and template literals by
 * start offset, each with its value; a template's `${…}` becomes `HOLE`.
 */
// The characters a string of each kind has to stop at. Everything between them is copied as a slice.
const STOPS = { '"': /["\\\n]/g, "'": /['\\\n]/g, "`": /[`\\$]/g };
const INTERESTING = /[/'"`]/g;
// After one of these, a `/` starts a regex literal rather than dividing.
const REGEX_AFTER = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "yield", "await"]);

function scanJs(text) {
  const n = text.length;
  const mask = new Uint8Array(n);
  const literals = new Map();
  const parts = []; // `code`, assembled from slices with the comments blanked
  let last = 0;
  const blank = (a, b) => {
    parts.push(text.slice(last, a), text.slice(a, b).replace(/[^\n]/g, " "));
    last = b;
  };

  // Returns the index just past the closing quote/backtick, and the literal's value.
  function scanString(i, q) {
    const stop = STOPS[q];
    let j = i + 1;
    let value = "";
    for (;;) {
      stop.lastIndex = j;
      const m = stop.exec(text);
      if (!m) {
        value += text.slice(j);
        return { end: n, value };
      }
      value += text.slice(j, m.index);
      j = m.index;
      const ch = text[j];
      if (ch === q) return { end: j + 1, value };
      if (ch === "\n") return { end: j, value }; // an unterminated '…' or "…" ends at the line
      if (ch === "\\") {
        value += text[j + 1] ?? "";
        j += 2;
        continue;
      }
      if (text[j + 1] === "{") {
        value += HOLE;
        j = skipExpression(j + 2);
        continue;
      }
      value += ch; // a `$` that opens nothing
      j += 1;
    }
  }

  // Past the `}` that closes a template expression, stepping over nested literals.
  function skipExpression(j) {
    let depth = 0;
    while (j < n) {
      const c = text[j];
      if (c === "'" || c === '"' || c === "`") {
        j = scanString(j, c).end;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        if (depth === 0) return j + 1;
        depth--;
      }
      j++;
    }
    return n;
  }

  // Regex or division? Decided by what precedes the `/`, read backwards over whitespace. `</div>` in
  // JSX is a closing tag, not a regex after `<`.
  function regexStarts(i) {
    let j = i - 1;
    while (j >= 0 && (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r")) j--;
    if (j < 0) return true;
    const p = text[j];
    if (p === "<" && j === i - 1) return false;
    if (REGEX_AFTER.has(p)) return true;
    if (!/[\w$]/.test(p)) return false;
    let s = j;
    while (s > 0 && /[\w$]/.test(text[s - 1])) s--;
    return REGEX_AFTER_WORD.has(text.slice(s, j + 1));
  }

  let i = 0;
  while (i < n) {
    INTERESTING.lastIndex = i;
    const hit = INTERESTING.exec(text);
    if (!hit) break;
    i = hit.index;
    const c = text[i];
    const d = text[i + 1];
    if (c === "/" && d === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && d === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const { end, value } = scanString(i, c);
      literals.set(i, { start: i, end, quote: c, value });
      mask.fill(1, i, end);
      i = end;
      continue;
    }
    if (regexStarts(i)) {
      // A regex literal. Scanned to the unescaped `/` outside a character class, on one line.
      let j = i + 1;
      let inClass = false;
      while (j < n && text[j] !== "\n") {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === "[") inClass = true;
        else if (text[j] === "]") inClass = false;
        else if (text[j] === "/" && !inClass) break;
        j++;
      }
      if (j < n && text[j] === "/") {
        j++;
        while (j < n && /[a-z]/i.test(text[j])) j++;
        mask.fill(1, i, j);
        i = j;
        continue;
      }
    }
    i++;
  }
  parts.push(text.slice(last));
  return { code: parts.join(""), literals, mask };
}

/** Java text with comments blanked, offsets kept; string literals stay. */
function javaNoComments(text) {
  const out = text.split("");
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && text[i] !== "\n") out[i++] = " ";
    } else if (c === "/" && d === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      for (; i < stop; i++) if (text[i] !== "\n") out[i] = " ";
    } else if (text.startsWith('"""', i)) {
      let j = i + 3;
      while (j < n && !text.startsWith('"""', j)) j += text[j] === "\\" ? 2 : 1;
      i = Math.min(n, j + 3);
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}

/** Index of the `)` closing the `(` at `open`, stepping over Java/JS string literals. -1 if none. */
function closeParen(code, open, mask = null) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (mask && mask[i]) continue;
    const c = code[i];
    if (!mask && (c === '"' || c === "'")) {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
      i = j;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// --- JS/TS: the arguments of one call -------------------------------------------------------------

/**
 * Walk the argument list whose `(` is at `open`.
 *
 * Returns `{ close, firstEnd, branches }`. `branches` split the first argument on the operators that
 * choose between values — `?`, `:`, `??`, `||` — and each is a list of parts: a string/template
 * literal, or `null` for anything else (an identifier, a call). A `+` keeps the branch, so
 * `"/orders/" + id` is one branch of two parts. Only literals at the top level of the argument
 * count; one inside a nested call is that call's business.
 */
function readArgs(scan, open) {
  const { code, literals, mask } = scan;
  let depth = 0;
  let firstEnd = -1;
  const branches = [[]];
  const push = (part) => {
    const b = branches[branches.length - 1];
    if (part === null && b.length && b[b.length - 1] === null) return;
    b.push(part);
  };
  let i = open + 1;
  while (i < code.length) {
    const lit = literals.get(i);
    if (lit) {
      if (depth === 0 && firstEnd < 0) push(lit);
      i = lit.end;
      continue;
    }
    if (mask[i]) {
      if (depth === 0 && firstEnd < 0) push(null);
      i++;
      continue;
    }
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") {
      if (depth === 0 && firstEnd < 0) push(null);
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) {
        if (firstEnd < 0) firstEnd = i;
        return { close: i, firstEnd, branches };
      }
      depth--;
    } else if (depth === 0 && firstEnd < 0) {
      if (c === ",") firstEnd = i;
      else if (c === "?" && code[i + 1] === "?") { branches.push([]); i += 2; continue; }
      else if (c === "|" && code[i + 1] === "|") { branches.push([]); i += 2; continue; }
      else if (c === "?" && code[i + 1] !== ".") branches.push([]);
      else if (c === ":") branches.push([]);
      else if (c === "+" || /\s/.test(c)) { /* a `+` joins; whitespace is nothing */ }
      else push(null);
    }
    i++;
  }
  return { close: -1, firstEnd, branches };
}

/** One branch → the URL it spells, with `HOLE` for each unknown part; null if it holds no literal. */
function branchValue(parts) {
  if (!parts.some((p) => p)) return null;
  return parts.map((p) => (p ? p.value : HOLE)).join("");
}

/**
 * A spelled URL → `{ path, raw }`, `"unread"` when it is built at runtime, or null when it is not a
 * URL at all. A leading run of unknowns is a base the code prepends — `${API}/orders` keeps
 * `/orders` — but nothing static after it is a runtime-built URL.
 */
function urlOf(value) {
  const rest = value.replace(new RegExp(`^${HOLE}+`), "");
  if (!rest) return "unread";
  if (rest !== value && !rest.startsWith("/")) return "unread";
  const raw = rest.split(HOLE).join("${}");
  const path = normalizeRoutePath(raw);
  if (!path) return null;
  // `base + "/" + id` spells `/{}`: every segment unknown is a URL built at runtime, not a route.
  if (path !== "/" && segsOf(path).every((s) => s === "{}")) return "unread";
  const host = (raw.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#:]*)/i) ?? [])[1] ?? "";
  return { path, raw, host: host.toLowerCase() || null };
}

/** A call row; `host` only when the URL names one, so a third-party API can be told apart. */
const callRow = (file, line, method, u) => ({ file, line, method, path: u.path, raw: u.raw, ...(u.host ? { host: u.host } : {}) });

// --- JS/TS: calls ---------------------------------------------------------------------------------

// `del` is superagent's and several wrappers' spelling of DELETE.
const VERBS = new Map([["get", "GET"], ["post", "POST"], ["put", "PUT"], ["patch", "PATCH"], ["delete", "DELETE"], ["del", "DELETE"], ["head", "HEAD"], ["options", "OPTIONS"]]);
// `x.get("/p")` is a call only when `x` reads as an HTTP client. `app.get("/p", handler)` defines a
// route, and `cache.put("/index.html", res)` in a service worker writes a cache — both real, both
// read as calls until the receiver had to earn it.
const CLIENT_RECEIVERS = new Set(["client", "agent", "instance"]);
const HTTP_WORDS = new Set(["fetch", "request", "http", "https", "api", "axios", "ky", "swr", "xhr"]);
const STRONG_NAMES = new Set(["fetch", "$fetch", "ofetch", "ky", "axios", "got", "request", "superagent", "useSWR", "useFetch"]);

/** `apiClient` → ["api", "client"]; `doFetch` → ["do", "fetch"]. */
function words(ident) {
  return ident
    .replace(/[$]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

// Every identifier followed by `(` reaches these, so the answer is kept per name: a repo calls the
// same few hundred functions thousands of times.
const memo = (fn) => {
  const seen = new Map();
  return (name) => {
    let v = seen.get(name);
    if (v === undefined) seen.set(name, (v = fn(name)));
    return v;
  };
};
const httpish = memo((name) =>
  STRONG_NAMES.has(name) || words(name).some((w) => HTTP_WORDS.has(w) || HTTP_WORDS.has(w.replace(/s$/, ""))));
const clientish = memo((name) => httpish(name) || words(name).some((w) => CLIENT_RECEIVERS.has(w)));
// A name that calls over HTTP whatever its argument is — the set an unreadable argument is counted
// against. `requestAnimationFrame(tick)` is not a runtime-built URL; `doFetch(url)` is.
const strongly = (name) => STRONG_NAMES.has(name) || words(name).includes("fetch");

// The callee alone. Its receiver is read backwards from it: matching `a.b.c(` as one chain let the
// engine re-match the chain from every segment, which cost more than the rest of the extraction.
const CALLEE = /(?<![\w$])([\w$]+)\s*(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>\s*)?\(/g;

/** The identifier ending just before `i` (whitespace skipped), and where it starts. */
function identBefore(code, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(code[j])) j--;
  const end = j + 1;
  while (j >= 0 && /[\w$]/.test(code[j])) j--;
  return { word: code.slice(j + 1, end), start: j + 1, end };
}

// A file naming none of the vocabulary cannot hold a call; most files in a repo are that file.
const MAY_CALL = /fetch|request|http|api|axios|ky|got|superagent|swr|xhr|\.\s*(?:get|post|put|patch|delete|del|head|options)\b/i;

function jsCalls(file, scan, at, rows, unread) {
  const { code, mask } = scan;
  if (!MAY_CALL.test(code)) return;
  for (const m of code.matchAll(CALLEE)) {
    if (mask[m.index]) continue;
    const name = m[1];
    const verb = VERBS.get(name.toLowerCase());
    const named = httpish(name) || name === "Request";
    if (!verb && !named) continue;
    const open = m.index + m[0].length - 1;
    if (mask[open]) continue;

    // `.` or `?.` right before the name makes it a member call; the receiver is the name before that.
    let k = m.index - 1;
    while (k >= 0 && /\s/.test(code[k])) k--;
    let receiver = null;
    if (code[k] === "." && !mask[k]) {
      const r = identBefore(code, code[k - 1] === "?" ? k - 1 : k);
      receiver = r.word || null;
    }
    const prevWord = receiver ? "" : identBefore(code, m.index).word;
    if (!receiver && /^(?:function|async)$/.test(prevWord)) continue; // a declaration, not a call
    if (name === "Request" && prevWord !== "new") continue;

    let method = null;
    let byName = false;
    if (receiver && verb) {
      if (!clientish(receiver)) continue;
      method = verb;
    } else if (named) {
      byName = true;
    } else {
      continue;
    }

    const args = readArgs(scan, open);
    if (args.close < 0) continue;
    // `api.get("/x", (req, res) => …)` is a route definition even under a client-sounding name.
    const rest = code.slice(args.firstEnd + 1, args.close).trimStart();
    if (method && /^(?:async\b|function\b|\([^()]*\)\s*=>|[\w$]+\s*=>)/.test(rest)) continue;

    const found = [];
    let dynamic = false;
    for (const b of args.branches) {
      const v = branchValue(b);
      if (v === null) {
        if (b.length) dynamic = true;
        continue;
      }
      const u = urlOf(v);
      if (u === "unread") dynamic = true;
      else if (u) found.push(u);
    }
    if (!found.length) {
      const counts = byName ? strongly(name) : httpish(receiver ?? "");
      if (dynamic && counts) unread.calls += 1;
      continue;
    }

    if (!method) {
      const init = code.slice(args.firstEnd, args.close);
      const lit = init.match(/\bmethod\s*:\s*(["'`])([A-Za-z]+)\1/);
      // `useApi("/api/user", "PUT")` — a wrapper that takes the verb positionally.
      const second = args.firstEnd < args.close ? staticValue(literalAfter(scan, args.firstEnd + 1)) : null;
      if (second && /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(second)) method = second.toUpperCase();
      else if (lit) method = lit[2].toUpperCase();
      else if (/\bmethod\s*:/.test(init)) method = null; // chosen at runtime: matches any
      else method = "GET";
    }
    const line = at(m.index);
    const seen = new Set();
    for (const u of found) {
      if (seen.has(u.path)) continue;
      seen.add(u.path);
      rows.push(callRow(file, line, method, u));
    }
  }
}

const CONFIG_KEYS = new Set(["method", "body", "data", "params", "headers"]);

/** The method a request-config object declares: its literal, null when chosen at runtime, else GET. */
function configMethod(entries) {
  const m = entries.find((e) => e.key === "method");
  if (!m) return "GET";
  const v = staticValue(m.valueLit);
  return v && /^[A-Za-z]+$/.test(v) ? v.toUpperCase() : null;
}

/**
 * Calls described as data rather than made inline: a request-config object — `url` beside a
 * `method`/`body`/`data`/`params`/`headers` (axios, RTK Query, `$.ajax`) — and an RTK Query
 * endpoint's `query: (…) => "/path"` or `=> ({ url })`. A bare `{ url: "/about" }` is a nav link or a
 * sitemap row and is not read.
 */
function jsConfigCalls(file, scan, at, rows) {
  const { code, mask } = scan;
  for (const open of enclosingObjects(scan, /\burl\s*:/g)) {
    const entries = objectEntries(scan, open);
    const url = entries.find((e) => e.key === "url" && e.valueLit);
    if (!url || !entries.some((e) => CONFIG_KEYS.has(e.key))) continue;
    if (entries.some((e) => PREFIX_KEYS.has(e.key) && staticValue(e.valueLit)?.startsWith("/"))) continue; // a gateway row
    const u = urlOf(url.valueLit.value);
    if (u && u !== "unread") rows.push(callRow(file, at(url.at), configMethod(entries), u));
  }
  for (const m of code.matchAll(/\bquery\s*:\s*(?:async\s*)?(?:\([^()]*\)|[\w$]+)\s*=>\s*/g)) {
    if (mask[m.index]) continue;
    let i = m.index + m[0].length;
    const lit = scan.literals.get(i);
    if (lit) {
      const u = urlOf(lit.value);
      if (u && u !== "unread") rows.push(callRow(file, at(i), "GET", u));
      continue;
    }
    if (code[i] !== "(") continue;
    i++;
    while (/\s/.test(code[i] ?? "")) i++;
    if (code[i] !== "{") continue;
    const entries = objectEntries(scan, i);
    const url = entries.find((e) => e.key === "url" && e.valueLit);
    const u = url ? urlOf(url.valueLit.value) : null;
    if (u && u !== "unread") rows.push(callRow(file, at(url.at), configMethod(entries), u));
  }
}

// --- JS/TS: bases and gateway routes --------------------------------------------------------------

const BASE_KEY = /\b(?:baseUrl|baseURL|basePath|prefixUrl|apiBase|apiBaseUrl|apiUrl|apiRoot|API_BASE|API_BASE_URL|API_URL|API_ROOT|API_PREFIX|BASE_URL)\b\s*[:=](?![=>])\s*/g;
const DEV_CONFIG = /(?:^|\/)(?:vite|webpack|vue|next|nuxt|rsbuild|rspack)\.config\.[cm]?[jt]s$/;

function literalAfter(scan, index) {
  let i = index;
  while (i < scan.code.length && /\s/.test(scan.code[i])) i++;
  return scan.literals.get(i) ?? null;
}

/** String literals from `i` to the end of the expression — `;`, `,`, a newline or a closer at depth 0. */
function expressionLiterals(scan, i) {
  const out = [];
  let depth = 0;
  for (; i < scan.code.length; i++) {
    const lit = scan.literals.get(i);
    if (lit) {
      if (depth === 0) out.push(lit);
      i = lit.end - 1;
      continue;
    }
    if (scan.mask[i]) continue;
    const c = scan.code[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && (c === ";" || c === "," || c === "\n")) break;
  }
  return out;
}

/** A literal with no `${…}` in it, as a plain string; null otherwise. */
const staticValue = (lit) => (lit && !lit.value.includes(HOLE) ? lit.value : null);

function jsBases(file, scan, at, rows) {
  for (const m of scan.code.matchAll(BASE_KEY)) {
    if (scan.mask[m.index]) continue;
    // The whole right-hand side, to the end of the expression: `env.API_URL || "/api"` declares
    // its fallback as plainly as `"/api"` does.
    for (const lit of expressionLiterals(scan, m.index + m[0].length)) {
      const v = staticValue(lit);
      const path = v === null ? null : normalizeRoutePath(v);
      if (path && path !== "/") {
        rows.push({ file, line: at(m.index), prefix: path });
        break;
      }
    }
  }
  if (!DEV_CONFIG.test(file)) return;
  for (const m of scan.code.matchAll(/\bproxy\s*:\s*\{/g)) {
    if (scan.mask[m.index]) continue;
    for (const e of objectEntries(scan, m.index + m[0].length - 1)) {
      const key = e.keyLit ? staticValue(e.keyLit) : null;
      const path = key === null ? null : normalizeRoutePath(key.replace(/^\^/, ""));
      if (path && path !== "/") rows.push({ file, line: at(e.at), prefix: path });
    }
  }
}

/**
 * The entries of the object literal whose `{` is at `open`: `{ key, keyLit, value, valueLit, at }`.
 * Keys are identifiers or string literals; spreads, shorthands and methods are skipped.
 */
function objectEntries(scan, open) {
  const { code, literals, mask } = scan;
  const entries = [];
  let depth = 0;
  let start = open + 1;
  const flush = (end) => {
    const seg = code.slice(start, end);
    const lead = seg.length - seg.trimStart().length;
    const at = start + lead;
    let key = null;
    let keyLit = null;
    let colon = -1;
    const lit = literals.get(at);
    if (lit) {
      keyLit = lit;
      key = lit.value;
      const after = code.slice(lit.end, end).match(/^\s*:/);
      if (after) colon = lit.end + after[0].length;
    } else {
      const km = seg.trimStart().match(/^([\w$]+)\s*:/);
      if (km) {
        key = km[1];
        colon = at + km[0].length;
      }
    }
    if (key !== null && colon >= 0) {
      const valueLit = literalAfter(scan, colon);
      const value = code.slice(colon, end).trim();
      entries.push({ key, keyLit, value, valueLit, at });
    }
  };
  for (let i = open + 1; i < code.length; i++) {
    const lit = literals.get(i);
    if (lit) {
      i = lit.end - 1;
      continue;
    }
    if (mask[i]) continue;
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) {
        flush(i);
        return entries;
      }
      depth--;
    } else if (c === "," && depth === 0) {
      flush(i);
      start = i + 1;
    }
  }
  return entries;
}

const PREFIX_KEYS = new Set(["prefix", "path", "source", "context", "from"]);
const TARGET_KEYS = new Set(["service", "target", "upstream", "destination", "url", "uri", "backend"]);
const REWRITE_KEYS = new Set(["rewrite", "stripPrefix", "replacePath", "rewritePath", "upstreamPath"]);
const PREFIX_HINT = /\b(?:prefix|path|source|context|from)\s*:\s*["'`]\//g;

/** The `{` of the innermost object literal around each match of `hint`, in order, once each. */
function enclosingObjects(scan, hint) {
  const { code, mask } = scan;
  const hints = [...code.matchAll(hint)].map((m) => m.index).filter((i) => !mask[i]);
  if (!hints.length) return [];
  // One pass over the braces alone to learn the innermost `{` enclosing each hint.
  const opens = new Set();
  const stack = [];
  let h = 0;
  const settle = (upTo) => {
    for (; h < hints.length && hints[h] < upTo; h++) if (stack.length) opens.add(stack[stack.length - 1]);
  };
  for (const m of code.matchAll(/[{}]/g)) {
    if (h >= hints.length) break;
    settle(m.index);
    if (mask[m.index]) continue;
    if (m[0] === "{") stack.push(m.index);
    else stack.pop();
  }
  settle(Infinity);
  return [...opens].sort((a, b) => a - b);
}

/** An object literal naming a path prefix and where it goes. */
function jsGatewayObjects(file, scan, at, rows) {
  for (const open of enclosingObjects(scan, PREFIX_HINT)) {
    const entries = objectEntries(scan, open);
    const pre = entries.find((e) => PREFIX_KEYS.has(e.key) && staticValue(e.valueLit)?.startsWith("/"));
    const tgt = entries.find((e) => TARGET_KEYS.has(e.key));
    if (!pre || !tgt) continue;
    // A Next.js `destination` inside the same app is a redirect or an internal rewrite, not a
    // forward to another service: only an absolute URL there names an upstream.
    if (tgt.key === "destination" && !/^[a-z][a-z0-9+.-]*:\/\//i.test(tgt.valueLit?.value ?? "")) continue;
    if (/[()]/.test(staticValue(pre.valueLit))) continue; // a regex-matched source is not a prefix
    const prefix = normalizeRoutePath(stripWildcards(staticValue(pre.valueLit)));
    if (!prefix) continue;
    const target = tgt.valueLit ? tgt.valueLit.value.split(HOLE).join("${}") : tgt.value.replace(/\s+/g, " ");
    let rewrite = null;
    const rw = entries.find((e) => REWRITE_KEYS.has(e.key));
    const rwv = rw ? staticValue(rw.valueLit) : null;
    if (rwv !== null) rewrite = rwv === "" ? "/" : normalizeRoutePath(stripWildcards(rwv));
    else if (tgt.key === "destination" && tgt.valueLit) {
      // A Next.js rewrite: the destination's path is what the upstream receives.
      const dest = tgt.valueLit.value.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "") || "/";
      rewrite = normalizeRoutePath(stripWildcards(dest.split(HOLE).join("${}")));
    }
    rows.push({ file, line: at(pre.at), prefix, rewrite, target });
  }
}

/** `app.use("/p", createProxyMiddleware({ target, pathRewrite: { "^/p": "/q" } }))`. */
function jsProxyMounts(file, scan, at, rows) {
  const { code, mask } = scan;
  for (const m of code.matchAll(/\.\s*use\s*\(/g)) {
    if (mask[m.index]) continue;
    const open = m.index + m[0].length - 1;
    const args = readArgs(scan, open);
    if (args.close < 0 || args.branches.length !== 1) continue;
    const v = branchValue(args.branches[0]);
    if (v === null || v.includes(HOLE)) continue;
    const prefix = normalizeRoutePath(stripWildcards(v));
    const rest = code.slice(args.firstEnd, args.close);
    if (!prefix || !/proxy/i.test(rest)) continue;
    const t = rest.match(/\btarget\s*:\s*(?:(["'`])(.*?)\1|([\w$.]+))/);
    if (!t) continue;
    let rewrite = null;
    const pr = rest.match(/\bpathRewrite\s*:\s*\{\s*(["'`])(.*?)\1\s*:\s*(["'`])(.*?)\3/);
    if (pr && normalizeRoutePath(pr[2].replace(/^\^/, "")) === prefix) {
      rewrite = pr[4] === "" ? "/" : normalizeRoutePath(pr[4]);
    }
    rows.push({ file, line: at(m.index), prefix, rewrite, target: t[2] ?? t[3] });
  }
}

// --- Java: Spring handlers ------------------------------------------------------------------------

const MAPPING = /@(RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\b/g;
const MODIFIERS = /^(?:public|protected|private|abstract|final|static|sealed|non-sealed|strictfp|default|synchronized)\b/;

/** Past any whitespace, annotations and modifiers from `i`; returns the index of what follows. */
function skipDecorations(code, i) {
  for (;;) {
    while (i < code.length && /\s/.test(code[i])) i++;
    if (code[i] === "@" && !code.startsWith("@interface", i)) {
      const m = code.slice(i).match(/^@[\w.]+\s*/);
      i += m ? m[0].length : 1;
      if (code[i] === "(") {
        const close = closeParen(code, i);
        i = close < 0 ? code.length : close + 1;
      }
      continue;
    }
    const mod = code.slice(i, i + 20).match(MODIFIERS);
    if (mod) {
      i += mod[0].length;
      continue;
    }
    return i;
  }
}

/** Java string literals in a snippet, in order. */
const javaStrings = (s) => [...s.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((m) => m[1]);

/** The `{…}` array starting at `i`, stepping over strings — `"/{id}"` holds a brace of its own. */
function javaArray(s, i) {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '"') {
      j++;
      while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
      continue;
    }
    if (s[j] === "}") return s.slice(i, j + 1);
  }
  return s.slice(i);
}

/** The value of `key = …` in annotation arguments; null when absent. */
function annotationValue(args, key) {
  // Named attributes sit outside string literals; blank those before looking for the name.
  const bare = args.replace(/"(?:\\.|[^"\\])*"/g, (m) => `"${"#".repeat(m.length - 2)}"`);
  const named = bare.match(new RegExp(`\\b${key}\\s*=\\s*`));
  if (!named) return null;
  const i = named.index + named[0].length;
  if (args[i] === "{") return javaArray(args, i);
  const m = args.slice(i).match(/^("(?:\\.|[^"\\])*"|[^,)]+)/);
  return m ? m[1].trim() : null;
}

/**
 * The paths an annotation declares: `[""]` when it declares none, `null` when its value is an
 * expression Cortex cannot read (a constant, a concatenation).
 */
function mappingPaths(args) {
  if (args === null) return [""];
  const trimmed = args.trim();
  let expr = annotationValue(trimmed, "value") ?? annotationValue(trimmed, "path");
  if (expr === null) {
    if (trimmed.startsWith('"') || trimmed.startsWith("{")) {
      expr = trimmed.startsWith("{") ? javaArray(trimmed, 0) : trimmed.match(/^"(?:\\.|[^"\\])*"/)[0];
      const after = trimmed.slice(expr.length).trim();
      if (after && !after.startsWith(",")) return null; // "/a" + X
    } else if (!trimmed || /^[\w$]+\s*=/.test(trimmed)) {
      return [""]; // only other attributes: produces =, consumes =, …
    } else {
      return null; // a bare constant
    }
  }
  const strs = javaStrings(expr);
  const leftover = expr.replace(/"(?:\\.|[^"\\])*"/g, "").replace(/[{},\s]/g, "");
  if (leftover) return null;
  return strs.length ? strs : [""];
}

function mappingMethods(kind, args) {
  if (kind !== "RequestMapping") return [kind.replace("Mapping", "").toUpperCase()];
  const expr = args === null ? null : annotationValue(args, "method");
  if (!expr) return ["ANY"];
  const found = [...expr.matchAll(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]);
  return found.length ? [...new Set(found)] : ["ANY"];
}

const joinPaths = (a, b) => {
  const parts = [a, b].map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean);
  return `/${parts.join("/")}`;
};

function javaHandlers(file, text, at, rows, unread) {
  const code = javaNoComments(text);
  if (/@FeignClient\b/.test(code)) return; // a client of someone else's API, not a handler here
  let classPaths = [""];
  for (const m of code.matchAll(MAPPING)) {
    const kind = m[1];
    let end = m.index + m[0].length;
    let args = null;
    const ws = code.slice(end).match(/^\s*/)[0].length;
    if (code[end + ws] === "(") {
      const close = closeParen(code, end + ws);
      if (close < 0) continue;
      args = code.slice(end + ws + 1, close);
      end = close + 1;
    }
    const next = skipDecorations(code, end);
    const isType = /^(?:class|interface|record|enum|@interface)\b/.test(code.slice(next, next + 12));
    const paths = mappingPaths(args);
    if (isType) {
      classPaths = paths;
      continue;
    }
    if (paths === null || classPaths === null) {
      unread.handlers += 1;
      continue;
    }
    const name = (code.slice(next, next + 400).match(/([\w$]+)\s*\(/) ?? [])[1] ?? null;
    const line = at(m.index);
    for (const cp of classPaths) {
      for (const mp of paths) {
        const raw = joinPaths(cp, mp);
        for (const method of mappingMethods(kind, args)) {
          rows.push({ file, line, method, path: normalizeRoutePath(raw), raw, name });
        }
      }
    }
  }
}

// --- Spring application config --------------------------------------------------------------------

const SERVICE_FILE = /(?:^|\/)application\.(?:ya?ml|properties)$/;

function unquote(v) {
  let s = v.trim().replace(/\s+#.*$/, "");
  if (/^(["']).*\1$/.test(s)) s = s.slice(1, -1);
  const ph = s.match(/^\$\{[^:}]+:([^}]*)\}$/);
  return ph ? ph[1] : s;
}

/** The dotted keys of a flat properties file or the first document of a YAML file. */
function configValues(file, text) {
  const out = new Map();
  if (file.endsWith(".properties")) {
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([^#!\s][^=:\s]*)\s*[=:]\s*(.*)$/);
      if (m) out.set(m[1], unquote(m[2]));
    }
    return out;
  }
  const stack = [];
  for (const line of text.split("\n")) {
    if (/^---/.test(line) && out.size) break;
    const m = line.match(/^(\s*)([\w.-]+)\s*:(?:\s+(.*))?$/);
    if (!m || /^\s*#/.test(line)) continue;
    const indent = m[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const key = [...stack.map((s) => s.key), m[2]].join(".");
    const value = (m[3] ?? "").trim();
    if (value && !value.startsWith("#")) out.set(key, unquote(value));
    stack.push({ indent, key: m[2] });
  }
  return out;
}

function service(file, text) {
  const v = configValues(file, text);
  const name = v.get("spring.application.name") || null;
  const portText = v.get("server.port");
  const port = portText && /^\d+$/.test(portText) ? Number(portText) : null;
  const ctx = v.get("server.servlet.context-path") ?? v.get("server.servlet.contextPath") ?? "";
  const contextPath = ctx ? normalizeRoutePath(ctx) ?? "" : "";
  if (!name && port === null && !contextPath) return null;
  return { file, name, port, contextPath: contextPath === "/" ? "" : contextPath };
}

const moduleRoot = (file) => {
  const i = file.indexOf("src/main/resources/");
  return i >= 0 ? file.slice(0, i) : file.slice(0, file.lastIndexOf("/") + 1);
};

// --- extraction -----------------------------------------------------------------------------------

const JS = /\.(?:[cm]?[jt]sx?)$/;

const byRow = (a, b) =>
  a.file.localeCompare(b.file) || a.line - b.line || (a.path ?? a.prefix ?? "").localeCompare(b.path ?? b.prefix ?? "") ||
  String(a.method ?? "").localeCompare(String(b.method ?? ""));

/**
 * Every route fact in one repo, from the index's file list and a reader.
 *
 * `files` are index rows (`path`, `isTest`); `read(path)` returns text or null. Test files are not
 * read: a mocked `fetch("/api/x")` is a fixture, not the product calling its back end.
 */
export function extractRoutes(files, read) {
  const routes = { calls: [], bases: [], gateways: [], handlers: [], services: [], unread: { calls: 0, handlers: 0 } };
  const list = [...(files ?? [])]
    .map((f) => ({ ...f, path: String(f.path).replace(/\\/g, "/") }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const origPath = new Map((files ?? []).map((f) => [String(f.path).replace(/\\/g, "/"), f.path]));
  const textOf = (p) => {
    const t = read(origPath.get(p) ?? p);
    return typeof t === "string" ? lf(t) : null;
  };

  for (const f of list) {
    if (SERVICE_FILE.test(f.path) && !f.isTest) {
      const text = textOf(f.path);
      const s = text === null ? null : service(f.path, text);
      if (s) routes.services.push(s);
      continue;
    }
    // A test's `fetch("/api/x")` is a fixture; a vendored or generated file's calls are somebody
    // else's code (declared in .gitattributes — see lib/vendored.mjs), not this team's routes.
    if (f.isTest || f.vendored) continue;
    if (JS.test(f.path)) {
      const text = textOf(f.path);
      if (text === null || !text) continue;
      const scan = scanJs(text);
      const at = lineIndex(text);
      jsCalls(f.path, scan, at, routes.calls, routes.unread);
      jsConfigCalls(f.path, scan, at, routes.calls);
      jsBases(f.path, scan, at, routes.bases);
      jsGatewayObjects(f.path, scan, at, routes.gateways);
      jsProxyMounts(f.path, scan, at, routes.gateways);
    } else if (f.path.endsWith(".java")) {
      const text = textOf(f.path);
      if (text === null || !/@(?:Request|Get|Post|Put|Delete|Patch)Mapping\b/.test(text)) continue;
      javaHandlers(f.path, text, lineIndex(text), routes.handlers, routes.unread);
    }
  }

  // A context path is part of every handler in its module. The deepest module claiming a file wins.
  const roots = routes.services.filter((s) => s.contextPath).map((s) => ({ root: moduleRoot(s.file), ctx: s.contextPath }));
  roots.sort((a, b) => b.root.length - a.root.length);
  for (const h of routes.handlers) {
    const r = roots.find((x) => h.file.startsWith(x.root));
    if (r) h.path = normalizeRoutePath(joinPaths(r.ctx, h.path));
  }

  routes.calls.sort(byRow);
  // Two readings of one line — an inline call whose argument is also a config object — are one call.
  routes.calls = routes.calls.filter((c, i, all) => i === 0 || byRow(all[i - 1], c) !== 0);
  routes.bases.sort(byRow);
  routes.gateways.sort(byRow);
  routes.handlers.sort(byRow);
  routes.services.sort((a, b) => a.file.localeCompare(b.file));
  return routes;
}

// --- a workspace ----------------------------------------------------------------------------------

/**
 * The repos of a workspace — #436's definition, so the acceptance run and this command agree: every
 * immediate child directory with a `.git`, minus team-brains (`team.md` + `projects/`), by name.
 */
export function workspaceRepos(dir) {
  let names;
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  const repos = [];
  for (const name of names) {
    const root = join(dir, name);
    try {
      if (!statSync(root).isDirectory() || !existsSync(join(root, ".git"))) continue;
    } catch {
      continue;
    }
    if (existsSync(join(root, "team.md")) && existsSync(join(root, "projects"))) continue;
    repos.push({ name, root });
  }
  return repos;
}

// --- resolution across repos ----------------------------------------------------------------------

/**
 * Handler matching is strict about variables: a call's `{}` meets only a handler's `{}`, because
 * "some id" is not evidence that the call reaches `/orders/export`. A call's literal meets a
 * handler's literal or variable.
 */
function handlerMatches(callSegs, handlerSegs) {
  if (callSegs.length !== handlerSegs.length) return false;
  for (let i = 0; i < callSegs.length; i++) {
    const c = callSegs[i];
    const h = handlerSegs[i];
    if (h === "{}" || h === "*") continue;
    if (c !== h) return false;
  }
  return true;
}

/**
 * A gateway prefix is loose: a call's `{}` may be the segment that picks a route — a region chosen
 * at runtime reaches every regional prefix. Returns the rest of the path, or null.
 */
function prefixRest(prefixSegs, pathSegs) {
  if (prefixSegs.length > pathSegs.length) return null;
  for (let i = 0; i < prefixSegs.length; i++) {
    const p = prefixSegs[i];
    const s = pathSegs[i];
    if (p !== s && p !== "{}" && s !== "{}") return null;
  }
  return pathSegs.slice(prefixSegs.length);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

const literalCount = (segs) => segs.filter((s) => s !== "{}" && s !== "*").length;

const methodOk = (callMethod, handlerMethod) => !callMethod || handlerMethod === "ANY" || callMethod === handlerMethod;

const STOP = new Set([
  "http", "https", "localhost", "www", "api", "svc", "service", "services", "url", "uri", "host", "env",
  "process", "internal", "local", "com", "net", "io", "org", "cluster", "base", "upstream", "upstreams",
  "config", "path", "target", "the", "default",
]);

const stem = (w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

function tokens(s) {
  return words(String(s ?? "").replace(/[^A-Za-z0-9]+/g, " "))
    .filter((w) => !/^\d+$/.test(w) && !STOP.has(w))
    .map(stem);
}

/**
 * Narrow a gateway's path-true handlers to the repo its target names. Only ever removes candidates,
 * and never all of them: a declared `server.port` in a URL target first, else every name token of
 * the target present in the repo's name or `spring.application.name`.
 */
function narrow(target, handlers, identity) {
  const repos = [...new Set(handlers.map((h) => h.repo))];
  if (!target || repos.length === 0) return { handlers, narrowed: null };
  const url = String(target).match(/^[a-z][a-z0-9+.-]*:\/\/([^/:?#]*)(?::(\d+))?/i);
  if (url?.[2]) {
    const port = Number(url[2]);
    const hit = repos.filter((r) => identity.get(r)?.ports.has(port));
    if (hit.length) return { handlers: handlers.filter((h) => hit.includes(h.repo)), narrowed: "port" };
  }
  const want = tokens(url ? url[1] : target);
  if (want.length) {
    const hit = repos.filter((r) => want.every((t) => identity.get(r)?.tokens.has(t)));
    if (hit.length) return { handlers: handlers.filter((h) => hit.includes(h.repo)), narrowed: "name" };
  }
  return { handlers, narrowed: repos.length > 1 ? "unresolved" : null };
}

const where = (x) => `${x.repo}/${x.file}:${x.line}`;
const handlerKey = (h) => `${h.repo}\u0000${h.file}\u0000${h.line}\u0000${h.method}\u0000${h.path}`;

function finding(kind, title, detail, evidence) {
  return { severity: "low", kind, title, detail, evidence, offer: null };
}

/**
 * Join the route facts of several repos: `repos` is `[{ name, routes }]`, each `routes` an
 * `index.routes`. Returns every call with what it reaches, every gateway route with what it serves,
 * and three kinds of low finding. Pure and deterministic; an absent `routes` reads as empty.
 */
export function resolveRoutes(repos) {
  const list = [...(repos ?? [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const calls = [];
  const handlers = [];
  const gateways = [];
  const basesOf = new Map();
  const identity = new Map();
  for (const r of list) {
    const rt = r.routes ?? {};
    for (const c of rt.calls ?? []) calls.push({ repo: r.name, ...c });
    for (const h of rt.handlers ?? []) handlers.push({ repo: r.name, ...h, segs: segsOf(h.path) });
    for (const g of rt.gateways ?? []) gateways.push({ repo: r.name, ...g });
    basesOf.set(r.name, [...new Set((rt.bases ?? []).map((b) => b.prefix))].sort());
    const services = rt.services ?? [];
    identity.set(r.name, {
      tokens: new Set([...tokens(r.name), ...services.flatMap((s) => tokens(s.name))]),
      ports: new Set(services.map((s) => s.port).filter((p) => p !== null)),
    });
  }
  const strip = ({ segs, ...h }) => h;
  const gwOut = (g) => ({ repo: g.repo, file: g.file, line: g.line, prefix: g.prefix, rewrite: g.rewrite, target: g.target });

  const used = new Set();
  const links = [];
  const unmatched = [];
  let external = 0;
  for (const c of calls) {
    const cs = segsOf(c.path);
    const candidates = [{ segs: cs, base: null }];
    for (const b of basesOf.get(c.repo) ?? []) {
      const bs = segsOf(b);
      if (prefixRest(bs, cs) !== null && cs.slice(0, bs.length).every((s, i) => s === bs[i])) continue;
      candidates.push({ segs: [...bs, ...cs], base: b });
    }

    // Through a gateway, when one claims the path: the longest matching prefix wins, ties kept.
    const hits = [];
    for (const cand of candidates) {
      let best = -1;
      const found = [];
      for (const g of gateways) {
        const ps = segsOf(g.prefix);
        const rest = prefixRest(ps, cand.segs);
        if (rest === null) continue;
        if (ps.length > best) {
          best = ps.length;
          found.length = 0;
        }
        if (ps.length === best) {
          const up = g.rewrite === null || g.rewrite === undefined ? cand.segs : [...segsOf(g.rewrite), ...rest];
          found.push({ gateway: g, upstream: up, base: cand.base });
        }
      }
      hits.push(...found);
    }

    const targets = [];
    const pathOnly = [];
    const route = (upstream, base, gateway) => {
      const matched = handlers.filter((h) => handlerMatches(upstream, h.segs));
      const { handlers: kept, narrowed } = narrow(gateway?.target, matched, identity);
      const serving = kept.filter((h) => methodOk(c.method, h.method));
      pathOnly.push(...kept.filter((h) => !methodOk(c.method, h.method)));
      // Spring's own rule inside one application: a literal segment beats a variable, so
      // `/articles/feed` is the feed handler and not `/articles/{slug}`. Across repos both stand —
      // they are different services, and the gateway already chose between them.
      const best = new Map();
      for (const h of serving) best.set(h.repo, Math.max(best.get(h.repo) ?? -1, literalCount(h.segs)));
      for (const h of serving) {
        if (literalCount(h.segs) < best.get(h.repo)) continue;
        targets.push({ gateway: gateway ? gwOut(gateway) : null, base, upstream: pathOf(upstream), narrowed, handler: strip(h) });
      }
    };
    if (hits.length) for (const hit of hits) route(hit.upstream, hit.base, hit.gateway);
    else for (const cand of candidates) route(cand.segs, cand.base, null);

    const seen = new Set();
    const unique = targets.filter((t) => {
      const k = `${t.gateway ? where(t.gateway) : ""}\u0000${handlerKey(t.handler)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    for (const t of unique) used.add(handlerKey(t.handler));
    const bases = [...new Set(unique.map((t) => t.base))];
    const call = { repo: c.repo, file: c.file, line: c.line, method: c.method, path: c.path, raw: c.raw, ...(c.host ? { host: c.host } : {}) };
    links.push({ call, base: bases.length === 1 ? bases[0] : null, targets: unique });
    if (unique.length) continue;
    // A call naming another host — a third-party API, or a production URL — is not evidence of a
    // missing handler here. It stays in `links`, unresolved, and is counted rather than reported.
    if (c.host && !LOCAL_HOSTS.has(c.host)) external += 1;
    else unmatched.push({ call, hits, pathOnly });
  }

  const gatewayRoutes = gateways.map((g) => {
    const up = segsOf(g.rewrite ?? g.prefix);
    const matched = handlers.filter((h) => {
      if (h.segs.length < up.length) return false;
      return up.every((s, i) => s === h.segs[i] || h.segs[i] === "{}");
    });
    const { handlers: kept, narrowed } = narrow(g.target, matched, identity);
    return { gateway: gwOut(g), narrowed, handlers: kept.map(strip) };
  });

  // --- findings ---
  const findings = [];
  // With nothing to match against, every call would be "unmatched" — a front-end-only workspace is
  // not a workspace full of broken calls. Likewise every handler "unused" with no calls at all.
  if (handlers.length || gateways.length) {
    for (const u of unmatched) {
      const c = u.call;
      const label = `${c.method ?? "ANY"} ${c.path}`;
      let detail;
      const methods = [...new Set(u.pathOnly.map((h) => h.method))].sort();
      if (methods.length) {
        detail = `The path is served, but only for ${methods.join(", ")} — ${u.pathOnly.map(where).join(", ")}. A method mismatch, or a handler Cortex cannot see.`;
      } else if (u.hits.length) {
        const g = u.hits[0].gateway;
        detail = `Gateway route ${g.prefix} (${where(g)}) forwards it to ${pathOf(u.hits[0].upstream)}, and no handler Cortex can see serves that path.`;
      } else {
        detail = "No gateway route or handler in the workspace declares this path. Worth checking: the back end may be outside the workspace, or declared in a way Cortex does not read.";
      }
      findings.push(finding("route-unmatched-call", `No handler Cortex can see serves ${label}`, detail, [where(c)]));
    }
  }
  for (const g of gatewayRoutes) {
    if (g.handlers.length) continue;
    if (!handlers.length) continue;
    findings.push(
      finding(
        "route-dead-gateway",
        `Gateway route ${g.gateway.prefix} reaches no handler Cortex can see`,
        `It forwards to ${g.gateway.rewrite ?? g.gateway.prefix} on ${g.gateway.target}, and no Spring handler in the workspace is under that path.`,
        [where(g.gateway)],
      ),
    );
  }
  if (calls.length) {
    for (const h of handlers) {
      if (used.has(handlerKey(h))) continue;
      findings.push(
        finding(
          "route-unused-endpoint",
          `${h.method} ${h.path} is reached by no call Cortex can see`,
          `Served by ${where(h)}${h.name ? ` (${h.name})` : ""}. Worth checking, never "safe to delete": calls from other services, runtime-built URLs and clients outside the workspace are invisible here.`,
          [where(h)],
        ),
      );
    }
  }
  const order = { "route-unmatched-call": 0, "route-dead-gateway": 1, "route-unused-endpoint": 2 };
  findings.sort((a, b) => order[a.kind] - order[b.kind] || a.evidence[0].localeCompare(b.evidence[0]) || a.title.localeCompare(b.title));

  return {
    repos: list.map((r) => ({
      name: r.name,
      calls: r.routes?.calls?.length ?? 0,
      handlers: r.routes?.handlers?.length ?? 0,
      gateways: r.routes?.gateways?.length ?? 0,
      bases: basesOf.get(r.name) ?? [],
      unread: r.routes?.unread ?? { calls: 0, handlers: 0 },
    })),
    links,
    gatewayRoutes,
    findings,
    stats: {
      calls: calls.length,
      linked: links.filter((l) => l.targets.length).length,
      external,
      handlers: handlers.length,
      reached: used.size,
      gateways: gateways.length,
      gatewaysServing: gatewayRoutes.filter((g) => g.handlers.length).length,
      unread: {
        calls: list.reduce((a, r) => a + (r.routes?.unread?.calls ?? 0), 0),
        handlers: list.reduce((a, r) => a + (r.routes?.unread?.handlers ?? 0), 0),
      },
    },
  };
}
