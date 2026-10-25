// Contracts across repos (#621) — the acceptance, on real git repositories.
//
// One team-brain (a bare remote on disk, so no network) and product repos in repo mode, as a plugin
// install runs them. Each repo extracts its contract with `index/cortex-contract.mjs` — spawned, not
// imported: the leaves never import each other — and publishes it with `ai-os contract publish`.
// Then: who calls /items, what the server serves, and the server dropping /items reaching the
// caller's next catch-up.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diffServes, parseContract, parseEndpoint, publishContract, renderContract, ContractRefused } from "../lib/contract.js";
import { tempDir } from "./tmp.js";
import { policyFor } from "../../core/profile.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "server.js");
const CLI = join(HERE, "..", "ai-os.js");
const EXTRACT = join(HERE, "..", "..", "index", "cortex-contract.mjs");
const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const FAKE_AWS_KEY = ["AKIA", "Q7X2M4N8P1R5T9V3"].join("");

function git(cwd, ...a) {
  return execFileSync("git", a, { cwd, env: { ...process.env, ...IDENTITY }, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function teamBrainRemote() {
  const remote = tempDir("contract-remote-");
  git(remote, "init", "--bare", "-q", "-b", "master");
  const seed = tempDir("contract-seed-");
  git(seed, "clone", "-q", remote, ".");
  for (const p of ["web-a", "svc-b", "lib-c"]) {
    mkdirSync(join(seed, "projects", p), { recursive: true });
    writeFileSync(join(seed, "projects", p, ".gitkeep"), "");
  }
  writeFileSync(join(seed, "team.md"), "# Team: harbor\n");
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "seed");
  git(seed, "branch", "-M", "master");
  git(seed, "push", "-q", "-u", "origin", "master");
  return remote;
}

/** A product repo joined to the team, holding `files`, all committed (the index asks git). */
function productRepo(project, remote, files) {
  const repo = tempDir(`${project}-`);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "x\n");
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), text);
  }
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  mkdirSync(join(repo, ".cortex"), { recursive: true });
  writeFileSync(join(repo, ".cortex", "connector.json"), JSON.stringify({ team: "harbor", project, teamBrainRepo: remote }, null, 2) + "\n");
  return repo;
}

function env(repo, extra = {}) {
  const e = { ...process.env, AI_OS_ROOT: "", CORTEX_ROOT: join(repo, ".cortex"), CORTEX_AUTHOR: "dev", ...IDENTITY };
  delete e.CORTEX_PROFILE;
  delete e.CORTEX_AUDIENCE;
  return { ...e, ...extra };
}

function cli(repo, args, extra = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env: env(repo, extra), encoding: "utf8" });
}

/** Extract the repo's contract into a file outside it, and return the path and the text. */
function extract(repo) {
  const out = join(tempDir("contract-out-"), "contract.json");
  const r = spawnSync(process.execPath, [EXTRACT, repo, "--out", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return { file: out, text: readFileSync(out, "utf8") };
}

function publish(repo, extra = {}) {
  const { file, text } = extract(repo);
  const r = cli(repo, ["contract", "publish", "--file", file], extra);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return { stdout: r.stdout, text };
}

function cliJson(repo, args) {
  const r = cli(repo, [...args, "--json"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return JSON.parse(r.stdout);
}

/** One server session: initialize, then each tools/call; resolves to each call's result. */
function session(repo, calls) {
  const child = spawn(process.execPath, [SERVER], { cwd: repo, env: env(repo) });
  let buf = "";
  let errBuf = "";
  const got = new Map();
  child.stderr.on("data", (d) => { errBuf += d.toString(); });
  const done = new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        got.set(m.id, m.result);
        if (got.size === calls.length + 1) resolve();
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => { if (code) reject(new Error(`server exited ${code}\n${errBuf}`)); });
    setTimeout(() => reject(new Error(`timed out\n${errBuf}`)), 20000);
  });
  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  calls.forEach(([name, args], i) => send({ jsonrpc: "2.0", id: i + 1, method: "tools/call", params: { name, arguments: args } }));
  return done.then(() => {
    child.kill();
    return calls.map((_, i) => got.get(i + 1));
  });
}

const json = (r) => {
  assert.notEqual(r.isError, true, r.content[0].text);
  return JSON.parse(r.content[0].text);
};

// --- the two repos -------------------------------------------------------------------------------

const ITEM_SCHEMA = { type: "object", properties: { id: { type: "string" } } };

function openapi(paths) {
  return JSON.stringify({
    openapi: "3.0.3",
    info: { title: "svc-b", version: "1" },
    paths,
    components: { schemas: { Item: ITEM_SCHEMA, Order: ITEM_SCHEMA } },
  }, null, 2);
}

const ITEMS = {
  "/items": {
    get: {
      operationId: "listItems",
      responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Item" } } } } } },
    },
  },
};
const ORDERS = {
  "/orders/{id}": {
    get: { operationId: "getOrder", responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } } } },
  },
};

const CALLER = {
  "src/api.js": [
    'import axios from "axios";',
    "export const listItems = () => fetch(\"/items/\");",
    "export const getOrder = (id) => axios.get(`/orders/${id}`);",
    "",
  ].join("\n"),
};

function setup() {
  const remote = teamBrainRemote();
  const server = productRepo("svc-b", remote, {
    "openapi.json": openapi({ ...ITEMS, ...ORDERS }),
    // A body and an environment value the contract must never carry.
    "src/handlers.js": "export function listItems(req, res) { const marker = 'BODY_MARKER_7f3a'; res.json([process.env.DB_HOST]); }\n",
    ".env.example": "DB_HOST=db.internal.example\n",
  });
  const caller = productRepo("web-a", remote, CALLER);
  return { remote, server, caller };
}

// --- the acceptance --------------------------------------------------------------------------------

test("two repos publish to one brain: who calls /items finds the caller, and the server's contract names /items with its response schema", async () => {
  const { remote, server, caller } = setup();
  const pub = publish(server);
  assert.match(pub.stdout, /Contract for svc-b created \(openapi: 2 served/);
  publish(caller);

  const files = git(remote, "ls-tree", "-r", "--name-only", "master");
  for (const f of ["projects/svc-b/contract.json", "projects/svc-b/contract.md", "projects/web-a/contract.json"]) assert.ok(files.includes(f), `${f} reached the remote`);
  assert.match(git(remote, "log", "--format=%s", "master"), /^contract: update web-a$/m);

  // The summary carries no file body and no environment value.
  assert.ok(!pub.text.includes("BODY_MARKER_7f3a"), "a code body leaked into the contract");
  assert.ok(!pub.text.includes("db.internal.example"), "an environment value leaked into the contract");

  // The CLI and the tool give the same answers.
  const who = cliJson(caller, ["contract", "who-calls", "--path", "/items"]);
  assert.deepEqual(who.callers.map((c) => c.project), ["web-a"]);
  assert.deepEqual(who.servedBy.map((s) => [s.project, s.method, s.path, s.operationId, s.response]), [["svc-b", "GET", "/items", "listItems", "Item[]"]]);

  const [byTool, shown, filtered, listed] = await session(caller, [
    ["contract", { calls: "GET /items/" }],
    ["contract", { project: "svc-b" }],
    ["contract", { project: "svc-b", path: "/orders/:id" }],
    ["contract", {}],
  ]);
  assert.deepEqual(json(byTool).callers.map((c) => c.project), ["web-a"]);
  const s = json(shown);
  assert.equal(s.source, "openapi");
  const items = s.serves.find((r) => r.path === "/items");
  assert.deepEqual([items.method, items.operationId, items.response], ["GET", "listItems", "Item[]"]);
  assert.deepEqual(json(filtered).serves.map((r) => r.operationId), ["getOrder"], "path params match whatever their spelling");
  assert.deepEqual(json(listed).contracts.map((c) => c.project), ["svc-b", "web-a"]);

  // A path parameter in either spelling finds the template-literal call.
  const orders = cliJson(caller, ["contract", "who-calls", "--path", "GET /orders/{orderId}"]);
  assert.deepEqual(orders.callers.map((c) => c.project), ["web-a"]);

  // Republishing an unchanged contract writes no commit.
  const before = git(remote, "rev-parse", "master");
  const again = publish(server);
  assert.match(again.stdout, /unchanged/);
  assert.equal(git(remote, "rev-parse", "master"), before);
});

test("the server drops /items and republishes: the caller's next catch-up lists the removal", () => {
  const { remote, server, caller } = setup();
  // The first contract predates the window.
  const old = `${day(-10)}T12:00:00`;
  publish(server, { GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old });
  publish(caller, { GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old });

  writeFileSync(join(server, "openapi.json"), openapi({ ...ORDERS }));
  git(server, "commit", "-qam", "drop /items");
  const r = publish(server);
  assert.match(r.stdout, /Contract for svc-b updated/);
  assert.match(git(remote, "log", "-1", "--format=%s", "master"), /^contract: update svc-b$/m);

  // The caller's contract changes in the window too, but not what it serves: no drift to report.
  writeFileSync(join(caller, "src", "more.js"), 'export const tags = () => fetch("/tags");\n');
  git(caller, "add", ".");
  git(caller, "commit", "-qm", "call /tags");
  assert.match(publish(caller).stdout, /Contract for web-a updated/);

  // Since TODAY, in local time: git reads a bare date as that day at the current time of day, so
  // a commit made a moment ago would fall outside the window unless the day is taken from midnight.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const up = cli(caller, ["catch-up", "--since", today]);
  assert.equal(up.status, 0, up.stderr);
  const res = JSON.parse(up.stdout);
  assert.deepEqual(res.pull, { ok: true });
  const drift = res.contracts.find((c) => c.project === "svc-b");
  assert.ok(drift, JSON.stringify(res.contracts));
  assert.equal(drift.first, false);
  assert.deepEqual(drift.removed.map((x) => `${x.method} ${x.path}`), ["GET /items"]);
  assert.deepEqual(drift.added, []);
  assert.ok(!res.contracts.some((c) => c.project === "web-a"), "an unchanged contract reports no drift");
});

test("a route handler stands in for a missing OpenAPI file", () => {
  const remote = teamBrainRemote();
  const server = productRepo("svc-b", remote, {
    "src/server.js": 'const app = require("express")();\napp.get("/items", listItems);\napp.post("/items/:id", saveItem);\n',
  });
  const caller = productRepo("web-a", remote, CALLER);
  const { text } = publish(server);
  publish(caller);
  const c = JSON.parse(text);
  assert.equal(c.source, "routes");
  assert.deepEqual(c.serves.map((r) => `${r.method} ${r.path}`), ["GET /items", "POST /items/{}"]);
  const who = cliJson(caller, ["contract", "who-calls", "--path", "/items"]);
  assert.deepEqual(who.callers.map((x) => x.project), ["web-a"]);
  assert.deepEqual(who.servedBy.map((x) => `${x.project} ${x.method}`), ["svc-b GET"]);
});

test("a repo with no HTTP surface publishes an empty contract that says why, and exits 0", () => {
  const remote = teamBrainRemote();
  const lib = productRepo("lib-c", remote, { "src/math.js": "export const add = (a, b) => a + b;\n" });
  const { text } = publish(lib);
  const c = JSON.parse(text);
  assert.equal(c.source, "none");
  assert.deepEqual([c.serves, c.calls, c.events], [[], [], []]);
  assert.match(c.reason, /No HTTP surface/);
  const shown = cliJson(lib, ["contract", "show", "--project", "lib-c"]);
  assert.match(shown.reason, /No HTTP surface/);
});

test("two extracts of one tree are byte-identical", () => {
  const { server } = setup();
  assert.equal(extract(server).text, extract(server).text);
});

test("a credential-shaped string is refused by the gate, and nothing is written or pushed", () => {
  const { remote, server } = setup();
  const { file, text } = extract(server);
  const c = JSON.parse(text);
  c.serves[0].operationId = `list ${FAKE_AWS_KEY}`;
  writeFileSync(file, JSON.stringify(c));
  const r = cli(server, ["contract", "publish", "--file", file]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refusing to write/);
  assert.ok(!r.stderr.includes(FAKE_AWS_KEY), "the refusal echoed the credential");
  assert.ok(!git(remote, "ls-tree", "-r", "--name-only", "master").includes("contract.json"));
  assert.ok(!existsSync(join(server, ".cortex", "team", "harbor", "projects", "svc-b", "contract.json")));
});

test("contract refuses on a brain with no team, naming /team-add", async () => {
  const repo = tempDir("solo-");
  git(repo, "init", "-q");
  mkdirSync(join(repo, ".cortex"));
  const [r] = await session(repo, [["contract", { calls: "/items" }]]);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /\/team-add/);
});

// --- the module ----------------------------------------------------------------------------------

test("parseContract keeps only the known shape, sorts it, and refuses what it cannot publish", () => {
  const c = parseContract(JSON.stringify({
    format: 1, project: "x", source: "routes", secretField: "dropped",
    serves: [{ method: "post", path: "/b/:id", files: ["src/b.js"], body: "dropped" }, { method: "GET", path: "/a", files: ["src/a.js"] }],
    calls: [], bases: ["/api/"], events: [], unread: [],
  }));
  assert.deepEqual(Object.keys(c), ["format", "project", "source", "serves", "calls", "bases", "events", "unread", "reason"].filter((k) => k !== "reason" || "reason" in c));
  assert.deepEqual(c.serves.map((r) => `${r.method} ${r.path}`), ["GET /a", "POST /b/{}"]);
  assert.ok(!renderContract(c).includes("dropped"));
  assert.deepEqual(c.bases, ["/api"]);

  const bad = (doc, re) => assert.throws(() => parseContract(JSON.stringify(doc)), (e) => e instanceof ContractRefused && re.test(e.message));
  bad({ format: 2, source: "none" }, /format is 2/);
  bad({ format: 1, source: "maybe" }, /source must be/);
  bad({ format: 1, source: "routes", serves: [{ method: "GET", path: "/a", files: ["/home/someone/repo/a.js"] }] }, /not a path inside the repo/);
  bad({ format: 1, source: "routes", serves: [{ method: "GET", path: "/a", files: ["../outside.js"] }] }, /not a path inside the repo/);
  bad({ format: 1, source: "routes", serves: [{ method: "FETCH", path: "/a" }] }, /not an HTTP method/);
  assert.throws(() => parseContract("{"), /not valid JSON/);
});

test("an endpoint question tolerates a method, a trailing slash and either parameter spelling", () => {
  assert.deepEqual(parseEndpoint("/items/"), { method: null, path: "/items" });
  assert.deepEqual(parseEndpoint("get /items/:id"), { method: "GET", path: "/items/{}" });
  assert.deepEqual(parseEndpoint("/items/{itemId}"), { method: null, path: "/items/{}" });
  assert.throws(() => parseEndpoint("items"), /not an endpoint/);
});

test("diffServes reports added, removed and changed endpoints", () => {
  const a = { serves: [{ method: "GET", path: "/a", response: "A" }, { method: "GET", path: "/gone" }] };
  const b = { serves: [{ method: "GET", path: "/a", response: "A2" }, { method: "POST", path: "/new" }] };
  const d = diffServes(a, b);
  assert.deepEqual(d.added.map((x) => x.path), ["/new"]);
  assert.deepEqual(d.removed.map((x) => x.path), ["/gone"]);
  assert.deepEqual(d.changed.map((x) => [x.before.response, x.after.response]), [["A", "A2"]]);
});

test("a credential in a field the parser would drop is still refused, before anything is written", () => {
  const remote = teamBrainRemote();
  const clone = tempDir("contract-clone-");
  git(clone, "clone", "-q", remote, ".");
  const input = JSON.stringify({ format: 1, source: "none", notes: `deploy key ${FAKE_AWS_KEY}`, serves: [], calls: [], bases: [], events: [], unread: [] });
  assert.throws(() => publishContract(clone, { slug: "lib-c", input }), /refusing to write/);
  assert.ok(!existsSync(join(clone, "projects", "lib-c", "contract.json")));
});

test("publishContract on lab commits and does not push", () => {
  const remote = teamBrainRemote();
  const clone = tempDir("contract-clone-");
  git(clone, "clone", "-q", remote, ".");
  const input = JSON.stringify({ format: 1, source: "none", serves: [], calls: [], bases: [], events: [], unread: [] });
  const res = publishContract(clone, { slug: "lib-c", input, policy: policyFor("lab") });
  assert.equal(res.committed, true);
  assert.equal(res.pushed, false);
  assert.equal(res.error, "outward_sync_disabled");
  assert.ok(!git(remote, "ls-tree", "-r", "--name-only", "master").includes("contract.json"));
});
