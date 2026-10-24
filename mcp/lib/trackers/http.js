// The one transport every tracker adapter uses: the global `fetch` (Node 20+), a timeout, JSON in
// and out, and errors that name what went wrong without echoing a credential (#624, design R17).
//
// No dependency and no `gh`: three adapters over one transport, and tests that need nothing but a
// local `node:http` server (R20). `fetch` is looked up when a request is made, not when this module
// loads, so a test that replaces `globalThis.fetch` with a function that throws is testing the real
// path (R19).

/** A tracker call that failed: unreachable, timed out, or answered with a status that is not 2xx. */
export class TrackerError extends Error {
  constructor(kind, message, { status = null, retryable = true } = {}) {
    super(`${kind}: ${message}`);
    this.name = "TrackerError";
    this.code = "tracker_error";
    this.kind = kind;
    this.status = status;
    this.retryable = retryable;
  }
}

/** A credential the adapter needs is not in the environment. Names the variable, never a value. */
export class MissingCredential extends Error {
  constructor(kind, variables) {
    super(`${kind}: no credential — set ${variables} in the environment (never in team.json)`);
    this.name = "MissingCredential";
    this.code = "missing_credential";
    this.kind = kind;
    this.variables = variables;
  }
}

export const DEFAULT_TIMEOUT_MS = 15_000;

const isLoopback = (host) => host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";

/**
 * A tracker's base URL, checked: https, or http on a loopback host (the tests' mock servers), no
 * user or password in it, no query and no fragment. Returned without a trailing slash.
 *
 * @param {string} kind
 * @param {string} value
 * @param {string} field  the team.json field, for the message
 */
export function baseUrl(kind, value, field) {
  let u;
  try {
    u = new URL(String(value ?? ""));
  } catch {
    throw new TrackerError(kind, `${field} is not a URL`, { retryable: false });
  }
  if (u.username || u.password) throw new TrackerError(kind, `${field} carries a user or password; credentials come from the environment`, { retryable: false });
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopback(u.hostname))) {
    throw new TrackerError(kind, `${field} must be https://`, { retryable: false });
  }
  if (u.search || u.hash) throw new TrackerError(kind, `${field} must not carry a query or a fragment`, { retryable: false });
  return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
}

/**
 * One request. Resolves to the parsed JSON body (or null for an empty one); rejects with
 * `TrackerError`. The message carries the method, the path and the status — never a header.
 *
 * @param {string} kind
 * @param {{ fetch?: Function, timeoutMs?: number }} io
 * @param {string} method
 * @param {string} url
 * @param {{ headers?: object, body?: unknown }} [opts]
 */
export async function request(kind, io, method, url, { headers = {}, body } = {}) {
  const f = io.fetch ?? globalThis.fetch;
  if (typeof f !== "function") throw new TrackerError(kind, "no fetch in this Node; Cortex needs Node 20 or later");
  const timeoutMs = io.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const path = (() => { try { return new URL(url).pathname; } catch { return url; } })();
  let res;
  try {
    res = await f(url, {
      method,
      headers: { Accept: "application/json", "User-Agent": "cortex-sync", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const why = e?.name === "TimeoutError" || e?.name === "AbortError" ? `timed out after ${timeoutMs} ms` : `unreachable (${e?.cause?.code ?? e?.code ?? e?.name ?? "error"})`;
    throw new TrackerError(kind, `${method} ${path} ${why}`);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    // 4xx other than 408/429 will not get better by retrying the same call.
    const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
    throw new TrackerError(kind, `${method} ${path} answered ${res.status}`, { status: res.status, retryable });
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new TrackerError(kind, `${method} ${path} answered something that is not JSON`);
  }
}

/** The marker an item carries so a retry finds it instead of creating a second one. */
export const askMarker = (id) => `cortex-ask-${id}`;
/** The tag in an item's title, readable by a person: `[ask:<id>]`. */
export const askTag = (id) => `[ask:${id}]`;
/** The tag every comment Cortex writes ends with, so a pull never reads Cortex's own text back. */
export const entryTag = (askId, entryId) => `[cortex:${askId}/${entryId}]`;
export const ENTRY_TAG_RE = /\[cortex:([0-9a-z-]+)\/([^\]\s]+)\]/;

/** The body of a new tracker item: the question, then where it came from and how to answer. */
export function itemBody(ask) {
  const from = [ask.from && `from ${ask.from}`, ask.fromProject && `in ${ask.fromProject}`].filter(Boolean).join(" ");
  return (
    `${ask.question}\n\n---\n` +
    `Ask ${ask.id} to ${ask.toKind} ${ask.to}${from ? `, ${from}` : ""}, via the Cortex team-brain. ` +
    `Answer here or with \`ai-os answer --id ${ask.id}\`; sync carries it both ways.`
  );
}
