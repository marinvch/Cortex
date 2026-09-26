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
import { toolsFor, assertAvailable, assertPublishable } from "./lib/tools.js";
import { openBrain, NoRootError, UnknownProfileError } from "./lib/brain.js";

// Three independent questions, composed by one module and answered by three. `mode` is
// repo-vs-vault — what KIND of brain this root is. `audience` is solo/team/server — WHO it serves.
// `profile` is home/work/lab — WHICH WORLD it belongs to. A work laptop can run a repo-mode brain
// on a team. See lib/brain.js, docs/adr/0008 and docs/adr/0015.
//
// Opened once, here, before anything dispatches: the CLI is the second adapter over these same
// operations and it opens the brain at its own entry, so neither one re-derives the answer and
// gets it wrong. A bad value is fatal rather than a fallback — a typo in CORTEX_PROFILE resolving
// quietly to `home` looks identical to a correct home install while the user believes the firewall
// points the other way, and a guessed root files a private note into a work repository.
let brain;
try {
  brain = openBrain({ cwd: process.cwd(), env: process.env });
} catch (e) {
  if (e instanceof NoRootError) {
    console.error("ai-os-mcp: AI_OS_ROOT is not set. Set it to your vault path, or a repo's .cortex/.");
    process.exit(1);
  }
  if (e instanceof UnknownProfileError) {
    console.error("cortex: " + e.message);
    process.exit(1);
  }
  throw e;
}
const AI_OS_ROOT = brain.root;

// Pointed at a repo's .cortex/, Cortex is a context manager for that codebase: memory is committed
// and shared, and the vault's personal tools (projects, daily notes, team-brain) do not apply.
const REPO_MODE = brain.isRepo;

// Which tools exist, and which mode each runs in, is stated once in lib/tools.js. The list below
// and the guard inside callTool are both derived from that one table, so they cannot disagree.
const TOOLS = toolsFor(REPO_MODE);

// Returning plain data; the transport serializes it. Throwing marks the result as an error —
// which covers both a tool that is unavailable in this mode and one that failed outright.
async function callTool(name, args) {
  // Enforcement, not advertising: a client that already knows a tool's name never reads tools/list,
  // so hiding a vault tool in repo mode is not the same as refusing it.
  assertAvailable(name, REPO_MODE);
  // The second half of the same seam, derived from the same table. `assertAvailable` asks whether
  // this tool may run against this root; this asks whether what it is about to write may leave the
  // machine. `remember` was gated in core/memory.js and `capture` — which commits and PUSHES to a
  // shared remote on a team — was not, because that gate was a convention callers applied rather
  // than the only way through. Refuses, never sanitises (core/scrub.js).
  assertPublishable(name, args);
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
      const cargs = { ...args, team, today: stamp(), outwardSync: brain.policy.outwardSync };
      if (team) cargs.noteId = genNoteId();
      // Same reasoning for the project: the connector names it, so a team note with none lands under
      // this repo's project rather than the team-brain's `inbox`.
      if (team && !args.project && brain.project) cargs.project = brain.project;
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
console.error(brain.describe());

serve({ name: "cortex", version: VERSION, tools: TOOLS, call: callTool });
