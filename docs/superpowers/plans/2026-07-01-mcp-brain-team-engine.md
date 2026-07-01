# MCP Brain + Team Context Engine + Core Plugin Bundle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a live MCP "brain" server + team-brain git sync + a curated Core Plugin Bundle so any project/team/PC that installs Cortex gets recall/capture + analysis + skill-creation power out of the box.

**Architecture:** Pure, unit-testable Node lib modules (`mcp/lib/*`) do the work (path-jail, lexical recall, capture, projects, git sync, catch-up). A thin `mcp/server.js` wires them to the MCP stdio transport. Team sync writes only inside `AI_OS_ROOT` (team repo cloned under it) and pushes only to the team-brain remote. Plugins ship via a committed manifest + declarative `.claude/settings.json` + a `/setup-plugins` script. Everything non-MCP is skills + bash, matching the vault's plain-files ethos.

**Tech Stack:** Node ≥20 (ESM), `@modelcontextprotocol/sdk`, built-in `node:test`/`node:assert`, bash (`tools/*.sh`), GitHub Actions.

## Global Constraints

- Node **≥ 20**, ESM only (`"type": "module"` in `mcp/package.json`). Test runner: **`node:test`** (no jest/vitest).
- Runtime deps: **only** `@modelcontextprotocol/sdk`. No other production dependency.
- MCP server's single writable root is **`AI_OS_ROOT`**; the team-brain repo is cloned at `AI_OS_ROOT/team/<team-name>/`. All writes go through the path-jail; `..`/symlink escapes are hard-refused.
- The server **never** runs git against the product repo/CWD, **never** rewrites `CLAUDE.md`/`AGENTS.md`, and only ever pushes to the **team-brain** remote. `capture` is explicit only.
- Committed files stay **data-free** (privacy firewall). Personal folders (`context/ inbox/ daily/ notes/ projects/ areas/ decisions/`) are gitignored — never write personal facts into committed files.
- Tool contract names/params are **stable**: `recall(query, project?, limit?)`, `get_project_context(project)`, `list_projects()`, `capture(content, project?, tags?)`, `catch_me_up(project, since)`.
- Git commits in this repo use `SKIP_SIMPLE_GIT_HOOKS=1`. Changes reach `master` via PR only.
- Final `VERSION` = `1.1.0`.

---

## Phase 0 — Local MCP brain (#305)

### Task 1: `mcp/` scaffold + package + gitignore

**Files:**
- Create: `mcp/package.json`
- Create: `mcp/.gitignore`
- Modify: `.gitignore` (add `mcp/node_modules/`)

**Interfaces:**
- Produces: an installable Node package at `mcp/` with `npm test` wired to `node --test`.

- [ ] **Step 1: Create `mcp/package.json`**

```json
{
  "name": "ai-os-mcp",
  "version": "1.1.0",
  "description": "Cortex brain — local MCP server (recall/capture over the vault).",
  "type": "module",
  "bin": { "ai-os-mcp": "server.js" },
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test",
    "smoke": "node test/smoke.test.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

- [ ] **Step 2: Create `mcp/.gitignore`**

```
node_modules/
```

- [ ] **Step 3: Add node_modules ignore at repo root**

Append to `.gitignore`:

```
# MCP server deps (Node only lives in mcp/)
mcp/node_modules/
```

- [ ] **Step 4: Install deps and confirm**

Run: `cd mcp && npm install`
Expected: creates `mcp/node_modules/` and `mcp/package-lock.json`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add mcp/package.json mcp/.gitignore mcp/package-lock.json .gitignore
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(mcp): scaffold ai-os-mcp node package"
```

---

### Task 2: Path-jail (`mcp/lib/paths.js`)

**Files:**
- Create: `mcp/lib/paths.js`
- Test: `mcp/test/paths.test.js`

**Interfaces:**
- Produces:
  - `class OutsideRootError extends Error` (has `.code === "outside_root"`)
  - `resolveInRoot(root: string, relPath: string): string` — absolute path guaranteed within `root`, else throws `OutsideRootError`.

- [ ] **Step 1: Write the failing test**

```js
// mcp/test/paths.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInRoot, OutsideRootError } from "../lib/paths.js";

test("resolves a normal relative path inside root", () => {
  const root = mkdtempSync(join(tmpdir(), "jail-"));
  const p = resolveInRoot(root, "projects/unis.md");
  assert.ok(p.startsWith(root));
  assert.ok(p.endsWith("unis.md"));
});

test("rejects .. escape", () => {
  const root = mkdtempSync(join(tmpdir(), "jail-"));
  assert.throws(() => resolveInRoot(root, "../evil.md"), (e) => e instanceof OutsideRootError && e.code === "outside_root");
});

test("rejects absolute path outside root", () => {
  const root = mkdtempSync(join(tmpdir(), "jail-"));
  assert.throws(() => resolveInRoot(root, "/etc/passwd"), OutsideRootError);
});

test("rejects symlink that escapes root", () => {
  const root = mkdtempSync(join(tmpdir(), "jail-"));
  const outside = mkdtempSync(join(tmpdir(), "out-"));
  writeFileSync(join(outside, "secret.md"), "x");
  mkdirSync(join(root, "sub"));
  symlinkSync(outside, join(root, "sub", "link"));
  assert.throws(() => resolveInRoot(root, "sub/link/secret.md"), OutsideRootError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && node --test test/paths.test.js`
Expected: FAIL — `Cannot find module '../lib/paths.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// mcp/lib/paths.js
import { resolve, sep } from "node:path";
import { realpathSync } from "node:fs";

export class OutsideRootError extends Error {
  constructor(relPath) {
    super(`path escapes AI_OS_ROOT: ${relPath}`);
    this.name = "OutsideRootError";
    this.code = "outside_root";
  }
}

// Longest-existing-ancestor realpath so we can validate paths that don't exist yet.
function realpathOfNearestExisting(absPath) {
  let cur = absPath;
  // Walk up until realpathSync succeeds (a create target may not exist yet).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return realpathSync(cur);
    } catch {
      const parent = resolve(cur, "..");
      if (parent === cur) return cur; // filesystem root
      cur = parent;
    }
  }
}

export function resolveInRoot(root, relPath) {
  const realRoot = realpathSync(root);
  const candidate = resolve(realRoot, relPath);
  const guard = realpathOfNearestExisting(candidate);
  const withSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (guard !== realRoot && !guard.startsWith(withSep)) {
    throw new OutsideRootError(relPath);
  }
  return candidate;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp && node --test test/paths.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/lib/paths.js mcp/test/paths.test.js
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(mcp): path-jail resolveInRoot with symlink/.. rejection"
```

---

### Task 3: Lexical recall (`mcp/lib/recall.js`)

**Files:**
- Create: `mcp/lib/recall.js`
- Test: `mcp/test/recall.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `listMarkdown(root: string): string[]` — absolute paths of `*.md` under root (skips `node_modules`, `.git`, `team/*/.git`).
  - `recall(root: string, { query, project, limit=8 }): {path, score, snippet}[]` — ranked, `project` filters by `/projects/<slug>` path segment or filename slug.

- [ ] **Step 1: Write the failing test**

```js
// mcp/test/recall.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recall } from "../lib/recall.js";

function seed() {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  mkdirSync(join(root, "projects"));
  writeFileSync(join(root, "projects", "unis.md"), "# UNIS\nUNIS uses PingID session cookies for auth.\n");
  writeFileSync(join(root, "projects", "acme.md"), "# ACME\nACME uses OAuth device flow.\n");
  writeFileSync(join(root, "notes.md"), "General note about PingID and cookies.\n");
  return root;
}

test("ranks the most relevant file first", () => {
  const root = seed();
  const hits = recall(root, { query: "PingID cookies" });
  assert.ok(hits.length >= 1);
  assert.match(hits[0].path, /unis\.md$/);
  assert.match(hits[0].snippet, /PingID/);
});

test("project filter restricts results", () => {
  const root = seed();
  const hits = recall(root, { query: "uses", project: "acme" });
  assert.ok(hits.every((h) => /acme/.test(h.path)));
});

test("limit caps result count", () => {
  const root = seed();
  const hits = recall(root, { query: "uses", limit: 1 });
  assert.equal(hits.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && node --test test/recall.test.js`
Expected: FAIL — cannot find `../lib/recall.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// mcp/lib/recall.js
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "archives"]);

export function listMarkdown(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(join(dir, e.name));
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push(join(dir, e.name));
      }
    }
  };
  walk(root);
  return out;
}

function tokenize(s) {
  return s.toLowerCase().match(/[a-z0-9]+/g) || [];
}

function matchesProject(path, project) {
  if (!project) return true;
  const p = project.toLowerCase();
  const parts = path.toLowerCase().split(sep);
  const pIdx = parts.indexOf("projects");
  if (pIdx >= 0 && parts[pIdx + 1] && parts[pIdx + 1].replace(/\.md$/, "") === p) return true;
  return parts.some((seg) => seg.replace(/\.md$/, "") === p);
}

export function recall(root, { query, project, limit = 8 }) {
  const terms = tokenize(query);
  const hits = [];
  for (const path of listMarkdown(root)) {
    if (!matchesProject(path, project)) continue;
    let text;
    try { text = readFileSync(path, "utf8"); } catch { continue; }
    const lower = text.toLowerCase();
    let score = 0;
    for (const t of terms) {
      let idx = 0;
      while ((idx = lower.indexOf(t, idx)) !== -1) { score++; idx += t.length; }
    }
    if (score === 0) continue;
    // snippet around first matching term
    const first = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
    const start = Math.max(0, first - 60);
    const snippet = text.slice(start, start + 200).replace(/\s+/g, " ").trim();
    hits.push({ path, score, snippet, mtime: statSync(path).mtimeMs });
  }
  hits.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return hits.slice(0, limit).map(({ path, score, snippet }) => ({ path, score, snippet }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp && node --test test/recall.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/lib/recall.js mcp/test/recall.test.js
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(mcp): lexical recall with ranking + project filter"
```

---

### Task 4: Projects (`mcp/lib/projects.js`)

**Files:**
- Create: `mcp/lib/projects.js`
- Test: `mcp/test/projects.test.js`

**Interfaces:**
- Produces:
  - `listProjects(root): {slug, path}[]` — from `projects/*.md` and `projects/*/` folders (team mode), excluding `README.md`.
  - `getProjectContext(root, slug): {slug, path, content}` — throws `Error` with `.code === "not_found"` if absent.

- [ ] **Step 1: Write the failing test**

```js
// mcp/test/projects.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjects, getProjectContext } from "../lib/projects.js";

function seed() {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  mkdirSync(join(root, "projects"));
  writeFileSync(join(root, "projects", "unis.md"), "# UNIS brief\n");
  writeFileSync(join(root, "projects", "README.md"), "readme\n");
  return root;
}

test("lists project slugs excluding README", () => {
  const root = seed();
  const slugs = listProjects(root).map((p) => p.slug);
  assert.deepEqual(slugs, ["unis"]);
});

test("getProjectContext returns content", () => {
  const root = seed();
  const ctx = getProjectContext(root, "unis");
  assert.match(ctx.content, /UNIS brief/);
});

test("getProjectContext throws not_found", () => {
  const root = seed();
  assert.throws(() => getProjectContext(root, "ghost"), (e) => e.code === "not_found");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && node --test test/projects.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```js
// mcp/lib/projects.js
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export function listProjects(root) {
  const dir = join(root, "projects");
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (e.name === "README.md") continue;
    if (e.isFile() && e.name.endsWith(".md")) out.push({ slug: e.name.replace(/\.md$/, ""), path: join(dir, e.name) });
    else if (e.isDirectory() && !e.name.startsWith(".")) out.push({ slug: e.name, path: join(dir, e.name) });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function getProjectContext(root, slug) {
  const file = join(root, "projects", `${slug}.md`);
  const dir = join(root, "projects", slug);
  if (existsSync(file) && statSync(file).isFile()) {
    return { slug, path: file, content: readFileSync(file, "utf8") };
  }
  if (existsSync(dir) && statSync(dir).isDirectory()) {
    const notes = readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
    const content = notes.map((n) => readFileSync(join(dir, n), "utf8")).join("\n\n---\n\n");
    return { slug, path: dir, content };
  }
  const err = new Error(`project not found: ${slug}`);
  err.code = "not_found";
  throw err;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp && node --test test/projects.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/lib/projects.js mcp/test/projects.test.js
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(mcp): list_projects + get_project_context"
```

---

### Task 5: Capture — personal mode (`mcp/lib/capture.js`)

**Files:**
- Create: `mcp/lib/capture.js`
- Test: `mcp/test/capture.test.js`

**Interfaces:**
- Consumes: `resolveInRoot`, `OutsideRootError` from `lib/paths.js`.
- Produces:
  - `capture(root, { content, project, tags, today }): { path, pushed:false }` — appends a timestamped note. Destination: `projects/<slug>.md` if `project` given (created if missing), else `inbox/<today>.md`. `today` is an injectable `YYYY-MM-DD` string (defaults to current date via `new Date` at call time — passed by server, injected in tests). Uses the path-jail. Team-mode is added in Task 12.

- [ ] **Step 1: Write the failing test**

```js
// mcp/test/capture.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture } from "../lib/capture.js";

test("captures to projects/<slug>.md when project given", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const { path } = capture(root, { content: "PingID cookies", project: "unis", today: "2026-07-01" });
  assert.match(path, /projects[\\/]unis\.md$/);
  assert.match(readFileSync(path, "utf8"), /PingID cookies/);
});

test("captures to inbox/<date>.md when no project", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const { path } = capture(root, { content: "stray idea", today: "2026-07-01" });
  assert.match(path, /inbox[\\/]2026-07-01\.md$/);
  assert.match(readFileSync(path, "utf8"), /stray idea/);
});

test("appends, does not overwrite", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  capture(root, { content: "first", today: "2026-07-01" });
  const { path } = capture(root, { content: "second", today: "2026-07-01" });
  const body = readFileSync(path, "utf8");
  assert.match(body, /first/);
  assert.match(body, /second/);
});

test("writes tags when provided", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const { path } = capture(root, { content: "x", tags: ["auth", "unis"], today: "2026-07-01" });
  assert.match(readFileSync(path, "utf8"), /#auth #unis/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && node --test test/capture.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```js
// mcp/lib/capture.js
import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { resolveInRoot } from "./paths.js";

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function capture(root, { content, project, tags, today }) {
  const rel = project ? `projects/${slugify(project)}.md` : `inbox/${today}.md`;
  const abs = resolveInRoot(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const tagLine = tags && tags.length ? " " + tags.map((t) => `#${slugify(t)}`).join(" ") : "";
  const stamp = today;
  const line = `\n- ${stamp} — ${content}${tagLine}\n`;
  if (!existsSync(abs)) appendFileSync(abs, `---\ntype: brain-note\ncreated: ${today}\n---\n`);
  appendFileSync(abs, line);
  return { path: abs, pushed: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp && node --test test/capture.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/lib/capture.js mcp/test/capture.test.js
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(mcp): capture to project note / dated inbox with tags"
```

---

### Task 6: Server wiring + smoke test (`mcp/server.js`)

**Files:**
- Create: `mcp/server.js`
- Test: `mcp/test/smoke.test.js`

**Interfaces:**
- Consumes: `recall`, `listProjects`, `getProjectContext`, `capture` from lib.
- Produces: an MCP stdio server exposing the four Phase-0 tools; fails fast if `AI_OS_ROOT` unset.

- [ ] **Step 1: Write the failing smoke test**

```js
// mcp/test/smoke.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const serverPath = join(dirname(fileURLToPath(import.meta.url)), "..", "server.js");

function rpc(child, msg) { child.stdin.write(JSON.stringify(msg) + "\n"); }

test("server answers tools/list over stdio", async () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const child = spawn(process.execPath, [serverPath], { env: { ...process.env, AI_OS_ROOT: root } });
  let buf = "";
  const got = new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      buf += d.toString();
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        try { const m = JSON.parse(line); if (m.id === 1) resolve(m); } catch {}
      }
    });
    child.on("error", reject);
    setTimeout(() => reject(new Error("timeout")), 5000);
  });
  rpc(child, { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  rpc(child, { jsonrpc: "2.0", method: "notifications/initialized" });
  rpc(child, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  const res = await got;
  const names = res.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["capture", "get_project_context", "list_projects", "recall"]);
  child.kill();
});
```

- [ ] **Step 2: Run smoke test to verify it fails**

Run: `cd mcp && node --test test/smoke.test.js`
Expected: FAIL — `server.js` missing / no response.

- [ ] **Step 3: Write minimal implementation**

```js
// mcp/server.js
#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { recall } from "./lib/recall.js";
import { listProjects, getProjectContext } from "./lib/projects.js";
import { capture } from "./lib/capture.js";

const AI_OS_ROOT = process.env.AI_OS_ROOT;
if (!AI_OS_ROOT) {
  console.error("ai-os-mcp: AI_OS_ROOT is not set. Set it to your vault path.");
  process.exit(1);
}
const today = () => new Date().toISOString().slice(0, 10);

const TOOLS = [
  { name: "recall", description: "Lexical search over the vault; returns ranked snippets with file paths.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, project: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
  { name: "get_project_context", description: "Return a project's brief/notes.",
    inputSchema: { type: "object", properties: { project: { type: "string" } }, required: ["project"] } },
  { name: "list_projects", description: "List projects registered in the brain.",
    inputSchema: { type: "object", properties: {} } },
  { name: "capture", description: "Append an explicit note to the vault; returns the path.",
    inputSchema: { type: "object", properties: { content: { type: "string" }, project: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["content"] } },
];

const server = new Server({ name: "ai-os", version: "1.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
  const fail = (msg) => ({ content: [{ type: "text", text: msg }], isError: true });
  try {
    switch (name) {
      case "recall": return ok(recall(AI_OS_ROOT, args));
      case "list_projects": return ok(listProjects(AI_OS_ROOT));
      case "get_project_context": return ok(getProjectContext(AI_OS_ROOT, args.project));
      case "capture": return ok(capture(AI_OS_ROOT, { ...args, today: today() }));
      default: return fail(`unknown tool: ${name}`);
    }
  } catch (e) {
    return fail(`${e.code || "error"}: ${e.message}`);
  }
});

await server.connect(new StdioServerTransport());
```

- [ ] **Step 4: Run smoke test to verify it passes**

Run: `cd mcp && node --test test/smoke.test.js`
Expected: PASS. Then full suite: `cd mcp && npm test` → all Phase-0 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/server.js mcp/test/smoke.test.js
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(mcp): stdio server wiring + tools/list smoke test"
```

---

### Task 7: `/connect-brain` skill + README registration snippet

**Files:**
- Create: `skills/connect-brain/SKILL.md`
- Modify: `README.md` (add "Connect the live brain" section)

**Interfaces:**
- Produces: a ritual + docs for the one-line user-scope MCP registration.

- [ ] **Step 1: Create the skill**

```markdown
---
name: connect-brain
description: Connect this machine to the live Cortex MCP brain in one step. Use when the user says "connect the brain", "wire up recall/capture", "set up the MCP server", or opens a new machine and wants recall/capture in every project. One-time, user-scope.
---

# /connect-brain — one-line live brain

Register the Cortex MCP server at **user scope** so every project on this machine can `recall`/`capture`.

## What to do
1. Resolve the vault path (this repo's root) → `AI_OS_ROOT`. Resolve the absolute path to `mcp/server.js`.
2. Ensure deps are installed: `cd <vault>/mcp && npm install` (once).
3. Print (and offer to run) the registration for the user's agent:

   **Claude Code:**
   ```bash
   claude mcp add --scope user ai-os --env AI_OS_ROOT=<vault> -- node <vault>/mcp/server.js
   ```

   **Cursor / other MCP agents:** add to the agent's `mcpServers` config:
   ```json
   { "ai-os": { "command": "node", "args": ["<vault>/mcp/server.js"], "env": { "AI_OS_ROOT": "<vault>" } } }
   ```
4. Confirm in one line: *"Brain connected (user scope). recall/capture available in every project."*

## Don't
- Don't register at project scope (defeats the "zero setup per project" goal).
- Don't touch the current project's git or files.
```

- [ ] **Step 2: Add README section**

Add a "## Connect the live brain (MCP)" section to `README.md` documenting the same one-line Claude + Cursor snippets and noting `AI_OS_ROOT` is the only config.

- [ ] **Step 3: Commit**

```bash
git add skills/connect-brain/SKILL.md README.md
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(skill): /connect-brain one-line user-scope MCP registration"
```

---

## Plugin Bundle

### Task 8: Plugin manifest (human + machine-readable)

**Files:**
- Create: `plugins/cortex-core-plugins.json`
- Create: `references/cortex-plugins.md`

**Interfaces:**
- Produces: `plugins/cortex-core-plugins.json` — `{ marketplaces: {...}, tiers: { core:[], "dev-tools":[], "browser-qa":[], platform:[] } }` consumed by Task 9 (stamping) and Task 10 (`/setup-plugins`).

- [ ] **Step 1: Create the machine-readable manifest**

```json
{
  "marketplaces": {
    "claude-plugins-official": { "source": { "source": "github", "repo": "anthropics/claude-plugins-official" } },
    "cloudflare": { "source": { "source": "github", "repo": "cloudflare/skills" } }
  },
  "tiers": {
    "core": ["superpowers", "skill-creator", "claude-md-management", "claude-code-setup", "feature-dev", "code-review", "code-simplifier", "context7"],
    "dev-tools": ["typescript-lsp", "github"],
    "browser-qa": ["playwright", "chrome-devtools-mcp"],
    "platform": ["vercel", "cloudflare@cloudflare", "andrej-karpathy-skills@multica-ai"]
  },
  "defaultMarketplace": "claude-plugins-official"
}
```

- [ ] **Step 2: Create the human reference**

`references/cortex-plugins.md` — a table of the four tiers, what each plugin does, and that **Core** installs out-of-the-box while the rest are offered by role. State the honest limitation (guided, not silent, provisioning). Link `[[operating-principles]]`.

- [ ] **Step 3: Commit**

```bash
git add plugins/cortex-core-plugins.json references/cortex-plugins.md
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(plugins): core plugin bundle manifest + reference"
```

---

### Task 9: Stamp `.claude/settings.json` from `cortex-init` + extend bash CI

**Files:**
- Modify: `tools/cortex-init.sh` (add plugin-settings stamping)
- Modify: `.github/workflows/cortex-init-test.yml` (assert stamped settings)

**Interfaces:**
- Consumes: `plugins/cortex-core-plugins.json` (Core tier list).
- Produces: stamped `.claude/settings.json` with `extraKnownMarketplaces` + `enabledPlugins` for the Core tier, merged (not clobbered) if the file exists.

- [ ] **Step 1: Add a stamping function to `cortex-init.sh`**

Add a function that writes/merges `.claude/settings.json` in the target repo. If `jq` is available, merge; else write the block only when the file is absent. Core `enabledPlugins` keys: `superpowers@claude-plugins-official`, `skill-creator@claude-plugins-official`, `claude-md-management@claude-plugins-official`, `claude-code-setup@claude-plugins-official`, `feature-dev@claude-plugins-official`, `code-review@claude-plugins-official`, `code-simplifier@claude-plugins-official`, `context7@claude-plugins-official` (all `true`), plus `extraKnownMarketplaces.claude-plugins-official.source = {source:"github", repo:"anthropics/claude-plugins-official"}`. Gate behind a `--no-plugins` opt-out flag (default: on).

- [ ] **Step 2: Extend the existing bash smoke test**

In `.github/workflows/cortex-init-test.yml`, after `bash "$SCRIPT" --yes`, add:
```yaml
      - name: Assert core plugins were stamped
        run: |
          test -f "$WORK/.claude/settings.json"
          grep -q '"superpowers@claude-plugins-official": true' "$WORK/.claude/settings.json"
          grep -q 'anthropics/claude-plugins-official' "$WORK/.claude/settings.json"
```
(Adjust to the workflow's existing `$WORK` variable / step layout.)

- [ ] **Step 3: Run the installer locally against a temp repo and verify**

```bash
WORK="$(mktemp -d)"; ( cd "$WORK" && git init -q && echo '{}' > package.json )
bash tools/cortex-init.sh --yes --path "$WORK" 2>/dev/null || bash tools/cortex-init.sh --yes  # match actual flag
grep -q 'superpowers@claude-plugins-official' "$WORK/.claude/settings.json" && echo OK
```
Expected: `OK`.

- [ ] **Step 4: Lint the script**

Run: `bash -n tools/cortex-init.sh`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add tools/cortex-init.sh .github/workflows/cortex-init-test.yml
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(cortex-init): stamp core plugin bundle into .claude/settings.json"
```

---

### Task 10: `tools/cortex-plugins.sh` + `/setup-plugins` skill

**Files:**
- Create: `tools/cortex-plugins.sh`
- Create: `skills/setup-plugins/SKILL.md`

**Interfaces:**
- Consumes: `plugins/cortex-core-plugins.json`.
- Produces: `cortex-plugins.sh [--tier core|dev-tools|browser-qa|platform] [--scope user|project]` that runs `claude plugin marketplace add …` + `claude plugin install …`. Idempotent; if `claude` CLI is missing, prints the exact commands instead of failing.

- [ ] **Step 1: Write the script**

Read tiers from `plugins/cortex-core-plugins.json` (via `jq` if present, else a hardcoded fallback list matching the manifest). For the chosen tier: `claude plugin marketplace add anthropics/claude-plugins-official` then for each plugin `claude plugin install <p>@claude-plugins-official --scope "$SCOPE"`. Default tier `core`, default scope `user`. Detect `command -v claude`; if absent, echo the commands and exit 0. Guard with `set -euo pipefail` and `bash -n` clean.

- [ ] **Step 2: Lint**

Run: `bash -n tools/cortex-plugins.sh`
Expected: exit 0.

- [ ] **Step 3: Dry behavior test (no claude CLI path)**

Run: `PATH=/nonexistent bash tools/cortex-plugins.sh --tier core 2>&1 | grep -q "claude plugin install superpowers@claude-plugins-official" && echo OK`
Expected: `OK` (prints commands when CLI absent).

- [ ] **Step 4: Create the skill**

```markdown
---
name: setup-plugins
description: Install the Cortex Core plugin bundle out-of-the-box, and offer the optional tiers by role. Use when the user says "set up plugins", "install the core plugins", "give this machine the Cortex toolset", or after connecting the brain. Core is default; Browser/QA, Dev-tools, Platform are opt-in.
---

# /setup-plugins — provision the Cortex plugin bundle

## What to do
1. Run `tools/cortex-plugins.sh --tier core --scope user` (installs the Core tier: superpowers, skill-creator, claude-md-management, claude-code-setup, feature-dev, code-review, code-simplifier, context7).
2. Then ask the user their role / stack and OFFER optional tiers (do not auto-install):
   - Frontend/QA → `--tier browser-qa` (playwright, chrome-devtools-mcp; heavy: downloads browsers).
   - Working in TS repos / lots of PRs → `--tier dev-tools` (typescript-lsp, github).
   - Deploys to Vercel/Cloudflare → `--tier platform`.
3. If `claude` CLI is unavailable, print the commands + the declarative `.claude/settings.json` block for guided setup.
4. Confirm which tiers were installed in one line.

## Don't
- Don't auto-install the heavy/platform tiers — offer them by role.
- Don't fail hard if the CLI is missing; degrade to printing commands.
```

- [ ] **Step 5: Commit**

```bash
git add tools/cortex-plugins.sh skills/setup-plugins/SKILL.md
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(plugins): cortex-plugins.sh + /setup-plugins ritual"
```

---

## Phase 1 — Team-brain repo + sync (#306)

### Task 11: Git sync (`mcp/lib/gitsync.js`)

**Files:**
- Create: `mcp/lib/gitsync.js`
- Test: `mcp/test/gitsync.test.js`

**Interfaces:**
- Produces:
  - `teamCloneDir(root, team): string` → `<root>/team/<team>`.
  - `pull(cloneDir): {ok:boolean, error?}` — `git -C cloneDir pull --ff-only`.
  - `commitAndPush(cloneDir, files, message): {ok:boolean, pushed:boolean, error?}` — stages `files`, commits, pushes; refuses if `cloneDir` is not a git repo. Never operates outside a real clone.

- [ ] **Step 1: Write the failing test (local bare-repo fixture — no network)**

```js
// mcp/test/gitsync.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAndPush, pull, teamCloneDir } from "../lib/gitsync.js";

function git(cwd, ...args) { return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString(); }

function setup() {
  const remote = mkdtempSync(join(tmpdir(), "remote-"));
  git(remote, "init", "--bare", "-q");
  const clone = mkdtempSync(join(tmpdir(), "clone-"));
  git(clone, "clone", "-q", remote, ".");
  git(clone, "config", "user.email", "t@t"); git(clone, "config", "user.name", "t");
  // seed an initial commit so pull --ff-only has an upstream
  writeFileSync(join(clone, "seed.md"), "seed"); git(clone, "add", "."); git(clone, "commit", "-qm", "seed"); git(clone, "push", "-q", "origin", "HEAD:master");
  git(clone, "branch", "--set-upstream-to=origin/master");
  return { remote, clone };
}

test("teamCloneDir builds path under root/team", () => {
  assert.match(teamCloneDir("/vault", "acme"), /team[\\/]acme$/);
});

test("commitAndPush pushes a note to the bare remote", () => {
  const { clone } = setup();
  writeFileSync(join(clone, "note.md"), "hello");
  const res = commitAndPush(clone, ["note.md"], "add note");
  assert.equal(res.ok, true);
  assert.equal(res.pushed, true);
});

test("commitAndPush refuses a non-git dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "plain-"));
  const res = commitAndPush(dir, ["x.md"], "m");
  assert.equal(res.ok, false);
});

test("pull --ff-only succeeds on a clean clone", () => {
  const { clone } = setup();
  const res = pull(clone);
  assert.equal(res.ok, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && node --test test/gitsync.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```js
// mcp/lib/gitsync.js
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function teamCloneDir(root, team) { return join(root, "team", team); }

function isGitRepo(dir) { return existsSync(join(dir, ".git")); }

function git(cwd, args) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

export function pull(cloneDir) {
  if (!isGitRepo(cloneDir)) return { ok: false, error: "not_a_git_repo" };
  try { git(cloneDir, ["pull", "--ff-only", "-q"]); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.stderr || e.message) }; }
}

export function commitAndPush(cloneDir, files, message) {
  if (!isGitRepo(cloneDir)) return { ok: false, pushed: false, error: "not_a_git_repo" };
  try {
    git(cloneDir, ["add", ...files]);
    git(cloneDir, ["commit", "-q", "-m", message]);
  } catch (e) { return { ok: false, pushed: false, error: String(e.stderr || e.message) }; }
  try { git(cloneDir, ["push", "-q"]); return { ok: true, pushed: true }; }
  catch (e) { return { ok: true, pushed: false, error: "push_failed: " + String(e.stderr || e.message) }; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp && node --test test/gitsync.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/lib/gitsync.js mcp/test/gitsync.test.js
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(mcp): team-brain git sync (pull ff-only, commit+push, non-repo refusal)"
```

---

### Task 12: Capture — team mode (append-only + auto push)

**Files:**
- Modify: `mcp/lib/capture.js`
- Test: `mcp/test/capture.team.test.js`

**Interfaces:**
- Consumes: `commitAndPush`, `teamCloneDir` from `lib/gitsync.js`.
- Produces: `capture(root, { content, project, tags, today, team, noteId })` — when `team` is set, writes a **new file per note** at `team/<team>/projects/<slug>/<today>-<noteId>.md` (one-file-per-note → near-zero merge conflicts), then commits+pushes. `noteId` is injectable for deterministic tests (server derives it from time). Returns `{ path, pushed }`.

- [ ] **Step 1: Write the failing test**

```js
// mcp/test/capture.team.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture } from "../lib/capture.js";

function git(cwd, ...a) { return execFileSync("git", a, { cwd }).toString(); }

function vaultWithTeam() {
  const remote = mkdtempSync(join(tmpdir(), "remote-")); git(remote, "init", "--bare", "-q");
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  const clone = join(root, "team", "acme");
  execFileSync("git", ["clone", "-q", remote, clone]);
  git(clone, "config", "user.email", "t@t"); git(clone, "config", "user.name", "t");
  const seed = join(clone, "seed.md"); require("node:fs").writeFileSync(seed, "s"); git(clone, "add", "."); git(clone, "commit", "-qm", "s"); git(clone, "push", "-q", "origin", "HEAD:master"); git(clone, "branch", "--set-upstream-to=origin/master");
  return root;
}

test("team capture writes one-file-per-note and pushes", () => {
  const root = vaultWithTeam();
  const res = capture(root, { content: "PingID cookies", project: "unis", team: "acme", today: "2026-07-01", noteId: "abc" });
  assert.match(res.path, /team[\\/]acme[\\/]projects[\\/]unis[\\/]2026-07-01-abc\.md$/);
  assert.ok(existsSync(res.path));
  assert.equal(res.pushed, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && node --test test/capture.team.test.js`
Expected: FAIL — team branch not implemented.

- [ ] **Step 3: Extend `capture.js`**

Add a team branch at the top of `capture`: when `team` is set, compute `rel = team/<team>/projects/<slug>/<today>-<noteId>.md` under the jail, `mkdirSync` parents, write the note file, then `const clone = teamCloneDir(root, team); const r = commitAndPush(clone, [<relative-to-clone path>], "capture: <slug>")`; return `{ path, pushed: r.pushed }`. Keep the existing personal-mode logic unchanged for the non-team path. Import `commitAndPush`/`teamCloneDir`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp && node --test test/capture.team.test.js` then `cd mcp && npm test`
Expected: PASS; full suite green.

- [ ] **Step 5: Commit**

```bash
git add mcp/lib/capture.js mcp/test/capture.team.test.js
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(mcp): team-mode capture (one-file-per-note, auto commit+push)"
```

---

### Task 13: Connector + `/team-init` / `/team-add` skills + `tools/cortex-team.sh`

**Files:**
- Create: `tools/cortex-team.sh`
- Create: `skills/team-init/SKILL.md`
- Create: `skills/team-add/SKILL.md`
- Create: `templates/connector.json` (the `.cortex/connector.json` template)

**Interfaces:**
- Produces:
  - `templates/connector.json`: `{ "slug": "<project-slug>", "teamBrainRepo": "<git-url>" }` (generic, safe to commit — no personal paths).
  - `cortex-team.sh init --repo <url> --name <team>` (leader) and `cortex-team.sh add --repo <url> --slug <slug>` (member: clones team-brain under `$AI_OS_ROOT/team/<name>`, writes `.cortex/connector.json` into CWD product repo).

- [ ] **Step 1: Create the connector template**

```json
{
  "slug": "REPLACE_WITH_PROJECT_SLUG",
  "teamBrainRepo": "REPLACE_WITH_TEAM_BRAIN_GIT_URL"
}
```

- [ ] **Step 2: Write `tools/cortex-team.sh`**

`init`: validate `--repo`/`--name`; print steps to create the private repo (via `gh repo create` if available) and seed `projects/.gitkeep` + a `team.md` config listing members/projects; commit+push. `add`: require `$AI_OS_ROOT`; `git clone <repo> "$AI_OS_ROOT/team/<name>"` (skip if exists); write `.cortex/connector.json` into CWD from the template with `slug` filled; **never** commit to the product repo automatically (print the `git add .cortex/connector.json` line for the user). `set -euo pipefail`, `bash -n` clean.

- [ ] **Step 3: Write the two skills**

`skills/team-init/SKILL.md` (leader ritual wrapping `cortex-team.sh init`) and `skills/team-add/SKILL.md` (member ritual wrapping `cortex-team.sh add`), each with frontmatter `name`/`description`, a "What to do" list, and a "Don't" list emphasizing: never auto-commit to the product repo; connector stays generic; personal/machine paths stay in user config only.

- [ ] **Step 4: Lint**

Run: `bash -n tools/cortex-team.sh`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add tools/cortex-team.sh skills/team-init/SKILL.md skills/team-add/SKILL.md templates/connector.json
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(team): connector template + /team-init + /team-add + cortex-team.sh"
```

---

## Phase 2 — Capture sources

### Task 14: Git/PR digest (`tools/cortex-digest.sh`)

**Files:**
- Create: `tools/cortex-digest.sh`
- Test: `mcp/test/digest.test.js` (drives the bash script against a temp git repo)

**Interfaces:**
- Produces: `cortex-digest.sh --repo <product-repo> --since <date> --out <file>` → appends a markdown digest of commits (and PRs via `gh` if available) since `<date>` into `<file>`. Reads the product repo git **read-only**; writes only `<out>`.

- [ ] **Step 1: Write the failing test**

```js
// mcp/test/digest.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tools", "cortex-digest.sh");

test("digest lists commits since a date", () => {
  const repo = mkdtempSync(join(tmpdir(), "prod-"));
  const git = (...a) => execFileSync("git", a, { cwd: repo });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(join(repo, "a.txt"), "1"); git("add", "."); git("commit", "-qm", "feat: add login");
  const out = join(mkdtempSync(join(tmpdir(), "brain-")), "digest.md");
  execFileSync("bash", [script, "--repo", repo, "--since", "2000-01-01", "--out", out]);
  assert.match(readFileSync(out, "utf8"), /feat: add login/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && node --test test/digest.test.js`
Expected: FAIL — script missing.

- [ ] **Step 3: Write `tools/cortex-digest.sh`**

Parse `--repo/--since/--out`. Use `git -C "$repo" log --since="$since" --pretty='- %h %s (%an, %ad)' --date=short`. Prepend a `## Digest since <since>` heading. If `gh` is available and `$repo` has a GitHub remote, append merged PRs via `gh pr list --repo <owner/repo> --state merged --search "merged:>=<since>"`. Append to `$out` (create dirs). `set -euo pipefail`, `bash -n` clean.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp && node --test test/digest.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/cortex-digest.sh mcp/test/digest.test.js
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(digest): read-only git/PR digest into brain notes"
```

---

## Phase 3 — Holiday catch-up

### Task 15: `catch_me_up` (`mcp/lib/catchup.js`) + tool wiring + skill

**Files:**
- Create: `mcp/lib/catchup.js`
- Test: `mcp/test/catchup.test.js`
- Modify: `mcp/server.js` (register `catch_me_up`)
- Create: `skills/catch-me-up/SKILL.md`

**Interfaces:**
- Consumes: `recall`/`listMarkdown` (notes), `git log` from the team clone.
- Produces: `catchMeUp(root, { project, since, team }): { notes:[{path,snippet}], commits:string[] }` — assembles material; **no summarizing**.

- [ ] **Step 1: Write the failing test**

```js
// mcp/test/catchup.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catchMeUp } from "../lib/catchup.js";

test("returns notes for the project", () => {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  mkdirSync(join(root, "projects", "unis"), { recursive: true });
  writeFileSync(join(root, "projects", "unis", "n1.md"), "PingID change landed");
  const res = catchMeUp(root, { project: "unis", since: "2026-06-01" });
  assert.ok(res.notes.some((n) => /PingID change/.test(n.snippet)));
  assert.ok(Array.isArray(res.commits));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && node --test test/catchup.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `catchup.js`**

```js
// mcp/lib/catchup.js
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { recall } from "./recall.js";
import { teamCloneDir } from "./gitsync.js";

export function catchMeUp(root, { project, since, team }) {
  const notes = recall(root, { query: project, project, limit: 50 })
    .map(({ path, snippet }) => ({ path, snippet }));
  let commits = [];
  const clone = team ? teamCloneDir(root, team) : null;
  if (clone && existsSync(clone)) {
    try {
      commits = execFileSync("git", ["-C", clone, "log", `--since=${since}`, "--pretty=- %h %s"], { stdio: ["ignore", "pipe", "pipe"] })
        .toString().split("\n").filter(Boolean);
    } catch { commits = []; }
  }
  return { notes, commits };
}
```

- [ ] **Step 4: Register the tool in `server.js`**

Add to `TOOLS`: `{ name: "catch_me_up", description: "Assemble notes + git history since <since> for the agent to summarize.", inputSchema: { type:"object", properties: { project:{type:"string"}, since:{type:"string"}, team:{type:"string"} }, required:["project","since"] } }`. Add `case "catch_me_up": return ok(catchMeUp(AI_OS_ROOT, args));` and import `catchMeUp`. Update the smoke test's expected tool-name array to include `catch_me_up`.

- [ ] **Step 5: Create `skills/catch-me-up/SKILL.md`**

Ritual: call `catch_me_up(project, since)` (since = last sync / user-provided), then the agent writes a concise "what changed & why" summary grouped by theme. `name`/`description` frontmatter; "Don't" = don't fabricate; only summarize returned material.

- [ ] **Step 6: Run tests and commit**

Run: `cd mcp && npm test`
Expected: all PASS (including updated smoke with 5 tools).

```bash
git add mcp/lib/catchup.js mcp/test/catchup.test.js mcp/server.js mcp/test/smoke.test.js skills/catch-me-up/SKILL.md
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat(mcp): catch_me_up material assembler + /catch-me-up ritual"
```

---

## Wire-up & Release

### Task 16: Wire skills into `AGENTS.md` + copy to `.claude/skills/`

**Files:**
- Modify: `AGENTS.md` (rituals list)
- Create: `.claude/skills/connect-brain/SKILL.md`, `.claude/skills/setup-plugins/SKILL.md`, `.claude/skills/team-init/SKILL.md`, `.claude/skills/team-add/SKILL.md`, `.claude/skills/catch-me-up/SKILL.md` (copies)

- [ ] **Step 1: Add ritual bullets to `AGENTS.md`**

Under "## The rituals", add one bullet each for `/connect-brain`, `/team-init`, `/team-add`, `/catch-me-up`, `/setup-plugins`, mirroring the existing bullet style (name — one-line purpose).

- [ ] **Step 2: Copy skills to `.claude/skills/`**

Run (bash):
```bash
for s in connect-brain setup-plugins team-init team-add catch-me-up; do
  mkdir -p ".claude/skills/$s"; cp "skills/$s/SKILL.md" ".claude/skills/$s/SKILL.md";
done
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md .claude/skills
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "docs(agents): register new brain/team/plugin rituals"
```

---

### Task 17: Node CI workflow (`.github/workflows/mcp-test.yml`)

**Files:**
- Create: `.github/workflows/mcp-test.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: mcp test
on:
  push:
    paths: ["mcp/**", ".github/workflows/mcp-test.yml"]
  pull_request:
  workflow_dispatch:
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - name: Configure git identity (for sync tests)
        run: git config --global user.email ci@example.com && git config --global user.name CI
      - name: Install
        run: cd mcp && npm ci
      - name: Test
        run: cd mcp && npm test
```

- [ ] **Step 2: Validate locally**

Run: `cd mcp && npm ci && npm test`
Expected: all suites PASS.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/mcp-test.yml mcp/package-lock.json
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "ci: node test workflow for ai-os-mcp (node 20/22)"
```

---

### Task 18: CHANGELOG + VERSION bump

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `VERSION`

- [ ] **Step 1: Bump VERSION**

Set `VERSION` file contents to `1.1.0`.

- [ ] **Step 2: Add CHANGELOG entry**

Add a `## 1.1.0 — <date>` section summarizing: live MCP brain (recall/capture/list_projects/get_project_context), team-brain git sync + connector, git/PR digest, catch_me_up, Core Plugin Bundle + `/setup-plugins`, new rituals; resolves #305 and #306.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md VERSION
SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "release: bump to v1.1.0 (MCP brain + team engine + plugin bundle)"
```

---

### Task 19: File the `/brain-doctor` follow-up issue

- [ ] **Step 1: Create the issue**

Run:
```bash
gh issue create --title "feat: /brain-doctor — diagnose & self-heal the Cortex brain wiring" \
  --label "enhancement,feature-request" \
  --body "Diagnostic + self-heal ritual: verify MCP server reachable, AI_OS_ROOT set, team-brain clone healthy/synced, tools/list responds, .cortex/connector.json valid, Core plugins present; offer one-command fixes. Complements #305/#306. Nice-to-have in core."
```
Expected: prints the new issue URL. (Do not implement in this branch.)

---

### Task 20: Finish the branch → dev → master → release

> Use the **superpowers:finishing-a-development-branch** skill for this task.

- [ ] **Step 1: Full green check**

Run: `cd mcp && npm ci && npm test` and `bash -n tools/*.sh`
Expected: all PASS / exit 0.

- [ ] **Step 2: Merge feature branch → `dev`**

```bash
git checkout dev
git merge --no-ff feat/mcp-brain-team-engine -m "Merge feat/mcp-brain-team-engine into dev (#305, #306)"
git push origin dev
```

- [ ] **Step 3: Confirm CI green on `dev`**

Run: `gh run list --branch dev --limit 5`
Expected: `mcp test` and `cortex-init test` both success.

- [ ] **Step 4: PR `dev` → `master`**

```bash
gh pr create --base master --head dev --title "release: v1.1.0 — MCP brain + team engine + core plugin bundle" \
  --body "Resolves #305 and #306. Adds live MCP brain, team-brain git sync, git/PR digest, catch_me_up, and the Cortex Core Plugin Bundle. CI green."
```
(If `gh pr edit` is needed later, use `gh api ... -X PATCH` per repo constraints.)

- [ ] **Step 5: Merge PR + tag release (after CI green)**

```bash
gh pr merge --merge   # or via UI
git checkout master && git pull origin master
git tag v1.1.0 && git push origin v1.1.0
gh release create v1.1.0 --title "Cortex v1.1.0" --notes-file - <<'EOF'
Live MCP brain + team context engine + Core Plugin Bundle. Resolves #305, #306.
EOF
```

---

## Self-Review

**Spec coverage:** Phase 0 tools → Tasks 2–6; user-scope registration → Task 7; team repo+sync → Tasks 11–13; capture sources → Tasks 12 & 14; catch_me_up → Task 15; plugin bundle (manifest/declarative/scripted/by-role) → Tasks 8–10; skills in AGENTS.md → Task 16; CI (node + bash) → Tasks 9 & 17; security path-jail → Task 2 (+ used in 5/12); guardrails (push only team repo, refuse non-repo) → Task 11; release/version → Tasks 18 & 20; `/brain-doctor` as a new issue → Task 19. No gaps.

**Placeholder scan:** No "TBD/TODO/handle edge cases" left; each code step shows real code; bash-heavy tasks (9, 10, 13, 14) specify exact commands, flags, and grep assertions rather than vague prose.

**Type consistency:** `resolveInRoot`/`OutsideRootError` (Task 2) used verbatim in Tasks 5 & 12. `recall(root,{query,project,limit})` (Task 3) reused in Task 15. `commitAndPush`/`teamCloneDir` (Task 11) consumed by Tasks 12 & 15. Tool names match across `server.js`, smoke test, and `AGENTS.md`. `capture(root, {...})` signature extended (not renamed) in Task 12.
