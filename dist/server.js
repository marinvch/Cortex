// AI OS MCP Server — bundled single-file deployment

// src/mcp-server/index.ts
import path4 from "node:path";

// src/mcp-server/tool-definitions.ts
import fs from "node:fs";
import path from "node:path";

// src/mcp-tools.ts
var always = () => true;
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
    },
    condition: always
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
    },
    condition: always
  },
  {
    name: "get_conventions",
    description: "Returns the detected coding conventions for this project: naming rules, file structure, testing patterns, forbidden practices.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  {
    name: "get_stack_info",
    description: "Returns the complete tech stack inventory: languages, frameworks, key dependencies, build tools, and test setup.",
    inputSchema: { type: "object", properties: {} },
    condition: always
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
    },
    condition: always
  },
  {
    name: "get_prisma_schema",
    description: "Returns the full Prisma schema file contents. Use before making any database model changes.",
    inputSchema: { type: "object", properties: {} },
    condition: (stack) => stack.allDependencies.includes("prisma") || stack.allDependencies.includes("@prisma/client")
  },
  {
    name: "get_trpc_procedures",
    description: "Returns a summary of all tRPC procedures (name, input type, public/private). Avoids reading the entire router file.",
    inputSchema: { type: "object", properties: {} },
    condition: (stack) => {
      const frameworks = stack.frameworks.map((f) => f.name.toLowerCase());
      return stack.allDependencies.includes("@trpc/server") || frameworks.includes("trpc");
    }
  },
  {
    name: "get_api_routes",
    description: "Returns a list of API routes with HTTP methods using stack-aware discovery for Node, Java/Spring, Python, Go, and Rust patterns.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: 'Optional substring to filter routes (e.g. "auth", "webhook")' }
      }
    },
    condition: (stack) => {
      const frameworks = stack.frameworks.map((f) => f.name.toLowerCase());
      return frameworks.some(
        (f) => f.includes("next") || f.includes("express") || f.includes("fastapi") || f.includes("django") || f.includes("flask") || f.includes("spring") || f.includes("quarkus") || f.includes("micronaut") || f.includes("gin") || f.includes("echo") || f.includes("fiber") || f.includes("chi") || f.includes("actix") || f.includes("axum") || f.includes("rocket")
      );
    }
  },
  {
    name: "get_env_vars",
    description: "Returns all required environment variable names (from .env.example or code). Shows which are set vs. missing. Never returns values.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  {
    name: "get_package_info",
    description: "Returns installed package versions and direct dependencies. Useful before suggesting library usage to avoid API mismatch.",
    inputSchema: {
      type: "object",
      properties: {
        packageName: { type: "string", description: 'Optional: specific package to look up (e.g. "@trpc/server")' }
      }
    },
    condition: always
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
    },
    condition: always
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
    },
    condition: always
  },
  {
    name: "check_for_updates",
    description: "Checks if the AI OS artifacts installed in this repo are out of date. Returns update instructions when a newer version of AI OS is available.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  {
    name: "get_memory_guidelines",
    description: "Returns repository memory rules and memory usage protocol from .github/ai-os/context/memory.md.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  {
    name: "get_repo_memory",
    description: "Retrieves persisted repository memory entries from .github/ai-os/memory/memory.jsonl, optionally filtered by query/category.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional full-text query against title/content/tags" },
        category: { type: "string", description: "Optional category filter (e.g. architecture, conventions, pitfalls)" },
        limit: { type: "number", description: "Max entries to return (default: 10, max: 50)" }
      }
    },
    condition: always
  },
  {
    name: "remember_repo_fact",
    description: "Stores a durable repository memory entry in .github/ai-os/memory/memory.jsonl using dedupe/upsert rules (marks superseded conflicts and avoids duplicate facts).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short memory title" },
        content: { type: "string", description: "Durable fact/decision/constraint" },
        category: { type: "string", description: "Category (e.g. conventions, architecture, build, testing, security)" },
        tags: { type: "string", description: "Optional comma-separated tags" }
      },
      required: ["title", "content"]
    },
    condition: always
  },
  {
    name: "get_active_plan",
    description: "Returns the persisted active session plan from .github/ai-os/memory/session/active-plan.json. Use after context resets to restore goals and avoid drift.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  {
    name: "upsert_active_plan",
    description: "Creates or updates the persisted active plan (objective, criteria, current/next step, blockers). This provides durable task state across context resets.",
    inputSchema: {
      type: "object",
      properties: {
        objective: { type: "string", description: "Primary goal for the current task" },
        acceptanceCriteria: { type: "string", description: "Success criteria for task completion" },
        status: { type: "string", description: "Plan status: active, paused, or completed" },
        currentStep: { type: "string", description: "Current execution step" },
        nextStep: { type: "string", description: "Next planned action" },
        blockers: { type: "string", description: "Optional blockers, comma-separated or newline-separated" }
      },
      required: ["objective", "acceptanceCriteria"]
    },
    condition: always
  },
  {
    name: "append_checkpoint",
    description: "Appends a progress checkpoint to .github/ai-os/memory/session/checkpoints.jsonl to preserve intent and execution state during long tool-call sequences.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Checkpoint title" },
        status: { type: "string", description: "Checkpoint status: open or closed (default: open)" },
        notes: { type: "string", description: "Optional checkpoint notes" },
        toolCallCount: { type: "number", description: "Optional tool call count snapshot at checkpoint time" }
      },
      required: ["title"]
    },
    condition: always
  },
  {
    name: "close_checkpoint",
    description: "Closes an existing checkpoint by id in .github/ai-os/memory/session/checkpoints.jsonl.",
    inputSchema: {
      type: "object",
      properties: {
        checkpointId: { type: "string", description: "Checkpoint id returned by append_checkpoint" },
        notes: { type: "string", description: "Optional closing notes to append" }
      },
      required: ["checkpointId"]
    },
    condition: always
  },
  {
    name: "record_failure_pattern",
    description: "Records or updates a failure pattern in .github/ai-os/memory/session/failure-ledger.jsonl to prevent repeating the same mistakes.",
    inputSchema: {
      type: "object",
      properties: {
        tool: { type: "string", description: "Tool or subsystem where failure occurred" },
        errorSignature: { type: "string", description: "Short normalized error signature" },
        rootCause: { type: "string", description: "Suspected or confirmed root cause" },
        attemptedFix: { type: "string", description: "Fix that was attempted" },
        outcome: { type: "string", description: "Result of the fix: unresolved, partial, or resolved" },
        confidence: { type: "number", description: "Confidence in diagnosis from 0.0 to 1.0" }
      },
      required: ["tool", "errorSignature", "rootCause", "attemptedFix"]
    },
    condition: always
  },
  {
    name: "compact_session_context",
    description: "Creates a compact session summary from active plan, open checkpoints, and recent failure patterns to reduce context stuffing and preserve continuity.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  // ── Tool #19: Session Continuity ─────────────────────────────────────────
  {
    name: "get_session_context",
    description: "Returns the compact session context card with MUST-ALWAYS rules, build/test commands, and key file locations. CALL THIS at the start of every new conversation to reload critical context after a session reset.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  // ── Tool #20: Recommendation Engine ──────────────────────────────────────
  {
    name: "get_recommendations",
    description: "Returns stack-appropriate recommendations: MCP servers, VS Code extensions, agent skills, and GitHub Copilot Extensions. Useful for setting up a new developer environment.",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  // ── Tool #21: Improvement Suggestions ────────────────────────────────────
  {
    name: "suggest_improvements",
    description: "Analyzes project structure and memory entries to return architectural and tooling optimization suggestions (e.g. missing env var documentation, undocumented key paths, skills gaps).",
    inputSchema: { type: "object", properties: {} },
    condition: always
  },
  // ── Tool #22: Watchdog Configuration ─────────────────────────────────────
  {
    name: "set_watchdog_threshold",
    description: "Configures the automatic watchdog checkpoint interval for the current session (default: 8 tool calls). Increase for complex multi-step tasks; decrease for shorter focused work. Range: 1\u2013100.",
    inputSchema: {
      type: "object",
      properties: {
        threshold: { type: "number", description: "Number of tool calls between automatic watchdog checkpoints (1\u2013100)" }
      },
      required: ["threshold"]
    },
    condition: always
  }
];
function getAllMcpTools() {
  return MCP_TOOL_DEFINITIONS.map(({ condition: _condition, ...tool }) => tool);
}

// src/mcp-server/tool-definitions.ts
function getAllMcpTools2() {
  return getAllMcpTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
}
function getActiveToolsForProject(projectRoot) {
  const toolsJsonPath = path.join(projectRoot, ".github", "ai-os", "tools.json");
  if (!fs.existsSync(toolsJsonPath)) {
    return getAllMcpTools2();
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(toolsJsonPath, "utf-8"));
  } catch {
    return getAllMcpTools2();
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed;
    if (Array.isArray(obj["activeTools"])) {
      return obj["activeTools"].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }));
    }
  }
  if (Array.isArray(parsed)) {
    return parsed.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
  }
  return getAllMcpTools2();
}

// src/mcp-server/utils.ts
import { execSync } from "node:child_process";
import fs2 from "node:fs";
import path3 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/updater.ts
import path2 from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
function parseSemver(v) {
  const [maj = 0, min = 0, pat = 0] = v.replace(/^v/, "").split(".").map(Number);
  return [maj, min, pat];
}
function compareSemver(a, b) {
  const [aMaj = 0, aMin = 0, aPat = 0] = parseSemver(a);
  const [bMaj = 0, bMin = 0, bPat = 0] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj > bMaj ? 1 : -1;
  if (aMin !== bMin) return aMin > bMin ? 1 : -1;
  if (aPat !== bPat) return aPat > bPat ? 1 : -1;
  return 0;
}
function getLatestPublishedTagVersion() {
  try {
    const result = spawnSync(
      "git",
      ["ls-remote", "--tags", "--refs", "https://github.com/marinvch/ai-os.git", "v*"],
      {
        encoding: "utf-8",
        timeout: 5e3
      }
    );
    if (result.status !== 0 || !result.stdout) return null;
    const versions = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const match = line.match(/refs\/tags\/v(\d+\.\d+\.\d+)$/);
      return match?.[1] ?? null;
    }).filter((v) => v !== null);
    if (versions.length === 0) return null;
    return versions.reduce(
      (latest, current) => compareSemver(current, latest) > 0 ? current : latest
    );
  } catch {
    return null;
  }
}
function getLatestResolvableVersion(toolVersion) {
  const published = getLatestPublishedTagVersion();
  if (!published) return toolVersion;
  return published;
}

// src/mcp-server/utils.ts
var ROOT = process.env["AI_OS_ROOT"] ?? process.cwd();
var __dirname2 = path3.dirname(fileURLToPath2(import.meta.url));
function getProjectRoot() {
  return path3.resolve(ROOT);
}
function readAiOsFile(relPath) {
  try {
    const newPath = path3.join(ROOT, ".github", "ai-os", relPath);
    if (fs2.existsSync(newPath)) return fs2.readFileSync(newPath, "utf-8");
    return fs2.readFileSync(path3.join(ROOT, ".ai-os", relPath), "utf-8");
  } catch {
    return "";
  }
}
var MEMORY_STALE_DAYS = 180;
var MEMORY_LOCK_WAIT_MS = 2e3;
var MEMORY_LOCK_RETRY_MS = 50;
var MEMORY_LOCK_STALE_MS = 15e3;
var DEFAULT_WATCHDOG_THRESHOLD = 8;
var SESSION_LOCK_WAIT_MS = 1e3;
var SESSION_LOCK_RETRY_MS = 30;
var SESSION_CHECKPOINTS_CAP = 100;
var SESSION_FAILURES_CAP = 50;
function getMemoryFilePath() {
  const newPath = path3.join(ROOT, ".github", "ai-os", "memory", "memory.jsonl");
  const legacyPath = path3.join(ROOT, ".ai-os", "memory", "memory.jsonl");
  return fs2.existsSync(newPath) || !fs2.existsSync(legacyPath) ? newPath : legacyPath;
}
function getMemoryDirPath() {
  const newPath = path3.join(ROOT, ".github", "ai-os", "memory");
  const legacyPath = path3.join(ROOT, ".ai-os", "memory");
  return fs2.existsSync(newPath) || !fs2.existsSync(legacyPath) ? newPath : legacyPath;
}
function getMemoryLockFilePath() {
  return path3.join(getMemoryDirPath(), ".memory.lock");
}
function getSessionMemoryDirPath() {
  return path3.join(getMemoryDirPath(), "session");
}
function getSessionLockFilePath() {
  return path3.join(getSessionMemoryDirPath(), ".session.lock");
}
function getActivePlanPath() {
  return path3.join(getSessionMemoryDirPath(), "active-plan.json");
}
function getCheckpointLogPath() {
  return path3.join(getSessionMemoryDirPath(), "checkpoints.jsonl");
}
function getFailureLedgerPath() {
  return path3.join(getSessionMemoryDirPath(), "failure-ledger.jsonl");
}
function getCompactContextPath() {
  return path3.join(getSessionMemoryDirPath(), "compact-context.md");
}
function getRuntimeStatePath() {
  return path3.join(getSessionMemoryDirPath(), "runtime-state.json");
}
function ensureMemoryStore() {
  const memoryDir = getMemoryDirPath();
  if (!fs2.existsSync(memoryDir)) {
    fs2.mkdirSync(memoryDir, { recursive: true });
  }
  const memoryFile = getMemoryFilePath();
  if (!fs2.existsSync(memoryFile)) {
    fs2.writeFileSync(memoryFile, "", "utf-8");
  }
}
function ensureSessionMemoryStore() {
  ensureMemoryStore();
  const sessionDir = getSessionMemoryDirPath();
  if (!fs2.existsSync(sessionDir)) {
    fs2.mkdirSync(sessionDir, { recursive: true });
  }
  const checkpointsPath = getCheckpointLogPath();
  if (!fs2.existsSync(checkpointsPath)) {
    fs2.writeFileSync(checkpointsPath, "", "utf-8");
  }
  const failurePath = getFailureLedgerPath();
  if (!fs2.existsSync(failurePath)) {
    fs2.writeFileSync(failurePath, "", "utf-8");
  }
}
function writeTextAtomic(filePath, content) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs2.writeFileSync(tempPath, content, "utf-8");
  fs2.renameSync(tempPath, filePath);
}
function readJsonlFile(filePath) {
  if (!fs2.existsSync(filePath)) return [];
  const lines = fs2.readFileSync(filePath, "utf-8").split("\n").map((line) => line.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
    }
  }
  return rows;
}
function readRuntimeState() {
  const filePath = getRuntimeStatePath();
  const fallback = {
    toolCallCount: 0,
    lastWatchdogCheckpointCount: 0,
    threshold: DEFAULT_WATCHDOG_THRESHOLD,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (!fs2.existsSync(filePath)) return fallback;
  try {
    const raw = JSON.parse(fs2.readFileSync(filePath, "utf-8"));
    const threshold = typeof raw.threshold === "number" && raw.threshold >= 1 ? Math.floor(raw.threshold) : DEFAULT_WATCHDOG_THRESHOLD;
    return {
      toolCallCount: typeof raw.toolCallCount === "number" ? Math.max(0, Math.floor(raw.toolCallCount)) : 0,
      lastWatchdogCheckpointCount: typeof raw.lastWatchdogCheckpointCount === "number" ? Math.max(0, Math.floor(raw.lastWatchdogCheckpointCount)) : 0,
      threshold,
      updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt.trim() ? raw.updatedAt : (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch {
    return fallback;
  }
}
function writeRuntimeState(state) {
  writeTextAtomic(getRuntimeStatePath(), JSON.stringify(state, null, 2));
}
function normalizeFailureText(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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
      fs2.unlinkSync(_activeLockPath);
    } catch {
    }
    _activeLockPath = null;
  }
}
process.on("exit", _releaseLockOnExit);
var _activeSessionLockPath = null;
function _releaseSessionLockOnExit() {
  if (_activeSessionLockPath) {
    try {
      fs2.unlinkSync(_activeSessionLockPath);
    } catch {
    }
    _activeSessionLockPath = null;
  }
}
process.on("exit", _releaseSessionLockOnExit);
function withSessionLock(fn) {
  ensureSessionMemoryStore();
  const lockPath = getSessionLockFilePath();
  const startedAt = Date.now();
  let lockFd = null;
  while (Date.now() - startedAt < SESSION_LOCK_WAIT_MS) {
    try {
      lockFd = fs2.openSync(lockPath, "wx");
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        const lockStat = fs2.statSync(lockPath);
        if (Date.now() - lockStat.mtimeMs > MEMORY_LOCK_STALE_MS) {
          fs2.unlinkSync(lockPath);
          continue;
        }
      } catch {
      }
      sleepSync(SESSION_LOCK_RETRY_MS);
    }
  }
  if (lockFd === null) {
    return fn();
  }
  _activeSessionLockPath = lockPath;
  try {
    return fn();
  } finally {
    _activeSessionLockPath = null;
    try {
      fs2.closeSync(lockFd);
    } catch {
    }
    try {
      fs2.unlinkSync(lockPath);
    } catch {
    }
  }
}
function withMemoryLock(fn) {
  ensureMemoryStore();
  const lockPath = getMemoryLockFilePath();
  const startedAt = Date.now();
  let lockFd = null;
  while (Date.now() - startedAt < MEMORY_LOCK_WAIT_MS) {
    try {
      lockFd = fs2.openSync(lockPath, "wx");
      break;
    } catch (err) {
      if (err.code !== "EEXIST") {
        throw err;
      }
      try {
        const lockStat = fs2.statSync(lockPath);
        if (Date.now() - lockStat.mtimeMs > MEMORY_LOCK_STALE_MS) {
          fs2.unlinkSync(lockPath);
          continue;
        }
      } catch {
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
      fs2.closeSync(lockFd);
    } catch {
    }
    try {
      fs2.unlinkSync(lockPath);
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
  fs2.writeFileSync(tempPath, serializeEntries(entries), "utf-8");
  fs2.renameSync(tempPath, memoryPath);
}
function trimJsonlFileToCap(filePath, cap) {
  if (!fs2.existsSync(filePath)) return;
  const lines = fs2.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  if (lines.length <= cap) return;
  writeTextAtomic(filePath, lines.slice(lines.length - cap).join("\n") + "\n");
}
function readMemoryEntries() {
  ensureMemoryStore();
  const file = getMemoryFilePath();
  const content = fs2.readFileSync(file, "utf-8");
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
  }).slice(0, cap);
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
function getActivePlan() {
  ensureSessionMemoryStore();
  const filePath = getActivePlanPath();
  if (!fs2.existsSync(filePath)) {
    return "No active session plan found. Create one with `upsert_active_plan`.";
  }
  try {
    const plan = JSON.parse(fs2.readFileSync(filePath, "utf-8"));
    const lines = [
      "## Active Plan",
      "",
      `- Objective: ${plan.objective}`,
      `- Acceptance Criteria: ${plan.acceptanceCriteria}`,
      `- Status: ${plan.status}`,
      `- Created: ${plan.createdAt}`,
      `- Updated: ${plan.updatedAt}`
    ];
    if (plan.currentStep) lines.push(`- Current Step: ${plan.currentStep}`);
    if (plan.nextStep) lines.push(`- Next Step: ${plan.nextStep}`);
    lines.push("- Blockers:");
    if (plan.blockers.length === 0) {
      lines.push("  - none");
    } else {
      for (const blocker of plan.blockers) {
        lines.push(`  - ${blocker}`);
      }
    }
    return lines.join("\n");
  } catch {
    return "Failed to read active plan. Recreate it with `upsert_active_plan`.";
  }
}
function upsertActivePlan(objective, acceptanceCriteria, status, currentStep, nextStep, blockers) {
  const trimmedObjective = objective.trim();
  const trimmedCriteria = acceptanceCriteria.trim();
  if (!trimmedObjective || !trimmedCriteria) {
    return "Both objective and acceptanceCriteria are required to upsert active plan.";
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const normalizedStatus = status === "paused" || status === "completed" ? status : "active";
  const blockerList = (blockers ?? "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();
      const filePath = getActivePlanPath();
      const existing = fs2.existsSync(filePath) ? JSON.parse(fs2.readFileSync(filePath, "utf-8")) : {};
      const plan = {
        objective: trimmedObjective,
        acceptanceCriteria: trimmedCriteria,
        status: normalizedStatus,
        currentStep: currentStep?.trim() || existing.currentStep,
        nextStep: nextStep?.trim() || existing.nextStep,
        blockers: blockerList.length > 0 ? blockerList : existing.blockers ?? [],
        createdAt: existing.createdAt ?? now,
        updatedAt: now
      };
      writeTextAtomic(filePath, JSON.stringify(plan, null, 2));
      return `Active plan upserted (${plan.status}).`;
    });
  } catch (err) {
    return `Failed to upsert active plan: ${err instanceof Error ? err.message : String(err)}`;
  }
}
function appendCheckpoint(title, status, notes, toolCallCount) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return "Checkpoint title is required.";
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const normalizedStatus = status === "closed" ? "closed" : "open";
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: trimmedTitle,
    status: normalizedStatus,
    notes: notes?.trim() || void 0,
    toolCallCount: typeof toolCallCount === "number" ? toolCallCount : void 0,
    createdAt: now,
    closedAt: normalizedStatus === "closed" ? now : void 0
  };
  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();
      const filePath = getCheckpointLogPath();
      fs2.appendFileSync(filePath, `${JSON.stringify(entry)}
`, "utf-8");
      trimJsonlFileToCap(filePath, SESSION_CHECKPOINTS_CAP);
      return `Checkpoint appended: ${entry.id}`;
    });
  } catch (err) {
    return `Failed to append checkpoint: ${err instanceof Error ? err.message : String(err)}`;
  }
}
function closeCheckpoint(checkpointId, notes) {
  const id = checkpointId.trim();
  if (!id) {
    return "checkpointId is required.";
  }
  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();
      const filePath = getCheckpointLogPath();
      const entries = readJsonlFile(filePath);
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) {
        return `Checkpoint not found: ${id}`;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const existingNotes = entries[index].notes?.trim();
      const closingNotes = notes?.trim();
      const mergedNotes = [existingNotes, closingNotes].filter(Boolean).join(" | ");
      entries[index] = {
        ...entries[index],
        status: "closed",
        notes: mergedNotes || void 0,
        closedAt: now
      };
      writeTextAtomic(filePath, entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""));
      return `Checkpoint closed: ${id}`;
    });
  } catch (err) {
    return `Failed to close checkpoint: ${err instanceof Error ? err.message : String(err)}`;
  }
}
function recordFailurePattern(tool, errorSignature, rootCause, attemptedFix, outcome, confidence) {
  const trimmedTool = tool.trim();
  const trimmedSignature = errorSignature.trim();
  const trimmedRootCause = rootCause.trim();
  const trimmedFix = attemptedFix.trim();
  if (!trimmedTool || !trimmedSignature || !trimmedRootCause || !trimmedFix) {
    return "tool, errorSignature, rootCause, and attemptedFix are required to record failure pattern.";
  }
  const normalizedOutcome = outcome === "resolved" || outcome === "partial" ? outcome : "unresolved";
  const normalizedConfidence = typeof confidence === "number" ? Math.max(0, Math.min(1, confidence)) : 0.5;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();
      const filePath = getFailureLedgerPath();
      const rows = readJsonlFile(filePath);
      const key = [
        normalizeFailureText(trimmedTool),
        normalizeFailureText(trimmedSignature),
        normalizeFailureText(trimmedRootCause),
        normalizeFailureText(trimmedFix)
      ].join("::");
      const existing = rows.find((entry2) => [
        normalizeFailureText(entry2.tool),
        normalizeFailureText(entry2.errorSignature),
        normalizeFailureText(entry2.rootCause),
        normalizeFailureText(entry2.attemptedFix)
      ].join("::") === key);
      if (existing) {
        existing.occurrences += 1;
        existing.lastSeenAt = now;
        existing.outcome = normalizedOutcome;
        existing.confidence = normalizedConfidence;
        writeTextAtomic(filePath, rows.map((entry2) => JSON.stringify(entry2)).join("\n") + (rows.length ? "\n" : ""));
        return `Failure pattern updated: ${existing.id} (occurrences=${existing.occurrences})`;
      }
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tool: trimmedTool,
        errorSignature: trimmedSignature,
        rootCause: trimmedRootCause,
        attemptedFix: trimmedFix,
        outcome: normalizedOutcome,
        confidence: normalizedConfidence,
        occurrences: 1,
        firstSeenAt: now,
        lastSeenAt: now
      };
      rows.push(entry);
      trimJsonlFileToCap(filePath, SESSION_FAILURES_CAP);
      writeTextAtomic(filePath, rows.map((item) => JSON.stringify(item)).join("\n") + "\n");
      return `Failure pattern recorded: ${entry.id}`;
    });
  } catch (err) {
    return `Failed to record failure pattern: ${err instanceof Error ? err.message : String(err)}`;
  }
}
function compactSessionContext() {
  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();
      const activePlanPath = getActivePlanPath();
      const checkpointsPath = getCheckpointLogPath();
      const failurePath = getFailureLedgerPath();
      const outputPath = getCompactContextPath();
      const plan = fs2.existsSync(activePlanPath) ? JSON.parse(fs2.readFileSync(activePlanPath, "utf-8")) : null;
      const checkpoints = readJsonlFile(checkpointsPath).slice(-12).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const failures = readJsonlFile(failurePath).slice(-12).sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
      const lines = [
        "# Compact Session Context",
        "",
        `Generated: ${(/* @__PURE__ */ new Date()).toISOString()}`,
        "",
        "## Active Goal"
      ];
      if (!plan) {
        lines.push("- No active plan yet.");
      } else {
        lines.push(`- Objective: ${plan.objective}`);
        lines.push(`- Acceptance Criteria: ${plan.acceptanceCriteria}`);
        lines.push(`- Status: ${plan.status}`);
        if (plan.currentStep) lines.push(`- Current Step: ${plan.currentStep}`);
        if (plan.nextStep) lines.push(`- Next Step: ${plan.nextStep}`);
        lines.push("- Blockers:");
        if (plan.blockers.length === 0) {
          lines.push("  - none");
        } else {
          for (const blocker of plan.blockers) lines.push(`  - ${blocker}`);
        }
      }
      lines.push("", "## Open Checkpoints");
      const openCheckpoints = checkpoints.filter((entry) => entry.status === "open");
      if (openCheckpoints.length === 0) {
        lines.push("- none");
      } else {
        for (const item of openCheckpoints) {
          lines.push(`- ${item.id}: ${item.title}`);
          if (item.notes) lines.push(`  - notes: ${item.notes}`);
          if (typeof item.toolCallCount === "number") lines.push(`  - tool calls: ${item.toolCallCount}`);
        }
      }
      lines.push("", "## Recent Failure Patterns");
      if (failures.length === 0) {
        lines.push("- none");
      } else {
        for (const item of failures.slice(0, 8)) {
          lines.push(`- ${item.tool}: ${item.errorSignature} (occurrences=${item.occurrences}, outcome=${item.outcome})`);
          lines.push(`  - root cause: ${item.rootCause}`);
          lines.push(`  - attempted fix: ${item.attemptedFix}`);
        }
      }
      lines.push("", "## Next Action Hint");
      if (plan?.nextStep) {
        lines.push(`- Resume from: ${plan.nextStep}`);
      } else {
        lines.push("- Define next step with `upsert_active_plan` to avoid goal drift.");
      }
      writeTextAtomic(outputPath, lines.join("\n") + "\n");
      return `Compact context written to .github/ai-os/memory/session/compact-context.md

${lines.join("\n")}`;
    });
  } catch (err) {
    return `Failed to compact session context: ${err instanceof Error ? err.message : String(err)}`;
  }
}
function recordToolCallAndRunWatchdog(toolName) {
  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();
      const state = readRuntimeState();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      state.toolCallCount += 1;
      state.updatedAt = now;
      const thresholdReached = state.toolCallCount - state.lastWatchdogCheckpointCount >= state.threshold;
      if (!thresholdReached) {
        writeRuntimeState(state);
        return null;
      }
      const checkpoint = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: `Goal watchdog checkpoint @${state.toolCallCount} calls`,
        status: "open",
        notes: `Auto-checkpoint after ${state.threshold} tool calls. Re-read active plan and confirm alignment. Trigger tool: ${toolName}`,
        toolCallCount: state.toolCallCount,
        createdAt: now
      };
      const checkpointsPath = getCheckpointLogPath();
      fs2.appendFileSync(checkpointsPath, `${JSON.stringify(checkpoint)}
`, "utf-8");
      trimJsonlFileToCap(checkpointsPath, SESSION_CHECKPOINTS_CAP);
      state.lastWatchdogCheckpointCount = state.toolCallCount;
      writeRuntimeState(state);
      return `Watchdog checkpoint created (${checkpoint.id}) after ${state.toolCallCount} tool calls.`;
    });
  } catch {
    return null;
  }
}
function setWatchdogThreshold(threshold) {
  const normalized = Math.max(1, Math.min(100, Math.floor(threshold)));
  try {
    return withSessionLock(() => {
      ensureSessionMemoryStore();
      const state = readRuntimeState();
      state.threshold = normalized;
      state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      writeRuntimeState(state);
      return `Watchdog threshold updated to ${normalized} tool calls.`;
    });
  } catch (err) {
    return `Failed to set watchdog threshold: ${err instanceof Error ? err.message : String(err)}`;
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
    const entries = fs2.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith(".") || e.name === ".github").filter((e) => !IGNORE_DIRS.has(e.name)).sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        lines.push(...buildFileTree(path3.join(dir, entry.name), depth + 1, maxDepth));
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
    const abs = path3.join(ROOT, rel);
    if (fs2.existsSync(abs)) {
      return fs2.readFileSync(abs, "utf-8");
    }
  }
  return "Prisma schema not found";
}
function getTrpcProcedures() {
  const candidates = ["src/trpc/index.ts", "src/server/trpc.ts", "server/trpc.ts"];
  for (const rel of candidates) {
    const abs = path3.join(ROOT, rel);
    if (!fs2.existsSync(abs)) continue;
    const content = fs2.readFileSync(abs, "utf-8");
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
  const apiDir = path3.join(ROOT, "src/app/api");
  function scanNextApiDir(dir, prefix = "") {
    try {
      const entries = fs2.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          scanNextApiDir(path3.join(dir, entry.name), `${prefix}/${entry.name}`);
          continue;
        }
        if (entry.name !== "route.ts" && entry.name !== "route.js") continue;
        const content = fs2.readFileSync(path3.join(dir, entry.name), "utf-8");
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
  if (fs2.existsSync(apiDir)) {
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
          content = fs2.readFileSync(file, "utf-8");
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
    if (fs2.existsSync(path3.join(ROOT, p))) {
      envContent = fs2.readFileSync(path3.join(ROOT, p), "utf-8");
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
          content = fs2.readFileSync(file, "utf-8");
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
  const pkgPath = path3.join(ROOT, "package.json");
  if (fs2.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs2.readFileSync(pkgPath, "utf-8"));
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
  const requirementsPath = path3.join(ROOT, "requirements.txt");
  if (fs2.existsSync(requirementsPath)) {
    const reqLines = fs2.readFileSync(requirementsPath, "utf-8").split("\n").map((line) => line.trim()).filter(Boolean).filter((line) => !line.startsWith("#"));
    if (packageName) {
      const found = reqLines.find((line) => line.toLowerCase().startsWith(packageName.toLowerCase()));
      if (found) return `**${packageName}:** ${found}`;
    }
    lines.push("", `**Python Requirements:** ${reqLines.length} entries`);
    lines.push(...reqLines.slice(0, 40).map((line) => `  ${line}`));
  }
  const pomPath = path3.join(ROOT, "pom.xml");
  if (fs2.existsSync(pomPath)) {
    const pom = fs2.readFileSync(pomPath, "utf-8");
    const artifact = pom.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1] ?? "unknown";
    const version = pom.match(/<version>([^<]+)<\/version>/)?.[1] ?? "unknown";
    lines.push("", `**Maven Project:** ${artifact}@${version}`);
  }
  const gradlePath = path3.join(ROOT, "build.gradle");
  const gradleKtsPath = path3.join(ROOT, "build.gradle.kts");
  if (fs2.existsSync(gradlePath) || fs2.existsSync(gradleKtsPath)) {
    lines.push("", "**Gradle Build:** detected");
  }
  const goModPath = path3.join(ROOT, "go.mod");
  if (fs2.existsSync(goModPath)) {
    const goMod = fs2.readFileSync(goModPath, "utf-8");
    const moduleName = goMod.match(/^module\s+(\S+)/m)?.[1] ?? "unknown";
    lines.push("", `**Go Module:** ${moduleName}`);
  }
  const cargoPath = path3.join(ROOT, "Cargo.toml");
  if (fs2.existsSync(cargoPath)) {
    const cargo = fs2.readFileSync(cargoPath, "utf-8");
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
  const absPath = path3.isAbsolute(filePath) ? filePath : path3.join(ROOT, filePath);
  try {
    const content = fs2.readFileSync(absPath, "utf-8");
    const lines = content.split("\n");
    const ext = path3.extname(filePath).toLowerCase();
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
  const newGraphPath = path3.join(ROOT, ".github", "ai-os", "context", "dependency-graph.json");
  const legacyGraphPath = path3.join(ROOT, ".ai-os", "context", "dependency-graph.json");
  const graphPath = fs2.existsSync(newGraphPath) ? newGraphPath : legacyGraphPath;
  if (!fs2.existsSync(graphPath)) {
    return "Dependency graph not found. Re-run the AI OS installer: `npx -y github:marinvch/ai-os --refresh-existing` (or the bootstrap one-liner from the README).";
  }
  let graph;
  try {
    graph = JSON.parse(fs2.readFileSync(graphPath, "utf-8"));
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
  const newGraphPath = path3.join(ROOT, ".github", "ai-os", "context", "dependency-graph.json");
  const legacyGraphPath = path3.join(ROOT, ".ai-os", "context", "dependency-graph.json");
  const graphPath = fs2.existsSync(newGraphPath) ? newGraphPath : legacyGraphPath;
  if (!fs2.existsSync(graphPath)) {
    return "Dependency graph not found. Re-run the AI OS installer: `npx -y github:marinvch/ai-os --refresh-existing` (or the bootstrap one-liner from the README).";
  }
  let graph;
  try {
    graph = JSON.parse(fs2.readFileSync(graphPath, "utf-8"));
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
  const newConfigPath = path3.join(ROOT, ".github", "ai-os", "config.json");
  const legacyConfigPath = path3.join(ROOT, ".ai-os", "config.json");
  const configPath = fs2.existsSync(newConfigPath) ? newConfigPath : legacyConfigPath;
  if (!fs2.existsSync(configPath)) {
    return "AI OS is not installed in this repository. Run the bootstrap installer: `curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash`";
  }
  let installedVersion = "0.0.0";
  let installedAt = "unknown";
  try {
    const config = JSON.parse(fs2.readFileSync(configPath, "utf-8"));
    installedVersion = config.version ?? "0.0.0";
    installedAt = config.installedAt ?? "unknown";
  } catch {
    return "Could not read .github/ai-os/config.json";
  }
  let toolVersion = "0.0.0";
  try {
    const toolPkg = JSON.parse(
      fs2.readFileSync(path3.join(__dirname2, "..", "..", "package.json"), "utf-8")
    );
    toolVersion = toolPkg.version ?? "0.0.0";
  } catch {
  }
  const latestVersion = getLatestResolvableVersion(toolVersion);
  const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(latestVersion);
  const [iMaj = 0, iMin = 0, iPat = 0] = parse(installedVersion);
  const updateAvailable = cMaj > iMaj || cMaj === iMaj && cMin > iMin || cMaj === iMaj && cMin === iMin && cPat > iPat;
  if (updateAvailable) {
    return [
      `## AI OS Update Available`,
      ``,
      `- **Installed:** v${installedVersion} (generated ${installedAt})`,
      `- **Latest:**    v${latestVersion}`,
      ``,
      `Run the following to update all AI OS artifacts in-place:`,
      `\`\`\`bash`,
      `npx -y "github:marinvch/ai-os#v${latestVersion}" --refresh-existing`,
      `\`\`\``,
      `Or use the bootstrap one-liner: \`curl -fsSL https://raw.githubusercontent.com/marinvch/ai-os/master/bootstrap.sh | bash\``,
      `This refreshes context docs, agents, skills, MCP tools, and the dependency graph without deleting your existing files.`
    ].join("\n");
  }
  return `AI OS is up-to-date (v${installedVersion}). Last generated: ${installedAt}`;
}
function getSessionContext() {
  const SESSION_BOOTSTRAP = [
    "",
    "---",
    "",
    "## Session Start Bootstrap",
    "",
    "**At the start of every session, run in order:**",
    "",
    "1. `get_session_context` \u2190 you are here",
    "2. `get_repo_memory` \u2014 reload durable architectural decisions",
    "3. `get_conventions` \u2014 reload coding rules before writing any code",
    "",
    "**Before any non-trivial change:**",
    "",
    "- `get_project_structure` \u2014 explore unfamiliar directories",
    "- `get_file_summary` \u2014 understand a file without reading it fully",
    "- `get_impact_of_change` \u2014 assess blast radius before editing shared files",
    "- Use `/define` \u2192 `/plan` lifecycle prompts before writing code",
    "",
    "> If the request is ambiguous or underspecified, ask clarifying questions first.",
    "> Do not improvise requirements or make architectural changes without confirmation."
  ].join("\n");
  const contextCardPath = path3.join(ROOT, ".github", "COPILOT_CONTEXT.md");
  if (fs2.existsSync(contextCardPath)) {
    return fs2.readFileSync(contextCardPath, "utf-8") + SESSION_BOOTSTRAP;
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
  return lines.join("\n") + SESSION_BOOTSTRAP;
}
function getRecommendations() {
  const recommendationsPath = path3.join(ROOT, ".github", "ai-os", "recommendations.md");
  if (fs2.existsSync(recommendationsPath)) {
    return fs2.readFileSync(recommendationsPath, "utf-8");
  }
  return "No recommendations file found. Run AI OS generation with recommendations enabled to create .github/ai-os/recommendations.md.";
}
function suggestImprovements() {
  const suggestions = [];
  const envExamplePaths = [".env.example", ".env.local.example", ".env.sample"];
  const hasEnvExample = envExamplePaths.some((p) => fs2.existsSync(path3.join(ROOT, p)));
  if (!hasEnvExample) {
    suggestions.push("**Missing `.env.example`**: Document required environment variables so `get_env_vars` can surface them.");
  }
  if (!fs2.existsSync(path3.join(ROOT, ".github", "COPILOT_CONTEXT.md"))) {
    suggestions.push("**Missing `COPILOT_CONTEXT.md`**: Re-run the AI OS installer (`npx -y github:marinvch/ai-os --refresh-existing`) to generate the session context card for better session continuity.");
  }
  if (!fs2.existsSync(path3.join(ROOT, ".github", "ai-os", "recommendations.md"))) {
    suggestions.push("**Missing `recommendations.md`**: Re-run the AI OS installer (`npx -y github:marinvch/ai-os --refresh-existing`) to generate stack-specific tool recommendations.");
  }
  const memoryPath = path3.join(ROOT, ".github", "ai-os", "memory", "memory.jsonl");
  if (!fs2.existsSync(memoryPath)) {
    suggestions.push("**No repository memory found**: Use `remember_repo_fact` to capture key architectural decisions.");
  } else {
    const content = fs2.readFileSync(memoryPath, "utf-8").trim();
    if (!content) {
      suggestions.push("**Empty repository memory**: Use `remember_repo_fact` to capture key architectural decisions and conventions.");
    }
  }
  const archPath = path3.join(ROOT, ".github", "ai-os", "context", "architecture.md");
  if (!fs2.existsSync(archPath)) {
    suggestions.push("**Missing architecture doc**: Re-run the AI OS installer (`npx -y github:marinvch/ai-os --refresh-existing`) to rebuild `.github/ai-os/context/architecture.md`.");
  }
  const configPath = path3.join(ROOT, ".github", "ai-os", "config.json");
  if (fs2.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs2.readFileSync(configPath, "utf-8"));
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
  const tools = getActiveToolsForProject(root);
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
  const watchdogMessage = recordToolCallAndRunWatchdog(toolName);
  let result;
  switch (toolName) {
    case "search_codebase":
      result = searchFiles(input.query ?? "", input.filePattern, input.caseSensitive ?? false);
      break;
    case "get_project_structure": {
      const startDir = input.path ? path4.join(getProjectRoot(), input.path) : getProjectRoot();
      result = buildFileTree(startDir, 0, input.depth ?? 4).join("\n");
      break;
    }
    case "get_conventions":
      result = readAiOsFile("context/conventions.md") || "No conventions file found.";
      break;
    case "get_stack_info":
      result = readAiOsFile("context/stack.md") || "No stack file found.";
      break;
    case "get_file_summary":
      result = getFileSummary(input.filePath ?? "");
      break;
    case "get_prisma_schema":
      result = getPrismaSchema();
      break;
    case "get_trpc_procedures":
      result = getTrpcProcedures();
      break;
    case "get_api_routes":
      result = getApiRoutes(input.filter);
      break;
    case "get_env_vars":
      result = getEnvVars();
      break;
    case "get_package_info":
      result = getPackageInfo(input.packageName);
      break;
    case "get_impact_of_change":
      result = getImpactOfChange(input.filePath ?? "");
      break;
    case "get_dependency_chain":
      result = getDependencyChain(input.filePath ?? "");
      break;
    case "check_for_updates":
      result = checkForUpdates();
      break;
    case "get_memory_guidelines":
      result = getMemoryGuidelines();
      break;
    case "get_repo_memory":
      result = getRepoMemory(input.query, input.category, input.limit);
      break;
    case "remember_repo_fact":
      result = rememberRepoFact(input.title ?? "", input.content ?? "", input.category, input.tags);
      break;
    case "get_active_plan":
      result = getActivePlan();
      break;
    case "upsert_active_plan":
      result = upsertActivePlan(
        input.objective ?? "",
        input.acceptanceCriteria ?? "",
        input.status,
        input.currentStep,
        input.nextStep,
        input.blockers
      );
      break;
    case "append_checkpoint":
      result = appendCheckpoint(input.title ?? "", input.status, input.notes, input.toolCallCount);
      break;
    case "close_checkpoint":
      result = closeCheckpoint(input.checkpointId ?? "", input.notes);
      break;
    case "record_failure_pattern":
      result = recordFailurePattern(
        input.tool ?? "",
        input.errorSignature ?? "",
        input.rootCause ?? "",
        input.attemptedFix ?? "",
        input.outcome,
        input.confidence
      );
      break;
    case "compact_session_context":
      result = compactSessionContext();
      break;
    case "set_watchdog_threshold":
      result = setWatchdogThreshold(typeof input.threshold === "number" ? input.threshold : 8);
      break;
    case "get_session_context":
      result = getSessionContext();
      break;
    case "get_recommendations":
      result = getRecommendations();
      break;
    case "suggest_improvements":
      result = suggestImprovements();
      break;
    default:
      result = `Unknown tool: ${toolName}`;
      break;
  }
  if (!watchdogMessage) {
    return result;
  }
  return `${result}

[Watchdog] ${watchdogMessage}`;
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
    tools: getActiveToolsForProject(getProjectRoot()).map((tool) => ({
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
      tools: getActiveToolsForProject(getProjectRoot()).map((tool) => ({
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
    const toolExists = getActiveToolsForProject(getProjectRoot()).some((tool) => tool.name === toolName);
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
