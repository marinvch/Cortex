import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tempDir } from "./tmp.mjs";
import { buildIndex } from "../lib/build.mjs";
import { extractRoutes, normalizeRoutePath, resolveRoutes, workspaceRepos } from "../lib/routes.mjs";

// The route map is regex over text, so every test here is a literal source and a literal answer.
// The fixtures are a tiny invented "depot" workspace: a React/TS front end with a Node gateway, and
// Spring services behind it. Two regional services share one API shape on purpose — that is the
// case where only the gateway's target can say which repo answers.

/** A file list and a reader from `{ path: text }`, the shape `extractRoutes` is handed by the builder. */
function repo(sources) {
  const files = Object.keys(sources).map((path) => ({
    path,
    lang: /\.(?:[cm]?[jt]sx?)$/.test(path) ? (/\.tsx?$/.test(path) ? "typescript" : "javascript") : path.endsWith(".java") ? "java" : "other",
    isTest: /\.test\.|Test\.java$|(^|\/)test\//.test(path),
  }));
  return extractRoutes(files, (rel) => sources[rel] ?? null);
}

// --- one normal form for a path -------------------------------------------------------------------

test("every spelling of a path variable normalises to the same segment", () => {
  assert.equal(normalizeRoutePath("/shipments/{id}"), "/shipments/{}");
  assert.equal(normalizeRoutePath("/shipments/:id"), "/shipments/{}");
  assert.equal(normalizeRoutePath("/shipments/${id}"), "/shipments/{}");
  assert.equal(normalizeRoutePath("/shipments/{id:\\d+}/events"), "/shipments/{}/events");
  assert.equal(normalizeRoutePath("/files/${name}.json"), "/files/{}", "a segment holding a variable is a variable");
});

test("origin, query, fragment, doubled and trailing slashes are not part of a route", () => {
  assert.equal(normalizeRoutePath("https://api.example.test:8443/v1/parcels/?page=2#top"), "/v1/parcels");
  assert.equal(normalizeRoutePath("/shipments?country=${c}"), "/shipments");
  assert.equal(normalizeRoutePath("//a//b/"), "/a/b");
  assert.equal(normalizeRoutePath("/"), "/");
});

test("a string that is not a path is not a route", () => {
  assert.equal(normalizeRoutePath("shipments"), null);
  assert.equal(normalizeRoutePath(""), null);
  assert.equal(normalizeRoutePath("./local/file.json"), null);
  assert.equal(normalizeRoutePath(null), null);
});

// --- Spring handlers ------------------------------------------------------------------------------

const ORDER_CONTROLLER = [
  "package com.depot.orders;",
  "",
  "import org.springframework.web.bind.annotation.*;",
  "",
  "/** @GetMapping(\"/in-a-comment\") is documentation, not a handler. */",
  "@RestController",
  "@RequestMapping(\"/orders\")",
  "public class OrderController {",
  "    @PostMapping",
  "    public Order create(@RequestBody OrderRequest r) { return null; }",
  "",
  "    @GetMapping(\"/{id}\")",
  "    public Order get(@PathVariable String id) { return null; }",
  "",
  "    // @DeleteMapping(\"/{id}\") — removed",
  "    @GetMapping(value = \"/{id}/events\", produces = \"application/json\")",
  "    public List<Event> events(@PathVariable String id) { return null; }",
  "",
  "    @RequestMapping(path = {\"/{id}/cancel\", \"/{id}/void\"}, method = RequestMethod.POST)",
  "    @ResponseStatus(HttpStatus.ACCEPTED)",
  "    public void cancel(@PathVariable String id) {}",
  "",
  "    @RequestMapping(\"/ping\")",
  "    public String ping() { return \"ok\"; }",
  "}",
  "",
].join("\n");

test("class-level and method-level Spring mappings combine into one path per handler", () => {
  const r = repo({ "src/main/java/com/depot/orders/OrderController.java": ORDER_CONTROLLER });
  const got = r.handlers.map((h) => `${h.method} ${h.path} :${h.line} ${h.name}`);
  assert.deepEqual(got, [
    "POST /orders :9 create",
    "GET /orders/{} :12 get",
    "GET /orders/{}/events :16 events",
    "POST /orders/{}/cancel :19 cancel",
    "POST /orders/{}/void :19 cancel",
    "ANY /orders/ping :23 ping",
  ]);
  assert.equal(r.handlers[1].raw, "/orders/{id}", "the source spelling is kept for display");
});

test("a mapping with no class-level prefix, a Feign client and a test are not handlers of this repo", () => {
  const r = repo({
    "src/main/java/com/depot/PingController.java":
      "@RestController\npublic class PingController {\n  @GetMapping(\"/regions/{code}/ping\")\n  public String ping() { return \"\"; }\n}\n",
    "src/main/java/com/depot/RegionClient.java":
      "@FeignClient(name = \"region\")\npublic interface RegionClient {\n  @GetMapping(\"/regions/{code}\")\n  Region get(@PathVariable String code);\n}\n",
    "src/test/java/com/depot/PingControllerTest.java":
      "class PingControllerTest {\n  @GetMapping(\"/fake\")\n  void t() {}\n}\n",
  });
  assert.deepEqual(r.handlers.map((h) => `${h.method} ${h.path}`), ["GET /regions/{}/ping"]);
});

test("a mapping built from a constant is counted as unread, never guessed", () => {
  const r = repo({
    "src/main/java/com/depot/X.java": "@RestController\n@RequestMapping(Paths.BASE)\nclass X {\n  @GetMapping(Paths.ONE)\n  void one() {}\n}\n",
  });
  assert.equal(r.handlers.length, 0);
  assert.equal(r.unread.handlers, 1);
});

test("CRLF sources give the same handlers on the same lines, with no \\r in any path", () => {
  const lf = repo({ "src/main/java/com/depot/orders/OrderController.java": ORDER_CONTROLLER });
  const crlf = repo({ "src/main/java/com/depot/orders/OrderController.java": ORDER_CONTROLLER.replace(/\n/g, "\r\n") });
  assert.deepEqual(crlf.handlers, lf.handlers);
  assert.ok(!JSON.stringify(crlf).includes("\\r"));
});

test("a Windows-style path handed to the extractor is recorded with forward slashes", () => {
  const files = [{ path: "src\\main\\java\\Ping.java", lang: "java", isTest: false }];
  const r = extractRoutes(files, () => "@RestController\nclass Ping {\n  @GetMapping(\"/ping\")\n  void p() {}\n}\n");
  assert.equal(r.handlers[0].file, "src/main/java/Ping.java");
});

test("server.servlet.context-path is prefixed onto the handlers of its own module", () => {
  const r = repo({
    "src/main/resources/application.yml": "server:\r\n  port: ${PORT:8085}\r\n  servlet:\r\n    context-path: /depot\r\nspring:\r\n  application:\r\n    name: depot-orders\r\n",
    "src/main/java/com/depot/orders/OrderController.java": ORDER_CONTROLLER,
  });
  assert.deepEqual(r.services, [{ file: "src/main/resources/application.yml", name: "depot-orders", port: 8085, contextPath: "/depot" }]);
  assert.equal(r.handlers[0].path, "/depot/orders");
});

test("application.properties declares the same three facts", () => {
  const r = repo({
    "svc/src/main/resources/application.properties": "# comment\nserver.port=9001\nspring.application.name=depot-east\n",
  });
  assert.deepEqual(r.services, [{ file: "svc/src/main/resources/application.properties", name: "depot-east", port: 9001, contextPath: "" }]);
});

// --- front-end calls ------------------------------------------------------------------------------

const CLIENT = [
  "// fetch(\"/api/commented-out\") is not a call",
  "const enc = encodeURIComponent;",
  "export function createDepotClient({ baseUrl = \"/api\", fetch: doFetch = globalThis.fetch } = {}) {",
  "  async function request<T>(path: string, init?: RequestInit): Promise<T> {",
  "    const res = await doFetch(`${baseUrl}${path}`, init);",
  "    return (await res.json()) as T;",
  "  }",
  "  return {",
  "    create(o) { return request(\"/orders\", { method: \"POST\", body: JSON.stringify(o) }); },",
  "    get(id) { return request(`/orders/${enc(id)}`); },",
  "    list(region) { return request(region ? `/orders?region=${enc(region)}` : \"/orders\"); },",
  "    rules(code) { return request(`/regions/${regionFor(code)}/${enc(code)}/rules`); },",
  "  };",
  "}",
  "",
].join("\n");

test("a wrapper call with a literal or template URL is a call; its method comes from the init object", () => {
  const r = repo({ "packages/client/src/client.ts": CLIENT });
  assert.deepEqual(
    r.calls.map((c) => `${c.method} ${c.path} :${c.line}`),
    ["POST /orders :9", "GET /orders/{} :10", "GET /orders :11", "GET /regions/{}/{}/rules :12"],
  );
  assert.equal(r.unread.calls, 1, "`${baseUrl}${path}` is runtime-built: counted, not guessed");
  assert.deepEqual(r.bases.map((b) => b.prefix), ["/api"]);
});

test("fetch, axios and an api instance are calls; an Express route definition is not", () => {
  const r = repo({
    "web/src/data.ts": [
      "export const a = () => fetch(\"/api/parcels\");",
      "export const b = (id) => fetch(`${API}/api/parcels/${id}`, { method: 'DELETE' });",
      "export const c = () => axios.post(\"/api/parcels\", body);",
      "export const d = () => api.get<Parcel[]>(\"/api/parcels/{id}/labels\");",
      "export const e = () => http.put(`https://edge.example.test/api/parcels/${id}`, body);",
      "const store = new Map(); store.get(\"key\");",
      "",
    ].join("\n"),
    "server/app.js": [
      "app.get(\"/health\", (req, res) => res.end());",
      "router.post(\"/hooks\", handler);",
      "api.get(\"/status\", async (req, res) => res.json({}));",
      "",
    ].join("\n"),
  });
  assert.deepEqual(r.calls.map((c) => `${c.method} ${c.path}`), [
    "GET /api/parcels",
    "DELETE /api/parcels/{}",
    "POST /api/parcels",
    "GET /api/parcels/{}/labels",
    "PUT /api/parcels/{}",
  ]);
});

// Each of these was a real false positive or a real miss on a cloned repo, not an invented case.
test("a verb call counts only on a receiver that reads as an HTTP client", () => {
  const r = repo({
    "public/sw.js": "self.addEventListener('fetch', (e) => caches.open('v1').then((cache) => cache.put(\"/index.html\", res)));\n",
    "src/agent.js": [
      "const requests = { del: (url) => superagent.del(`${API_ROOT}${url}`) };",
      "export const remove = (slug) => requests.del(`/articles/${slug}`);",
      "export const one = () => client.get(\"/articles/feed\");",
      "export const two = () => this.httpClient.patch(\"/articles/x\", body);",
      "export const three = () => useApi(\"/api/user/password\", \"PUT\");",
      "",
    ].join("\n"),
  });
  assert.deepEqual(r.calls.map((c) => `${c.method} ${c.path}`), [
    "DELETE /articles/{}", "GET /articles/feed", "PATCH /articles/x", "PUT /api/user/password",
  ]);
});

test("request-config objects and RTK Query endpoints are calls; a nav link with a url is not", () => {
  const r = repo({
    "src/authApi.ts": [
      "export const authApi = createApi({ baseQuery, endpoints: (builder) => ({",
      "  current: builder.query({ query: () => \"/users/current\" }),",
      "  login: builder.mutation({ query: (b) => ({ url: \"/users/login\", method: \"POST\", body: b }) }),",
      "  one: builder.query({ query: (id) => ({ url: `/users/${id}` }) }),",
      "}) });",
      "export const put = () => axios({ url: \"/api/users/me\", method: \"put\", data: {} });",
      "export const nav = [{ title: \"About\", url: \"/about\" }];",
      "",
    ].join("\n"),
  });
  assert.deepEqual(r.calls.map((c) => `${c.method} ${c.path} :${c.line}`), [
    "GET /users/current :2",
    "POST /users/login :3",
    "GET /users/{} :4",
    "PUT /api/users/me :6",
  ]);
});

test("a URL with no literal segment is runtime-built, however it is spelled", () => {
  const r = repo({ "src/owner.service.ts": "get(id) { return this.http.get<Owner>(this.entityUrl + '/' + id); }\n" });
  assert.deepEqual(r.calls, []);
  assert.equal(r.unread.calls, 1);
});

test("a base declared as a fallback is still declared", () => {
  const r = repo({ "src/baseQuery.ts": "const API_URL = import.meta.env.VITE_API_URL || \"/api\";\nexport const q = fetchBaseQuery({ baseUrl: API_URL });\n" });
  assert.deepEqual(r.bases.map((b) => b.prefix), ["/api"]);
});

test("a call to another host is kept in the map but never reported as a missing handler", () => {
  const map = resolveRoutes([
    { name: "web", routes: repo({ "src/a.ts": "fetch(\"https://third-party.example.test/v1/search\");\nfetch(\"http://localhost:8080/nope\");\n" }) },
    { name: "api", routes: repo({ "src/main/java/A.java": "@RestController\nclass A {\n  @GetMapping(\"/yes\")\n  void y() {}\n}\n" }) },
  ]);
  assert.equal(map.links.length, 2);
  assert.equal(map.stats.external, 1);
  assert.deepEqual(map.findings.filter((f) => f.kind === "route-unmatched-call").map((f) => f.title), ["No handler Cortex can see serves GET /nope"]);
});

test("a call inside a test file is not part of the product's route map", () => {
  const r = repo({ "src/client.test.ts": "fetch(\"/api/mocked\");\n" });
  assert.equal(r.calls.length, 0);
});

test("a file .gitattributes declares vendored or generated is not this team's routes", () => {
  const files = [{ path: "gen/runtime/client.js", isTest: false, vendored: true }];
  const r = extractRoutes(files, () => "fetch(\"/api/generated\"); fetch(url);\n");
  assert.equal(r.calls.length, 0);
  assert.equal(r.unread.calls, 0, "and its runtime-built URLs are not counted as ours either");
});

test("a dev-server proxy key is a base the front end sends through", () => {
  const r = repo({
    "apps/web/vite.config.ts":
      "export default defineConfig({ server: { proxy: { \"/api\": process.env.GW ?? \"http://localhost:4000\", '/auth': { target: 'x' } } } });\n",
  });
  assert.deepEqual(r.bases.map((b) => b.prefix), ["/api", "/auth"]);
});

// --- gateway routes -------------------------------------------------------------------------------

test("a route table, an http-proxy-middleware mount and a Next rewrite are gateway routes", () => {
  const r = repo({
    "gateway/src/routes.js": [
      "export const ROUTES = [",
      "  { prefix: \"/api/orders\", service: \"orders\", rewrite: \"/orders\" },",
      "  { prefix: \"/api/regions/east\", service: \"regionEast\", rewrite: \"/regions\" },",
      "];",
      "",
    ].join("\n"),
    "edge/server.js":
      "app.use(\"/api/labels\", createProxyMiddleware({ target: \"http://localhost:9003\", pathRewrite: { \"^/api/labels\": \"/labels\" } }));\n",
    "site/next.config.js":
      "module.exports = { async rewrites() { return [{ source: \"/api/stock/:path*\", destination: \"http://stock:8080/stock/:path*\" }]; } };\n",
    "web/src/routes.tsx": "const routes = [{ path: \"/checkout\", element: <Checkout /> }];\n",
    // A redirect inside the app, from a real next.config: not a forward to another service.
    "site/redirects.js":
      "module.exports = [{ source: \"/:path((?!ie-incompatible.html$).*)\", destination: \"/ie-incompatible.html\", permanent: false }, { source: \"/old\", destination: \"/new\" }];\n",
  });
  assert.deepEqual(
    r.gateways.map((g) => `${g.prefix} -> ${g.rewrite ?? "(as is)"} @ ${g.target} :${g.line}`),
    [
      "/api/labels -> /labels @ http://localhost:9003 :1",
      "/api/orders -> /orders @ orders :2",
      "/api/regions/east -> /regions @ regionEast :3",
      "/api/stock -> /stock @ http://stock:8080/stock/:path* :1",
    ],
  );
});

// --- a repo with none of it -----------------------------------------------------------------------

test("a repo with no routes at all yields empty lists, zero findings, and no throw", () => {
  const r = repo({ "README.md": "# nothing\n", "src/util.ts": "export const x = 1;\n", "lib/Main.java": "class Main {}\n" });
  assert.deepEqual(r, {
    calls: [], bases: [], gateways: [], handlers: [], services: [], unread: { calls: 0, handlers: 0 },
  });
  const map = resolveRoutes([{ name: "plain", routes: r }]);
  assert.deepEqual(map.findings, []);
  assert.deepEqual(map.links, []);
  assert.doesNotThrow(() => resolveRoutes([]));
  assert.doesNotThrow(() => resolveRoutes([{ name: "old-index", routes: undefined }]));
});

// --- across a workspace ---------------------------------------------------------------------------

const RULES = (region) =>
  [
    `package com.depot.${region};`,
    "@RestController",
    "@RequestMapping(\"/regions\")",
    "public class RulesController {",
    "  @GetMapping",
    "  public List<Rules> list() { return null; }",
    "  @GetMapping(\"/{code}/rules\")",
    "  public Rules rules(@PathVariable String code) { return null; }",
    "}",
    "",
  ].join("\n");

function depotWorkspace() {
  return [
    {
      name: "depot-web",
      routes: repo({
        "packages/client/src/client.ts": CLIENT,
        "gateway/src/routes.js": [
          "export const ROUTES = [",
          "  { prefix: \"/api/orders\", service: \"orders\", rewrite: \"/orders\" },",
          "  { prefix: \"/api/regions/east\", service: \"regionEast\", rewrite: \"/regions\" },",
          "  { prefix: \"/api/regions/west\", service: \"regionWest\", rewrite: \"/regions\" },",
          "  { prefix: \"/api/legacy\", service: \"legacy\", rewrite: \"/legacy\" },",
          "];",
          "",
        ].join("\n"),
        "apps/shop/src/cart.ts": "export const drop = (id) => fetch(`/api/orders/${id}`, { method: \"DELETE\" });\n",
      }),
    },
    {
      name: "depot-orders",
      routes: repo({
        "src/main/resources/application.yml": "server:\n  port: 8080\nspring:\n  application:\n    name: depot-orders\n",
        "src/main/java/com/depot/orders/OrderController.java": ORDER_CONTROLLER,
      }),
    },
    { name: "depot-region-east", routes: repo({ "src/main/java/com/depot/east/RulesController.java": RULES("east") }) },
    { name: "depot-region-west", routes: repo({ "src/main/java/com/depot/west/RulesController.java": RULES("west") }) },
  ];
}

test("a front-end call resolves through the gateway to the Spring handler that serves it", () => {
  const map = resolveRoutes(depotWorkspace());
  const create = map.links.find((l) => l.call.method === "POST" && l.call.path === "/orders");
  assert.equal(create.base, "/api", "the declared base is what put the call under the gateway prefix");
  assert.equal(create.targets.length, 1);
  const [t] = create.targets;
  assert.equal(t.gateway.prefix, "/api/orders");
  assert.equal(t.gateway.repo, "depot-web");
  assert.equal(t.gateway.file, "gateway/src/routes.js");
  assert.equal(t.handler.repo, "depot-orders");
  assert.equal(t.handler.file, "src/main/java/com/depot/orders/OrderController.java");
  assert.equal(t.handler.line, 9);
});

test("two services with one API shape are told apart by the gateway's target, and a runtime region reaches both", () => {
  const map = resolveRoutes(depotWorkspace());
  const rules = map.links.find((l) => l.call.path === "/regions/{}/{}/rules");
  assert.deepEqual(
    rules.targets.map((t) => `${t.gateway.prefix} -> ${t.handler.repo}:${t.handler.line}`).sort(),
    ["/api/regions/east -> depot-region-east:7", "/api/regions/west -> depot-region-west:7"],
  );
  const east = map.gatewayRoutes.find((g) => g.gateway.prefix === "/api/regions/east");
  assert.deepEqual([...new Set(east.handlers.map((h) => h.repo))], ["depot-region-east"], "the east route never claims the west service");
});

test("unmatched calls, unused endpoints and dead gateway routes are low findings, each naming file:line", () => {
  const map = resolveRoutes(depotWorkspace());
  const kinds = map.findings.map((f) => f.kind);
  assert.ok(map.findings.every((f) => f.severity === "low" && f.offer === null));

  // The controller has no GET on /orders — only POST — so the client's list() is unmatched too.
  const unmatched = map.findings.filter((f) => f.kind === "route-unmatched-call");
  assert.deepEqual(unmatched.map((f) => f.evidence[0]), ["depot-web/apps/shop/src/cart.ts:1", "depot-web/packages/client/src/client.ts:11"]);
  assert.match(unmatched[0].title, /DELETE \/api\/orders\/\{\}/);
  assert.match(unmatched[0].detail, /only for GET/, "a path that exists under another method says which");
  assert.match(unmatched[1].title, /GET \/orders$/);
  assert.match(unmatched[1].detail, /only for POST/);

  const unused = map.findings.filter((f) => f.kind === "route-unused-endpoint").map((f) => f.evidence[0]);
  assert.ok(unused.includes("depot-region-east/src/main/java/com/depot/east/RulesController.java:5"), "GET /regions (list) is called by nothing");
  assert.ok(unused.includes("depot-orders/src/main/java/com/depot/orders/OrderController.java:23"));
  assert.ok(!unused.includes("depot-orders/src/main/java/com/depot/orders/OrderController.java:12"), "GET /orders/{id} is called");
  assert.ok(map.findings.filter((f) => f.kind === "route-unused-endpoint").every((f) => /never .safe to delete./.test(f.detail)));

  assert.ok(kinds.includes("route-dead-gateway"));
  assert.match(map.findings.find((f) => f.kind === "route-dead-gateway").title, /\/api\/legacy/);
});

test("with no gateway, a monorepo's call matches its own handler directly", () => {
  const map = resolveRoutes([
    {
      name: "mono",
      routes: repo({
        "web/src/api.ts": "export const one = (id) => fetch(`/orders/${id}`);\n",
        "api/src/main/java/com/depot/orders/OrderController.java": ORDER_CONTROLLER,
      }),
    },
  ]);
  const link = map.links.find((l) => l.call.path === "/orders/{}");
  assert.equal(link.targets.length, 1);
  assert.equal(link.targets[0].gateway, null);
  assert.equal(link.targets[0].handler.name, "get");
});

test("inside one service a literal segment beats a variable, as Spring decides it", () => {
  const map = resolveRoutes([
    { name: "web", routes: repo({ "src/a.ts": "fetch(\"/orders/ping\");\n" }) },
    { name: "api", routes: repo({ "src/main/java/com/depot/orders/OrderController.java": ORDER_CONTROLLER }) },
  ]);
  assert.deepEqual(map.links[0].targets.map((t) => t.handler.name), ["ping"], "not also get(/orders/{id})");
});

test("a gateway target that names no repo narrows nothing, and says so", () => {
  const map = resolveRoutes([
    { name: "web", routes: repo({ "gw/routes.js": "export const R = [{ prefix: \"/api/regions\", service: \"mystery\", rewrite: \"/regions\" }];\n" }) },
    { name: "depot-region-east", routes: repo({ "src/main/java/E.java": RULES("east") }) },
    { name: "depot-region-west", routes: repo({ "src/main/java/W.java": RULES("west") }) },
  ]);
  const [g] = map.gatewayRoutes;
  assert.equal(g.narrowed, "unresolved");
  assert.deepEqual([...new Set(g.handlers.map((h) => h.repo))], ["depot-region-east", "depot-region-west"]);
});

test("with only one half in reach, nothing is reported against the other", () => {
  const feOnly = resolveRoutes([{ name: "web", routes: repo({ "packages/client/src/client.ts": CLIENT }) }]);
  assert.deepEqual(feOnly.findings, [], "a front-end-only workspace is not full of broken calls");
  const beOnly = resolveRoutes([{ name: "api", routes: repo({ "src/main/java/O.java": ORDER_CONTROLLER }) }]);
  assert.deepEqual(beOnly.findings, [], "nor a back-end-only one full of dead endpoints");
});

test("the resolved map is deterministic — the same workspace gives the same bytes", () => {
  assert.equal(JSON.stringify(resolveRoutes(depotWorkspace())), JSON.stringify(resolveRoutes(depotWorkspace())));
});

// --- the index and the workspace on disk ----------------------------------------------------------

function gitRepo(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  execFileSync("git", ["init", "-q", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: dir });
}

test("the index always carries routes — empty for a repo with none — and two builds agree", () => {
  const root = tempDir("cortex-routes-");
  gitRepo(join(root, "plain"), { "src/a.js": "export const a = 1;\n" });
  const a = buildIndex(join(root, "plain"));
  assert.deepEqual(a.routes, { calls: [], bases: [], gateways: [], handlers: [], services: [], unread: { calls: 0, handlers: 0 } });

  gitRepo(join(root, "orders"), { "src/main/java/com/depot/orders/OrderController.java": ORDER_CONTROLLER.replace(/\n/g, "\r\n") });
  const b1 = buildIndex(join(root, "orders"));
  const b2 = buildIndex(join(root, "orders"));
  assert.equal(b1.routes.handlers.length, 6);
  assert.deepEqual(b1.routes, b2.routes);
});

test("a workspace is every git repo directly under a directory, team-brains excluded, sorted", () => {
  const ws = tempDir("cortex-ws-");
  gitRepo(join(ws, "b-api"), { "a.txt": "x\n" });
  gitRepo(join(ws, "a-web"), { "a.txt": "x\n" });
  gitRepo(join(ws, "team-brain"), { "team.md": "# Team: depot\n", "projects/.gitkeep": "" });
  mkdirSync(join(ws, "not-a-repo"));
  writeFileSync(join(ws, "loose.txt"), "x\n");
  assert.deepEqual(workspaceRepos(ws).map((r) => r.name), ["a-web", "b-api"]);
  assert.deepEqual(workspaceRepos(join(ws, "does-not-exist")), []);
});
