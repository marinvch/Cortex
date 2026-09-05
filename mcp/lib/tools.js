// The tool table: what Cortex offers, and in which mode each tool runs.
//
// Mode availability used to be stated twice and asymmetrically — once as the list `server.js`
// advertised, and again as an `if (!REPO_MODE) throw` inside two of the seven cases. The vault
// tools carried no guard at all, so `capture` INVOKED in repo mode executed: the list was the only
// thing stopping it, and a list is advertising, not enforcement. A client that already knows the
// name never reads the list.
//
// So `mode` is a field on the declaration, next to the name and the schema, and both the list and
// the guard are derived from it. They cannot disagree, and a tool cannot be added without saying
// where it runs.

/** A tool that needs a repo's `.cortex/` — committed, shared, code-adjacent memory. */
export const REPO = "repo";
/** A tool that needs a personal vault's folder layout — inbox/, daily/, projects/. */
export const VAULT = "vault";
/** A tool that is correct in either: it reads markdown under the root, and both roots are that. */
export const ANY = "any";

const MODES = new Set([REPO, VAULT, ANY]);

/**
 * Every tool, with the mode it runs in. Descriptions and schemas are sent verbatim to the client;
 * `mode` is ours and is stripped before they go out.
 */
export const TOOL_TABLE = [
  { name: "recall", mode: ANY,
    description: "Lexical search over the indexed markdown; returns ranked snippets with file paths.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, project: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },

  { name: "remember", mode: REPO,
    description: "Append a durable note to this repo's committed .cortex/memory/. Refuses anything carrying a credential — memory ships with the code.",
    inputSchema: { type: "object", properties: { content: { type: "string" }, kind: { type: "string", description: "note | decision | dream | drift" } }, required: ["content"] } },
  { name: "recall_memory", mode: REPO,
    description: "Read back recent days of this repo's committed memory, newest first.",
    inputSchema: { type: "object", properties: { days: { type: "number" } } } },

  { name: "get_project_context", mode: VAULT,
    description: "Return a project's brief/notes.",
    inputSchema: { type: "object", properties: { project: { type: "string" } }, required: ["project"] } },
  { name: "list_projects", mode: VAULT,
    description: "List projects registered in the brain.",
    inputSchema: { type: "object", properties: {} } },
  { name: "capture", mode: VAULT,
    description: "Append an explicit note to the vault; returns the path. In a repo connected to a team-brain this writes there automatically (one-file-per-note, auto commit+push).",
    inputSchema: { type: "object", properties: { content: { type: "string" }, project: { type: "string" }, tags: { type: "array", items: { type: "string" } }, team: { type: "string", description: "Override the team-brain this writes to. Defaults to the connected team, so you rarely need it." } }, required: ["content"] } },
  { name: "catch_me_up", mode: VAULT,
    description: "Assemble notes + team-brain git history since <since> as raw material for the agent to summarize.",
    inputSchema: { type: "object", properties: { project: { type: "string" }, since: { type: "string" }, team: { type: "string", description: "Override the team-brain to read. Defaults to the connected team." } }, required: ["project", "since"] } },
];

const runsHere = (mode, repoMode) => mode === ANY || (repoMode ? mode === REPO : mode === VAULT);

/**
 * The descriptors to advertise in this mode, without the `mode` field — the client sees exactly
 * what it saw before this table existed.
 *
 * @param {boolean} repoMode
 * @returns {{name: string, description: string, inputSchema: object}[]}
 */
export function toolsFor(repoMode) {
  return TOOL_TABLE
    .filter((t) => runsHere(t.mode, repoMode))
    .map(({ mode, ...descriptor }) => descriptor);
}

/**
 * Refuse a call the declared mode does not allow. Throwing is how a tool reports failure over this
 * transport, so a refusal reaches the client as an error result rather than a dead call.
 *
 * @param {string} name    the tool the client asked for
 * @param {boolean} repoMode
 */
export function assertAvailable(name, repoMode) {
  const tool = TOOL_TABLE.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  if (runsHere(tool.mode, repoMode)) return;
  if (tool.mode === REPO) {
    throw new Error(`${name} is only available when Cortex is pointed at a repo's .cortex/`);
  }
  // The refusal that matters: this root is someone's product repository, and the vault tools write
  // inbox/ and daily/.
  throw new Error(`${name} is only available when Cortex is pointed at a vault; this root is a repo's .cortex/`);
}

/** Every declaration is well-formed. Called at import time so a malformed row cannot start. */
for (const t of TOOL_TABLE) {
  if (!MODES.has(t.mode)) throw new Error(`tool ${t.name}: mode must be one of repo | vault | any`);
}
