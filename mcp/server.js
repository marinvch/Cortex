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
