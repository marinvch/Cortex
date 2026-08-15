#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { recall } from "./lib/recall.js";
import { listProjects, getProjectContext } from "./lib/projects.js";
import { capture } from "./lib/capture.js";
import { catchMeUp } from "./lib/catchup.js";
import { genNoteId } from "./lib/noteid.js";
import { VERSION } from "./lib/version.js";
import { append as rememberNote, recent as recentMemory } from "../core/memory.js";
import { isRepoMode } from "./lib/mode.js";

const AI_OS_ROOT = process.env.AI_OS_ROOT;
if (!AI_OS_ROOT) {
  console.error("ai-os-mcp: AI_OS_ROOT is not set. Set it to your vault path, or a repo's .cortex/.");
  process.exit(1);
}
const today = () => new Date().toISOString().slice(0, 10);

// Pointed at a repo's .cortex/, Cortex is a context manager for that codebase: memory is committed
// and shared, and the vault's personal tools (projects, daily notes, team-brain) do not apply.
const REPO_MODE = isRepoMode(AI_OS_ROOT);

// Available in repo mode only.
const REPO_TOOLS = [
  { name: "remember", description: "Append a durable note to this repo's committed .cortex/memory/. Refuses anything carrying a credential — memory ships with the code.",
    inputSchema: { type: "object", properties: { content: { type: "string" }, kind: { type: "string", description: "note | decision | dream | drift" } }, required: ["content"] } },
  { name: "recall_memory", description: "Read back recent days of this repo's committed memory, newest first.",
    inputSchema: { type: "object", properties: { days: { type: "number" } } } },
];

// Available in vault mode only — they assume a personal vault's folder layout.
const VAULT_TOOLS = [
  { name: "get_project_context", description: "Return a project's brief/notes.",
    inputSchema: { type: "object", properties: { project: { type: "string" } }, required: ["project"] } },
  { name: "list_projects", description: "List projects registered in the brain.",
    inputSchema: { type: "object", properties: {} } },
  { name: "capture", description: "Append an explicit note to the vault; returns the path. Pass `team` to write into the team-brain (one-file-per-note, auto commit+push).",
    inputSchema: { type: "object", properties: { content: { type: "string" }, project: { type: "string" }, tags: { type: "array", items: { type: "string" } }, team: { type: "string" } }, required: ["content"] } },
  { name: "catch_me_up", description: "Assemble notes + team-brain git history since <since> as raw material for the agent to summarize.",
    inputSchema: { type: "object", properties: { project: { type: "string" }, since: { type: "string" }, team: { type: "string" } }, required: ["project", "since"] } },
];

// `recall` works in both modes — it is lexical search over markdown under the root, and both a
// vault and a .cortex directory are exactly that.
const SHARED_TOOLS = [
  { name: "recall", description: "Lexical search over the indexed markdown; returns ranked snippets with file paths.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, project: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
];

const TOOLS = REPO_MODE ? [...SHARED_TOOLS, ...REPO_TOOLS] : [...SHARED_TOOLS, ...VAULT_TOOLS];

const server = new Server({ name: "cortex", version: VERSION }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
  const fail = (msg) => ({ content: [{ type: "text", text: msg }], isError: true });
  try {
    switch (name) {
      case "recall": return ok(recall(AI_OS_ROOT, args));
      case "remember": {
        if (!REPO_MODE) return fail("remember is only available when Cortex is pointed at a repo's .cortex/");
        const r = rememberNote(AI_OS_ROOT, args.content, { kind: args.kind || "note" });
        return ok({ path: r.path, day: r.day });
      }
      case "recall_memory": {
        if (!REPO_MODE) return fail("recall_memory is only available when Cortex is pointed at a repo's .cortex/");
        return ok(recentMemory(AI_OS_ROOT, { days: args.days || 7 }));
      }
      case "list_projects": return ok(listProjects(AI_OS_ROOT));
      case "get_project_context": return ok(getProjectContext(AI_OS_ROOT, args.project));
      case "capture": {
        const cargs = { ...args, today: today() };
        if (args.team) cargs.noteId = genNoteId();
        return ok(capture(AI_OS_ROOT, cargs));
      }
      case "catch_me_up": return ok(catchMeUp(AI_OS_ROOT, args));
      default: return fail(`unknown tool: ${name}`);
    }
  } catch (e) {
    return fail(`${e.code || "error"}: ${e.message}`);
  }
});

await server.connect(new StdioServerTransport());
