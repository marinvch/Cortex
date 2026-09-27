# FE ↔ BE route map — design (roadmap step 8.3)

Scenario S3 asks one question of a workspace: **who serves this call?** It is the first Cortex
feature that answers across repositories, so the shape is fixed here before the code.

## What is extracted — per repo, into the index

A new field, `index.routes`, written by `buildIndex` for every repo. Regex over the text the index
already reads; no parser, no network, no clock (ADR 0004, `index/AGENTS.md`). Adding a field is not
an `INDEX_VERSION` bump; the field is **always present**, so "extracted, found none" and "an index
older than this feature" are different answers.

| Key | From | Row |
|---|---|---|
| `calls` | JS/TS, not a test and not declared vendored/generated in `.gitattributes`: `fetch`, `axios`, `ky`, `$fetch`, `new Request`, wrappers whose name says `fetch`/`request`/`http`/`api`; `x.get/post/put/patch/delete/del(…)` only when `x` reads as an HTTP client; request-config objects (`url` beside `method`/`body`/`data`/`params`/`headers`) and RTK Query `query: (…) => …`. Method from the verb, a `method:` key, or a positional verb; else GET | `file, line, method, path, raw` (+ `host` for an absolute URL) |
| `bases` | `baseUrl`/`baseURL`/`prefixUrl`/`API_BASE…`/`API_URL`/`API_ROOT` with a literal anywhere on its right-hand side (`env.X \|\| "/api"`), and the keys of a `*.config.*` dev-server `proxy: {…}` | `file, line, prefix` |
| `gateways` | an object literal with a prefix key (`prefix`/`path`/`source`/`context`/`from`) *and* a target key (`service`/`target`/`upstream`/`destination`/`url`), optional `rewrite` (a Next `destination` counts only as an absolute URL — otherwise it is a redirect); `use("/p", …proxy…({ target, pathRewrite }))` | `file, line, prefix, rewrite, target` |
| `handlers` | Java, non-test, not `@FeignClient`: class-level `@RequestMapping` × method-level `@RequestMapping`/`@Get…`/`@Post…`/`@Put…`/`@Delete…`/`@PatchMapping`, `value=`/`path=`/arrays, `method=RequestMethod.X` (none → `ANY`) | `file, line, method, path, raw, name` |
| `services` | `application.{yml,yaml,properties}`: `spring.application.name`, `server.port`, `server.servlet.context-path` (prefixed onto that module's handlers) | `file, name, port, contextPath` |
| `unread` | calls and handlers whose URL is built at runtime — **counted, never guessed** | `{ calls, handlers }` |

**One normal form for a path:** origin, query and trailing slash dropped; every variable —
`{id}`, `{id:\d+}`, `:id`, `${expr}` — becomes `{}`; a segment holding any variable is `{}`. The
source text is kept as `raw` for display. A template literal led by `${base}` keeps its path and
drops the base; one with no literal segment left (`${base}${path}`, `url + "/" + id`) is `unread`. Line endings are normalised
before offsets are taken, and every recorded path is `/`-separated.

## Where a workspace comes from

The concept #436 already ships: **every immediate child directory with a `.git`, minus
team-brains** (`team.md` + `projects/`). A single repo is a workspace of one, which is how a
monorepo holding both halves is read. Each repo contributes its stored index when that index carries
`routes`; otherwise one is built **in memory** — nothing is written anywhere, and the output says
which.

## How a call is resolved

1. Candidates: the call's path, plus `base + path` for each base its own repo declares (the
   `request("/shipments")` + `baseUrl: "/api"` shape).
2. A candidate under a gateway prefix (segment-wise; `{}` matches any literal) is forwarded:
   `rewrite + rest`, or the path unchanged when no rewrite is declared. Gateways from every repo
   apply; if any gateway matched, direct matching is skipped.
3. The forwarded (or direct) path is matched against every handler, segment-wise, method-aware
   (`ANY` and an unknown method match either way). A call's `{}` meets only a handler's `{}` — "some
   id" is no evidence of reaching `/orders/export` — and inside one repo a literal beats a variable,
   as Spring decides it.
4. A gateway's `target` narrows *among path-true matches only*: a declared `server.port` in the URL,
   else every target token (`countryNorth` → country, north) present in the repo's name or
   `spring.application.name`. If narrowing would leave nothing, it is not applied and the link says so.

## What is reported

`node index/cortex-routes.mjs <root> [--workspace] [--json]` — read-only, writes nothing. Each
call → gateway (file:line) → handler (`repo/file:line`); each gateway route → the handlers it can
reach. Three **low** findings in the `findings.mjs` shape, `offer: null`:
`route-unmatched-call` (naming a method mismatch when the path exists), `route-unused-endpoint`
("no call Cortex can see reaches it — worth checking, never safe to delete"), and
`route-dead-gateway`. They are **not** added to `analyse()`: on a front-end-only repo every call is
unmatched by construction, so a single-repo report would be confidently wrong. For the same reason
nothing is reported against a half that is absent, and a call naming another host is counted, not
reported.

## Out of scope — stated, not silently missed

Runtime-built URLs (counted in `unread`); OpenAPI/Swagger; non-Spring back ends (Express, JAX-RS,
Kotlin, Go, …) and Spring Cloud Gateway YAML; back-end-to-back-end clients (Feign, `RestClient`,
`WebClient`) — so an endpoint only another service calls reads as unused, which is why that finding
is phrased as a floor; proxy `rewrite` *functions*; query-string and header routing; profile-specific
`application-*.yml`. The Cortex View does not draw the route map yet (follow-up).
