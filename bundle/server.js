// AI OS MCP Server — bundled single-file deployment

// src/mcp-server/index.ts
import path2 from "node:path";

// src/mcp-server/tool-definitions.ts
var MCP_TOOL_DEFINITIONS = [
  {
    name: "search_codebase",
    description: "Search for patterns, symbols, or text across the project codebase. Respects .gitignore. Returns matching file paths and snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The pattern or text to search for" },
        filePattern: { type: "string", description: 'Optional glob pattern to limit search (e.g. "*.ts", "src/**/*.py")' },
        caseSensitive: { type: "boolean", description: "Whether search is case-sensitive (default: false)" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_project_structure",
    description: "Returns an annotated file tree of the project (respects .gitignore, skips node_modules/build/dist). Useful for understanding project layout before making changes.",
    inputSchema: {
      type: "object",
      properties: {
        depth: { type: "number", description: "Max directory depth to show (default: 4)" },
        path: { type: "string", description: "Subdirectory to start from (default: project root)" }
      }
    }
  },
  {
    name: "get_conventions",
    description: "Returns the detected coding conventions for this project: naming rules, file structure, testing patterns, forbidden practices.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_stack_info",
    description: "Returns the complete tech stack inventory: languages, frameworks, key dependencies, build tools, and test setup.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_file_summary",
    description: "Returns a structured summary of a specific file: key exports, types, functions, and brief description. Token-efficient alternative to reading the full file.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to the file relative to project root" }
      },
      required: ["filePath"]
    }
  },
  {
    name: "get_prisma_schema",
    description: "Returns the full Prisma schema file contents. Use before making any database model changes.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_trpc_procedures",
    description: "Returns a summary of all tRPC procedures (name, input type, public/private). Avoids reading the entire router file.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_api_routes",
    description: "Returns a list of API routes with HTTP methods using stack-aware discovery for Node, Java/Spring, Python, Go, and Rust patterns.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: 'Optional substring to filter routes (e.g. "auth", "webhook")' }
      }
    }
  },
  {
    name: "get_env_vars",
    description: "Returns all required environment variable names (from .env.example or code). Shows which are set vs. missing. Never returns values.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_package_info",
    description: "Returns installed package versions and direct dependencies. Useful before suggesting library usage to avoid API mismatch.",
    inputSchema: {
      type: "object",
      properties: {
        packageName: { type: "string", description: 'Optional: specific package to look up (e.g. "@trpc/server")' }
      }
    }
  },
  {
    name: "get_impact_of_change",
    description: "Shows what files are affected when a given file changes. Returns direct importers and all transitively affected files.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: 'File path relative to project root (e.g. "src/types.ts")' }
      },
      required: ["filePath"]
    }
  },
  {
    name: "get_dependency_chain",
    description: "Shows the full dependency chain for a file: what it imports and what imports it, with export names.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: 'File path relative to project root (e.g. "src/utils/auth.ts")' }
      },
      required: ["filePath"]
    }
  },
  {
    name: "check_for_updates",
    description: "Checks if the AI OS artifacts installed in this repo are out of date. Returns update instructions when a newer version of AI OS is available.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_memory_guidelines",
    description: "Returns repository memory rules and memory usage protocol from .ai-os/context/memory.md.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_repo_memory",
    description: "Retrieves persisted repository memory entries from .ai-os/memory/memory.jsonl, optionally filtered by query/category.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional full-text query against title/content/tags" },
        category: { type: "string", description: "Optional category filter (e.g. architecture, conventions, pitfalls)" },
        limit: { type: "number", description: "Max entries to return (default: 10, max: 50)" }
      }
    }
  },
  {
    name: "remember_repo_fact",
    description: "Stores a durable repository memory entry in .ai-os/memory/memory.jsonl using dedupe/upsert rules (marks superseded conflicts and avoids duplicate facts).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short memory title" },
        content: { type: "string", description: "Durable fact/decision/constraint" },
        category: { type: "string", description: "Category (e.g. conventions, architecture, build, testing, security)" },
        tags: { type: "string", description: "Optional comma-separated tags" }
      },
      required: ["title", "content"]
    }
  },
  {
    name: "get_session_context",
    description: "Returns the compact session context card with MUST-ALWAYS rules, build/test commands, and key file locations. CALL THIS at the start of every new conversation to reload critical context after a session reset.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_recommendations",
    description: "Returns stack-appropriate recommendations: MCP servers, VS Code extensions, agent skills, and GitHub Copilot Extensions.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "suggest_improvements",
    description: "Analyzes project structure and memory entries to return architectural and tooling optimization suggestions.",
    inputSchema: { type: "object", properties: {} }
  }
];
function getAllMcpTools() {
  return MCP_TOOL_DEFINITIONS;
}

// src/mcp-server/utils.ts
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var ROOT = process.env["AI_OS_ROOT"] ?? process.cwd();
var __dirname = path.dirname(fileURLToPath(import.meta.url));
function getProjectRoot() {
  return path.resolve(ROOT);
}
function readAiOsFile(relPath) {
  try {
    const newPath = path.join(ROOT, ".github", "ai-os", relPath);
    if (fs.existsSync(newPath)) return fs.readFileSync(newPath, "utf-8");
    return fs.readFileSync(path.join(ROOT, ".ai-os", relPath), "utf-8");
  } catch {
    return "";
  }
}
var MEMORY_STALE_DAYS = 180;
var MEMORY_LOCK_WAIT_MS = 2e3;
var MEMORY_LOCK_RETRY_MS = 50;
function getMemoryFilePath() {
  const newPath = path.join(ROOT, ".github", "ai-os", "memory", "memory.jsonl");
  const legacyPath = path.join(ROOT, ".ai-os", "memory", "memory.jsonl");
  return fs.existsSync(newPath) || !fs.existsSync(legacyPath) ? newPath : legacyPath;
}
function getMemoryDirPath() {
  const newPath = path.join(ROOT, ".github", "ai-os", "memory");
  const legacyPath = path.join(ROOT, ".ai-os", "memory");
  return fs.existsSync(newPath) || !fs.existsSync(legacyPath) ? newPath : legacyPath;
}
function getMemoryLockFilePath() {
  return path.join(getMemoryDirPath(), ".memory.lock");
}
function ensureMemoryStore() {
  const memoryDir = getMemoryDirPath();
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  const memoryFile = getMemoryFilePath();
  if (!fs.existsSync(memoryFile)) {
    fs.writeFileSync(memoryFile, "", "utf-8");
  }
}
function sleepSync(ms) {
  const shared = new SharedArrayBuffer(4);
  const int32 = new Int32Array(shared);
  Atomics.wait(int32, 0, 0, ms);
}
var _activeLockPath = null;
function _releaseLockOnExit() {
  if (_activeLockPath) {
    try {
      fs.unlinkSync(_activeLockPath);
    } catch {
    }
    _activeLockPath = null;
  }
}
process.on("exit", _releaseLockOnExit);
function withMemoryLock(fn) {
  ensureMemoryStore();
  const lockPath = getMemoryLockFilePath();
  const startedAt = Date.now();
  let lockFd = null;
  while (Date.now() - startedAt < MEMORY_LOCK_WAIT_MS) {
    try {
      lockFd = fs.openSync(lockPath, "wx");
      break;
    } catch (err) {
      if (err.code !== "EEXIST") {
        throw err;
      }
      sleepSync(MEMORY_LOCK_RETRY_MS);
    }
  }
  if (lockFd === null) {
    throw new Error("Timed out waiting for repository memory lock.");
  }
  _activeLockPath = lockPath;
  try {
    return fn();
  } finally {
    _activeLockPath = null;
    try {
      fs.closeSync(lockFd);
    } catch {
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
    }
  }
}
function normalizeWhitespace(value) {
  return value.trim().replace(/\s+/g, " ");
}
function normalizeMemoryText(value) {
  return normalizeWhitespace(value).toLowerCase();
}
function normalizeTags(tags) {
  return [...new Set(tags.map((tag) => normalizeMemoryText(tag)).filter(Boolean))].sort();
}
function buildMemoryKey(entry) {
  return `${normalizeMemoryText(entry.category)}::${normalizeMemoryText(entry.title)}`;
}
function buildFingerprint(entry) {
  return `${buildMemoryKey(entry)}::${normalizeMemoryText(entry.content)}`;
}
function toIsoDate(dateValue) {
  const parsed = dateValue ? new Date(dateValue) : /* @__PURE__ */ new Date();
  return Number.isNaN(parsed.getTime()) ? (/* @__PURE__ */ new Date()).toISOString() : parsed.toISOString();
}
function ageInDays(isoDate) {
  const dt = new Date(isoDate);
  if (Number.isNaN(dt.getTime())) return 0;
  return Math.floor((Date.now() - dt.getTime()) / (1e3 * 60 * 60 * 24));
}
function canonicalizeEntry(raw) {
  const title = typeof raw.title === "string" ? normalizeWhitespace(raw.title) : "";
  const content = typeof raw.content === "string" ? normalizeWhitespace(raw.content) : "";
  if (!title || !content) return null;
  const category = typeof raw.category === "string" && raw.category.trim() ? normalizeMemoryText(raw.category) : "general";
  const createdAt = toIsoDate(raw.createdAt);
  const updatedAt = raw.updatedAt ? toIsoDate(raw.updatedAt) : void 0;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tags = normalizeTags(Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === "string") : []);
  const status = raw.status === "stale" ? "stale" : "active";
  const fingerprint = buildFingerprint({ title, content, category });
  return {
    id,
    createdAt,
    updatedAt,
    title,
    content,
    category,
    tags,
    fingerprint,
    status,
    staleReason: typeof raw.staleReason === "string" ? raw.staleReason : void 0,
    supersedesId: typeof raw.supersedesId === "string" ? raw.supersedesId : void 0,
    conflictWithId: typeof raw.conflictWithId === "string" ? raw.conflictWithId : void 0
  };
}
function sortByRecencyDesc(a, b) {
  const aTime = new Date(a.updatedAt ?? a.createdAt).getTime();
  const bTime = new Date(b.updatedAt ?? b.createdAt).getTime();
  return bTime - aTime;
}
function applyStalePolicy(entries) {
  const byKey = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const key = buildMemoryKey(entry);
    const list = byKey.get(key) ?? [];
    list.push(entry);
    byKey.set(key, list);
  }
  for (const [, list] of byKey) {
    list.sort(sortByRecencyDesc);
    let activeSeen = false;
    for (const entry of list) {
      if (entry.status === "stale") continue;
      if (!activeSeen) {
        activeSeen = true;
        continue;
      }
      entry.status = "stale";
      entry.staleReason = entry.staleReason ?? "superseded-by-newer-entry";
      entry.updatedAt = toIsoDate(entry.updatedAt);
    }
  }
  for (const entry of entries) {
    if (entry.status === "stale") continue;
    if (ageInDays(entry.updatedAt ?? entry.createdAt) > MEMORY_STALE_DAYS) {
      entry.status = "stale";
      entry.staleReason = entry.staleReason ?? `auto-stale-${MEMORY_STALE_DAYS}d`;
      entry.updatedAt = toIsoDate(entry.updatedAt);
    }
  }
  return entries;
}
function dedupeEntries(entries) {
  const seen = /* @__PURE__ */ new Map();
  const ordered = [...entries].sort(sortByRecencyDesc);
  for (const entry of ordered) {
    const dedupeKey = `${entry.fingerprint ?? buildFingerprint(entry)}::${entry.status ?? "active"}`;
    if (!seen.has(dedupeKey)) {
      seen.set(dedupeKey, entry);
      continue;
    }
    const kept = seen.get(dedupeKey);
    kept.tags = normalizeTags([...kept.tags, ...entry.tags]);
  }
  return [...seen.values()].sort(sortByRecencyDesc);
}
function serializeEntries(entries) {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length > 0 ? "\n" : "");
}
function writeMemoryEntriesAtomic(entries) {
  const memoryPath = getMemoryFilePath();
  const tempPath = `${memoryPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, serializeEntries(entries), "utf-8");
  fs.renameSync(tempPath, memoryPath);
}
function readMemoryEntries() {
  ensureMemoryStore();
  const file = getMemoryFilePath();
  const content = fs.readFileSync(file, "utf-8");
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  const entries = [];
  let malformedCount = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const canonical = canonicalizeEntry(parsed);
      if (canonical) entries.push(canonical);
      else malformedCount += 1;
    } catch {
      malformedCount += 1;
    }
  }
  return {
    entries: applyStalePolicy(dedupeEntries(entries)),
    malformedCount
  };
}
function recoverMalformedMemoryIfNeeded(result) {
  if (result.malformedCount <= 0) return;
  writeMemoryEntriesAtomic(result.entries);
}
function getMemoryGuidelines() {
  const guidelines = readAiOsFile("context/memory.md");
  return guidelines || "No memory guidelines found. Re-run AI OS generation to create .github/ai-os/context/memory.md.";
}
function getRepoMemory(query, category, limit) {
  const { entries, malformedCount } = readMemoryEntries();
  const q = (query ?? "").trim().toLowerCase();
  const c = (category ?? "").trim().toLowerCase();
  const cap = Math.max(1, Math.min(limit ?? 10, 50));
  const filtered = entries.filter((entry) => {
    if (c && entry.category.toLowerCase() !== c) return false;
    if (!q) return true;
    const haystack = [entry.title, entry.content, entry.category, ...entry.tags].join(" ").toLowerCase();
    return haystack.includes(q);
  }).slice(-cap).reverse();
  if (filtered.length === 0) {
    return "No repository memory entries found for the provided filters.";
  }
  const activeCount = entries.filter((entry) => entry.status !== "stale").length;
  const staleCount = entries.length - activeCount;
  const lines = [
    "## Repository Memory",
    "",
    `- Total entries: ${entries.length}`,
    `- Active: ${activeCount}`,
    `- Stale: ${staleCount}`
  ];
  if (malformedCount > 0) {
    lines.push(`- Malformed lines skipped: ${malformedCount} (recovery is applied on next write)`);
  }
  for (const entry of filtered) {
    lines.push("");
    const state = entry.status === "stale" ? "stale" : "active";
    lines.push(`- **${entry.title}** [${entry.category}] (${state})`);
    lines.push(`  - Created: ${entry.createdAt}`);
    lines.push(`  - Updated: ${entry.updatedAt ?? entry.createdAt}`);
    if (entry.tags.length > 0) {
      lines.push(`  - Tags: ${entry.tags.join(", ")}`);
    }
    if (entry.staleReason) {
      lines.push(`  - Stale reason: ${entry.staleReason}`);
    }
    if (entry.conflictWithId) {
      lines.push(`  - Conflict marker: supersedes ${entry.conflictWithId}`);
    }
    lines.push(`  - ${entry.content}`);
  }
  return lines.join("\n");
}
function rememberRepoFact(title, content, category, tags) {
  const trimmedTitle = title.trim();
  const trimmedContent = content.trim();
  if (!trimmedTitle || !trimmedContent) {
    return "Both title and content are required to store memory.";
  }
  try {
    return withMemoryLock(() => {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const incoming = canonicalizeEntry({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now,
        updatedAt: now,
        title: trimmedTitle,
        content: trimmedContent,
        category: category?.trim() || "general",
        tags: (tags ?? "").split(",").map((tag) => tag.trim()),
        status: "active"
      });
      if (!incoming) {
        return "Invalid memory payload. Title and content are required.";
      }
      const parsed = readMemoryEntries();
      const entries = parsed.entries;
      recoverMalformedMemoryIfNeeded(parsed);
      const key = buildMemoryKey(incoming);
      const sameKey = entries.filter((entry) => buildMemoryKey(entry) === key).sort(sortByRecencyDesc);
      const sameFingerprint = sameKey.find((entry) => (entry.fingerprint ?? buildFingerprint(entry)) === incoming.fingerprint);
      if (sameFingerprint) {
        const mergedTags = normalizeTags([...sameFingerprint.tags, ...incoming.tags]);
        const tagsChanged = mergedTags.length !== sameFingerprint.tags.length;
        if (tagsChanged) {
          sameFingerprint.tags = mergedTags;
          sameFingerprint.updatedAt = now;
          writeMemoryEntriesAtomic(dedupeEntries(applyStalePolicy(entries)));
          return `Updated memory tags for existing fact: ${sameFingerprint.title} (${sameFingerprint.category})`;
        }
        return `Skipped duplicate memory fact: ${sameFingerprint.title} (${sameFingerprint.category})`;
      }
      const currentActive = sameKey.find((entry) => entry.status !== "stale");
      if (currentActive) {
        currentActive.status = "stale";
        currentActive.staleReason = "superseded-by-conflicting-update";
        currentActive.updatedAt = now;
        incoming.supersedesId = currentActive.id;
        incoming.conflictWithId = currentActive.id;
      }
      entries.push(incoming);
      const normalized = dedupeEntries(applyStalePolicy(entries));
      writeMemoryEntriesAtomic(normalized);
      if (currentActive) {
        return `Stored memory entry with conflict marker: ${incoming.title} (${incoming.category})`;
      }
      return `Stored memory entry: ${incoming.title} (${incoming.category})`;
    });
  } catch (err) {
    return `Failed to store memory entry: ${err instanceof Error ? err.message : String(err)}`;
  }
}
function searchFiles(query, filePattern, caseSensitive = false) {
  try {
    const flags = caseSensitive ? "" : "-i";
    const globArg = filePattern ? `-g "${filePattern}"` : "";
    const cmd = `npx --yes ripgrep ${flags} ${globArg} --line-number --max-count=5 "${query}" "${ROOT}"`;
    const result = execSync(cmd, { maxBuffer: 512 * 1024, timeout: 1e4 }).toString();
    return result.slice(0, 8e3);
  } catch (err) {
    if (err instanceof Error && "stdout" in err) {
      return String(err.stdout ?? "No results found");
    }
    return "No results found";
  }
}
var IGNORE_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "out",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "vendor",
  "coverage",
  ".gradle",
  "bin",
  "obj",
  ".vs",
  "packages",
  ".cache"
]);
function buildFileTree(dir, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return [];
  const prefix = "  ".repeat(depth);
  const lines = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith(".") || e.name === ".github").filter((e) => !IGNORE_DIRS.has(e.name)).sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        lines.push(...buildFileTree(path.join(dir, entry.name), depth + 1, maxDepth));
      } else {
        lines.push(`${prefix}${entry.name}`);
      }
    }
  } catch {
  }
  return lines;
}
function getPrismaSchema() {
  const candidates = ["prisma/schema.prisma", "schema.prisma", "db/schema.prisma"];
  for (const rel of candidates) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) {
      return fs.readFileSync(abs, "utf-8");
    }
  }
  return "Prisma schema not found";
}
function getTrpcProcedures() {
  const candidates = ["src/trpc/index.ts", "src/server/trpc.ts", "server/trpc.ts"];
  for (const rel of candidates) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, "utf-8");
    const lines = content.split("\n");
    const procedures = [];
    for (const line of lines) {
      const m = line.match(/^\s+(\w+):\s+(public|private)Procedure/);
      if (m) procedures.push(`- ${m[1]} (${m[2]})`);
    }
    if (procedures.length > 0) {
      return `**tRPC Procedures** (from ${rel}):
${procedures.join("\n")}`;
    }
    return `Found router at ${rel} but could not parse procedures. First 50 lines:
\`\`\`
${lines.slice(0, 50).join("\n")}
\`\`\``;
  }
  return "tRPC router not found";
}
function getApiRoutes(filter) {
  const routes = /* @__PURE__ */ new Set();
  function addRoute(route) {
    const trimmed = route.trim();
    if (!trimmed) return;
    routes.add(trimmed);
  }
  const apiDir = path.join(ROOT, "src/app/api");
  function scanNextApiDir(dir, prefix = "") {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          scanNextApiDir(path.join(dir, entry.name), `${prefix}/${entry.name}`);
          continue;
        }
        if (entry.name !== "route.ts" && entry.name !== "route.js") continue;
        const content = fs.readFileSync(path.join(dir, entry.name), "utf-8");
        const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter(
          (m) => new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}`).test(content)
        );
        if (methods.length === 0) continue;
        const route = prefix.replace(/\/\[([^\]]+)\]/g, "/:$1");
        addRoute(`${methods.join(", ")} ${route}`);
      }
    } catch {
    }
  }
  if (fs.existsSync(apiDir)) {
    scanNextApiDir(apiDir, "/api");
  }
  const scanPatterns = [
    {
      glob: "*.py",
      patterns: [
        /@(app|router)\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/g,
        /path\(['"]([^'"]+)['"],/g
      ]
    },
    {
      glob: "*.java",
      patterns: [
        /@(?:Get|Post|Put|Patch|Delete|Request)Mapping\(([^)]*)\)/g
      ]
    },
    {
      glob: "*.go",
      patterns: [
        /\.(GET|POST|PUT|PATCH|DELETE)\("([^"]+)"/g,
        /HandleFunc\("([^"]+)"/g
      ]
    },
    {
      glob: "*.rs",
      patterns: [
        /#\[(get|post|put|patch|delete)\("([^"]+)"\)\]/g,
        /route\("([^"]+)",\s*(get|post|put|patch|delete)/g
      ]
    },
    {
      glob: "*.{ts,js}",
      patterns: [
        /router\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/g,
        /app\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/g
      ]
    }
  ];
  for (const scan of scanPatterns) {
    try {
      const cmd = `npx --yes ripgrep --files -g "${scan.glob}" "${ROOT}"`;
      const files = execSync(cmd, { maxBuffer: 1024 * 1024, timeout: 12e3 }).toString().split("\n").filter(Boolean);
      for (const file of files.slice(0, 300)) {
        let content = "";
        try {
          content = fs.readFileSync(file, "utf-8");
        } catch {
          continue;
        }
        for (const pattern of scan.patterns) {
          const matches = content.matchAll(pattern);
          for (const match of matches) {
            if (scan.glob === "*.java") {
              const mappingArgs = match[1] ?? "";
              const methodMatch = mappingArgs.match(/RequestMethod\.(GET|POST|PUT|PATCH|DELETE)/);
              const method2 = methodMatch?.[1] ?? (match[0].includes("GetMapping") ? "GET" : match[0].includes("PostMapping") ? "POST" : match[0].includes("PutMapping") ? "PUT" : match[0].includes("PatchMapping") ? "PATCH" : match[0].includes("DeleteMapping") ? "DELETE" : "REQUEST");
              const pathMatch = mappingArgs.match(/['"]([^'"]+)['"]/);
              if (pathMatch) addRoute(`${method2} ${pathMatch[1]}`);
              continue;
            }
            const method = (match[2] ?? match[1] ?? "").toString().toUpperCase();
            const routePath = (match[3] ?? match[2] ?? match[1] ?? "").toString();
            if (!routePath.startsWith("/")) continue;
            if (["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
              addRoute(`${method} ${routePath}`);
            } else {
              addRoute(`ROUTE ${routePath}`);
            }
          }
        }
      }
    } catch {
    }
  }
  const result = [...routes].sort();
  const filtered = filter ? result.filter((route) => route.toLowerCase().includes(filter.toLowerCase())) : result;
  return filtered.length > 0 ? `**API Routes:**
${filtered.join("\n")}` : "No API routes found";
}
function getEnvVars() {
  const envExamplePaths = [".env.example", ".env.local.example", ".env.sample", ".env.template"];
  let envContent = "";
  for (const p of envExamplePaths) {
    if (fs.existsSync(path.join(ROOT, p))) {
      envContent = fs.readFileSync(path.join(ROOT, p), "utf-8");
      break;
    }
  }
  const codeEnvVars = /* @__PURE__ */ new Set();
  const extractors = [
    { regex: /process\.env\.(\w+)/g, fileGlob: "*.{ts,tsx,js,jsx,mjs,cjs}" },
    { regex: /os\.getenv\(['"]([A-Z0-9_]+)['"]/g, fileGlob: "*.py" },
    { regex: /os\.environ\[['"]([A-Z0-9_]+)['"]\]/g, fileGlob: "*.py" },
    { regex: /System\.getenv\(['"]([A-Z0-9_]+)['"]\)/g, fileGlob: "*.java" },
    { regex: /os\.Getenv\(['"]([A-Z0-9_]+)['"]\)/g, fileGlob: "*.go" },
    { regex: /std::env::var\(['"]([A-Z0-9_]+)['"]\)/g, fileGlob: "*.rs" }
  ];
  for (const extractor of extractors) {
    try {
      const cmd = `npx --yes ripgrep --files -g "${extractor.fileGlob}" "${ROOT}"`;
      const files = execSync(cmd, { maxBuffer: 1024 * 1024, timeout: 1e4 }).toString().split("\n").filter(Boolean);
      for (const file of files.slice(0, 400)) {
        let content = "";
        try {
          content = fs.readFileSync(file, "utf-8");
        } catch {
          continue;
        }
        for (const match of content.matchAll(extractor.regex)) {
          if (match[1]) codeEnvVars.add(match[1]);
        }
      }
    } catch {
    }
  }
  const lines = ["**Required Environment Variables:**", ""];
  if (envContent) {
    lines.push("From .env.example:");
    lines.push("```");
    lines.push(envContent.split("\n").filter((l) => l.trim() && !l.startsWith("#")).join("\n"));
    lines.push("```");
  }
  if (codeEnvVars.size > 0) {
    lines.push("");
    lines.push("Referenced in code:");
    [...codeEnvVars].sort().forEach((v) => lines.push(`- ${v}`));
  }
  return lines.join("\n");
}
function getPackageInfo(packageName) {
  const lines = [];
  const pkgPath = path.join(ROOT, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (packageName && allDeps[packageName]) {
      return `**${packageName}:** ${allDeps[packageName]}`;
    }
    lines.push(`**Node Package:** ${pkg.name ?? "unknown"}@${pkg.version ?? "0.0.0"}`);
    lines.push(`**Node Engine:** ${pkg.engines?.node ?? "not specified"}`);
    const depPairs = Object.entries(pkg.dependencies ?? {}).slice(0, 40).map(([k, v]) => `  ${k}: ${v}`);
    if (depPairs.length > 0) {
      lines.push("", "**Node Dependencies:**", ...depPairs);
    }
  }
  const requirementsPath = path.join(ROOT, "requirements.txt");
  if (fs.existsSync(requirementsPath)) {
    const reqLines = fs.readFileSync(requirementsPath, "utf-8").split("\n").map((line) => line.trim()).filter(Boolean).filter((line) => !line.startsWith("#"));
    if (packageName) {
      const found = reqLines.find((line) => line.toLowerCase().startsWith(packageName.toLowerCase()));
      if (found) return `**${packageName}:** ${found}`;
    }
    lines.push("", `**Python Requirements:** ${reqLines.length} entries`);
    lines.push(...reqLines.slice(0, 40).map((line) => `  ${line}`));
  }
  const pomPath = path.join(ROOT, "pom.xml");
  if (fs.existsSync(pomPath)) {
    const pom = fs.readFileSync(pomPath, "utf-8");
    const artifact = pom.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1] ?? "unknown";
    const version = pom.match(/<version>([^<]+)<\/version>/)?.[1] ?? "unknown";
    lines.push("", `**Maven Project:** ${artifact}@${version}`);
  }
  const gradlePath = path.join(ROOT, "build.gradle");
  const gradleKtsPath = path.join(ROOT, "build.gradle.kts");
  if (fs.existsSync(gradlePath) || fs.existsSync(gradleKtsPath)) {
    lines.push("", "**Gradle Build:** detected");
  }
  const goModPath = path.join(ROOT, "go.mod");
  if (fs.existsSync(goModPath)) {
    const goMod = fs.readFileSync(goModPath, "utf-8");
    const moduleName = goMod.match(/^module\s+(\S+)/m)?.[1] ?? "unknown";
    lines.push("", `**Go Module:** ${moduleName}`);
  }
  const cargoPath = path.join(ROOT, "Cargo.toml");
  if (fs.existsSync(cargoPath)) {
    const cargo = fs.readFileSync(cargoPath, "utf-8");
    const name = cargo.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "unknown";
    const version = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "unknown";
    lines.push("", `**Rust Crate:** ${name}@${version}`);
  }
  if (lines.length === 0) {
    return "No supported package/build manifest found (package.json, requirements.txt, pom.xml/build.gradle, go.mod, Cargo.toml).";
  }
  return lines.join("\n").trim();
}
function getFileSummary(filePath) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  try {
    const content = fs.readFileSync(absPath, "utf-8");
    const lines = content.split("\n");
    const ext = path.extname(filePath).toLowerCase();
    const exports = [];
    const imports = [];
    for (const line of lines.slice(0, 200)) {
      if (/^export\s+(default\s+)?(function|class|const|interface|type|enum)\s+(\w+)/.test(line)) {
        const match = line.match(/^export\s+(?:default\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/);
        if (match) exports.push(match[1]);
      }
      if (ext === ".py" && /^(def|class)\s+(\w+)/.test(line)) {
        const match = line.match(/^(def|class)\s+(\w+)/);
        if (match) exports.push(`${match[1]} ${match[2]}`);
      }
      if (ext === ".go" && /^func\s+(\w+)/.test(line)) {
        const match = line.match(/^func\s+(\w+)/);
        if (match) exports.push(`func ${match[1]}`);
      }
      if (imports.length < 10 && /^import\s/.test(line)) {
        imports.push(line.trim());
      }
    }
    const summary = [
      `**File:** \`${filePath}\``,
      `**Size:** ${lines.length} lines`,
      ""
    ];
    if (imports.length > 0) {
      summary.push("**Key Imports:**");
      summary.push(...imports.map((i) => `- ${i}`));
      summary.push("");
    }
    if (exports.length > 0) {
      summary.push("**Exports:**");
      summary.push(...exports.map((e) => `- ${e}`));
      summary.push("");
    }
    summary.push("**Preview (first 30 lines):**");
    summary.push("```");
    summary.push(...lines.slice(0, 30));
    summary.push("```");
    return summary.join("\n");
  } catch {
    return `Could not read file: ${filePath}`;
  }
}
function getImpactOfChange(filePath) {
  const newGraphPath = path.join(ROOT, ".github", "ai-os", "context", "dependency-graph.json");
  const legacyGraphPath = path.join(ROOT, ".ai-os", "context", "dependency-graph.json");
  const graphPath = fs.existsSync(newGraphPath) ? newGraphPath : legacyGraphPath;
  if (!fs.existsSync(graphPath)) {
    return "Dependency graph not found. Re-run the AI OS installer: `npx -y github:marinvch/ai-os --refresh-existing` (or the bootstrap one-liner from the README).";
  }
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, "utf-8"));
  } catch {
    return "Could not parse dependency graph.";
  }
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const node = graph.nodes[normalized];
  if (!node) {
    const candidates = Object.keys(graph.nodes).filter((k) => k.includes(normalized));
    if (candidates.length === 0) {
      return `File "${normalized}" not found in dependency graph. It may not be a tracked source file.`;
    }
    if (candidates.length > 1) {
      return `Ambiguous path "${normalized}" \u2014 did you mean one of:
${candidates.map((c) => `- ${c}`).join("\n")}`;
    }
    return getImpactOfChange(candidates[0]);
  }
  const visited = /* @__PURE__ */ new Set();
  const queue = [...node.importedBy];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    const n = graph.nodes[current];
    if (n) queue.push(...n.importedBy);
  }
  const direct = node.importedBy;
  const transitive = [...visited].filter((f) => !direct.includes(f));
  const lines = [
    `## Impact Analysis: \`${normalized}\``,
    "",
    `**Exports:** ${node.exports.length > 0 ? node.exports.join(", ") : "_none detected_"}`,
    "",
    `**Imports (${node.imports.length} direct dependencies):**`,
    ...node.imports.map((f) => `- ${f}`),
    "",
    `**Directly imported by (${direct.length} files):**`,
    ...direct.length > 0 ? direct.map((f) => `- ${f}`) : ["- _nothing imports this file_"],
    "",
    `**Transitively affected (${transitive.length} files):**`,
    ...transitive.length > 0 ? transitive.map((f) => `- ${f}`) : ["- _no transitive dependents_"]
  ];
  return lines.join("\n");
}
function getDependencyChain(filePath) {
  const newGraphPath = path.join(ROOT, ".github", "ai-os", "context", "dependency-graph.json");
  const legacyGraphPath = path.join(ROOT, ".ai-os", "context", "dependency-graph.json");
  const graphPath = fs.existsSync(newGraphPath) ? newGraphPath : legacyGraphPath;
  if (!fs.existsSync(graphPath)) {
    return "Dependency graph not found. Re-run the AI OS installer: `npx -y github:marinvch/ai-os --refresh-existing` (or the bootstrap one-liner from the README).";
  }
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, "utf-8"));
  } catch {
    return "Could not parse dependency graph.";
  }
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const node = graph.nodes[normalized];
  if (!node) {
    return `File "${normalized}" not found in dependency graph.`;
  }
  const lines = [
    `## Dependency Chain: \`${normalized}\``,
    "",
    "### This file imports:"
  ];
  if (node.imports.length === 0) {
    lines.push("- _no local imports_");
  } else {
    for (const imp of node.imports) {
      const impNode = graph.nodes[imp];
      const exports = impNode?.exports.slice(0, 5).join(", ") ?? "";
      lines.push(`- **${imp}**${exports ? ` \u2192 exports: \`${exports}\`` : ""}`);
    }
  }
  lines.push("");
  lines.push("### This file is imported by:");
  if (node.importedBy.length === 0) {
    lines.push("- _nothing imports this file_");
  } else {
    for (const parent of node.importedBy) {
      const parentNode = graph.nodes[parent];
      const grandparents = parentNode?.importedBy.slice(0, 3).join(", ") ?? "";
      lines.push(`- **${parent}**${grandparents ? ` (used by: ${grandparents})` : ""}`);
    }
  }
  return lines.join("\n");
}
function checkForUpdates() {
  const newConfigPath = path.join(ROOT, ".github", "ai-os", "config.json");
  const legacyConfigPath = path.join(ROOT, ".ai-os", "config.json");
  const configPath = fs.existsSync(newConfigPath) ? newConfigPath : legacyConfigPath;
  if (!fs.existsSync(configPath)) {
    return "AI OS is not installed in this repository. Run the bootstrap installer: `curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash`";
  }
  let installedVersion = "0.0.0";
  let installedAt = "unknown";
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    installedVersion = config.version ?? "0.0.0";
    installedAt = config.installedAt ?? "unknown";
  } catch {
    return "Could not read .github/ai-os/config.json";
  }
  let toolVersion = "0.0.0";
  try {
    const toolPkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf-8")
    );
    toolVersion = toolPkg.version ?? "0.0.0";
  } catch {
  }
  const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(toolVersion);
  const [iMaj = 0, iMin = 0, iPat = 0] = parse(installedVersion);
  const updateAvailable = cMaj > iMaj || cMaj === iMaj && cMin > iMin || cMaj === iMaj && cMin === iMin && cPat > iPat;
  if (updateAvailable) {
    return [
      `## AI OS Update Available`,
      ``,
      `- **Installed:** v${installedVersion} (generated ${installedAt})`,
      `- **Latest:**    v${toolVersion}`,
      ``,
      `Run the following to update all AI OS artifacts in-place:`,
      `\`\`\`bash`,
      `npx -y github:marinvch/ai-os#v${toolVersion} --refresh-existing`,
      `\`\`\``,
      `Or use the bootstrap one-liner: \`curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash\``,
      `This refreshes context docs, agents, skills, MCP tools, and the dependency graph without deleting your existing files.`
    ].join("\n");
  }
  return `AI OS is up-to-date (v${installedVersion}). Last generated: ${installedAt}`;
}
function getSessionContext() {
  const contextCardPath = path.join(ROOT, ".github", "COPILOT_CONTEXT.md");
  if (fs.existsSync(contextCardPath)) {
    return fs.readFileSync(contextCardPath, "utf-8");
  }
  const lines = [
    "# Session Context",
    "",
    "> COPILOT_CONTEXT.md not found. Run AI OS generation to create it.",
    "",
    "## Quick Context",
    ""
  ];
  const conventions = readAiOsFile("context/conventions.md");
  if (conventions) {
    const firstSection = conventions.split("\n##")[0];
    lines.push(firstSection.split("\n").slice(0, 15).join("\n"));
  }
  lines.push("");
  lines.push("Call `get_conventions` and `get_repo_memory` for full context.");
  return lines.join("\n");
}
function getRecommendations() {
  const recommendationsPath = path.join(ROOT, ".github", "ai-os", "recommendations.md");
  if (fs.existsSync(recommendationsPath)) {
    return fs.readFileSync(recommendationsPath, "utf-8");
  }
  return "No recommendations file found. Run AI OS generation with recommendations enabled to create .github/ai-os/recommendations.md.";
}
function suggestImprovements() {
  const suggestions = [];
  const envExamplePaths = [".env.example", ".env.local.example", ".env.sample"];
  const hasEnvExample = envExamplePaths.some((p) => fs.existsSync(path.join(ROOT, p)));
  if (!hasEnvExample) {
    suggestions.push("**Missing `.env.example`**: Document required environment variables so `get_env_vars` can surface them.");
  }
  if (!fs.existsSync(path.join(ROOT, ".github", "COPILOT_CONTEXT.md"))) {
    suggestions.push("**Missing `COPILOT_CONTEXT.md`**: Re-run the AI OS installer (`npx -y github:marinvch/ai-os --refresh-existing`) to generate the session context card for better session continuity.");
  }
  if (!fs.existsSync(path.join(ROOT, ".github", "ai-os", "recommendations.md"))) {
    suggestions.push("**Missing `recommendations.md`**: Re-run the AI OS installer (`npx -y github:marinvch/ai-os --refresh-existing`) to generate stack-specific tool recommendations.");
  }
  const memoryPath = path.join(ROOT, ".github", "ai-os", "memory", "memory.jsonl");
  if (!fs.existsSync(memoryPath)) {
    suggestions.push("**No repository memory found**: Use `remember_repo_fact` to capture key architectural decisions.");
  } else {
    const content = fs.readFileSync(memoryPath, "utf-8").trim();
    if (!content) {
      suggestions.push("**Empty repository memory**: Use `remember_repo_fact` to capture key architectural decisions and conventions.");
    }
  }
  const archPath = path.join(ROOT, ".github", "ai-os", "context", "architecture.md");
  if (!fs.existsSync(archPath)) {
    suggestions.push("**Missing architecture doc**: Re-run the AI OS installer (`npx -y github:marinvch/ai-os --refresh-existing`) to rebuild `.github/ai-os/context/architecture.md`.");
  }
  const configPath = path.join(ROOT, ".github", "ai-os", "config.json");
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (!config.persistentRules || config.persistentRules.length === 0) {
        suggestions.push('**No persistent rules defined**: Add `persistentRules` in `.github/ai-os/config.json` for rules that survive context window resets (e.g. "use shared components from components/ui").');
      }
      if (config.recommendations === false) {
        suggestions.push('**Recommendations disabled**: Set `"recommendations": true` in `.github/ai-os/config.json` to enable stack-specific tool suggestions.');
      }
    } catch {
    }
  }
  if (suggestions.length === 0) {
    return "## Improvement Suggestions\n\nNo actionable improvements found. Your AI OS setup looks healthy!\n\nConsider:\n- Adding more persistent rules in `config.json` for frequently forgotten conventions\n- Calling `remember_repo_fact` after major architectural decisions";
  }
  return [
    "## Improvement Suggestions",
    "",
    ...suggestions.map((s) => `- ${s}`)
  ].join("\n");
}

// src/mcp-server/index.ts
function logDiagnostic(message) {
  if (process.env["AI_OS_MCP_DEBUG"] === "1") {
    console.error(`[ai-os:mcp] ${message}`);
  }
}
function validateRuntimeEnvironment() {
  const messages = [];
  const root = getProjectRoot();
  if (!root) {
    messages.push("AI_OS_ROOT resolved to an empty path.");
  }
  const tools = getAllMcpTools();
  if (tools.length === 0) {
    messages.push("No MCP tools were registered at runtime.");
  }
  if (process.env["AI_OS_MCP_DEBUG"] === "1") {
    messages.push(`Resolved AI_OS_ROOT: ${root}`);
    messages.push(`Registered tools: ${tools.length}`);
  }
  return { ok: messages.filter((msg) => !msg.startsWith("Resolved ") && !msg.startsWith("Registered ")).length === 0, messages };
}
function executeTool(toolName, input) {
  switch (toolName) {
    case "search_codebase":
      return searchFiles(input.query ?? "", input.filePattern, input.caseSensitive ?? false);
    case "get_project_structure": {
      const startDir = input.path ? path2.join(getProjectRoot(), input.path) : getProjectRoot();
      return buildFileTree(startDir, 0, input.depth ?? 4).join("\n");
    }
    case "get_conventions":
      return readAiOsFile("context/conventions.md") || "No conventions file found.";
    case "get_stack_info":
      return readAiOsFile("context/stack.md") || "No stack file found.";
    case "get_file_summary":
      return getFileSummary(input.filePath ?? "");
    case "get_prisma_schema":
      return getPrismaSchema();
    case "get_trpc_procedures":
      return getTrpcProcedures();
    case "get_api_routes":
      return getApiRoutes(input.filter);
    case "get_env_vars":
      return getEnvVars();
    case "get_package_info":
      return getPackageInfo(input.packageName);
    case "get_impact_of_change":
      return getImpactOfChange(input.filePath ?? "");
    case "get_dependency_chain":
      return getDependencyChain(input.filePath ?? "");
    case "check_for_updates":
      return checkForUpdates();
    case "get_memory_guidelines":
      return getMemoryGuidelines();
    case "get_repo_memory":
      return getRepoMemory(input.query, input.category, input.limit);
    case "remember_repo_fact":
      return rememberRepoFact(input.title ?? "", input.content ?? "", input.category, input.tags);
    case "get_session_context":
      return getSessionContext();
    case "get_recommendations":
      return getRecommendations();
    case "suggest_improvements":
      return suggestImprovements();
    default:
      return `Unknown tool: ${toolName}`;
  }
}
async function main() {
  if (process.argv.includes("--healthcheck")) {
    const health2 = validateRuntimeEnvironment();
    if (!health2.ok) {
      for (const message of health2.messages) {
        console.error(`[ai-os:mcp:healthcheck] ${message}`);
      }
      process.exit(1);
    }
    console.error("[ai-os:mcp:healthcheck] OK");
    process.exit(0);
  }
  if (!process.argv.includes("--copilot")) {
    logDiagnostic("Starting in standalone JSON-RPC stdio mode");
    runStandaloneMcp();
    return;
  }
  const health = validateRuntimeEnvironment();
  for (const message of health.messages) {
    logDiagnostic(message);
  }
  if (!health.ok) {
    throw new Error(`MCP runtime validation failed: ${health.messages.join(" | ")}`);
  }
  let CopilotClient;
  try {
    const sdk = await import("@github/copilot-sdk");
    CopilotClient = sdk.CopilotClient;
  } catch {
    console.error("[ai-os:mcp] @github/copilot-sdk is required for --copilot mode but was not found.");
    console.error("[ai-os:mcp] Install it or omit --copilot to use standalone JSON-RPC mode.");
    process.exit(1);
  }
  const client = new CopilotClient();
  try {
    await client.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ai-os:mcp] Copilot SDK client failed to start: ${msg}`);
    console.error("[ai-os:mcp] Ensure the Copilot CLI is installed and authenticated, or omit --copilot to use standalone mode.");
    process.exit(1);
  }
  const session = await client.createSession({
    model: "gpt-4.1",
    tools: getAllMcpTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      handler: async (input) => executeTool(tool.name, input)
    })),
    onPermissionRequest: (_req) => ({ kind: "approved" })
  });
  process.on("SIGINT", async () => {
    await session.disconnect();
    await client.stop();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await session.disconnect();
    await client.stop();
    process.exit(0);
  });
}
function runStandaloneMcp() {
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
  let buffer = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      handleJsonRpcMessage(trimmed);
    }
  });
}
function handleJsonRpcMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (method === "tools/list") {
    sendResponse(id, {
      tools: getAllMcpTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    });
    return;
  }
  if (method === "tools/call") {
    const toolName = params?.name ?? "";
    const input = params?.arguments ?? {};
    const toolExists = getAllMcpTools().some((tool) => tool.name === toolName);
    if (!toolExists) {
      sendError(id, -32601, `Unknown tool: ${toolName}`);
      return;
    }
    const result = executeTool(toolName, input);
    sendResponse(id, { content: [{ type: "text", text: result }] });
    return;
  }
  if (method === "initialize") {
    sendResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "ai-os", version: "0.1.0" }
    });
    return;
  }
}
function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result });
  process.stdout.write(msg + "\n");
}
function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  process.stdout.write(msg + "\n");
}
main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[ai-os:mcp] Fatal error: ${msg}`);
  process.exit(1);
});
