#!/usr/bin/env node
import { serve } from "./lib/stdio.js";
import { recall } from "./lib/recall.js";
import { listProjects, getProjectContext } from "./lib/projects.js";
import { capture } from "./lib/capture.js";
import { catchMeUp } from "./lib/catchup.js";
import { genNoteId } from "./lib/noteid.js";
import { VERSION } from "./lib/version.js";
import { append as rememberNote, recent as recentMemory } from "../core/memory.js";
import { stamp } from "../core/date.js";
import { isRepoMode } from "./lib/mode.js";
import { toolsFor, assertAvailable } from "./lib/tools.js";
import { resolveBrain, NoRootError } from "./lib/resolve.js";
import { resolveProfile, UnknownProfileError } from "../core/profile.js";

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

// The third axis: which WORLD this install belongs to. Declared, never detected — a work laptop and
// a home laptop have the same shape on disk. A bad value is fatal rather than a fallback, because a
// typo resolving quietly to `home` looks identical to a correct home install while the user
// believes the firewall points the other way. See core/profile.js and docs/adr/0015.
let world;
try {
  world = resolveProfile({ env: process.env });
} catch (e) {
  if (e instanceof UnknownProfileError) {
    console.error("cortex: " + e.message);
    process.exit(1);
  }
  throw e;
}

// Pointed at a repo's .cortex/, Cortex is a context manager for that codebase: memory is committed
// and shared, and the vault's personal tools (projects, daily notes, team-brain) do not apply.
const REPO_MODE = isRepoMode(AI_OS_ROOT);

// Which tools exist, and which mode each runs in, is stated once in lib/tools.js. The list below
// and the guard inside callTool are both derived from that one table, so they cannot disagree.
const TOOLS = toolsFor(REPO_MODE);

// Returning plain data; the transport serializes it. Throwing marks the result as an error —
// which covers both a tool that is unavailable in this mode and one that failed outright.
async function callTool(name, args) {
  // Enforcement, not advertising: a client that already knows a tool's name never reads tools/list,
  // so hiding a vault tool in repo mode is not the same as refusing it.
  assertAvailable(name, REPO_MODE);
  switch (name) {
    case "recall": return recall(AI_OS_ROOT, args);
    case "remember": {
      const r = rememberNote(AI_OS_ROOT, args.content, { kind: args.kind || "note" });
      return { path: r.path, day: r.day };
    }
    case "recall_memory": return recentMemory(AI_OS_ROOT, { days: args.days || 7 });
    case "list_projects": return listProjects(AI_OS_ROOT);
    case "get_project_context": return getProjectContext(AI_OS_ROOT, args.project);
    // The team comes from the resolution, not from the caller. Requiring the agent to pass `team`
    // was the seam leaking: it made the dev side learn which world it was in, which is exactly what
    // the resolver exists to prevent. The argument survives as an explicit override.
    case "capture": {
      const team = args.team ?? brain.team ?? undefined;
      // stamp(), not toISOString().slice(0,10). The day a note is filed under is the day the
      // person filing it is living in: at 01:00 in UTC+3 those are 2026-08-19 and 2026-08-18, and
      // the UTC answer put the capture into yesterday's daily note. core/date.js is the only clock.
      // outwardSync is the one half of the profile that code can enforce; the firewall's direction
      // is prose the rituals read. Passing it here rather than letting capture read the environment
      // keeps capture a pure function of its arguments, which is what its tests rely on.
      const cargs = { ...args, team, today: stamp(), outwardSync: world.policy.outwardSync };
      if (team) cargs.noteId = genNoteId();
      return capture(AI_OS_ROOT, cargs);
    }
    case "catch_me_up": return catchMeUp(AI_OS_ROOT, { ...args, team: args.team ?? brain.team ?? undefined });
    // assertAvailable already rejected anything the table does not name, so reaching here means a
    // tool was declared in lib/tools.js and never wired up.
    default: throw new Error(`tool declared but not implemented: ${name}`);
  }
}

// stderr, never stdout — stdout is the MCP protocol channel and one stray line there corrupts the
// stream. Worth saying out loud because the audience is now load-bearing: if this says `solo` in a
// repo you expected to be connected, the connector is missing or unreadable, and `source` says
// which.
console.error(`cortex: profile=${world.profile} (${world.source}) audience=${brain.audience} (${brain.source}) mode=${REPO_MODE ? "repo" : "vault"} root=${AI_OS_ROOT}`);

serve({ name: "cortex", version: VERSION, tools: TOOLS, call: callTool });
