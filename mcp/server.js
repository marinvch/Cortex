#!/usr/bin/env node
import { serve } from "./lib/stdio.js";
import { recall } from "./lib/recall.js";
import { listProjects, getProjectContext } from "./lib/projects.js";
import { capture } from "./lib/capture.js";
import { catchMeUp } from "./lib/catchup.js";
import { genNoteId } from "./lib/noteid.js";
import { VERSION } from "./lib/version.js";
import { append as rememberNote, recent as recentMemory } from "../core/memory.js";
import { isRepoMode } from "./lib/mode.js";
import { resolveBrain, NoRootError } from "./lib/resolve.js";

// Two independent questions, answered by two modules. `mode` is repo-vs-vault — what KIND of brain
// this root is. `audience` is solo/team/server — WHO it serves. A repo-mode brain can be on a
// server; a vault-mode brain can be on a team. See docs/adr/0008.
let brain;
try {
  brain = resolveBrain({ cwd: process.cwd(), env: process.env });
} catch (e) {
  if (e instanceof NoRootError) {
    console.error("ai-os-mcp: AI_OS_ROOT is not set. Set it to your vault path, or a repo's .cortex/.");
    process.exit(1);
  }
  throw e;
}
const AI_OS_ROOT = brain.root;
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
  { name: "capture", description: "Append an explicit note to the vault; returns the path. In a repo connected to a team-brain this writes there automatically (one-file-per-note, auto commit+push).",
    inputSchema: { type: "object", properties: { content: { type: "string" }, project: { type: "string" }, tags: { type: "array", items: { type: "string" } }, team: { type: "string", description: "Override the team-brain this writes to. Defaults to the connected team, so you rarely need it." } }, required: ["content"] } },
  { name: "catch_me_up", description: "Assemble notes + team-brain git history since <since> as raw material for the agent to summarize.",
    inputSchema: { type: "object", properties: { project: { type: "string" }, since: { type: "string" }, team: { type: "string", description: "Override the team-brain to read. Defaults to the connected team." } }, required: ["project", "since"] } },
];

// `recall` works in both modes — it is lexical search over markdown under the root, and both a
// vault and a .cortex directory are exactly that.
const SHARED_TOOLS = [
  { name: "recall", description: "Lexical search over the indexed markdown; returns ranked snippets with file paths.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, project: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
];

const TOOLS = REPO_MODE ? [...SHARED_TOOLS, ...REPO_TOOLS] : [...SHARED_TOOLS, ...VAULT_TOOLS];

// Returning plain data; the transport serializes it. Throwing marks the result as an error —
// which covers both a tool that is unavailable in this mode and one that failed outright.
async function callTool(name, args) {
  switch (name) {
    case "recall": return recall(AI_OS_ROOT, args);
    case "remember": {
      if (!REPO_MODE) throw new Error("remember is only available when Cortex is pointed at a repo's .cortex/");
      const r = rememberNote(AI_OS_ROOT, args.content, { kind: args.kind || "note" });
      return { path: r.path, day: r.day };
    }
    case "recall_memory": {
      if (!REPO_MODE) throw new Error("recall_memory is only available when Cortex is pointed at a repo's .cortex/");
      return recentMemory(AI_OS_ROOT, { days: args.days || 7 });
    }
    case "list_projects": return listProjects(AI_OS_ROOT);
    case "get_project_context": return getProjectContext(AI_OS_ROOT, args.project);
    // The team comes from the resolution, not from the caller. Requiring the agent to pass `team`
    // was the seam leaking: it made the dev side learn which world it was in, which is exactly what
    // the resolver exists to prevent. The argument survives as an explicit override.
    case "capture": {
      const team = args.team ?? brain.team ?? undefined;
      const cargs = { ...args, team, today: today() };
      if (team) cargs.noteId = genNoteId();
      return capture(AI_OS_ROOT, cargs);
    }
    case "catch_me_up": return catchMeUp(AI_OS_ROOT, { ...args, team: args.team ?? brain.team ?? undefined });
    default: throw new Error(`unknown tool: ${name}`);
  }
}

// stderr, never stdout — stdout is the MCP protocol channel and one stray line there corrupts the
// stream. Worth saying out loud because the audience is now load-bearing: if this says `solo` in a
// repo you expected to be connected, the connector is missing or unreadable, and `source` says
// which.
console.error(`cortex: audience=${brain.audience} (${brain.source}) mode=${REPO_MODE ? "repo" : "vault"} root=${AI_OS_ROOT}`);

serve({ name: "cortex", version: VERSION, tools: TOOLS, call: callTool });
