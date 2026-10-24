// The contract extractor (#621) and the route handlers it reads from lib/routes.mjs.
//
// Literal sources throughout: extractRoutes and extractContract take a reader, so no temp tree is
// needed to say what a repo holds. The end-to-end run on real git repos — extract, publish, read
// back, drift — is mcp/test/contract.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRoutes } from "../lib/routes.mjs";
import { extractContract, parseYaml, readSpecFile, renderContractJson, YamlUnsupported } from "../lib/contract.mjs";
import { detectLanguage, categoryOf } from "../lib/langs.mjs";

/** An index-shaped object from `{ path: text }`, routes extracted the way buildIndex does it. */
function indexOf(src) {
  const files = Object.keys(src).sort().map((path) => {
    const lang = detectLanguage(path);
    return { path, lang, category: categoryOf(lang), isTest: /\.test\./.test(path), vendored: false };
  });
  return { files, routes: extractRoutes(files, (p) => src[p] ?? null) };
}

const contractOf = (src, opts) => {
  const index = indexOf(src);
  return extractContract(index, (p) => src[p] ?? null, opts);
};

// --- route handlers ---------------------------------------------------------------------------------

test("Express-style routers are handlers; a one-argument get is a setting, a runtime path is counted", () => {
  const r = extractRoutes([{ path: "src/app.js" }], () => [
    'const app = express(); const itemsRouter = express.Router();',
    'app.get("/items", listItems);',
    'app.post("/items/:id", auth, (req, res) => res.send(1));',
    'app.get("env");',
    'itemsRouter.route("/things/:id").get(getThing).delete(delThing);',
    "app.get(`${base}/x`, h);",
    'apiRouter.get("/health", ok);',
    'app.get("/lonely");',
    'server.get({ path: "/restify" }, h);',
  ].join("\n"));
  assert.deepEqual(r.handlers.map((h) => `${h.method} ${h.path} ${h.name}`), [
    "GET /items listItems",
    "POST /items/{} null",
    "DELETE /things/{} delThing",
    "GET /things/{} getThing",
    "GET /health ok",
  ]);
  assert.equal(r.unread.handlers, 1);
  assert.deepEqual(r.calls, [], "a router's get is not a call, even under a name with `api` in it");
});

test("NestJS controllers combine with their method decorators and one literal global prefix", () => {
  const src = {
    "src/items.controller.ts": [
      '@Controller("items")',
      "export class ItemsController {",
      "  @Get()",
      "  findAll() {}",
      '  @Get(":id")',
      '  async findOne(@Param("id") id: string) {}',
      '  @Post(["a", "b"])',
      "  create() {}",
      "  @Delete(ID)",
      "  remove() {}",
      "}",
    ].join("\n"),
    "src/main.ts": 'app.setGlobalPrefix("api");',
  };
  const r = extractRoutes(Object.keys(src).map((path) => ({ path })), (p) => src[p]);
  assert.deepEqual(r.handlers.map((h) => `${h.method} ${h.path} ${h.name}`), [
    "GET /api/items findAll",
    "GET /api/items/{} findOne",
    "POST /api/items/a create",
    "POST /api/items/b create",
  ]);
  assert.equal(r.unread.handlers, 1, "a constant path is counted, not guessed");
});

test("FastAPI and Flask decorators are handlers, with a same-file router prefix; requests calls are calls", () => {
  const text = [
    "from fastapi import APIRouter, FastAPI",
    "import requests",
    'router = APIRouter(prefix="/users")',
    "app = FastAPI()",
    '@app.get("/items/{item_id}")',
    "async def read_item(item_id: int):",
    '    return requests.get(f"{BASE}/orders/{item_id}")',
    '@router.post("")',
    "def create_user(): pass",
    '@bp.route("/flask/<int:id>", methods=["GET", "PUT"])',
    "def flask_view(id): pass",
    "@app.get(PATH)",
    "def dynamic(): pass",
  ].join("\n");
  const r = extractRoutes([{ path: "app/main.py" }], () => text);
  assert.deepEqual(r.handlers.map((h) => `${h.method} ${h.path} ${h.name}`), [
    "GET /items/{} read_item",
    "POST /users create_user",
    "GET /flask/{} flask_view",
    "PUT /flask/{} flask_view",
  ]);
  assert.equal(r.unread.handlers, 1);
  assert.deepEqual(r.calls.map((c) => `${c.method} ${c.path}`), ["GET /orders/{}"]);
});

test("a decorator shown in a docstring or a comment is not a handler", () => {
  const text = [
    "def route(self, rule):",
    '    """Decorate a view.',
    "",
    "    .. code-block:: python",
    "",
    '        @app.route("/")',
    "        def index():",
    "            return 'Hello World'",
    '    """',
    '# @app.get("/commented")',
  ].join("\n");
  assert.deepEqual(extractRoutes([{ path: "src/flask/scaffold.py" }], () => text).handlers, []);
});

test("a generated client's verb is the method of the config object it is handed", () => {
  const text = [
    "export class LoginService {",
    "  public static login(options) {",
    "    return (options.client ?? client).post<LoginResponses, LoginErrors>({",
    "      responseType: 'json',",
    "      url: '/api/v1/login/access-token',",
    "      ...options,",
    "      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },",
    "    });",
    "  }",
    "}",
  ].join("\n");
  const r = extractRoutes([{ path: "src/client/sdk.gen.ts" }], () => text);
  assert.deepEqual(r.calls.map((c) => `${c.method} ${c.path}`), ["POST /api/v1/login/access-token"]);
});

// --- YAML -------------------------------------------------------------------------------------------

test("parseYaml reads the subset an OpenAPI file uses", () => {
  const doc = parseYaml([
    "openapi: 3.0.0 # a comment",
    "info:",
    "  title: 'Items API'",
    "  description: |",
    "    Line one.",
    "    Line two: still text.",
    "paths:",
    "  /items:",
    "    get:",
    "      operationId: listItems",
    "      tags: [items, read]",
    "      parameters:",
    "        - name: limit",
    "          in: query",
    "        - $ref: '#/components/parameters/Page'",
    "      responses:",
    "        '200':",
    "          description: ok",
    "          content:",
    "            application/json:",
    "              schema:",
    "                type: array",
    "                items:",
    '                  $ref: "#/components/schemas/Item"',
    "servers:",
    "- url: https://api.example.com/v1",
  ].join("\n"));
  assert.equal(doc.openapi, "3.0.0");
  assert.equal(doc.info.description, "Line one.\nLine two: still text.");
  assert.deepEqual(doc.paths["/items"].get.tags, ["items", "read"]);
  assert.deepEqual(doc.paths["/items"].get.parameters, [{ name: "limit", in: "query" }, { $ref: "#/components/parameters/Page" }]);
  assert.equal(doc.paths["/items"].get.responses["200"].content["application/json"].schema.items.$ref, "#/components/schemas/Item");
  assert.deepEqual(doc.servers, [{ url: "https://api.example.com/v1" }]);
});

test("parseYaml refuses what it does not cover rather than guessing", () => {
  assert.throws(() => parseYaml("a: &anchor\n  b: 1\nc: *anchor\n"), YamlUnsupported);
  assert.throws(() => parseYaml("base: &b {x: 1}\nother:\n  <<: *b\n"), YamlUnsupported);
  assert.throws(() => parseYaml("other:\n  <<: {x: 1}\n"), YamlUnsupported);
  assert.throws(() => parseYaml("? complex\n: key\n"), YamlUnsupported);
});

// --- specs ------------------------------------------------------------------------------------------

test("an OpenAPI 3 YAML file serves its paths with operation ids and response schema names", () => {
  const yaml = [
    "openapi: 3.1.0",
    "servers:",
    "  - url: https://api.example.com/v1",
    "paths:",
    "  /items:",
    "    get:",
    "      operationId: listItems",
    "      responses:",
    "        '200':",
    "          content:",
    "            application/json:",
    "              schema:",
    "                type: array",
    "                items: { $ref: '#/components/schemas/Item' }",
    "    post:",
    "      responses:",
    "        '201':",
    "          $ref: '#/components/responses/Created'",
    "  /items/{id}:",
    "    delete:",
    "      responses:",
    "        '204':",
    "          description: gone",
    "components:",
    "  responses:",
    "    Created:",
    "      content:",
    "        application/json:",
    "          schema:",
    "            $ref: '#/components/schemas/Item'",
  ].join("\n");
  const c = contractOf({ "api/openapi.yaml": yaml });
  assert.equal(c.source, "openapi");
  assert.deepEqual(c.serves.map((r) => [r.method, r.path, r.raw, r.operationId ?? null, r.response ?? null]), [
    ["GET", "/v1/items", "/v1/items", "listItems", "Item[]"],
    ["POST", "/v1/items", "/v1/items", null, "Item"],
    ["DELETE", "/v1/items/{}", "/v1/items/{id}", null, null],
  ]);
});

test("a Swagger 2 file prefixes its basePath; a spec wins over route handlers", () => {
  const swagger = JSON.stringify({
    swagger: "2.0", basePath: "/api",
    paths: { "/orders": { get: { operationId: "listOrders", responses: { 200: { schema: { $ref: "#/definitions/Order" } } } } } },
  });
  const c = contractOf({ "swagger.json": swagger, "src/app.js": 'app.get("/other", h);' });
  assert.equal(c.source, "openapi");
  assert.deepEqual(c.serves.map((r) => `${r.method} ${r.path} ${r.response}`), ["GET /api/orders Order"]);
});

test("a spec file that does not parse is reported in unread, and routes stand in", () => {
  const c = contractOf({ "openapi.json": "{ not json", "src/app.js": 'app.get("/items", list);' });
  assert.equal(c.source, "routes");
  assert.ok(c.unread.some((u) => u.what === "openapi.json" && /not valid JSON/.test(u.why)), JSON.stringify(c.unread));
});

test("AsyncAPI channels and Kafka topics in code are events", () => {
  const asyncapi = "asyncapi: 2.6.0\nchannels:\n  order.created:\n    subscribe:\n      message: {}\n  payment.done:\n    publish:\n      message: {}\n";
  const c = contractOf({
    "asyncapi.yaml": asyncapi,
    "src/worker.js": 'await consumer.subscribe({ topic: "stock.changed" });\n// producer.send({ topic: "in.a.comment" })\n',
  });
  assert.deepEqual(c.events.map((e) => `${e.kind} ${e.name}`), ["publish order.created", "consume payment.done", "consume stock.changed"]);
});

test("calls keep method, path and host, never the query string; languages Cortex does not read are unread", () => {
  const c = contractOf({
    "web/api.js": 'fetch("https://user:pw@api.example.com:8443/items?key=abc");\nfetch("/items");\naxios.post("/orders", body);\n',
    "svc/main.go": "package main\n",
    "svc/util.go": "package main\n",
  });
  assert.deepEqual(c.calls.map((r) => `${r.method} ${r.path} ${r.host ?? ""}`.trim()), ["GET /items", "GET /items api.example.com", "POST /orders"]);
  const text = renderContractJson(c);
  assert.ok(!text.includes("key=abc") && !text.includes("pw@"), "a query string or credential leaked");
  assert.ok(!/"line"/.test(text), "a line number would make every edit a contract change");
  assert.ok(c.unread.some((u) => u.what === "go (2 files)"), JSON.stringify(c.unread));
});

test("an empty contract says why; the same input gives the same bytes", () => {
  const src = { "src/math.js": "export const add = (a, b) => a + b;\n" };
  const a = contractOf(src, { project: "lib-c" });
  assert.equal(a.source, "none");
  assert.equal(a.project, "lib-c");
  assert.match(a.reason, /No HTTP surface Cortex can read/);
  assert.equal(renderContractJson(a), renderContractJson(contractOf(src, { project: "lib-c" })));
});

test("a file merely named like a spec contributes nothing and is not reported", () => {
  assert.deepEqual(readSpecFile("openapi-generator.json", '{"generatorName":"typescript"}'), { serves: [], events: [], unread: [] });
});
