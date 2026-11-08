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

// --- mounts: a router whose prefix is declared in another file (#630) -------------------------------

/**
 * `{ path: text }` and `{ "<from> <spec>": [targets] }` → routes, extracted with a resolver the way
 * buildIndex hands one in. The resolver is a lookup table, so each test says exactly which import
 * reaches which file.
 */
function mounted(src, links) {
  const files = Object.keys(src).sort().map((path) => {
    const lang = detectLanguage(path);
    return { path, lang, category: categoryOf(lang), isTest: false, vendored: false };
  });
  const resolve = (spec, from) => links[`${from.path} ${spec}`] ?? [];
  return extractRoutes(files, (p) => src[p] ?? null, resolve);
}

const handlerLines = (r) => r.handlers.map((h) => `${h.method} ${h.path} ${h.file}`);

test("an Express router mounted under a prefix in another file gets the prefix, through each import form", () => {
  const r = mounted(
    {
      "src/app.js": [
        'const express = require("express");',
        'const items = require("./routes/items");',
        'import { usersRouter } from "./routes/users";',
        "const app = express();",
        'app.use("/api/items", authenticate, items);',
        'app.use("/api", usersRouter);',
        'app.use("/admin", require("./routes/admin"));',
        "app.use(express.json());",
      ].join("\n"),
      "src/routes/items.js": 'const router = express.Router();\nrouter.get("/", list);\nrouter.get("/:id", one);',
      "src/routes/users.js": 'export const usersRouter = Router();\nusersRouter.post("/users", create);',
      "src/routes/admin.js": 'const router = Router();\nrouter.delete("/cache", flush);',
      "src/auth.js": "export function authenticate(req, res, next) { next(); }",
    },
    {
      "src/app.js ./routes/items": ["src/routes/items.js"],
      "src/app.js ./routes/users": ["src/routes/users.js"],
      "src/app.js ./routes/admin": ["src/routes/admin.js"],
      "src/app.js express": [],
    },
  );
  assert.deepEqual(handlerLines(r), [
    "DELETE /admin/cache src/routes/admin.js",
    "GET /api/items src/routes/items.js",
    "GET /api/items/{} src/routes/items.js",
    "POST /api/users src/routes/users.js",
  ]);
  assert.deepEqual(
    r.mounts.map((m) => `${m.file}:${m.line} ${m.prefix} -> ${m.target} ${m.confidence}`),
    [
      "src/app.js:5 /api/items -> src/routes/items.js extracted",
      "src/app.js:6 /api -> src/routes/users.js extracted",
      "src/app.js:7 /admin -> src/routes/admin.js extracted",
    ],
  );
  assert.equal(r.unread.mounts, 0);
});

test("mounts compose: a router mounted inside a router mounted under a prefix gets both", () => {
  const r = mounted(
    {
      "src/server.ts": 'import v1 from "./v1";\napp.use("/v1", v1);',
      "src/v1/index.ts": 'import items from "./items";\nconst router = Router();\nrouter.use("/items", items);\nrouter.get("/health", ok);\nexport default router;',
      "src/v1/items.ts": 'const router = Router();\nrouter.get("/:id", one);\nexport default router;',
    },
    {
      "src/server.ts ./v1": ["src/v1/index.ts"],
      "src/v1/index.ts ./items": ["src/v1/items.ts"],
    },
  );
  assert.deepEqual(handlerLines(r), ["GET /v1/health src/v1/index.ts", "GET /v1/items/{} src/v1/items.ts"]);
});

test("one router mounted under two prefixes serves both", () => {
  const r = mounted(
    {
      "src/app.js": 'const legacy = require("./legacy");\napp.use("/v1", legacy);\napp.use("/v2", legacy);',
      "src/legacy.js": 'const router = Router();\nrouter.get("/ping", ping);',
    },
    { "src/app.js ./legacy": ["src/legacy.js"] },
  );
  assert.deepEqual(handlerLines(r), ["GET /v1/ping src/legacy.js", "GET /v2/ping src/legacy.js"]);
});

test("FastAPI include_router chains resolve, and a settings default is applied as inferred, with where it came from", () => {
  const r = mounted(
    {
      "backend/app/main.py": [
        "from fastapi import FastAPI",
        "from app.api.main import api_router",
        "from app.core.config import settings",
        "app = FastAPI()",
        "app.include_router(api_router, prefix=settings.API_V1_STR)",
      ].join("\n"),
      "backend/app/api/main.py": [
        "from fastapi import APIRouter",
        "from app.api.routes import items, login",
        "api_router = APIRouter()",
        "api_router.include_router(login.router)",
        "api_router.include_router(items.router)",
      ].join("\n"),
      "backend/app/api/routes/items.py": 'router = APIRouter(prefix="/items")\n@router.get("/")\ndef read_items(): pass',
      "backend/app/api/routes/login.py": 'router = APIRouter()\n@router.post("/login/access-token")\ndef login(): pass',
      "backend/app/core/config.py": 'class Settings(BaseSettings):\n    API_V1_STR: str = "/api/v1"\n    PROJECT_NAME: str = "x"',
    },
    {
      "backend/app/main.py app.api.main.api_router": [],
      "backend/app/main.py app.api.main": ["backend/app/api/main.py"],
      "backend/app/api/main.py app.api.routes.items": ["backend/app/api/routes/items.py"],
      "backend/app/api/main.py app.api.routes.login": ["backend/app/api/routes/login.py"],
    },
  );
  assert.deepEqual(handlerLines(r), [
    "GET /api/v1/items backend/app/api/routes/items.py",
    "POST /api/v1/login/access-token backend/app/api/routes/login.py",
  ]);
  const top = r.mounts.find((m) => m.file === "backend/app/main.py");
  assert.deepEqual(top, {
    file: "backend/app/main.py",
    line: 5,
    prefix: "/api/v1",
    target: "backend/app/api/main.py",
    confidence: "inferred",
    from: "backend/app/core/config.py:2",
  });
  assert.ok(r.mounts.filter((m) => m.file === "backend/app/api/main.py").every((m) => m.prefix === "" && m.confidence === "extracted"));
});

test("a prefix that is not a literal and has no single default is unread: the routes keep the path they declare", () => {
  const r = mounted(
    {
      "app/main.py": [
        "from app.routes import items, users",
        'app.include_router(items.router, prefix=f"{BASE}/items")',
        "app.include_router(users.router, prefix=settings.PREFIX)",
      ].join("\n"),
      "app/routes/items.py": '@router.get("/all")\ndef all_items(): pass',
      "app/routes/users.py": '@router.get("/me")\ndef me(): pass',
      "app/config_a.py": 'PREFIX = "/a"',
      "app/config_b.py": 'PREFIX = "/b"',
    },
    {
      "app/main.py app.routes.items": ["app/routes/items.py"],
      "app/main.py app.routes.users": ["app/routes/users.py"],
    },
  );
  assert.deepEqual(handlerLines(r), ["GET /all app/routes/items.py", "GET /me app/routes/users.py"]);
  assert.equal(r.unread.mounts, 2);
  assert.deepEqual(r.mounts.map((m) => [m.prefix, m.reason]), [
    [null, "the prefix is built at runtime"],
    [null, "settings.PREFIX has more than one default in the repo"],
  ]);
});

test("Flask register_blueprint lends its url_prefix; without a resolver no mount is followed", () => {
  const src = {
    "app/__init__.py": "from app.admin import bp as admin_bp\napp.register_blueprint(admin_bp, url_prefix='/admin')",
    "app/admin.py": '@bp.route("/users")\ndef users(): pass',
  };
  const r = mounted(src, { "app/__init__.py app.admin.bp": [], "app/__init__.py app.admin": ["app/admin.py"] });
  assert.deepEqual(handlerLines(r), ["GET /admin/users app/admin.py"]);
  const plain = extractRoutes(Object.keys(src).map((path) => ({ path })), (p) => src[p]);
  assert.deepEqual(plain.handlers.map((h) => h.path), ["/users"]);
  assert.deepEqual(plain.mounts, []);
});

test("an Express prefix held in a variable is unread, not guessed", () => {
  const r = mounted(
    {
      "src/app.js": 'const items = require("./items");\napp.use(API_PREFIX, items);\napp.use(`${BASE}/v2`, items);',
      "src/items.js": 'router.get("/items", list);',
    },
    { "src/app.js ./items": ["src/items.js"] },
  );
  assert.deepEqual(handlerLines(r), ["GET /items src/items.js"]);
  assert.deepEqual(r.mounts.map((m) => [m.prefix, m.reason]), [
    [null, "the prefix is not a literal"],
    [null, "the prefix is built at runtime"],
  ]);
  assert.equal(r.unread.mounts, 2);
});

test("an unread mount prefix is listed in the contract's unread", () => {
  const src = {
    "src/app.js": 'const items = require("./items");\napp.use(API_PREFIX, items);',
    "src/items.js": 'router.get("/items", list);',
  };
  const files = Object.keys(src).map((path) => ({ path, lang: "javascript", category: "code", isTest: false, vendored: false }));
  const routes = extractRoutes(files, (p) => src[p], (spec) => (spec === "./items" ? ["src/items.js"] : []));
  const c = extractContract({ files, routes }, (p) => src[p] ?? null);
  assert.ok(c.unread.some((u) => u.what === "1 router mount" && /prefix/.test(u.why)), JSON.stringify(c.unread));
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
