// route-path.js — one normal form for an HTTP path, for both leaves.
//
// `index/lib/routes.mjs` writes every route it extracts in this form, and `index/lib/contract.mjs`
// publishes a repo's contract in it. `mcp/lib/contract.js` answers "who calls /items/:id" by
// normalising the question the same way. The leaves may not import each other, so the function
// both need lives here (#621). It is pure: a string in, a string or null out.
//
// The form is `/orders/{}/events`. Every variable — Spring's `{id}` and `{id:\d+}`, Express's
// `:id`, a template literal's `${id}` — is `{}`, and a segment that holds any variable is a
// variable. Origin, query, fragment, doubled and trailing slashes go.

const VAR_SEGMENT = /\$\{\}|\{[^/{}]*\}|^:[\w$]+[?]?$/;

/**
 * A URL or route pattern → `/a/{}/b`, or null when it is not a path.
 *
 * @param {unknown} raw
 * @returns {string|null}
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

/** The segments of a normal-form path: `/` is none. */
export const routeSegments = (path) => (path === "/" ? [] : path.slice(1).split("/"));

/**
 * Does a call to `callPath` reach an endpoint declared as `endpointPath`? Both in normal form.
 *
 * Strict about variables, as the route map is: a call's `{}` meets only an endpoint's `{}`,
 * because "some id" is no evidence that the call reaches `/orders/export`. A call's literal meets
 * an endpoint's literal or variable.
 */
export function callReaches(callPath, endpointPath) {
  const c = routeSegments(callPath);
  const e = routeSegments(endpointPath);
  if (c.length !== e.length) return false;
  for (let i = 0; i < c.length; i++) {
    if (e[i] === "{}" || e[i] === "*") continue;
    if (c[i] !== e[i]) return false;
  }
  return true;
}
