// Which brain, and who is it for.
//
// This is the seam from the three-mode design: everything above it (tools, rituals, the viewer) is
// audience-agnostic, and everything below it is one Vault. The dev side asks for `capture` and gets
// capture; it never learns whether a solo vault, a team clone or a scheduled host answered.
//
// Two axes, and they are NOT the same question — conflating them is a bug waiting to happen:
//
//   mode     (lib/mode.js)  repo | vault   — decided by whether the root ends in `.cortex`
//   audience (this file)    solo | team | server
//
// A repo-mode brain can be on a server; a vault-mode brain can be on a team. See docs/adr/0008.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { teamCloneDir } from "./gitsync.js";

export const SOLO = "solo";
export const TEAM = "team";
export const SERVER = "server";

export class NoRootError extends Error {
  constructor() {
    super("AI_OS_ROOT is not set");
    this.name = "NoRootError";
    this.code = "no_root";
  }
}

const CONNECTOR = join(".cortex", "connector.json");

// Walk up from `cwd` to the filesystem root. An agent runs in a subdirectory far more often than at
// the top of a repo, and without this, team mode silently becomes solo mode — notes stop reaching
// the team brain and nothing says so. First hit wins: the nearest connector is the relevant one when
// repos are nested.
function findConnector(cwd) {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, CONNECTOR);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * @param {{ cwd: string, env: Record<string,string|undefined> }} ctx
 * @returns {{ audience: string, root: string, team: string|null, teamClone: string|null, source: string }}
 */
export function resolveBrain({ cwd, env }) {
  // Never inferred. A resolver that invents a root can file a private note into a work repository,
  // and no amount of convenience is worth that. mcp/AGENTS.md states this as an invariant and
  // server.js has always enforced it; the resolver does not get to soften it.
  const root = String(env.AI_OS_ROOT ?? "").trim();
  if (!root) throw new NoRootError();

  let team = null;
  let teamClone = null;
  let detected = null;

  const connectorPath = findConnector(cwd);
  if (connectorPath) {
    try {
      const parsed = JSON.parse(readFileSync(connectorPath, "utf8"));
      if (parsed?.slug) {
        team = String(parsed.slug);
        teamClone = teamCloneDir(root, team);
        detected = `connector:${connectorPath}`;
      }
    } catch {
      // A brain that refuses to start because one JSON file is corrupt has turned a papercut into an
      // outage. Degrade to solo and say so in `source`, so the startup line explains itself.
      detected = `unreadable:${connectorPath}`;
    }
  }

  // Declaring beats detecting. A scheduled run on a host that happens to sit inside a connected repo
  // is still a server run, and server cannot be detected at all: it is solo minus interactive
  // prompts, plus a scheduler, plus a model that is not Claude Code — none of which leaves a trace.
  // Guessing from the absence of a TTY would be wrong in CI every time.
  if (env.CORTEX_AUDIENCE === SERVER) {
    return { audience: SERVER, root, team, teamClone, source: "declared" };
  }

  if (team) return { audience: TEAM, root, team, teamClone, source: detected };
  return { audience: SOLO, root, team: null, teamClone: null, source: detected ?? "default" };
}
